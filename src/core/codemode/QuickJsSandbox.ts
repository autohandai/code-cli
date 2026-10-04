/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  QuickJSContext,
  QuickJSDeferredPromise,
  QuickJSHandle,
  QuickJSRuntime,
  QuickJSWASMModule,
} from 'quickjs-emscripten-core';

export interface SandboxToolCall {
  id: number;
  tool: string;
  args: unknown;
}

export type SandboxToolOutcome =
  | { ok: true; output: string }
  | { ok: false; error: string; kind?: string; output?: string };

export interface SandboxLimits {
  /** Ceiling on the sandbox's whole linear memory; the QuickJS module itself needs 16 MiB, so that is the floor. */
  memoryBytes: number;
  /** Capped at 256 KiB, the most the host stack can back. */
  stackBytes: number;
  maxScriptChars: number;
  maxResultChars: number;
  maxLogChars: number;
  maxToolCalls: number;
  /** Applied to each outcome before it enters the guest. */
  maxToolResultChars: number;
}

export interface SandboxRunOptions {
  /** Body of an async function: top-level `await` and `return` are allowed. Plain JavaScript. */
  script: string;
  /** Exposed to the guest as `tools.<name>(args)` and `tools["<name>"](args)`; each returns a Promise of a SandboxToolOutcome object. */
  toolNames: readonly string[];
  /**
   * Receives every tool call the guest issued since it last yielded (e.g. all members of a Promise.all),
   * and resolves with one outcome per call in the same order. If it rejects, the script is stopped and the
   * rejection message becomes the run's error with errorKind 'aborted'.
   */
  executeToolCalls: (calls: SandboxToolCall[]) => Promise<SandboxToolOutcome[]>;
  /** Budget for guest execution time only; time spent inside executeToolCalls does not count. */
  timeoutMs: number;
  signal?: AbortSignal;
  limits?: Partial<SandboxLimits>;
}

export interface SandboxRunResult {
  ok: boolean;
  /** JSON text of the script's return value ("null" for undefined), cut at maxResultChars with an explicit marker. */
  result?: string;
  error?: string;
  /** Absent when the sandbox itself failed rather than the script. */
  errorKind?: 'script' | 'timeout' | 'aborted' | 'limit';
  /** console output, one line per call, cut at maxLogChars with a marker. */
  logs: string;
  /** Number of tool calls the guest issued. */
  toolCalls: number;
  durationMs: number;
}

const KIB = 1024;
const MIB = 1024 * KIB;

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = Object.freeze({
  memoryBytes: 64 * MIB,
  stackBytes: 128 * KIB,
  maxScriptChars: 50_000,
  maxResultChars: 20_000,
  maxLogChars: 4_000,
  maxToolCalls: 200,
  maxToolResultChars: MIB,
});

// Guest frames live on the host stack: above this the host overflows before QuickJS notices.
const MAX_STACK_BYTES = 256 * KIB;
const WASM_PAGE_BYTES = 64 * KIB;
// The memory size the QuickJS module declares for itself; a smaller import fails to link.
const WASM_INITIAL_BYTES = 16 * MIB;
const WASM_MAX_BYTES = 2048 * MIB;
const MAX_ERROR_CHARS = 2_000;
const MAX_STACK_TRACE_CHARS = 600;
const ABORT_MESSAGE = 'The script was aborted.';

// Bound at load so the execution budget keeps running when a caller installs fake timers.
const monotonicNow = performance.now.bind(performance);

type ErrorKind = NonNullable<SandboxRunResult['errorKind']>;
type Failure = { ok: false; error: string; errorKind?: ErrorKind };
type Verdict = { ok: true; result: string } | Failure;

interface GuestResource {
  readonly alive: boolean;
  dispose(): void;
}

interface PendingCall {
  call: SandboxToolCall;
  deferred: QuickJSDeferredPromise;
}

/**
 * Evaluated once per run. The two bridge functions arrive as arguments and stay in this closure, so the
 * script can reach them only through `tools` and `console`; nothing but strings crosses in either direction.
 */
