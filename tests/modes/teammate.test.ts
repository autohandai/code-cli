import { describe, it, expect, vi } from 'vitest';

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

import { executeTask, parseTeammateOptions } from '../../src/modes/teammate.js';

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
