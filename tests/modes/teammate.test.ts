import { describe, it, expect, vi, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';

// Mock heavy dependencies before importing
vi.mock('../../src/config.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    provider: 'openrouter',
    openrouter: { apiKey: 'test-key', baseUrl: 'https://test.com', model: 'test-model' },
    configPath: '/tmp/config.json',
    isNewConfig: false,
  }),
}));

vi.mock('../../src/providers/ProviderFactory.js', () => ({
  ProviderFactory: {
    create: vi.fn().mockReturnValue({
      getName: () => 'mock',
      complete: vi.fn().mockResolvedValue({ content: '{"finalResponse": "Done"}' }),
      setModel: vi.fn(),
    }),
  },
}));

vi.mock('../../src/core/agents/AgentRegistry.js', () => ({
  AgentRegistry: {
    getInstance: vi.fn().mockReturnValue({
      loadAgents: vi.fn().mockResolvedValue(undefined),
      getAgent: vi.fn().mockReturnValue({
        name: 'tester',
        description: 'Writes tests',
        systemPrompt: 'You write tests.',
        tools: ['read_file', 'write_file'],
        path: '/tmp/tester.md',
        source: 'builtin' as const,
      }),
    }),
  },
}));

vi.mock('../../src/core/agents/SubAgent.js', () => ({
  SubAgent: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue('Completed: wrote 3 test files'),
  })),
}));

vi.mock('../../src/core/actionExecutor.js', () => ({
  ActionExecutor: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../src/actions/filesystem.js', () => ({
  FileActionManager: vi.fn().mockImplementation(() => ({})),
}));

import { executeTask, parseTeammateOptions, runTeammateModeWithStreams } from '../../src/modes/teammate.js';
import type { TeammateOptions } from '../../src/modes/teammate.js';

describe('parseTeammateOptions', () => {

  it('should parse all required options', () => {
    const argv = [
      'node', 'autohand',
      '--mode', 'teammate',
      '--team', 'code-cleanup',
      '--name', 'hunter',
      '--agent', 'code-cleaner',
      '--lead-session', 'session-123',
    ];
    const opts = parseTeammateOptions(argv);
    expect(opts).toEqual({
      teamName: 'code-cleanup',
      name: 'hunter',
      agentName: 'code-cleaner',
      leadSessionId: 'session-123',
      model: undefined,
      workspacePath: undefined,
    });
  });

  it('should parse optional model and path', () => {
    const argv = [
      'node', 'autohand',
      '--mode', 'teammate',
      '--team', 'test-team',
      '--name', 'tester',
      '--agent', 'tester',
      '--lead-session', 'session-456',
      '--model', 'anthropic/claude-3.5-sonnet',
      '--path', '/tmp/workspace',
    ];
    const opts = parseTeammateOptions(argv);
    expect(opts?.model).toBe('anthropic/claude-3.5-sonnet');
    expect(opts?.workspacePath).toBe('/tmp/workspace');
  });

  it('should return null when required options are missing', () => {
    const argv = ['node', 'autohand', '--mode', 'teammate', '--team', 'test'];
    expect(parseTeammateOptions(argv)).toBeNull();
  });

  it('should return null when no teammate flags are present', () => {
    const argv = ['node', 'autohand'];
    expect(parseTeammateOptions(argv)).toBeNull();
  });
});

describe('teammate executeTask', () => {
  it('runs SubAgent and returns result', async () => {
    const result = await executeTask(
      { teamName: 'test', name: 'worker', agentName: 'tester', leadSessionId: 'sess-1' },
      { id: 'task-1', subject: 'Write tests', description: 'Write unit tests for auth module', status: 'in_progress', blockedBy: [], createdAt: '' }
    );
    expect(result).toContain('Completed');
  });

  it('returns error string on agent not found', async () => {
    const { AgentRegistry } = await import('../../src/core/agents/AgentRegistry.js');
    vi.mocked(AgentRegistry.getInstance().getAgent).mockReturnValueOnce(undefined);

    const result = await executeTask(
      { teamName: 'test', name: 'worker', agentName: 'nonexistent', leadSessionId: 'sess-1' },
      { id: 'task-2', subject: 'Fail', description: '', status: 'in_progress', blockedBy: [], createdAt: '' }
    );
    expect(result).toContain('Error');
    expect(result).toContain('nonexistent');
  });

  it('calls provider.setModel when opts.model is provided', async () => {
    const { ProviderFactory } = await import('../../src/providers/ProviderFactory.js');
    const mockProvider = ProviderFactory.create({} as any);

    await executeTask(
      { teamName: 'test', name: 'worker', agentName: 'tester', leadSessionId: 'sess-1', model: 'custom-model' },
      { id: 'task-3', subject: 'Test', description: 'test', status: 'in_progress', blockedBy: [], createdAt: '' }
    );
    expect(mockProvider.setModel).toHaveBeenCalledWith('custom-model');
  });
});

describe('runTeammateModeWithStreams (keep-alive)', () => {
  const defaultOpts: TeammateOptions = {
    teamName: 'test-team',
    name: 'worker',
    agentName: 'tester',
    leadSessionId: 'sess-1',
  };

  function collectOutput(stdout: PassThrough): string[] {
    const lines: string[] = [];
    stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split('\n')) {
        if (line.trim()) lines.push(line.trim());
      }
    });
    return lines;
  }

  function parseMessages(lines: string[]): Array<{ method: string; params: Record<string, unknown> }> {
    return lines.map((l) => {
      try { return JSON.parse(l); }
      catch { return null; }
    }).filter(Boolean);
  }

  it('sends team.ready on startup', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const lines = collectOutput(stdout);

    // Start teammate mode (don't await — it blocks until shutdown)
    const promise = runTeammateModeWithStreams(defaultOpts, stdin, stdout);

    // Give it a tick to send ready message
    await new Promise((r) => setTimeout(r, 50));

    const messages = parseMessages(lines);
    expect(messages.some((m) => m.method === 'team.ready')).toBe(true);

    // Clean up: send shutdown
    stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'team.shutdown', params: {} }) + '\n');
    await promise;
  });

  it('stays alive when stdin has no data (does not exit prematurely)', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();

    const promise = runTeammateModeWithStreams(defaultOpts, stdin, stdout);

    // Wait 200ms — if the bug exists, the promise resolves immediately
    let resolved = false;
    promise.then(() => { resolved = true; });
    await new Promise((r) => setTimeout(r, 200));

    expect(resolved).toBe(false);

    // Clean up: send shutdown
    stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'team.shutdown', params: {} }) + '\n');
    await promise;
  });

  it('exits gracefully on team.shutdown message', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const lines = collectOutput(stdout);

    const promise = runTeammateModeWithStreams(defaultOpts, stdin, stdout);
    await new Promise((r) => setTimeout(r, 50));

    // Send shutdown
    stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'team.shutdown', params: {} }) + '\n');
    await promise; // Should resolve (not hang)

    const messages = parseMessages(lines);
    expect(messages.some((m) => m.method === 'team.shutdownAck')).toBe(true);
  });

  it('exits when stdin closes (parent process died)', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();

    const promise = runTeammateModeWithStreams(defaultOpts, stdin, stdout);
    await new Promise((r) => setTimeout(r, 50));

    // Simulate parent death by ending stdin
    stdin.end();

    // Should resolve within a reasonable time
    const result = await Promise.race([
      promise.then(() => 'resolved'),
      new Promise<string>((r) => setTimeout(() => r('timeout'), 2000)),
    ]);
    expect(result).toBe('resolved');
  });
});