const GUEST_BOOTSTRAP = String.raw`(function (hostCall, hostLog, toolNamesJson) {
  'use strict';
  const { stringify, parse } = JSON;
  const reject = Promise.reject.bind(Promise);
  const hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty);
  const AsyncFunction = (async () => {}).constructor;

  const describe = (value) => {
    if (typeof value === 'string') return value;
    try {
      if (value instanceof Error) return value.name + ': ' + value.message;
      const json = stringify(value);
      return typeof json === 'string' ? json : String(value);
    } catch {
      try { return String(value); } catch { return '[unprintable]'; }
    }
  };
  const logger = (level) => (...values) => { hostLog(level, values.map(describe).join(' ')); };

  const toolFunction = (name) => (args) => {
    let json;
    try {
      json = stringify(args === undefined ? {} : args);
    } catch (error) {
      return reject(new TypeError('Arguments for ' + name + ' are not JSON-serialisable: ' + error.message));
    }
    if (typeof json !== 'string') {
      return reject(new TypeError('Arguments for ' + name + ' are not JSON-serialisable.'));
    }
    try {
      return hostCall(name, json).then(parse);
    } catch (error) {
      return reject(error);
    }
  };
  const unknownTool = (name) => () => reject(new Error(
    'Unknown tool "' + name + '". Object.keys(tools) lists the tools available to this script.'
  ));

  const exposed = Object.create(null);
  for (const name of parse(toolNamesJson)) exposed[name] = toolFunction(name);
  const tools = new Proxy(Object.freeze(exposed), {
    get(target, key) {
      if (typeof key !== 'string' || key === 'then' || key === 'toJSON') return undefined;
      return hasOwn(target, key) ? target[key] : unknownTool(key);
    },
  });

  Object.defineProperty(globalThis, 'tools', { value: tools });
  Object.defineProperty(globalThis, 'console', {
    value: Object.freeze({
      log: logger('log'), info: logger('info'), debug: logger('debug'), warn: logger('warn'), error: logger('error'),
    }),
  });

  return (source) => new AsyncFunction('"use strict"; ' + source)().then((value) => {
    let json;
    try {
      json = stringify(value);
    } catch (error) {
      throw new TypeError('The script return value is not JSON-serialisable: ' + error.message);
    }
    return typeof json === 'string' ? json : 'null';
  });
})`;

interface WasmMemory {
  readonly buffer: ArrayBuffer;
  grow(deltaPages: number): number;
}

// The project compiles without the DOM lib, which is where TypeScript declares WebAssembly.
const WasmMemoryBase = (globalThis as unknown as {
  WebAssembly: { Memory: new (descriptor: { initial: number; maximum: number }) => WasmMemory };
}).WebAssembly.Memory;

/** Linear memory with a hard ceiling that remembers whether its latest growth request was refused. */
class CappedMemory extends WasmMemoryBase {
  exhausted = false;

  override grow(deltaPages: number): number {
    this.exhausted = true;
    const previousPages = super.grow(deltaPages);
    this.exhausted = false;
    return previousPages;
  }
}

interface LoadedQuickJs {
  quickjs: QuickJSWASMModule;
  memory: CappedMemory;
}

let cachedModule: { maxPages: number; loading: Promise<LoadedQuickJs> } | undefined;

/**
 * QuickJS cannot measure its own allocations in a WASM build, so its runtime memory limit never trips.
 * The limit that holds is the size the engine lets the module's linear memory reach.
 */
function loadQuickJs(memoryBytes: number): Promise<LoadedQuickJs> {
  const maxPages = Math.ceil(memoryBytes / WASM_PAGE_BYTES);
  if (cachedModule?.maxPages !== maxPages) {
    cachedModule = { maxPages, loading: instantiateQuickJs(maxPages) };
  }
  return cachedModule.loading;
}

async function instantiateQuickJs(maxPages: number): Promise<LoadedQuickJs> {
  const [core, variant] = await Promise.all([
    import('quickjs-emscripten-core'),
    import('@jitl/quickjs-singlefile-mjs-release-sync'),
  ]);
  const memory = new CappedMemory({ initial: WASM_INITIAL_BYTES / WASM_PAGE_BYTES, maximum: maxPages });
  const quickjs = await core.newQuickJSWASMModuleFromVariant(core.newVariant(variant.default, { wasmMemory: memory }));
  return { quickjs, memory };
}

function dropCachedModule(loading: Promise<LoadedQuickJs> | undefined): void {
  if (cachedModule?.loading === loading) {
    cachedModule = undefined;
  }
}

function fail(errorKind: ErrorKind | undefined, error: string): Failure {
  return { ok: false, error: truncate(error, MAX_ERROR_CHARS, 'error'), ...(errorKind ? { errorKind } : {}) };
}

