import { describe, it, expect, vi, beforeEach } from 'vitest';
import { team } from '../../src/commands/team.js';
import { tasks } from '../../src/commands/tasks.js';
import { message } from '../../src/commands/message.js';

// Minimal TeamManager mock
function createMockTeamManager(hasTeam = true) {
  const taskList = [
    { id: 'task-001', subject: 'Fix bug', status: 'completed', owner: 'hunter', blockedBy: [], createdAt: '', completedAt: '' },
    { id: 'task-002', subject: 'Write docs', status: 'in_progress', owner: 'writer', blockedBy: [], createdAt: '' },
    { id: 'task-003', subject: 'Add tests', status: 'pending', owner: undefined, blockedBy: ['task-002'], createdAt: '' },
  ];
  return {
    getTeam: vi.fn().mockReturnValue(hasTeam ? {
      name: 'test-team',
      status: 'active',
      members: [
        { name: 'hunter', agentName: 'code-cleaner', pid: 123, status: 'working' },
        { name: 'writer', agentName: 'docs-writer', pid: 456, status: 'idle' },
      ],
    } : null),
    getStatus: vi.fn().mockReturnValue({
      teamName: 'test-team',
      memberCount: 2,
      tasksDone: 1,
      tasksTotal: 3,
    }),
    tasks: {
      listTasks: vi.fn().mockReturnValue(taskList),
    },
    shutdown: vi.fn().mockResolvedValue(undefined),
    sendMessageTo: vi.fn(),
  };
}

describe('/team command', () => {
  it('should show help when called with no args', async () => {
    const mock = createMockTeamManager();
    const result = await team({ teamManager: mock as any }, []);
    expect(result).toContain('Team Commands');
  });

  it('should show team status', async () => {
    const mock = createMockTeamManager();
    const result = await team({ teamManager: mock as any }, ['status']);
    expect(result).toContain('test-team');
    expect(result).toContain('hunter');
    expect(result).toContain('writer');
  });

  it('should return warning when no team manager', async () => {
    const result = await team({ teamManager: undefined }, []);
    expect(result).toContain('not available');
  });

  it('should shutdown team', async () => {
    const mock = createMockTeamManager();
    const result = await team({ teamManager: mock as any }, ['shutdown']);
    expect(mock.shutdown).toHaveBeenCalled();
    expect(result).toContain('shut down');
  });
});

describe('/tasks command', () => {
  it('should list tasks with status', async () => {
    const mock = createMockTeamManager();
    const result = await tasks({ teamManager: mock as any });
    expect(result).toContain('1/3 done');
    expect(result).toContain('Fix bug');
    expect(result).toContain('Write docs');
    expect(result).toContain('Add tests');
  });

  it('should return warning when no team', async () => {
    const mock = createMockTeamManager(false);
    const result = await tasks({ teamManager: mock as any });
    expect(result).toContain('No active team');
  });
});

describe('/message command', () => {
  it('should send a message to a teammate', async () => {
    const mock = createMockTeamManager();
    const result = await message({ teamManager: mock as any }, ['hunter', 'check', 'src/legacy/']);
    expect(mock.sendMessageTo).toHaveBeenCalledWith('hunter', 'lead', 'check src/legacy/');
    expect(result).toContain('sent');
  });

  it('should show usage when args are insufficient', async () => {
    const mock = createMockTeamManager();
    const result = await message({ teamManager: mock as any }, ['hunter']);
    expect(result).toContain('Usage');
  });
});
