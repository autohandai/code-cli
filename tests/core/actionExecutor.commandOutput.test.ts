import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ToolManager } from '../../src/core/toolManager.js';
import { setConfigSetting } from '../../src/commands/settings.js';
import { ActionExecutor } from '../../src/core/actionExecutor.js';
import { FileActionManager } from '../../src/actions/filesystem.js';
import { formatToolObservation, handleAgentToolOutput, queueAgentToolMessageChunk } from '../../src/core/agent/AgentToolOutputRuntime.js';
const directories: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
describe('command output at the model boundary', () => {
  it('preserves the model observation through tool-result normalization', async () => {
    const manager = new ToolManager({ executor: async () => ({ success: true, output: 'terminal log', modelOutput: 'model log' }),
      definitions: [{ name: 'run_command', description: 'Run a command' }], confirmApproval: async () => true });
    const [result] = await manager.execute([{ tool: 'run_command', args: { command: 'true' } }]);
    expect(result.output).toBe('terminal log');
    expect(formatToolObservation(result)).toBe('model log');
  });
  it('accepts the public config key and rejects invalid limits', () => {
    const config = { configPath: '/fixture/config.json' };
    expect(setConfigSetting(config, 'tools.maxCommandOutputChars', '4096').value).toBe(4096);
    expect(() => setConfigSetting(config, 'tools.maxCommandOutputChars', '0')).toThrow('at least 1024');
  });

  it.each([
    { type: 'run_command', live: false, exit: 0 },
    { type: 'run_command', live: false, exit: 7 },
    { type: 'shell', live: false, exit: 0 },
    { type: 'shell', live: false, exit: 7 },
    { type: 'shell', live: true, exit: 0 },
    { type: 'shell', live: true, exit: 7 },
  ] as const)('bounds $type live=$live exit=$exit and saves output beyond the UI capture limit', async ({ type, live, exit }) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ah-command-model-')); directories.push(directory);
    const script = path.join(directory, 'output.cjs');
    const stdout = 'HEAD\n' + 'x'.repeat(1024 * 1024 + 20000) + '\n400000\n';
    await writeFile(script, `process.stdout.write(${JSON.stringify(stdout)}, () => { process.stderr.write(${JSON.stringify('STDERR_FINAL\n')}, () => { process.exitCode = ${exit}; }); });`);
    const actions = new ActionExecutor({
      runtime: { workspaceRoot: directory, config: { configPath: '' }, options: { yes: true } },
      files: new FileActionManager(directory), resolveWorkspacePath: file => path.resolve(directory, file),
      confirmDangerousAction: async () => true, getCommandOutputDirectory: () => path.join(directory, 'session'),
      ...(live ? { onLiveCommandStart: () => 'live', onLiveCommandOutput: vi.fn(), onLiveCommandRemove: vi.fn(), onLiveCommandFinish: vi.fn() } : {}),
    });
    const outcome = await actions.executeForTool({ type, command: `"${process.execPath}" "${script}"` }, { approvalHandled: true });
    expect(outcome.success).toBe(exit === 0);
    expect(outcome.output!.length).toBeGreaterThan(30000);
    const model = formatToolObservation({ tool: type, ...outcome });
    expect(model.length).toBeLessThanOrEqual(30000);
    expect(model).toContain('400000'); expect(model).toContain('STDERR_FINAL');
    const files = await readdir(path.join(directory, 'session', 'command-output'));
    const filename = path.join(directory, 'session', 'command-output', files[0]);
    const archived = await readFile(filename, 'utf8');
    expect(archived.replace('STDERR_FINAL\n', '')).toBe(stdout);
    expect(model).toContain(filename);
  });
  it('keeps a 20k log whole and does not create an unnecessary archive', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ah-command-short-')); directories.push(directory);
    const actions = new ActionExecutor({ runtime: { workspaceRoot: directory, config: { configPath: '' }, options: { yes: true } },
      files: new FileActionManager(directory), resolveWorkspacePath: file => path.resolve(directory, file),
      confirmDangerousAction: async () => true, getCommandOutputDirectory: () => directory });
    const outcome = await actions.executeForTool({ type: 'run_command', command: `"${process.execPath}" -e 'process.stdout.write("Q".repeat(20000))'` }, { approvalHandled: true });
    expect(formatToolObservation({ tool: 'run_command', ...outcome })).toContain('Q'.repeat(20000));
    expect(await readdir(directory)).not.toContain('command-output');
  });
  it.each([
    { type: 'run_command', background: true },
    { type: 'run_command', interactive: true },
    { type: 'shell', background: true },
  ] as const)('bounds the $type observation envelope with %j', async action => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ah-command-envelope-')); directories.push(directory);
    const actions = new ActionExecutor({ runtime: { workspaceRoot: directory, config: { configPath: '', tools: { maxCommandOutputChars: 1024 } }, options: { yes: true } },
      files: new FileActionManager(directory), resolveWorkspacePath: file => path.resolve(directory, file),
      confirmDangerousAction: async () => true });
    vi.spyOn(actions as unknown as { executeLegacy: () => Promise<string> }, 'executeLegacy')
      .mockResolvedValue('$ command\n' + 'metadata'.repeat(1000));
    const outcome = await actions.executeForTool({ ...action, command: 'fixture' }, { approvalHandled: true });
    expect(outcome.success).toBe(true);
    expect(outcome.output!.length).toBeGreaterThan(1024);
    expect(formatToolObservation({ tool: action.type, ...outcome }).length).toBeLessThanOrEqual(1024);
  });
  it('keeps streamed command chunks out of the conversation even when streaming is enabled', async () => {
    vi.stubEnv('AUTOHAND_STREAM_TOOL_OUTPUT', '1');
    const appendTransient = vi.fn(); const queueToolMessageChunk = vi.fn();
    const host = { sessionManager: { getCurrentSession: () => ({ append: vi.fn(), appendTransient }) }, toolOutputQueue: Promise.resolve(), queueToolMessageChunk };
    for (const tool of ['run_command', 'shell'] as const) {
      handleAgentToolOutput(host, { tool, toolCallId: 'command', data: 'unbounded', stream: 'stdout' });
      queueAgentToolMessageChunk(host, tool, 'unbounded', 'command', 'stdout');
    }
    await host.toolOutputQueue;
    expect(queueToolMessageChunk).not.toHaveBeenCalled(); expect(appendTransient).not.toHaveBeenCalled();
  });
});