function truncate(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[${label} truncated: ${text.length - maxChars} of ${text.length} characters dropped]`;
}

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim() || 'Unknown error.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function resolveLimits(overrides: Partial<SandboxLimits> = {}): SandboxLimits {
  const limits: SandboxLimits = { ...DEFAULT_SANDBOX_LIMITS };
  for (const key of Object.keys(limits) as Array<keyof SandboxLimits>) {
    const value = overrides[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      limits[key] = Math.floor(value);
    }
  }
  limits.stackBytes = Math.min(limits.stackBytes, MAX_STACK_BYTES);
  limits.memoryBytes = Math.min(Math.max(limits.memoryBytes, WASM_INITIAL_BYTES), WASM_MAX_BYTES);
  return limits;
}

function toGuestOutcome(outcome: SandboxToolOutcome | undefined, maxChars: number): SandboxToolOutcome {
  if (!isRecord(outcome)) {
    return { ok: false, error: 'The host returned a malformed tool outcome.' };
  }
  const cut = (value: unknown): string => truncate(typeof value === 'string' ? value : String(value ?? ''), maxChars, 'output');
  if (outcome.ok) {
    return { ok: true, output: cut(outcome.output) };
  }
  return {
    ok: false,
    error: cut(outcome.error),
    ...(outcome.kind === undefined ? {} : { kind: String(outcome.kind) }),
    ...(outcome.output === undefined ? {} : { output: cut(outcome.output) }),
  };
}

function describeGuestError(detail: unknown, limits: SandboxLimits, memoryExhausted: boolean): Failure {
  const outOfMemory = fail('limit', `The script exceeded its ${Math.round(limits.memoryBytes / MIB)} MiB memory limit.`);
  if (!isRecord(detail) || typeof detail.message !== 'string') {
    // With no memory left to build an error object, QuickJS throws a bare null.
    return detail === null && memoryExhausted
      ? outOfMemory
      : fail('script', `Uncaught ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
  const name = typeof detail.name === 'string' && detail.name ? detail.name : 'Error';
  if (name === 'InternalError' && detail.message === 'out of memory') {
    return outOfMemory;
  }
  const headline = `${name}: ${detail.message}`;
  const stack = typeof detail.stack === 'string' ? detail.stack.trimEnd() : '';
  return fail('script', stack && stack.length <= MAX_STACK_TRACE_CHARS ? `${headline}\n${stack}` : headline);
}

/** Runs `work`, or rejects as soon as the signal aborts; the listener never outlives the call. */
function settleOrAbort<T>(work: () => Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const release = (): void => signal?.removeEventListener('abort', onAbort);
    const onAbort = (): void => {
      release();
      reject(new SandboxAbortedError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    Promise.resolve().then(work).then(
      (value) => {
        release();
        resolve(value);
      },
      (error: unknown) => {
        release();
        reject(error);
      },
    );
  });
}

class SandboxAbortedError extends Error {
  constructor() {
    super(ABORT_MESSAGE);
  }
}

class LogBuffer {
  private kept = '';
  private total = 0;

  constructor(private readonly maxChars: number) {}

  append(line: string): void {
    const piece = this.total === 0 ? line : `\n${line}`;
    this.total += piece.length;
    if (this.kept.length < this.maxChars) {
      this.kept += piece.slice(0, this.maxChars - this.kept.length);
    }
  }

  toString(): string {
    const dropped = this.total - this.kept.length;
    return dropped > 0
      ? `${this.kept}\n[logs truncated: ${dropped} of ${this.total} characters dropped]`
      : this.kept;
  }
}

class GuestSession {
  toolCalls = 0;

  private readonly runtime: QuickJSRuntime;
  private readonly context: QuickJSContext;
  private readonly memory: CappedMemory;
  private readonly owned: GuestResource[] = [];
  private readonly allowedTools: ReadonlySet<string>;
  private readonly budgetMs: number;
  private pending: PendingCall[] = [];
  private guestMs = 0;
  private sliceStartedAt: number | undefined;
  private stopped: Failure | undefined;

  constructor(
    { quickjs, memory }: LoadedQuickJs,
    private readonly options: SandboxRunOptions,
    private readonly limits: SandboxLimits,
    private readonly logs: LogBuffer,
  ) {
    this.memory = memory;
    this.allowedTools = new Set(options.toolNames);
    this.budgetMs = Number.isFinite(options.timeoutMs) ? Math.max(0, options.timeoutMs) : 0;
    this.runtime = this.own(quickjs.newRuntime());
    this.runtime.setMaxStackSize(limits.stackBytes);
    this.runtime.setInterruptHandler(() => this.shouldInterrupt());
    this.context = this.own(this.runtime.newContext());
  }

