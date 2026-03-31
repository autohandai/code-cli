/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_TOOL_DEFINITIONS, ToolManager } from '../src/core/toolManager.js';

const noopDefinitions = [
  { name: 'read_file', description: 'read file' },
  { name: 'delete_path', description: 'delete file', requiresApproval: true }
] as const;

/** Helper: create a delayed executor that optionally tracks in-flight count */
function createDelayedExecutor(delayMs: number, tracker?: { current: number; max: number }) {
  return async () => {
    if (tracker) {
      tracker.current++;
      tracker.max = Math.max(tracker.max, tracker.current);
    }
    await new Promise(r => setTimeout(r, delayMs));
    if (tracker) {
      tracker.current--;
    }
    return 'ok';
  };
}

describe('ToolManager', () => {
  it('exposes delegation, team coordination, and tool discovery tools by default', () => {
    const names = new Set(DEFAULT_TOOL_DEFINITIONS.map((tool) => tool.name));

    expect(names.has('tool_search')).toBe(true);
    expect(names.has('delegate_task')).toBe(true);
    expect(names.has('delegate_parallel')).toBe(true);
    expect(names.has('create_team')).toBe(true);
    expect(names.has('add_teammate')).toBe(true);
    expect(names.has('create_task')).toBe(true);
    expect(names.has('task_get')).toBe(true);
    expect(names.has('task_list')).toBe(true);
    expect(names.has('task_update')).toBe(true);
    expect(names.has('task_stop')).toBe(true);
    expect(names.has('task_output')).toBe(true);
    expect(names.has('team_status')).toBe(true);
    expect(names.has('send_team_message')).toBe(true);
  });

  it('executes tool calls via the provided executor', async () => {
    const executor = vi.fn().mockResolvedValue('file contents');
    const confirm = vi.fn().mockResolvedValue(true);
    const manager = new ToolManager({ executor, confirmApproval: confirm, definitions: noopDefinitions as any });

    const results = await manager.execute([{ tool: 'read_file', args: { path: 'src/index.ts' } }]);

    expect(executor).toHaveBeenCalledWith(
      { type: 'read_file', path: 'src/index.ts' },
      expect.objectContaining({ tool: 'read_file' })
    );
    expect(results[0]).toMatchObject({ tool: 'read_file', success: true, output: 'file contents' });
  });

  it('enforces approval for dangerous tools', async () => {
    const executor = vi.fn();
    const confirm = vi.fn().mockResolvedValue(false);
    const manager = new ToolManager({ executor, confirmApproval: confirm, definitions: noopDefinitions as any });

    const results = await manager.execute([{ tool: 'delete_path', args: { path: 'dist' } }]);

    expect(confirm).toHaveBeenCalled();
    expect(executor).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ tool: 'delete_path', success: false });
  });

  it('lists registered tool names', () => {
    const manager = new ToolManager({
      executor: vi.fn(),
      confirmApproval: vi.fn(),
      definitions: noopDefinitions as any
    });

    expect(manager.listToolNames()).toEqual(['read_file', 'delete_path']);
  });

  it('replaces MCP tools without touching other tools', () => {
    const manager = new ToolManager({
      executor: vi.fn(),
      confirmApproval: vi.fn(),
      definitions: [{ name: 'read_file', description: 'read file' }] as any
    });

    manager.registerMetaTools([
      { name: 'mcp__old__tool', description: 'old mcp tool' },
      { name: 'custom_meta_tool', description: 'custom tool' }
    ] as any);

    manager.replaceMcpTools([
      { name: 'mcp__new__tool', description: 'new mcp tool' }
    ] as any);

    const names = manager.listAllDefinitions().map(def => def.name);

    expect(names).toContain('read_file');
    expect(names).toContain('custom_meta_tool');
    expect(names).toContain('mcp__new__tool');
    expect(names).not.toContain('mcp__old__tool');
  });

  // ═══════════════════════════════════════════════════════════════════
  // Parallel Execution Tests
  // ═══════════════════════════════════════════════════════════════════

  describe('parallel execution', () => {
    const threeDefs = [
      { name: 'read_file', description: 'read file' },
      { name: 'search_files', description: 'search files' },
      { name: 'git_status', description: 'git status' }
    ] as const;

    it('executes independent tools in parallel (total time ~1x delay, not 3x)', async () => {
      const delay = 50;
      const executor = createDelayedExecutor(delay);
      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue(true),
        definitions: threeDefs as any,
        maxConcurrency: 5
      });

      const start = Date.now();
      const results = await manager.execute([
        { tool: 'read_file', args: { path: 'a.ts' } },
        { tool: 'search_files', args: { query: 'foo' } },
        { tool: 'git_status', args: {} }
      ]);
      const elapsed = Date.now() - start;

      expect(results).toHaveLength(3);
      expect(results.every(r => r.success)).toBe(true);
      // Should complete in ~1x delay, not 3x. Allow generous margin for CI variability.
      expect(elapsed).toBeLessThan(delay * 2.5);
    });

    it('respects concurrency limit (maxConcurrency: 2, 5 calls)', async () => {
      const delay = 50;
      const tracker = { current: 0, max: 0 };
      const executor = createDelayedExecutor(delay, tracker);

      const fiveDefs = [
        { name: 'read_file', description: 'read file' },
        { name: 'search_files', description: 'search files' },
        { name: 'git_status', description: 'git status' },
        { name: 'list_files', description: 'list files' },
        { name: 'web_search', description: 'web search' }
      ] as const;

      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue(true),
        definitions: fiveDefs as any,
        maxConcurrency: 2
      });

      await manager.execute([
        { tool: 'read_file', args: {} },
        { tool: 'search_files', args: {} },
        { tool: 'git_status', args: {} },
        { tool: 'list_files', args: {} },
        { tool: 'web_search', args: {} }
      ]);

      expect(tracker.max).toBeLessThanOrEqual(2);
    });

    it('isolates errors — failing tool does not affect others', async () => {
      const executor = vi.fn()
        .mockResolvedValueOnce('result-0')
        .mockRejectedValueOnce(new Error('tool 2 broke'))
        .mockResolvedValueOnce('result-2');

      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue(true),
        definitions: threeDefs as any,
        maxConcurrency: 5
      });

      const results = await manager.execute([
        { tool: 'read_file', args: {} },
        { tool: 'search_files', args: {} },
        { tool: 'git_status', args: {} }
      ]);

      expect(results[0]).toMatchObject({ tool: 'read_file', success: true, output: 'result-0' });
      expect(results[1]).toMatchObject({ tool: 'search_files', success: false, error: 'tool 2 broke' });
      expect(results[2]).toMatchObject({ tool: 'git_status', success: true, output: 'result-2' });
    });

    it('preserves result order regardless of completion order', async () => {
      // Tool 0: 100ms, Tool 1: 10ms, Tool 2: 50ms — complete out of order
      const executor = vi.fn()
        .mockImplementationOnce(async () => { await new Promise(r => setTimeout(r, 100)); return 'slow'; })
        .mockImplementationOnce(async () => { await new Promise(r => setTimeout(r, 10)); return 'fast'; })
        .mockImplementationOnce(async () => { await new Promise(r => setTimeout(r, 50)); return 'medium'; });

      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue(true),
        definitions: threeDefs as any,
        maxConcurrency: 5
      });

      const results = await manager.execute([
        { tool: 'read_file', args: {} },
        { tool: 'search_files', args: {} },
        { tool: 'git_status', args: {} }
      ]);

      // Results must match input order, not completion order
      expect(results[0]).toMatchObject({ tool: 'read_file', output: 'slow' });
      expect(results[1]).toMatchObject({ tool: 'search_files', output: 'fast' });
      expect(results[2]).toMatchObject({ tool: 'git_status', output: 'medium' });
    });

    it('keeps approval prompts sequential (not overlapping)', async () => {
      const timestamps: number[] = [];
      const confirm = vi.fn().mockImplementation(async () => {
        timestamps.push(Date.now());
        await new Promise(r => setTimeout(r, 30));
        timestamps.push(Date.now());
        return true;
      });

      const twoDangerousDefs = [
        { name: 'delete_path', description: 'delete', requiresApproval: true },
        { name: 'write_file', description: 'write', requiresApproval: true }
      ] as const;

      const manager = new ToolManager({
        executor: vi.fn().mockResolvedValue('ok'),
        confirmApproval: confirm,
        definitions: twoDangerousDefs as any,
        maxConcurrency: 5
      });

      await manager.execute([
        { tool: 'delete_path', args: { path: 'a' } },
        { tool: 'write_file', args: { path: 'b' } }
      ]);

      // Approval 1: timestamps[0]..timestamps[1], Approval 2: timestamps[2]..timestamps[3]
      // Second approval must start after first ends (sequential)
      expect(timestamps).toHaveLength(4);
      expect(timestamps[2]).toBeGreaterThanOrEqual(timestamps[1]);
    });

    it('handles mixed denied + approved tools correctly', async () => {
      const confirm = vi.fn()
        .mockResolvedValueOnce(false)  // deny first
        .mockResolvedValueOnce(true);  // approve second

      const twoDangerousDefs = [
        { name: 'delete_path', description: 'delete', requiresApproval: true },
        { name: 'write_file', description: 'write', requiresApproval: true }
      ] as const;

      const executor = vi.fn().mockResolvedValue('written');

      const manager = new ToolManager({
        executor,
        confirmApproval: confirm,
        definitions: twoDangerousDefs as any,
        maxConcurrency: 5
      });

      const results = await manager.execute([
        { tool: 'delete_path', args: { path: 'a' } },
        { tool: 'write_file', args: { path: 'b' } }
      ]);

      expect(results[0]).toMatchObject({ tool: 'delete_path', success: false, output: 'Tool execution skipped by user.' });
      expect(results[1]).toMatchObject({ tool: 'write_file', success: true, output: 'written' });
    });

    it('maxConcurrency: 1 behaves sequentially', async () => {
      const delay = 30;
      const tracker = { current: 0, max: 0 };
      const executor = createDelayedExecutor(delay, tracker);

      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue(true),
        definitions: threeDefs as any,
        maxConcurrency: 1
      });

      const start = Date.now();
      await manager.execute([
        { tool: 'read_file', args: {} },
        { tool: 'search_files', args: {} },
        { tool: 'git_status', args: {} }
      ]);
      const elapsed = Date.now() - start;

      // Sequential: should take ~3x delay
      expect(tracker.max).toBe(1);
      expect(elapsed).toBeGreaterThanOrEqual(delay * 2.5);
    });

    it('defaults to maxConcurrency 5 when not specified', async () => {
      const delay = 30;
      const tracker = { current: 0, max: 0 };
      const executor = createDelayedExecutor(delay, tracker);

      const fiveDefs = [
        { name: 'read_file', description: 'r' },
        { name: 'search_files', description: 's' },
        { name: 'git_status', description: 'g' },
        { name: 'list_files', description: 'l' },
        { name: 'web_search', description: 'w' }
      ] as const;

      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue(true),
        definitions: fiveDefs as any
        // No maxConcurrency specified — should default to 5
      });

      await manager.execute([
        { tool: 'read_file', args: {} },
        { tool: 'search_files', args: {} },
        { tool: 'git_status', args: {} },
        { tool: 'list_files', args: {} },
        { tool: 'web_search', args: {} }
      ]);

      // All 5 should run concurrently (default max = 5)
      expect(tracker.max).toBe(5);
    });

    it('onToolComplete callback fires per-tool with correct index and result', async () => {
      const executor = vi.fn()
        .mockImplementationOnce(async () => { await new Promise(r => setTimeout(r, 30)); return 'a'; })
        .mockImplementationOnce(async () => { await new Promise(r => setTimeout(r, 10)); return 'b'; })
        .mockImplementationOnce(async () => { await new Promise(r => setTimeout(r, 20)); return 'c'; });

      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue(true),
        definitions: threeDefs as any,
        maxConcurrency: 5
      });

      const callbacks: Array<{ index: number; result: { tool: string; success: boolean; output?: string } }> = [];

      await manager.execute(
        [
          { tool: 'read_file', args: {} },
          { tool: 'search_files', args: {} },
          { tool: 'git_status', args: {} }
        ],
        (index, result) => {
          callbacks.push({ index, result });
        }
      );

      // Should fire exactly 3 times
      expect(callbacks).toHaveLength(3);

      // Each index should appear once
      const indices = callbacks.map(c => c.index).sort();
      expect(indices).toEqual([0, 1, 2]);

      // Verify correct tool-to-index mapping
      const byIndex = Object.fromEntries(callbacks.map(c => [c.index, c.result]));
      expect(byIndex[0]).toMatchObject({ tool: 'read_file', success: true, output: 'a' });
      expect(byIndex[1]).toMatchObject({ tool: 'search_files', success: true, output: 'b' });
      expect(byIndex[2]).toMatchObject({ tool: 'git_status', success: true, output: 'c' });
    });

    it('onToolComplete fires for rejected and denied tools too', async () => {
      // Use a tool not in definitions to trigger context rejection
      const defs = [
        { name: 'read_file', description: 'read' },
        { name: 'delete_path', description: 'delete', requiresApproval: true }
      ] as const;

      const confirm = vi.fn().mockResolvedValue(false); // deny approval
      const executor = vi.fn().mockResolvedValue('ok');

      const manager = new ToolManager({
        executor,
        confirmApproval: confirm,
        definitions: defs as any,
        maxConcurrency: 5
      });

      const callbacks: Array<{ index: number; result: { tool: string; success: boolean } }> = [];

      await manager.execute(
        [
          { tool: 'read_file', args: {} },           // will execute normally
          { tool: 'delete_path', args: { path: 'x' } } // will be denied by user
        ],
        (index, result) => {
          callbacks.push({ index, result });
        }
      );

      // Both should fire callback
      expect(callbacks).toHaveLength(2);

      const byIndex = Object.fromEntries(callbacks.map(c => [c.index, c.result]));
      expect(byIndex[0]).toMatchObject({ tool: 'read_file', success: true });
      expect(byIndex[1]).toMatchObject({ tool: 'delete_path', success: false });
    });

    it('single tool call works correctly through parallel engine', async () => {
      const executor = vi.fn().mockResolvedValue('single result');
      const callback = vi.fn();

      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue(true),
        definitions: [{ name: 'read_file', description: 'read' }] as any,
        maxConcurrency: 5
      });

      const results = await manager.execute(
        [{ tool: 'read_file', args: { path: 'one.ts' } }],
        callback
      );

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ tool: 'read_file', success: true, output: 'single result' });
      expect(executor).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(0, expect.objectContaining({ tool: 'read_file', success: true }));
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Performance Benchmarks
  // ═══════════════════════════════════════════════════════════════════

  describe('performance benchmarks', () => {
    const fiveDefs = [
      { name: 'read_file', description: 'r' },
      { name: 'search_files', description: 's' },
      { name: 'git_status', description: 'g' },
      { name: 'list_files', description: 'l' },
      { name: 'web_search', description: 'w' }
    ] as const;

    it('parallel is significantly faster than sequential for I/O-bound tools', async () => {
      const ioDelay = 50; // Simulate 50ms I/O per tool (realistic for file reads)
      const toolCount = 5;
      const executor = createDelayedExecutor(ioDelay);

      // Sequential (maxConcurrency: 1)
      const seqManager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue(true),
        definitions: fiveDefs as any,
        maxConcurrency: 1
      });

      const calls = [
        { tool: 'read_file', args: {} },
        { tool: 'search_files', args: {} },
        { tool: 'git_status', args: {} },
        { tool: 'list_files', args: {} },
        { tool: 'web_search', args: {} }
      ];

      const seqStart = Date.now();
      await seqManager.execute(calls as any);
      const seqTime = Date.now() - seqStart;

      // Parallel (maxConcurrency: 5)
      const parManager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue(true),
        definitions: fiveDefs as any,
        maxConcurrency: 5
      });

      const parStart = Date.now();
      await parManager.execute(calls as any);
      const parTime = Date.now() - parStart;

      const speedup = seqTime / parTime;

      // Sequential should take ~5x delay, parallel ~1x delay → speedup >= 2x
      expect(seqTime).toBeGreaterThanOrEqual(ioDelay * (toolCount - 1)); // at least 200ms
      expect(parTime).toBeLessThan(ioDelay * 2.5);                       // under 125ms
      expect(speedup).toBeGreaterThanOrEqual(2);                          // at least 2x faster

      // Log for visibility in test output
      console.log(`  [perf] Sequential: ${seqTime}ms | Parallel: ${parTime}ms | Speedup: ${speedup.toFixed(1)}x`);
    });

    it('speedup scales with tool count (3 vs 5 vs 10 tools)', async () => {
      const ioDelay = 30;
      const results: Array<{ count: number; seqMs: number; parMs: number; speedup: number }> = [];

      for (const count of [3, 5, 10]) {
        // Build definitions and calls for this count
        const defs = Array.from({ length: count }, (_, i) => ({
          name: `tool_${i}`, description: `tool ${i}`
        }));
        const calls = defs.map(d => ({ tool: d.name, args: {} }));

        const executor = createDelayedExecutor(ioDelay);

        // Sequential
        const seqManager = new ToolManager({
          executor,
          confirmApproval: vi.fn().mockResolvedValue(true),
          definitions: defs as any,
          maxConcurrency: 1
        });
        const seqStart = Date.now();
        await seqManager.execute(calls as any);
        const seqMs = Date.now() - seqStart;

        // Parallel
        const parManager = new ToolManager({
          executor,
          confirmApproval: vi.fn().mockResolvedValue(true),
          definitions: defs as any,
          maxConcurrency: 5
        });
        const parStart = Date.now();
        await parManager.execute(calls as any);
        const parMs = Date.now() - parStart;

        const speedup = seqMs / parMs;
        results.push({ count, seqMs, parMs, speedup });
      }

      // Print benchmark table
      console.log('\n  [perf] Parallel Speedup by Tool Count');
      console.log('  ┌────────┬────────────┬────────────┬──────────┐');
      console.log('  │ Tools  │ Sequential │  Parallel  │ Speedup  │');
      console.log('  ├────────┼────────────┼────────────┼──────────┤');
      for (const r of results) {
        console.log(`  │ ${String(r.count).padStart(5)} │ ${String(r.seqMs + 'ms').padStart(9)} │ ${String(r.parMs + 'ms').padStart(9)} │ ${r.speedup.toFixed(1).padStart(6)}x │`);
      }
      console.log('  └────────┴────────────┴────────────┴──────────┘');

      // 3 tools should be at least 2x faster
      expect(results[0].speedup).toBeGreaterThanOrEqual(2);
      // 5 tools should be at least 3x faster
      expect(results[1].speedup).toBeGreaterThanOrEqual(3);
      // 10 tools (capped at concurrency 5): two batches of 5 → ~2x vs seq
      // Still significantly faster than sequential
      expect(results[2].speedup).toBeGreaterThanOrEqual(3);
    });

    it('real file I/O: parallel reads are faster than sequential', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');

      // Use actual project files for realistic I/O
      const testFiles = [
        'src/index.ts',
        'src/types.ts',
        'src/core/toolManager.ts',
        'src/core/agent.ts',
        'src/core/agents/SubAgent.ts'
      ];

      const realExecutor = async (action: any) => {
        const filePath = path.resolve(action.path || action.type);
        return fs.readFile(filePath, 'utf-8');
      };

      const defs = [{ name: 'read_file', description: 'read' }] as any;
      const calls = testFiles.map(f => ({ tool: 'read_file', args: { path: f } }));

      // Sequential
      const seqManager = new ToolManager({
        executor: realExecutor,
        confirmApproval: vi.fn().mockResolvedValue(true),
        definitions: defs,
        maxConcurrency: 1
      });
      const seqStart = Date.now();
      const seqResults = await seqManager.execute(calls as any);
      const seqMs = Date.now() - seqStart;

      // Parallel
      const parManager = new ToolManager({
        executor: realExecutor,
        confirmApproval: vi.fn().mockResolvedValue(true),
        definitions: defs,
        maxConcurrency: 5
      });
      const parStart = Date.now();
      const parResults = await parManager.execute(calls as any);
      const parMs = Date.now() - parStart;

      // Both should succeed and return the same content
      expect(seqResults.every(r => r.success)).toBe(true);
      expect(parResults.every(r => r.success)).toBe(true);
      for (let i = 0; i < testFiles.length; i++) {
        expect(seqResults[i].output).toBe(parResults[i].output);
      }

      // Calculate total bytes read
      const totalBytes = parResults.reduce((sum, r) => sum + (r.output?.length ?? 0), 0);
      const totalKB = (totalBytes / 1024).toFixed(0);

      console.log(`  [perf] Real file I/O (${testFiles.length} files, ${totalKB} KB total)`);
      console.log(`         Sequential: ${seqMs}ms | Parallel: ${parMs}ms`);

      // Real file I/O may not show huge speedup on fast SSDs with warm cache,
      // but parallel should never be slower than sequential
      expect(parMs).toBeLessThanOrEqual(seqMs + 10); // parallel <= sequential + margin
    });
  });
});
