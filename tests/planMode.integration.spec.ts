/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActionExecutor } from '../src/core/actionExecutor.js';
import type { AgentRuntime } from '../src/types.js';
import type { Plan } from '../src/modes/planMode/types.js';

// Mock fs-extra before importing modules
vi.mock('fs-extra', () => ({
  default: {
    ensureDir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    writeJson: vi.fn().mockResolvedValue(undefined),
    readJson: vi.fn().mockResolvedValue({}),
    pathExists: vi.fn().mockResolvedValue(false),
    readFile: vi.fn().mockResolvedValue(''),
    remove: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
  },
}));

// Mock chalk to avoid ANSI in tests
vi.mock('chalk', () => ({
  default: {
    gray: (s: string) => s,
    green: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s,
    cyan: (s: string) => s,
    white: (s: string) => s,
    bold: {
      cyan: (s: string) => s,
      green: (s: string) => s,
    },
  },
}));

// Mock the FileActionManager
const mockFileActionManager = {
  readFile: vi.fn(),
  writeFile: vi.fn(),
  appendFile: vi.fn(),
  applyPatch: vi.fn(),
  search: vi.fn().mockReturnValue([]),
  searchWithContext: vi.fn(),
  semanticSearch: vi.fn().mockReturnValue([]),
  createDirectory: vi.fn(),
  deletePath: vi.fn(),
  renamePath: vi.fn(),
  copyPath: vi.fn(),
  formatFile: vi.fn(),
  root: '/test'
};

// Mock runtime
const createMockRuntime = (overrides: Partial<AgentRuntime> = {}): AgentRuntime => ({
  workspaceRoot: '/test',
  config: {
    provider: 'openrouter',
    openrouter: { apiKey: 'test', model: 'test' },
    permissions: {}
  },
  options: {},
  ...overrides
} as AgentRuntime);