  async run(): Promise<Verdict> {
    if (this.options.signal?.aborted) {
      return fail('aborted', ABORT_MESSAGE);
    }
    const started = this.start();
    if (started.failure) {
      return started.failure;
    }
    for (;;) {
      const verdict = this.drain(started.script);
      if (verdict) {
        return verdict;
      }
      const batch = this.pending;
      this.pending = [];
      if (batch.length === 0) {
        return fail('script', 'The script is waiting on a promise that can never settle: no tool call is pending.');
      }
      const outcomes = await this.dispatch(batch);
      if (!Array.isArray(outcomes)) {
        return outcomes;
      }
      this.deliver(batch, outcomes);
    }
  }

  dispose(): void {
    for (const resource of this.owned.reverse()) {
      if (resource.alive) {
        resource.dispose();
      }
    }
    this.owned.length = 0;
  }

  private start(): { script: QuickJSHandle; failure?: undefined } | { failure: Failure } {
    const { context } = this;
    const bootstrap = this.own(context.unwrapResult(context.evalCode(GUEST_BOOTSTRAP, 'sandbox-bootstrap.js')));
    const hostCall = this.own(context.newFunction('callTool', (name, argsJson) =>
      this.acceptToolCall(context.getString(name), context.getString(argsJson))));
    const hostLog = this.own(context.newFunction('log', (level, text) => {
      this.acceptLog(context.getString(level), context.getString(text));
    }));
    const toolNames = this.own(context.newString(JSON.stringify([...this.allowedTools])));
    const runScript = this.own(context.unwrapResult(
      context.callFunction(bootstrap, context.undefined, hostCall, hostLog, toolNames),
    ));

    const source = this.own(context.newString(this.options.script));
    const started = this.inGuest(() => context.callFunction(runScript, context.undefined, source));
    return started.error
      ? { failure: this.consumeGuestError(started.error) }
      : { script: this.own(started.value) };
  }

  /** Runs the guest until it has no runnable job, then reports the script's fate if it has one. */
  private drain(script: QuickJSHandle): Verdict | undefined {
    let jobs = this.inGuest(() => this.runtime.executePendingJobs());
    while (jobs.error) {
      jobs.error.dispose();
      if (this.stopped) {
        break;
      }
      jobs = this.inGuest(() => this.runtime.executePendingJobs());
    }
    if (this.stopped) {
      return this.stopped;
    }

    const state = this.context.getPromiseState(script);
    if (state.type === 'fulfilled') {
      const result = this.context.getString(state.value);
      state.value.dispose();
      return this.pending.length > 0
        ? this.unawaitedCallsFailure()
        : { ok: true, result: truncate(result, this.limits.maxResultChars, 'result') };
    }
    if (state.type === 'rejected') {
      return this.consumeGuestError(state.error);
    }
    return this.guestMs > this.budgetMs ? this.timeoutFailure() : undefined;
  }

  private async dispatch(batch: PendingCall[]): Promise<SandboxToolOutcome[] | Failure> {
    const calls = batch.map(({ call }) => call);
    const { signal } = this.options;
    let outcomes: SandboxToolOutcome[];
    try {
      outcomes = await settleOrAbort(() => this.options.executeToolCalls(calls), signal);
    } catch (error) {
      return fail('aborted', messageOf(error));
    }
    if (signal?.aborted) {
      return fail('aborted', ABORT_MESSAGE);
    }
    if (!Array.isArray(outcomes) || outcomes.length !== calls.length) {
      const received = Array.isArray(outcomes) ? outcomes.length : 0;
      return fail(
        undefined,
        `executeToolCalls returned ${countOf(received, 'outcome')} for ${countOf(calls.length, 'call')}.`,
      );
    }
    return outcomes;
  }

  private deliver(batch: PendingCall[], outcomes: SandboxToolOutcome[]): void {
    batch.forEach(({ deferred }, index) => {
      const outcome = toGuestOutcome(outcomes[index], this.limits.maxToolResultChars);
      const payload = this.context.newString(JSON.stringify(outcome));
      try {
        this.inGuest(() => deferred.resolve(payload));
      } finally {
        payload.dispose();
      }
    });
  }

