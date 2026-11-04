import { resolveAutohandAICloudBaseUrl } from '../providers/AutohandAIProvider.js';
import { discardResponseBody } from '../utils/responseBody.js';
import {
  authorizeDecision, decisionPolicyFingerprint,
  type AuthorizedDecisionRoute, type DecisionFeature, type DecisionLocalReason, type DecisionPolicyContext,
} from './policy.js';

export interface DecisionQuestion { type: 'noul'; instructions: string }
export interface DecisionAnswer { type: 'noul'; noul: number }
export interface DecisionUsage { inputTokens?: number; outputTokens?: number; cost?: number }

export interface DecisionRequest {
  feature: DecisionFeature;
  state: unknown;
  questions: Readonly<Record<string, DecisionQuestion>>;
  model?: string;
  policyEpoch?: number;
  signal?: AbortSignal;
  maxAttempts?: number;
  deadlineMs?: number;
}

export interface DecisionProviderRequest {
  model: string;
  state: unknown;
  questions: Readonly<Record<string, DecisionQuestion>>;
  signal: AbortSignal;
}

export interface DecisionProviderTransport {
  provider: string;
  dispatch(request: DecisionProviderRequest): Promise<unknown>;
}

export type DecisionResult = {
  status: 'completed'; answers: Readonly<Record<string, DecisionAnswer>>;
  provider: string; model: string; attempts: number; usage?: DecisionUsage;
} | {
  status: 'local'; reason: DecisionLocalReason; attempts: number; dispatched: boolean; usage?: DecisionUsage;
};

export interface DecisionDispatchEvent {
  feature: DecisionFeature;
  status: 'dispatched' | 'completed' | 'discarded' | 'local';
  attempts: number;
  provider?: string;
  model?: string;
  reason?: DecisionLocalReason;
  usage?: DecisionUsage;
}

export interface DecisionDispatcherOptions {
  getContext(): DecisionPolicyContext | Promise<DecisionPolicyContext>;
  providerTransport?: DecisionProviderTransport;
  onEvent?(event: DecisionDispatchEvent): void;
}

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024;
const MAX_QUESTIONS = 32;
const MAX_DEADLINE_MS = 10_000;

class DecisionFailure extends Error {
  constructor(readonly reason: DecisionLocalReason, readonly retryable = false) { super(reason); }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requestBody(input: DecisionRequest, model: string): string {
  const questions = Object.entries(input.questions);
  if (questions.length < 1 || questions.length > MAX_QUESTIONS || questions.some(([id, question]) =>
    !/^[A-Za-z0-9_.:-]{1,128}$/u.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)
      || question.type !== 'noul' || !question.instructions.trim() || question.instructions.length > 2_000)) {
    throw new DecisionFailure('invalid-request');
  }
  let body: string;
  try { body = JSON.stringify({ model, state: input.state, questions: input.questions }); }
  catch { throw new DecisionFailure('invalid-request'); }
  if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) throw new DecisionFailure('request-too-large');
  return body;
}

function usageFrom(value: unknown): DecisionUsage | undefined {
  if (!record(value)) return undefined;
  const usage: DecisionUsage = {};
  for (const [key, candidates] of [
    ['inputTokens', [value.input_tokens, value.prompt_tokens]],
    ['outputTokens', [value.output_tokens, value.completion_tokens]],
    ['cost', [value.cost]],
  ] as const) {
    const number = candidates.find(candidate => typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0);
    if (typeof number === 'number') usage[key] = number;
  }
  return Object.keys(usage).length ? usage : undefined;
}

function validateResponse(value: unknown, questions: Readonly<Record<string, DecisionQuestion>>): {
  answers: Readonly<Record<string, DecisionAnswer>>; usage?: DecisionUsage;
} {
  if (!record(value) || !record(value.answers)) throw new DecisionFailure('invalid-response');
  const ids = Object.keys(questions);
  if (Object.keys(value.answers).length !== ids.length) throw new DecisionFailure('invalid-response');
  const answers: Record<string, DecisionAnswer> = {};
  for (const id of ids) {
    const answer = value.answers[id];
    if (!record(answer) || Object.keys(answer).length !== 2 || answer.type !== 'noul'
      || typeof answer.noul !== 'number' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) {
      throw new DecisionFailure('invalid-response');
    }
    answers[id] = { type: 'noul', noul: answer.noul };
  }
  return { answers, usage: usageFrom(value.usage) };
}

function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    const settled = () => signal.removeEventListener('abort', aborted);
    operation.then(value => { settled(); resolve(value); }, error => { settled(); reject(error); });
    if (signal.aborted) aborted();
    else signal.addEventListener('abort', aborted, { once: true });
  });
}

