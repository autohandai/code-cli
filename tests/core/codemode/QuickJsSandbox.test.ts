/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SANDBOX_LIMITS,
  runSandboxedScript,
  type SandboxRunOptions,
  type SandboxRunResult,
  type SandboxToolCall,
  type SandboxToolOutcome,
} from '../../../src/core/codemode/QuickJsSandbox.js';

const MIB = 1024 * 1024;

type Executor = SandboxRunOptions['executeToolCalls'];

function run(script: string, overrides: Partial<SandboxRunOptions> = {}): Promise<SandboxRunResult> {
  return runSandboxedScript({
    script,
    toolNames: [],
    executeToolCalls: async () => {
      throw new Error('This script was not expected to call a tool.');
    },
    timeoutMs: 5_000,
    ...overrides,
  });
}

function recordingExecutor(
  respond: (call: SandboxToolCall) => SandboxToolOutcome = (call) => ({
    ok: true,
    output: `${call.tool}:${JSON.stringify(call.args)}`,
  }),
): { batches: SandboxToolCall[][]; execute: Executor } {
  const batches: SandboxToolCall[][] = [];
  return {
    batches,
    execute: async (calls) => {
      batches.push(calls);
      return calls.map(respond);
    },
  };
}

function value(result: SandboxRunResult): unknown {
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  return JSON.parse(result.result ?? 'null');
}