  private acceptToolCall(tool: string, argsJson: string): QuickJSHandle {
    if (!this.allowedTools.has(tool)) {
      throw new Error(`Unknown tool "${tool}".`);
    }
    if (this.toolCalls >= this.limits.maxToolCalls) {
      const failure = fail('limit', `The script issued more than ${this.limits.maxToolCalls} tool calls.`);
      this.stopped ??= failure;
      throw new Error(failure.error);
    }
    this.toolCalls += 1;
    const deferred = this.own(this.context.newPromise());
    this.pending.push({ call: { id: this.toolCalls, tool, args: JSON.parse(argsJson) as unknown }, deferred });
    return deferred.handle;
  }

  private acceptLog(level: string, text: string): void {
    this.logs.append(level === 'warn' || level === 'error' ? `[${level}] ${text}` : text);
  }

  private shouldInterrupt(): boolean {
    if (this.stopped) {
      return true;
    }
    if (this.options.signal?.aborted) {
      this.stopped = fail('aborted', ABORT_MESSAGE);
      return true;
    }
    const sliceMs = this.sliceStartedAt === undefined ? 0 : monotonicNow() - this.sliceStartedAt;
    if (this.guestMs + sliceMs > this.budgetMs) {
      this.stopped = this.timeoutFailure();
      return true;
    }
    return false;
  }

  /** A call still pending when the script returns was never sent to the host; saying so beats dropping it silently. */
  private unawaitedCallsFailure(): Failure {
    const tools = [...new Set(this.pending.map(({ call }) => call.tool))].join(', ');
    const count = this.pending.length;
    return fail(
      'script',
      `The script returned while ${countOf(count, 'tool call')} (${tools}) had not been awaited, `
        + `so ${count === 1 ? 'it was' : 'they were'} not executed. Await every tools.* call.`,
    );
  }

  private timeoutFailure(): Failure {
    return fail('timeout', `The script used more than its ${this.budgetMs} ms execution budget.`);
  }

  /** Every entry into guest code goes through here so its time is charged to the script budget. */
  private inGuest<T>(work: () => T): T {
    const startedAt = monotonicNow();
    this.sliceStartedAt = startedAt;
    try {
      return work();
    } finally {
      this.guestMs += monotonicNow() - startedAt;
      this.sliceStartedAt = undefined;
    }
  }

  private consumeGuestError(error: QuickJSHandle): Failure {
    try {
      const detail = this.inGuest(() => this.context.dump(error)) as unknown;
      return this.stopped ?? describeGuestError(detail, this.limits, this.memory.exhausted);
    } finally {
      error.dispose();
    }
  }

  private own<T extends GuestResource>(resource: T): T {
    this.owned.push(resource);
    return resource;
  }
}

function describeHostFailure(error: unknown): Failure {
  if (error instanceof RangeError) {
    return fail('limit', `The script exhausted the sandbox stack: ${messageOf(error)}`);
  }
  return fail(undefined, `The sandbox failed: ${messageOf(error)}`);
}

/** Never throws and never rejects. Always disposes the QuickJS runtime and leaves no timers behind. */
export async function runSandboxedScript(options: SandboxRunOptions): Promise<SandboxRunResult> {
  const startedAt = monotonicNow();
  const limits = resolveLimits(options.limits);
  const logs = new LogBuffer(limits.maxLogChars);
  let session: GuestSession | undefined;
  let loading: Promise<LoadedQuickJs> | undefined;
  let memory: CappedMemory | undefined;
  let verdict: Verdict;
  try {
    if (options.script.length > limits.maxScriptChars) {
      verdict = fail(
        'limit',
        `The script is ${options.script.length} characters long; the limit is ${limits.maxScriptChars}.`,
      );
    } else if (options.signal?.aborted) {
      verdict = fail('aborted', ABORT_MESSAGE);
    } else {
      loading = loadQuickJs(limits.memoryBytes);
      const loaded = await loading;
      memory = loaded.memory;
      session = new GuestSession(loaded, options, limits, logs);
      verdict = await session.run();
    }
  } catch (error) {
    // A host-level throw can leave the shared WASM instance mid-call; the next run gets a fresh one.
    dropCachedModule(loading);
    verdict = describeHostFailure(error);
  }
  try {
    session?.dispose();
  } catch {
    dropCachedModule(loading);
  }
  // WASM memory never shrinks, so a module that had to grow is not kept for the next run.
  if (memory && memory.buffer.byteLength > WASM_INITIAL_BYTES) {
    dropCachedModule(loading);
  }
  return {
    ...verdict,
    logs: logs.toString(),
    toolCalls: session?.toolCalls ?? 0,
    durationMs: Math.round(monotonicNow() - startedAt),
  };
}