describe('plan mode integration', () => {
  let mockOnPlanCreated: ReturnType<typeof vi.fn>;
  let mockOnAskFollowup: ReturnType<typeof vi.fn>;
  let executor: ActionExecutor;

  beforeEach(() => {
    mockOnPlanCreated = vi.fn();
    mockOnAskFollowup = vi.fn();
    executor = new ActionExecutor({
      runtime: createMockRuntime(),
      files: mockFileActionManager as any,
      resolveWorkspacePath: (p) => `/test/${p}`,
      confirmDangerousAction: vi.fn().mockResolvedValue(true),
      onPlanCreated: mockOnPlanCreated,
      onAskFollowup: mockOnAskFollowup
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('plan tool execution', () => {
    it('creates Plan object from numbered notes', async () => {
      mockOnPlanCreated.mockResolvedValue('Plan accepted');

      await executor.execute({
        type: 'plan',
        notes: '1. First step\n2. Second step\n3. Third step'
      });

      expect(mockOnPlanCreated).toHaveBeenCalled();
      const [plan] = mockOnPlanCreated.mock.calls[0];
      expect(plan.steps).toHaveLength(3);
      expect(plan.steps[0].description).toBe('First step');
      expect(plan.steps[1].description).toBe('Second step');
      expect(plan.steps[2].description).toBe('Third step');
    });

    it('creates Plan object from bullet points', async () => {
      mockOnPlanCreated.mockResolvedValue('Plan accepted');

      await executor.execute({
        type: 'plan',
        notes: '- Step one\n- Step two\n* Step three'
      });

      expect(mockOnPlanCreated).toHaveBeenCalled();
      const [plan] = mockOnPlanCreated.mock.calls[0];
      expect(plan.steps).toHaveLength(3);
      expect(plan.steps[0].number).toBe(1);
      expect(plan.steps[1].number).toBe(2);
      expect(plan.steps[2].number).toBe(3);
    });

    it('handles mixed numbered and bullet formats', async () => {
      mockOnPlanCreated.mockResolvedValue('Plan accepted');

      await executor.execute({
        type: 'plan',
        notes: '1. First numbered\n- Bullet item\n2) Another numbered'
      });

      expect(mockOnPlanCreated).toHaveBeenCalled();
      const [plan] = mockOnPlanCreated.mock.calls[0];
      expect(plan.steps).toHaveLength(3);
    });

    it('creates single step when notes have no list format', async () => {
      mockOnPlanCreated.mockResolvedValue('Plan accepted');

      await executor.execute({
        type: 'plan',
        notes: 'Just a simple plan description without lists'
      });

      expect(mockOnPlanCreated).toHaveBeenCalled();
      const [plan] = mockOnPlanCreated.mock.calls[0];
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].description).toContain('Just a simple plan');
    });

    it('returns "No plan notes provided" when notes are empty', async () => {
      const result = await executor.execute({
        type: 'plan',
        notes: ''
      });

      expect(result).toBe('No plan notes provided');
      expect(mockOnPlanCreated).not.toHaveBeenCalled();
    });

    it('returns "No plan notes provided" when notes are undefined', async () => {
      const result = await executor.execute({
        type: 'plan'
      } as any);

      expect(result).toBe('No plan notes provided');
      expect(mockOnPlanCreated).not.toHaveBeenCalled();
    });

    it('generates unique plan ID', async () => {
      mockOnPlanCreated.mockResolvedValue('Plan accepted');

      await executor.execute({
        type: 'plan',
        notes: '1. Step one'
      });

      await executor.execute({
        type: 'plan',
        notes: '1. Another step'
      });

      const [plan1] = mockOnPlanCreated.mock.calls[0];
      const [plan2] = mockOnPlanCreated.mock.calls[1];
      expect(plan1.id).not.toBe(plan2.id);
      expect(plan1.id).toMatch(/^plan-[a-f0-9]+$/);
    });

    it('sets all steps to pending status', async () => {
      mockOnPlanCreated.mockResolvedValue('Plan accepted');

      await executor.execute({
        type: 'plan',
        notes: '1. Step 1\n2. Step 2\n3. Step 3'
      });

      const [plan] = mockOnPlanCreated.mock.calls[0];
      expect(plan.steps.every((s: any) => s.status === 'pending')).toBe(true);
    });

    it('preserves rawText in plan', async () => {
      mockOnPlanCreated.mockResolvedValue('Plan accepted');
      const notes = '1. Do this\n2. Then that\n3. Finally this';

      await executor.execute({
        type: 'plan',
        notes
      });

      const [plan] = mockOnPlanCreated.mock.calls[0];
      expect(plan.rawText).toBe(notes);
    });

    it('passes file path to callback', async () => {
      mockOnPlanCreated.mockResolvedValue('Plan accepted');

      await executor.execute({
        type: 'plan',
        notes: '1. Step'
      });

      expect(mockOnPlanCreated).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringMatching(/\.md$/)
      );
    });
  });

  describe('plan acceptance callback integration', () => {
    it('returns result from onPlanCreated callback', async () => {
      mockOnPlanCreated.mockResolvedValue('Plan accepted with option: auto_accept');

      const result = await executor.execute({
        type: 'plan',
        notes: '1. Test step'
      });

      expect(result).toBe('Plan accepted with option: auto_accept');
    });

    it('allows callback to reject plan', async () => {
      mockOnPlanCreated.mockResolvedValue('Plan not accepted. Staying in planning mode.');

      const result = await executor.execute({
        type: 'plan',
        notes: '1. Test step'
      });

      expect(result).toContain('not accepted');
    });
  });

  describe('fallback when no callback provided', () => {
    it('returns summary when onPlanCreated is not set', async () => {
      const executorNoCallback = new ActionExecutor({
        runtime: createMockRuntime(),
        files: mockFileActionManager as any,
        resolveWorkspacePath: (p) => `/test/${p}`,
        confirmDangerousAction: vi.fn().mockResolvedValue(true)
        // No onPlanCreated
      });

      const result = await executorNoCallback.execute({
        type: 'plan',
        notes: '1. First\n2. Second'
      });

      expect(result).toContain('Plan saved to');
      expect(result).toContain('First');
      expect(result).toContain('Second');
    });
  });

  describe('edge cases', () => {
    it('handles notes with extra whitespace', async () => {
      mockOnPlanCreated.mockResolvedValue('Plan accepted');

      await executor.execute({
        type: 'plan',
        notes: '  1.   Step with spaces  \n\n  2.  Another step  \n\n'
      });

      const [plan] = mockOnPlanCreated.mock.calls[0];
      expect(plan.steps).toHaveLength(2);
      expect(plan.steps[0].description).toBe('Step with spaces');
    });

    it('handles notes with only non-list content', async () => {
      mockOnPlanCreated.mockResolvedValue('Plan accepted');

      await executor.execute({
        type: 'plan',
        notes: 'This is a paragraph.\n\nAnother paragraph.'
      });

      const [plan] = mockOnPlanCreated.mock.calls[0];
      expect(plan.steps).toHaveLength(1);
    });

    it('truncates very long single-step descriptions', async () => {
      mockOnPlanCreated.mockResolvedValue('Plan accepted');
      const longNote = 'A'.repeat(500);

      await executor.execute({
        type: 'plan',
        notes: longNote
      });

      const [plan] = mockOnPlanCreated.mock.calls[0];
      expect(plan.steps[0].description.length).toBeLessThanOrEqual(200);
    });

    it('handles numbered list with parenthesis format (1)', async () => {
      mockOnPlanCreated.mockResolvedValue('Plan accepted');

      await executor.execute({
        type: 'plan',
        notes: '1) First\n2) Second'
      });

      const [plan] = mockOnPlanCreated.mock.calls[0];
      expect(plan.steps).toHaveLength(2);
      expect(plan.steps[0].description).toBe('First');
    });

    it('handles numbered list with period format (1.)', async () => {
      mockOnPlanCreated.mockResolvedValue('Plan accepted');

      await executor.execute({
        type: 'plan',
        notes: '1. First\n2. Second'
      });

      const [plan] = mockOnPlanCreated.mock.calls[0];
      expect(plan.steps).toHaveLength(2);
    });

    it('sets createdAt timestamp', async () => {
      mockOnPlanCreated.mockResolvedValue('Plan accepted');
      const before = Date.now();

      await executor.execute({
        type: 'plan',
        notes: '1. Step'
      });

      const [plan] = mockOnPlanCreated.mock.calls[0];
      expect(plan.createdAt).toBeGreaterThanOrEqual(before);
      expect(plan.createdAt).toBeLessThanOrEqual(Date.now());
    });
  });
});

describe('PlanModeManager tool filtering', () => {
  it('provides read-only tools list', async () => {
    const { PlanModeManager } = await import('../src/modes/planMode/PlanModeManager.js');
    const manager = new PlanModeManager();

    const tools = manager.getReadOnlyTools();

    // Should include read operations
    expect(tools).toContain('read_file');
    expect(tools).toContain('search');
    expect(tools).toContain('list_tree');
    expect(tools).toContain('git_status');
    expect(tools).toContain('git_diff');
    expect(tools).toContain('git_log');

    // Should include plan-related tools
    expect(tools).toContain('plan');
    expect(tools).toContain('ask_followup_question');

    // Should NOT include write operations
    expect(tools).not.toContain('write_file');
    expect(tools).not.toContain('apply_patch');
    expect(tools).not.toContain('run_command');
    expect(tools).not.toContain('git_commit');
    expect(tools).not.toContain('git_push');
  });

  it('should filter tools during planning phase', async () => {
    const { PlanModeManager } = await import('../src/modes/planMode/PlanModeManager.js');
    const manager = new PlanModeManager();

    manager.enable();
    expect(manager.isEnabled()).toBe(true);
    expect(manager.getPhase()).toBe('planning');

    const readOnlyTools = new Set(manager.getReadOnlyTools());

    // Simulate tool filtering in runReactLoop
    const allTools = [
      { name: 'read_file' },
      { name: 'write_file' },
      { name: 'search' },
      { name: 'run_command' },
      { name: 'plan' },
      { name: 'git_commit' },
    ];

    const filteredTools = allTools.filter(t => readOnlyTools.has(t.name));

    expect(filteredTools.map(t => t.name)).toContain('read_file');
    expect(filteredTools.map(t => t.name)).toContain('search');
    expect(filteredTools.map(t => t.name)).toContain('plan');
    expect(filteredTools.map(t => t.name)).not.toContain('write_file');
    expect(filteredTools.map(t => t.name)).not.toContain('run_command');
    expect(filteredTools.map(t => t.name)).not.toContain('git_commit');
  });
});

describe('plan cleanup and resume', () => {
  let mockOnPlanCreated: ReturnType<typeof vi.fn>;
  let mockOnAskFollowup: ReturnType<typeof vi.fn>;
  let executor: ActionExecutor;
  let mockFs: any;

  beforeEach(async () => {
    mockOnPlanCreated = vi.fn();
    mockOnAskFollowup = vi.fn();
    mockFs = (await import('fs-extra')).default;

    executor = new ActionExecutor({
      runtime: createMockRuntime(),
      files: mockFileActionManager as any,
      resolveWorkspacePath: (p) => `/test/${p}`,
      confirmDangerousAction: vi.fn().mockResolvedValue(true),
      onPlanCreated: mockOnPlanCreated,
      onAskFollowup: mockOnAskFollowup
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('cleans up plans older than 30 days', async () => {
    const oldDate = Date.now() - (31 * 24 * 60 * 60 * 1000); // 31 days ago
    // Use completed step [x] so it won't be detected as incomplete after cleanup
    const oldPlanContent = `# Plan: old-plan\n\nCreated: ${new Date(oldDate).toISOString()}\n\n## Steps\n\n- [x] 1. Completed old step`;

    // First readdir returns old plan, second (after cleanup) returns empty
    mockFs.readdir
      .mockResolvedValueOnce(['old-plan.md'])  // First call: before cleanup
      .mockResolvedValueOnce([]);               // Second call: after cleanup (plan deleted)
    mockFs.pathExists.mockResolvedValue(true);
    mockFs.readFile.mockResolvedValue(oldPlanContent);
    mockFs.remove.mockResolvedValue(undefined);
    mockOnPlanCreated.mockResolvedValue('Plan accepted');

    await executor.execute({
      type: 'plan',
      notes: '1. New step'
    });

    // Should have called remove on old plan
    expect(mockFs.remove).toHaveBeenCalled();
  });

  it('does not clean up plans less than 30 days old', async () => {
    const recentDate = Date.now() - (29 * 24 * 60 * 60 * 1000); // 29 days ago
    const recentPlanContent = `# Plan: recent-plan\n\nCreated: ${new Date(recentDate).toISOString()}\n\n## Steps\n\n- [x] 1. Completed step`;

    mockFs.pathExists.mockResolvedValue(true);
    mockFs.readdir.mockResolvedValue(['recent-plan.md']);
    mockFs.readFile.mockResolvedValue(recentPlanContent);
    mockOnPlanCreated.mockResolvedValue('Plan accepted');

    await executor.execute({
      type: 'plan',
      notes: '1. New step'
    });

    // Should NOT have called remove
    expect(mockFs.remove).not.toHaveBeenCalled();
  });

  it('offers to resume incomplete plans', async () => {
    const recentDate = Date.now() - (1 * 24 * 60 * 60 * 1000); // 1 day ago
    const incompletePlanContent = `# Plan: incomplete-plan\n\nCreated: ${new Date(recentDate).toISOString()}\n\n## Steps\n\n- [ ] 1. Pending step\n- [>] 2. In progress step`;

    mockFs.pathExists.mockResolvedValue(true);
    mockFs.readdir.mockResolvedValue(['incomplete-plan.md']);
    mockFs.readFile.mockResolvedValue(incompletePlanContent);
    mockOnAskFollowup.mockResolvedValue('<answer>Create new plan</answer>');
    mockOnPlanCreated.mockResolvedValue('Plan accepted');

    await executor.execute({
      type: 'plan',
      notes: '1. New step'
    });

    // Should have asked about resuming
    expect(mockOnAskFollowup).toHaveBeenCalledWith(
      expect.stringContaining('resume'),
      expect.arrayContaining(['Create new plan'])
    );
  });

  it('resumes plan when user selects resume option', async () => {
    const recentDate = Date.now() - (1 * 24 * 60 * 60 * 1000);
    const incompletePlanContent = `# Plan: incomplete-plan\n\nCreated: ${new Date(recentDate).toISOString()}\n\n## Steps\n\n- [ ] 1. Pending step`;

    mockFs.pathExists.mockResolvedValue(true);
    mockFs.readdir.mockResolvedValue(['incomplete-plan.md']);
    mockFs.readFile.mockResolvedValue(incompletePlanContent);
    mockOnAskFollowup.mockResolvedValue('<answer>Resume: incomplete-plan</answer>');
    mockOnPlanCreated.mockResolvedValue('Resumed plan');

    await executor.execute({
      type: 'plan',
      notes: '1. This should be ignored when resuming'
    });

    // Should have called onPlanCreated with the resumed plan
    expect(mockOnPlanCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'incomplete-plan' }),
      expect.any(String)
    );
  });

  it('creates new plan when user chooses not to resume', async () => {
    const recentDate = Date.now() - (1 * 24 * 60 * 60 * 1000);
    const incompletePlanContent = `# Plan: incomplete-plan\n\nCreated: ${new Date(recentDate).toISOString()}\n\n## Steps\n\n- [ ] 1. Pending step`;

    mockFs.pathExists.mockResolvedValue(true);
    mockFs.readdir.mockResolvedValue(['incomplete-plan.md']);
    mockFs.readFile.mockResolvedValue(incompletePlanContent);
    mockOnAskFollowup.mockResolvedValue('<answer>Create new plan</answer>');
    mockOnPlanCreated.mockResolvedValue('Plan accepted');

    await executor.execute({
      type: 'plan',
      notes: '1. Brand new step'
    });

    // Should have called onPlanCreated with a NEW plan (not incomplete-plan)
    expect(mockOnPlanCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^plan-[a-f0-9]+$/),
        steps: expect.arrayContaining([
          expect.objectContaining({ description: 'Brand new step' })
        ])
      }),
      expect.any(String)
    );
  });

  it('does not ask about resume if no incomplete plans exist', async () => {
    // All plans are complete
    const completePlanContent = `# Plan: complete-plan\n\nCreated: ${new Date().toISOString()}\n\n## Steps\n\n- [x] 1. Done step`;

    mockFs.pathExists.mockResolvedValue(true);
    mockFs.readdir.mockResolvedValue(['complete-plan.md']);
    mockFs.readFile.mockResolvedValue(completePlanContent);
    mockOnPlanCreated.mockResolvedValue('Plan accepted');

    await executor.execute({
      type: 'plan',
      notes: '1. New step'
    });

    // Should NOT have asked about resuming
    expect(mockOnAskFollowup).not.toHaveBeenCalled();
  });

  it('handles empty plans directory', async () => {
    mockFs.pathExists.mockResolvedValue(false);
    mockFs.readdir.mockResolvedValue([]);
    mockOnPlanCreated.mockResolvedValue('Plan accepted');

    await executor.execute({
      type: 'plan',
      notes: '1. First step'
    });

    // Should just create new plan without asking
    expect(mockOnAskFollowup).not.toHaveBeenCalled();
    expect(mockOnPlanCreated).toHaveBeenCalled();
  });
});