async function boundedResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (declaredLength > MAX_RESPONSE_BYTES) {
    discardResponseBody(response);
    throw new DecisionFailure('response-too-large');
  }
  if (!response.body) throw new DecisionFailure('invalid-response');
  const reader = response.body.getReader();
  let consumed = false;
  try {
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const chunk = await withAbort(reader.read(), signal);
      if (chunk.done) { consumed = true; break; }
      length += chunk.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw new DecisionFailure('response-too-large');
      chunks.push(chunk.value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new DecisionFailure('invalid-response'); }
  } finally {
    if (!consumed) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export class DecisionDispatcher {
  constructor(private readonly options: DecisionDispatcherOptions) {}

  private event(event: DecisionDispatchEvent): void {
    try { this.options.onEvent?.(event); } catch { /* Observability cannot authorize or block inference. */ }
  }

  async dispatch(input: DecisionRequest): Promise<DecisionResult> {
    input.signal?.throwIfAborted();
    const requestedDeadline = input.deadlineMs ?? MAX_DEADLINE_MS;
    const deadline = Number.isFinite(requestedDeadline) ? Math.max(1, Math.min(MAX_DEADLINE_MS, requestedDeadline)) : MAX_DEADLINE_MS;
    const signal = AbortSignal.any([AbortSignal.timeout(deadline), ...(input.signal ? [input.signal] : [])]);
    let attempts = 0;
    const routeState: { current?: AuthorizedDecisionRoute } = {};
    let usage: DecisionUsage | undefined;
    const local = (reason: DecisionLocalReason): DecisionResult => {
      const route = routeState.current;
      this.event({ feature: input.feature, status: reason === 'stale-policy' && attempts > 0 ? 'discarded' : 'local', reason, attempts, provider: route?.provider, model: route?.model, usage });
      return { status: 'local', reason, attempts, dispatched: attempts > 0, usage };
    };
    let initial: DecisionPolicyContext;
    let fingerprint: string;
    try {
      initial = await withAbort(Promise.resolve(this.options.getContext()), signal);
      fingerprint = decisionPolicyFingerprint(initial);
    } catch {
      input.signal?.throwIfAborted();
      return local(signal.aborted ? 'deadline' : 'context-unavailable');
    }
    if (input.policyEpoch !== undefined && input.policyEpoch !== initial.policyEpoch) return local('stale-policy');
    const authorized = authorizeDecision(initial, input.feature, input.model);
    if (!authorized.allowed) return local(authorized.reason);
    const route = authorized.route;
    routeState.current = route;
    if (!route.weka && this.options.providerTransport?.provider !== route.provider) return local('transport-unavailable');
    let body: string;
    try { body = requestBody(input, route.model); }
    catch (error) { return local(error instanceof DecisionFailure ? error.reason : 'invalid-request'); }
    const captured = JSON.parse(body) as Pick<DecisionProviderRequest, 'state' | 'questions'>;
    const maxAttempts = Math.max(1, Math.min(2, Math.floor(input.maxAttempts ?? 1) || 1));
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      input.signal?.throwIfAborted();
      if (signal.aborted) return local('deadline');
      let current: DecisionPolicyContext;
      try {
        current = await withAbort(Promise.resolve(this.options.getContext()), signal);
        if (decisionPolicyFingerprint(current) !== fingerprint) return local('stale-policy');
      } catch {
        input.signal?.throwIfAborted();
        return local(signal.aborted ? 'deadline' : 'context-unavailable');
      }
      const permission = authorizeDecision(current, input.feature, input.model);
      if (!permission.allowed) return local(permission.reason);
      try {
        signal.throwIfAborted();
        attempts++;
        const pending = route.weka
          ? this.dispatchWeka(current, body, signal)
          : this.options.providerTransport!.dispatch({ model: route.model, state: captured.state, questions: captured.questions, signal });
        this.event({ feature: input.feature, status: 'dispatched', attempts, provider: route.provider, model: route.model });
        const payload = await withAbort(pending, signal);
        let serialized: string;
        try { serialized = JSON.stringify(payload); } catch { throw new DecisionFailure('invalid-response'); }
        if (typeof serialized !== 'string') throw new DecisionFailure('invalid-response');
        if (Buffer.byteLength(serialized, 'utf8') > MAX_RESPONSE_BYTES) throw new DecisionFailure('response-too-large');
        const response = validateResponse(payload, captured.questions);
        usage = response.usage;
        input.signal?.throwIfAborted();
        if (signal.aborted) return local('deadline');
        const latest = await withAbort(Promise.resolve(this.options.getContext()), signal);
        if (decisionPolicyFingerprint(latest) !== fingerprint || !authorizeDecision(latest, input.feature, input.model).allowed) return local('stale-policy');
        this.event({ feature: input.feature, status: 'completed', attempts, provider: route.provider, model: route.model, usage });
        return { status: 'completed', answers: response.answers, provider: route.provider, model: route.model, attempts, usage };
      } catch (error) {
        input.signal?.throwIfAborted();
        if (signal.aborted) return local('deadline');
        if (error instanceof DecisionFailure) {
          if (error.retryable && attempt + 1 < maxAttempts) continue;
          return local(error.reason);
        }
        if (attempt + 1 >= maxAttempts) return local('transport-failed');
      }
    }
    return local('transport-failed');
  }

  private async dispatchWeka(context: DecisionPolicyContext, body: string, signal: AbortSignal): Promise<unknown> {
    const settings = context.autohandSettings!;
    const token = settings.authMode === 'account' ? settings.accountToken : settings.apiKey;
    const response = await fetch(`${resolveAutohandAICloudBaseUrl(settings.baseUrl).replace(/\/$/, '')}/decisions`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(settings.accountId ? { 'X-Autohand-Account-Id': settings.accountId } : {}) },
      body, signal,
    });
    if (!response.ok) {
      discardResponseBody(response);
      throw new DecisionFailure('transport-failed', response.status === 429 || response.status >= 500);
    }
    return boundedResponse(response, signal);
  }
}