describe('runSandboxedScript', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('results', () => {
    it('returns the script value as JSON text', async () => {
      const result = await run('return { answer: 42, items: [1, "two"] };');

      expect(result).toMatchObject({ ok: true, result: '{"answer":42,"items":[1,"two"]}', logs: '', toolCalls: 0 });
      expect(result.errorKind).toBeUndefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('reports "null" when the script returns nothing', async () => {
      const result = await run('const unused = 1;');

      expect(result).toMatchObject({ ok: true, result: 'null' });
    });

    it('cuts an oversized result and says how much was dropped', async () => {
      const result = await run('return "y".repeat(500);', { limits: { maxResultChars: 100 } });

      expect(result.ok).toBe(true);
      expect(result.result?.slice(0, 100)).toBe(`"${'y'.repeat(99)}`);
      expect(result.result).toContain('[result truncated: 402 of 502 characters dropped]');
    });

    it('fails a return value that cannot be serialised', async () => {
      const result = await run('const loop = {}; loop.self = loop; return loop;');

      expect(result).toMatchObject({ ok: false, errorKind: 'script' });
      expect(result.error).toContain('not JSON-serialisable');
    });
  });

  describe('tool calls', () => {
    it('awaits a tool call at the top level', async () => {
      const { batches, execute } = recordingExecutor(() => ({ ok: true, output: 'file body' }));

      const result = await run(
        'const file = await tools.read_file({ path: "a.txt" }); return file.output.toUpperCase();',
        { toolNames: ['read_file'], executeToolCalls: execute },
      );

      expect(value(result)).toBe('FILE BODY');
      expect(batches).toEqual([[{ id: 1, tool: 'read_file', args: { path: 'a.txt' } }]]);
      expect(result.toolCalls).toBe(1);
    });

    it('exposes tools whose names are not identifiers through bracket access', async () => {
      const { batches, execute } = recordingExecutor();

      const result = await run('return (await tools["mcp__docs__search"]({ q: "x" })).output;', {
        toolNames: ['mcp__docs__search'],
        executeToolCalls: execute,
      });

      expect(value(result)).toBe('mcp__docs__search:{"q":"x"}');
      expect(batches[0]?.[0]?.tool).toBe('mcp__docs__search');
    });

    it('sends every call of a Promise.all as one batch with ids in issue order', async () => {
      const { batches, execute } = recordingExecutor();

      const result = await run(
        `const paths = ['a', 'b', 'c', 'd', 'e'];
         const files = await Promise.all(paths.map((path) => tools.read_file({ path })));
         return files.map((file) => file.output);`,
        { toolNames: ['read_file'], executeToolCalls: execute },
      );

      expect(batches).toHaveLength(1);
      expect(batches[0]?.map((call) => call.id)).toEqual([1, 2, 3, 4, 5]);
      expect(batches[0]?.map((call) => call.args)).toEqual(['a', 'b', 'c', 'd', 'e'].map((path) => ({ path })));
      expect(value(result)).toEqual(['a', 'b', 'c', 'd', 'e'].map((path) => `read_file:{"path":"${path}"}`));
      expect(result.toolCalls).toBe(5);
    });

    it('sends sequential awaits as separate batches', async () => {
      const { batches, execute } = recordingExecutor();

      const result = await run(
        `const out = [];
         for (const path of ['a', 'b', 'c']) out.push((await tools.read_file({ path })).ok);
         return out;`,
        { toolNames: ['read_file'], executeToolCalls: execute },
      );

      expect(value(result)).toEqual([true, true, true]);
      expect(batches.map((batch) => batch.map((call) => call.id))).toEqual([[1], [2], [3]]);
    });

    it('returns a failed outcome to the script instead of throwing', async () => {
      const { execute } = recordingExecutor(() => ({
        ok: false,
        error: 'Tool execution skipped by user.',
        kind: 'authorization',
        output: 'partial',
      }));

      const result = await run(
        'const r = await tools.write_file({ path: "x" }); return [r.ok, r.error, r.kind, r.output];',
        { toolNames: ['write_file'], executeToolCalls: execute },
      );

      expect(value(result)).toEqual([false, 'Tool execution skipped by user.', 'authorization', 'partial']);
    });

    it('rejects a call to an unlisted tool inside the guest without reaching the host', async () => {
      const execute = vi.fn<Executor>(async () => []);

      const result = await run(
        `try { await tools.delete_everything({}); return 'reached'; }
         catch (error) { return error.message; }`,
        { toolNames: ['read_file'], executeToolCalls: execute },
      );

      expect(value(result)).toContain('delete_everything');
      expect(execute).not.toHaveBeenCalled();
      expect(result.toolCalls).toBe(0);
    });

    it('lists only the exposed tools and cannot be extended by the script', async () => {
      const result = await run(
        `'use strict';
         let assigned = 'no error';
         try { tools.extra = () => 1; } catch (error) { assigned = error.constructor.name; }
         return [Object.keys(tools), assigned, typeof tools.then];`,
        { toolNames: ['read_file', 'find_grep'] },
      );

      expect(value(result)).toEqual([['read_file', 'find_grep'], 'TypeError', 'undefined']);
    });

    it.each([
      ['a circular structure', 'const args = {}; args.self = args;'],
      ['a BigInt', 'const args = { size: 10n };'],
      ['a function', 'const args = () => 1;'],
    ])('rejects arguments holding %s in the guest', async (_label, setup) => {
      const execute = vi.fn<Executor>(async () => []);

      const result = await run(
        `${setup}
         try { await tools.read_file(args); return 'reached'; }
         catch (error) { return error.message; }`,
        { toolNames: ['read_file'], executeToolCalls: execute },
      );

      expect(value(result)).toContain('not JSON-serialisable');
      expect(execute).not.toHaveBeenCalled();
    });

    it('cuts an oversized outcome before it enters the guest', async () => {
      const { execute } = recordingExecutor(() => ({ ok: true, output: 'z'.repeat(5_000) }));

      const result = await run(
        'const r = await tools.read_file({}); return [r.output.length < 400, r.output.slice(0, 3), r.output.includes("truncated")];',
        { toolNames: ['read_file'], executeToolCalls: execute, limits: { maxToolResultChars: 200 } },
      );

      expect(value(result)).toEqual([true, 'zzz', true]);
    });

    it('fails a script that returns while a tool call was never awaited', async () => {
      const { batches, execute } = recordingExecutor();

      const result = await run('await tools.read_file({}); tools.write_file({ path: "x" }); return "done";', {
        toolNames: ['read_file', 'write_file'],
        executeToolCalls: execute,
      });

      expect(result).toMatchObject({ ok: false, errorKind: 'script', toolCalls: 2 });
      expect(result.error).toContain('1 tool call (write_file) had not been awaited');
      expect(result.result).toBeUndefined();
      expect(batches.flat().map((call) => call.tool)).toEqual(['read_file']);
    });

    it('stops with errorKind aborted when the host executor rejects', async () => {
      const result = await run('await tools.write_file({ path: "x" }); return "after";', {
        toolNames: ['write_file'],
        executeToolCalls: async () => {
          throw new Error('The user declined write_file.');
        },
      });

      expect(result).toMatchObject({
        ok: false,
        errorKind: 'aborted',
        error: 'The user declined write_file.',
        toolCalls: 1,
      });
      expect(result.result).toBeUndefined();
    });

    it('never rejects when the host executor throws synchronously', async () => {
      const execute = (() => {
        throw new Error('sync failure');
      }) as unknown as Executor;

      const result = await run('await tools.read_file({});', { toolNames: ['read_file'], executeToolCalls: execute });

      expect(result).toMatchObject({ ok: false, errorKind: 'aborted', error: 'sync failure' });
    });

    it('fails the run when the host answers with the wrong number of outcomes', async () => {
      const result = await run('await Promise.all([tools.read_file({}), tools.read_file({})]);', {
        toolNames: ['read_file'],
        executeToolCalls: async () => [{ ok: true, output: 'only one' }],
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('1 outcome');
    });

    it('keeps concurrent runs isolated from each other', async () => {
      const first = recordingExecutor(() => ({ ok: true, output: 'first' }));
      const second = recordingExecutor(() => ({ ok: true, output: 'second' }));
      const script = 'globalThis.seen = (globalThis.seen ?? 0) + 1; return [(await tools.read_file({})).output, globalThis.seen];';

      const [a, b] = await Promise.all([
        run(script, { toolNames: ['read_file'], executeToolCalls: first.execute }),
        run(script, { toolNames: ['read_file'], executeToolCalls: second.execute }),
      ]);

      expect(value(a)).toEqual(['first', 1]);
      expect(value(b)).toEqual(['second', 1]);
    });
  });

  describe('console', () => {
    it('captures one line per console call', async () => {
      const result = await run(
        `console.log('scanned', 3, { files: ['a'] });
         console.info('info line');
         console.warn('careful');
         console.error(new TypeError('boom'));
         return 1;`,
      );

      expect(result.logs.split('\n')).toEqual([
        'scanned 3 {"files":["a"]}',
        'info line',
        '[warn] careful',
        '[error] TypeError: boom',
      ]);
    });

    it('cuts the log at the cap and says how much was dropped', async () => {
      const result = await run('for (let i = 0; i < 10; i += 1) console.log("x".repeat(19)); return 1;', {
        limits: { maxLogChars: 50 },
      });

      expect(result.ok).toBe(true);
      expect(result.logs.slice(0, 50)).toBe(`${'x'.repeat(19)}\n${'x'.repeat(19)}\n${'x'.repeat(10)}`);
      expect(result.logs).toContain('[logs truncated: 149 of 199 characters dropped]');
    });

    it('keeps the logs written before a failure', async () => {
      const result = await run('console.log("step 1"); throw new Error("step 2 failed");');

      expect(result).toMatchObject({ ok: false, errorKind: 'script', logs: 'step 1' });
    });
  });

  describe('script failures', () => {
    it('reports an uncaught exception with its message and short stack', async () => {
      const result = await run('function parse() { throw new RangeError("bad input"); }\nparse();');

      expect(result).toMatchObject({ ok: false, errorKind: 'script' });
      expect(result.error).toContain('RangeError: bad input');
      expect(result.error).toContain('at parse');
    });

    it('reports a syntax error without running anything', async () => {
      const result = await run('console.log("ran"); return ((;');

      expect(result).toMatchObject({ ok: false, errorKind: 'script', logs: '' });
      expect(result.error).toContain('SyntaxError');
    });

    it('reports a thrown non-error value', async () => {
      const result = await run('throw "plain string";');

      expect(result).toMatchObject({ ok: false, errorKind: 'script' });
      expect(result.error).toContain('plain string');
    });

    it('fails a script that waits on a promise nothing can settle', async () => {
      const result = await run('await new Promise(() => {}); return 1;');

      expect(result).toMatchObject({ ok: false, errorKind: 'script' });
      expect(result.error).toContain('never settle');
    });
  });

  describe('limits', () => {
    it('ships the agreed defaults', () => {
      expect(DEFAULT_SANDBOX_LIMITS).toEqual({
        memoryBytes: 64 * MIB,
        stackBytes: 128 * 1024,
        maxScriptChars: 50_000,
        maxResultChars: 20_000,
        maxLogChars: 4_000,
        maxToolCalls: 200,
        maxToolResultChars: 1_048_576,
      });
    });

    it('refuses a script over the size limit without evaluating it', async () => {
      const execute = vi.fn<Executor>(async () => []);

      const result = await run('console.log("ran"); await tools.read_file({});', {
        toolNames: ['read_file'],
        executeToolCalls: execute,
        limits: { maxScriptChars: 20 },
      });

      expect(result).toMatchObject({ ok: false, errorKind: 'limit', logs: '', toolCalls: 0 });
      expect(result.error).toContain('20');
      expect(execute).not.toHaveBeenCalled();
    });

    it('stops a script that issues more tool calls than allowed', async () => {
      const { batches, execute } = recordingExecutor();

      const result = await run(
        'for (let i = 0; i < 10; i += 1) { try { await tools.read_file({ i }); } catch {} } return "finished";',
        { toolNames: ['read_file'], executeToolCalls: execute, limits: { maxToolCalls: 3 } },
      );

      expect(result).toMatchObject({ ok: false, errorKind: 'limit', toolCalls: 3 });
      expect(result.error).toContain('3');
      expect(batches.flat().map((call) => call.id)).toEqual([1, 2, 3]);
    });

    it('dispatches nothing from a batch that crosses the tool-call limit', async () => {
      const { batches, execute } = recordingExecutor();

      const result = await run('await Promise.all([1, 2, 3, 4, 5].map((i) => tools.read_file({ i })));', {
        toolNames: ['read_file'],
        executeToolCalls: execute,
        limits: { maxToolCalls: 3 },
      });

      expect(result).toMatchObject({ ok: false, errorKind: 'limit' });
      expect(batches).toEqual([]);
    });

    it('interrupts a synchronous infinite loop', async () => {
      const result = await run('while (true) {}', { timeoutMs: 100 });

      expect(result).toMatchObject({ ok: false, errorKind: 'timeout' });
      expect(result.error).toContain('100');
      expect(result.durationMs).toBeLessThan(5_000);
    });

    it('interrupts a loop the script cannot catch its way out of', async () => {
      const result = await run('for (;;) { try { while (true) {} } catch {} }', { timeoutMs: 100 });

      expect(result).toMatchObject({ ok: false, errorKind: 'timeout' });
    });

    it('interrupts an infinite loop entered after an await', async () => {
      const { execute } = recordingExecutor();

      const result = await run('await tools.read_file({}); while (true) {}', {
        toolNames: ['read_file'],
        executeToolCalls: execute,
        timeoutMs: 100,
      });

      expect(result).toMatchObject({ ok: false, errorKind: 'timeout', toolCalls: 1 });
    });

    it('interrupts an endless chain of microtasks', async () => {
      const result = await run('const spin = () => Promise.resolve().then(spin); await spin();', { timeoutMs: 100 });

      expect(result).toMatchObject({ ok: false, errorKind: 'timeout' });
    });

    it('does not charge time spent inside the host executor to the script budget', async () => {
      const result = await run('return (await tools.read_file({})).output;', {
        toolNames: ['read_file'],
        timeoutMs: 50,
        executeToolCalls: async (calls) => {
          await new Promise((resolve) => setTimeout(resolve, 300));
          return calls.map(() => ({ ok: true, output: 'slow but fine' }));
        },
      });

      expect(value(result)).toBe('slow but fine');
      expect(result.durationMs).toBeGreaterThanOrEqual(250);
    });

    it('contains a memory bomb and stays usable afterwards', async () => {
      const bomb = await run('const hoard = []; for (;;) hoard.push(new Uint8Array(1024 * 1024));', {
        limits: { memoryBytes: 32 * MIB },
      });

      expect(bomb).toMatchObject({ ok: false, errorKind: 'limit' });
      expect(bomb.error).toMatch(/32 MiB memory limit/);
      expect(value(await run('return 1 + 1;'))).toBe(2);
    });

    it.each([
      ['typed arrays', 'new Uint8Array(1024 * 1024)', 1],
      ['flat strings', 'Array.from({ length: 4096 }, () => "abcdefgh".repeat(32)).join("")', 1],
      ['small objects', 'Array.from({ length: 8192 }, (_, i) => ({ i }))', 0.25],
    ])('holds the script to its memory limit when it allocates %s', async (_label, allocate, minMibPerItem) => {
      const options = { limits: { memoryBytes: 32 * MIB }, timeoutMs: 20_000 };

      const counted = await run(
        `const hoard = [];
         try { for (;;) hoard.push(${allocate}); }
         catch { const held = hoard.length; hoard.length = 0; return held; }`,
        options,
      );
      const uncaught = await run(`const hoard = []; for (;;) hoard.push(${allocate});`, options);

      const held = value(counted) as number;
      expect(held).toBeGreaterThan(1);
      expect(held * minMibPerItem).toBeLessThanOrEqual(32);
      expect(uncaught).toMatchObject({ ok: false, errorKind: 'limit' });
      expect(uncaught.error).toMatch(/32 MiB memory limit/);
    });

    it('does not mistake a thrown null for memory exhaustion', async () => {
      const result = await run('throw null;');

      expect(result).toMatchObject({ ok: false, errorKind: 'script', error: 'Uncaught null' });
    });

    it('raises a memory limit below what the QuickJS module needs to 16 MiB', async () => {
      const bomb = await run('const hoard = []; for (;;) hoard.push(new Uint8Array(1024 * 1024));', {
        limits: { memoryBytes: 1024 },
      });

      expect(bomb).toMatchObject({ ok: false, errorKind: 'limit' });
      expect(bomb.error).toMatch(/16 MiB memory limit/);
    });

    it('refuses one allocation larger than the whole limit', async () => {
      const result = await run('return new Uint8Array(1024 * 1024 * 1024).length;');

      expect(result).toMatchObject({ ok: false, errorKind: 'limit' });
    });

    it('applies the default memory limit when none is given', async () => {
      const result = await run(
        `const hoard = [];
         try { for (;;) hoard.push(new Uint8Array(1024 * 1024)); } catch (error) { return hoard.length; }`,
      );

      expect(value(result)).toBeGreaterThan(16);
      expect(value(result)).toBeLessThanOrEqual(64);
    });

    it('contains runaway recursion without a host stack overflow', async () => {
      const uncaught = await run('const dive = () => dive(); dive();');

      expect(uncaught).toMatchObject({ ok: false, errorKind: 'script' });
      expect(uncaught.error).toMatch(/stack overflow/i);

      const caught = await run('const dive = () => dive(); try { dive(); } catch (error) { return error.message; }');

      expect(value(caught)).toMatch(/stack overflow/i);
      expect(value(await run('return "still alive";'))).toBe('still alive');
    });

    it('clamps a guest stack limit the host stack could not serve', async () => {
      const result = await run('const dive = () => dive(); dive();', { limits: { stackBytes: 64 * MIB } });

      expect(result).toMatchObject({ ok: false, errorKind: 'script' });
      expect(result.error).toMatch(/stack overflow/i);
      expect(value(await run('return "recovered";'))).toBe('recovered');
    });
  });

  describe('cancellation', () => {
    it('does not start when the signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      const execute = vi.fn<Executor>(async () => []);

      const result = await run('console.log("ran"); await tools.read_file({});', {
        toolNames: ['read_file'],
        executeToolCalls: execute,
        signal: controller.signal,
      });

      expect(result).toMatchObject({ ok: false, errorKind: 'aborted', logs: '', toolCalls: 0 });
      expect(execute).not.toHaveBeenCalled();
    });

    it('stops while a tool batch is in flight when the signal aborts', async () => {
      const controller = new AbortController();

      const result = await run('console.log("before"); await tools.read_file({}); console.log("after");', {
        toolNames: ['read_file'],
        signal: controller.signal,
        executeToolCalls: () => {
          queueMicrotask(() => controller.abort());
          return new Promise<SandboxToolOutcome[]>(() => {});
        },
      });

      expect(result).toMatchObject({ ok: false, errorKind: 'aborted', logs: 'before', toolCalls: 1 });
    });

    it('does not resume the script when the signal aborts as a batch resolves', async () => {
      const controller = new AbortController();

      const result = await run('await tools.read_file({}); console.log("after");', {
        toolNames: ['read_file'],
        signal: controller.signal,
        executeToolCalls: async (calls) => {
          controller.abort();
          return calls.map(() => ({ ok: true, output: '' }));
        },
      });

      expect(result).toMatchObject({ ok: false, errorKind: 'aborted', logs: '' });
    });
  });

  describe('isolation', () => {
    it('exposes no host globals', async () => {
      const result = await run(
        `return [typeof process, typeof require, typeof fetch, typeof Bun, typeof setTimeout,
                 typeof setInterval, typeof module, typeof Deno, typeof XMLHttpRequest];`,
      );

      expect(value(result)).toEqual(Array.from({ length: 9 }, () => 'undefined'));
    });

    it('leaves no bridge function reachable from the global object', async () => {
      const result = await run(
        'return Object.getOwnPropertyNames(globalThis).filter((name) => /host|bridge|__/i.test(name));',
      );

      expect(value(result)).toEqual([]);
    });

    it('cannot reach a host object through function constructors', async () => {
      const result = await run(
        `const probes = [
           () => tools.read_file.constructor('return typeof process')(),
           () => tools.read_file.constructor('return typeof require')(),
           () => tools.unknown.constructor('return process')(),
           () => console.log.constructor('return process')(),
           () => (async () => {}).constructor('return this')(),
           async () => {
             const pending = tools.read_file({});
             const reached = Object.getPrototypeOf(pending).constructor.constructor('return globalThis.process')();
             await pending;
             return reached;
           },
         ];
         const seen = [];
         for (const probe of probes) {
           try {
             const reached = await probe();
             seen.push(reached === globalThis ? typeof reached.process : String(reached));
           } catch (error) { seen.push('threw ' + error.constructor.name); }
         }
         return seen;`,
        { toolNames: ['read_file'], executeToolCalls: recordingExecutor().execute },
      );

      expect(value(result)).toEqual([
        'undefined',
        'undefined',
        'threw ReferenceError',
        'threw ReferenceError',
        'undefined',
        'undefined',
      ]);
    });

    it('cannot import host modules', async () => {
      const result = await run(
        `try { await import('node:fs'); return 'imported'; }
         catch (error) { return 'blocked'; }`,
      );

      expect(value(result)).toBe('blocked');
    });

    it('receives tool outcomes as data, never as host objects', async () => {
      const { execute } = recordingExecutor(() => ({ ok: true, output: '{"constructor":"x"}' }));

      const result = await run(
        `const outcome = await tools.read_file({});
         return [Object.getPrototypeOf(outcome) === Object.prototype, Object.keys(outcome), typeof outcome.output];`,
        { toolNames: ['read_file'], executeToolCalls: execute },
      );

      expect(value(result)).toEqual([true, ['ok', 'output'], 'string']);
    });
  });

  describe('cleanup', () => {
    it('leaves no timers behind', async () => {
      // Load the WASM module on real timers first; the run under test is then purely synchronous setup.
      await run('return 0;');
      vi.useFakeTimers();
      const controller = new AbortController();

      const finished = await run('return (await tools.read_file({})).output;', {
        toolNames: ['read_file'],
        executeToolCalls: recordingExecutor().execute,
        signal: controller.signal,
      });
      const timedOut = await run('while (true) {}', { timeoutMs: 20, signal: controller.signal });

      expect(finished.ok).toBe(true);
      expect(timedOut.errorKind).toBe('timeout');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('removes its abort listener when the run ends', async () => {
      const controller = new AbortController();
      const add = vi.spyOn(controller.signal, 'addEventListener');
      const remove = vi.spyOn(controller.signal, 'removeEventListener');

      await run('return (await tools.read_file({})).output;', {
        toolNames: ['read_file'],
        executeToolCalls: recordingExecutor().execute,
        signal: controller.signal,
      });

      expect(add.mock.calls.length).toBeGreaterThan(0);
      expect(remove.mock.calls.length).toBe(add.mock.calls.length);
    });
  });
});