describe('plan acceptance flow', () => {
  it('acceptPlan with clear_context_auto_accept sets correct config', async () => {
    const { PlanModeManager } = await import('../src/modes/planMode/PlanModeManager.js');
    const manager = new PlanModeManager();

    manager.enable();
    manager.setPlan({
      id: 'test-plan',
      steps: [{ number: 1, description: 'Step', status: 'pending' }],
      rawText: '1. Step',
      createdAt: Date.now(),
    });

    const config = manager.acceptPlan('clear_context_auto_accept');

    expect(config.clearContext).toBe(true);
    expect(config.autoAcceptEdits).toBe(true);
    expect(manager.getPhase()).toBe('executing');
  });

  it('acceptPlan with manual_approve sets correct config', async () => {
    const { PlanModeManager } = await import('../src/modes/planMode/PlanModeManager.js');
    const manager = new PlanModeManager();

    manager.enable();
    manager.setPlan({
      id: 'test-plan',
      steps: [{ number: 1, description: 'Step', status: 'pending' }],
      rawText: '1. Step',
      createdAt: Date.now(),
    });

    const config = manager.acceptPlan('manual_approve');

    expect(config.clearContext).toBe(false);
    expect(config.autoAcceptEdits).toBe(false);
    expect(manager.getPhase()).toBe('executing');
  });

  it('acceptPlan with auto_accept sets correct config', async () => {
    const { PlanModeManager } = await import('../src/modes/planMode/PlanModeManager.js');
    const manager = new PlanModeManager();

    manager.enable();
    manager.setPlan({
      id: 'test-plan',
      steps: [{ number: 1, description: 'Step', status: 'pending' }],
      rawText: '1. Step',
      createdAt: Date.now(),
    });

    const config = manager.acceptPlan('auto_accept');

    expect(config.clearContext).toBe(false);
    expect(config.autoAcceptEdits).toBe(true);
    expect(manager.getPhase()).toBe('executing');
  });

  it('emits events during plan acceptance', async () => {
    const { PlanModeManager } = await import('../src/modes/planMode/PlanModeManager.js');
    const manager = new PlanModeManager();
    const acceptedCallback = vi.fn();
    const executionCallback = vi.fn();

    manager.on('plan:accepted', acceptedCallback);
    manager.on('execution:started', executionCallback);

    manager.enable();
    manager.setPlan({
      id: 'test-plan',
      steps: [{ number: 1, description: 'Step', status: 'pending' }],
      rawText: '1. Step',
      createdAt: Date.now(),
    });

    manager.acceptPlan('auto_accept');

    expect(acceptedCallback).toHaveBeenCalledWith(expect.objectContaining({
      option: 'auto_accept'
    }));
    expect(executionCallback).toHaveBeenCalled();
  });
});
