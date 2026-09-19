/** @license Apache-2.0 */
import type { NormalizedTrace, TracePart } from './model.js';

type TraceOutcome = NonNullable<NormalizedTrace['outcome']>;
type OutcomeFact = TraceOutcome['facts'][number];

const FACT_ORDER: readonly OutcomeFact[] = [
  'files_changed',
  'tests_passed',
  'tests_failed',
  'lint_passed',
  'build_passed',
  'proof_passed',
  'commit_created',
  'user_cancelled',
  'tool_error',
];

interface ObservedCall {
  name: string;
  arguments?: unknown;
}

function commandFrom(argumentsValue: unknown): string {
  if (!argumentsValue || typeof argumentsValue !== 'object' || Array.isArray(argumentsValue)) return '';
  const command = (argumentsValue as Record<string, unknown>).command;
  return typeof command === 'string' ? command.toLowerCase() : '';
}

function verificationKind(call: ObservedCall): 'tests' | 'lint' | 'build' | 'proof' | undefined {
  const value = `${call.name.toLowerCase()} ${commandFrom(call.arguments)}`;
  if (/\b(?:proof|check-release)\b/u.test(value)) return 'proof';
  if (/\b(?:test|vitest|jest|pytest|cargo test|go test)\b/u.test(value)) return 'tests';
  if (/\b(?:lint|eslint|rubocop|clippy)\b/u.test(value)) return 'lint';
  if (/\b(?:build|compile|tsc)\b/u.test(value)) return 'build';
  return undefined;
}

function isMutation(call: ObservedCall): boolean {
  return /(?:write|edit|patch|replace|append|delete|rename|copy|notebook)/iu.test(call.name);
}

function isCommit(call: ObservedCall): boolean {
  return /(?:git_commit|commit)/iu.test(call.name)
    || /\bgit\s+commit\b/u.test(commandFrom(call.arguments));
}

function factForVerification(
  kind: NonNullable<ReturnType<typeof verificationKind>>,
  succeeded: boolean,
): OutcomeFact | undefined {
  if (!succeeded) return kind === 'tests' ? 'tests_failed' : 'tool_error';
  if (kind === 'tests') return 'tests_passed';
  if (kind === 'lint') return 'lint_passed';
  if (kind === 'build') return 'build_passed';
  if (kind === 'proof') return 'proof_passed';
  return undefined;
}

function resultSucceeded(part: Extract<TracePart, { type: 'tool_result' }>): boolean | undefined {
  if (part.isError === true) return false;
  if (part.exitCode !== undefined) return part.exitCode === 0;
  return undefined;
}

export function deriveTraceOutcome(trace: Pick<NormalizedTrace, 'messages' | 'status'>): TraceOutcome {
  const facts = new Set<OutcomeFact>();
  const calls = new Map<string, ObservedCall>();
  let mostRecentCall: ObservedCall | undefined;
  let lastVerificationSucceeded: boolean | undefined;

  for (const message of trace.messages) {
    for (const part of message.parts) {
      if (part.type === 'tool_call') {
        const call = { name: part.name, arguments: part.arguments };
        mostRecentCall = call;
        if (part.callId) calls.set(part.callId, call);
        continue;
      }
      if (part.type === 'error') {
        facts.add('tool_error');
        continue;
      }
      if (part.type === 'terminal') {
        if (part.exitCode === undefined) continue;
        const call = { name: 'terminal', arguments: { command: part.command ?? '' } };
        const verification = verificationKind(call);
        const succeeded = part.exitCode === 0;
        if (verification) {
          const fact = factForVerification(verification, succeeded);
          if (fact) facts.add(fact);
          lastVerificationSucceeded = succeeded;
        } else if (!succeeded) {
          facts.add('tool_error');
        }
        continue;
      }
      if (part.type !== 'tool_result') continue;
      const call = (part.callId ? calls.get(part.callId) : undefined)
        ?? (part.name ? { name: part.name } : undefined)
        ?? mostRecentCall;
      const succeeded = resultSucceeded(part);
      if (succeeded === false) facts.add('tool_error');
      if (!call) continue;
      if (isMutation(call) && succeeded !== false) facts.add('files_changed');
      if (isCommit(call) && succeeded !== false) facts.add('commit_created');
      const verification = verificationKind(call);
      if (verification && succeeded !== undefined) {
        const fact = factForVerification(verification, succeeded);
        if (fact) facts.add(fact);
        lastVerificationSucceeded = succeeded;
      }
    }
  }

  if (trace.status === 'cancelled') facts.add('user_cancelled');
  let state: TraceOutcome['state'];
  if (trace.status === 'cancelled') state = 'cancelled';
  else if (trace.status === 'failed') state = 'failed';
  else if (trace.status === 'active') state = 'partial';
  else if (lastVerificationSucceeded === true) state = 'verified';
  else if (trace.status === 'completed') state = 'completed_unverified';
  else state = 'unknown';

  return {
    state,
    facts: FACT_ORDER.filter((fact) => facts.has(fact)),
    confidence: state === 'unknown' ? 'low' : state === 'completed_unverified' ? 'medium' : 'high',
  };
}
