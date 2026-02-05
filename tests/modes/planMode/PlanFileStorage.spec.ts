/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock fs-extra before importing modules that use it
vi.mock('fs-extra', () => ({
  default: {
    ensureDir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    writeJson: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(''),
    readJson: vi.fn().mockResolvedValue({}),
    pathExists: vi.fn().mockResolvedValue(false),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('PlanFileStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createTestPlan = () => ({
    id: 'plan-abc123',
    steps: [
      { number: 1, description: 'First step', status: 'pending' as const },
      { number: 2, description: 'Second step', status: 'pending' as const },
      { number: 3, description: 'Third step', status: 'pending' as const },
    ],
    rawText: '1. First step\n2. Second step\n3. Third step',
    createdAt: Date.now(),
  });

  describe('savePlan', () => {
    it('should save plan to .autohand/plans/<plan-id>.md', async () => {
      const fs = await import('fs-extra');
      const { PlanFileStorage } = await import('../../../src/modes/planMode/PlanFileStorage.js');
      const storage = new PlanFileStorage();

      const plan = createTestPlan();
      await storage.savePlan(plan);

      expect(fs.default.ensureDir).toHaveBeenCalled();
      expect(fs.default.writeFile).toHaveBeenCalled();

      const writeCall = (fs.default.writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(writeCall[0]).toContain('plans');
      expect(writeCall[0]).toContain('plan-abc123.md');
    });

    it('should format plan as markdown', async () => {
      const fs = await import('fs-extra');
      const { PlanFileStorage } = await import('../../../src/modes/planMode/PlanFileStorage.js');
      const storage = new PlanFileStorage();

      const plan = createTestPlan();
      await storage.savePlan(plan);

      const writeCall = (fs.default.writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
      const content = writeCall[1] as string;

      // Should have markdown header
      expect(content).toContain('# Plan');

      // Should list steps
      expect(content).toContain('1. First step');
      expect(content).toContain('2. Second step');
      expect(content).toContain('3. Third step');
    });

    it('should include metadata in plan file', async () => {
      const fs = await import('fs-extra');
      const { PlanFileStorage } = await import('../../../src/modes/planMode/PlanFileStorage.js');
      const storage = new PlanFileStorage();

      const plan = createTestPlan();
      await storage.savePlan(plan);

      const writeCall = (fs.default.writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
      const content = writeCall[1] as string;

      expect(content).toContain('plan-abc123');
      expect(content).toContain('Created:');
    });

    it('should mark completed steps with checkmark', async () => {
      const fs = await import('fs-extra');
      const { PlanFileStorage } = await import('../../../src/modes/planMode/PlanFileStorage.js');
      const storage = new PlanFileStorage();

      const plan = createTestPlan();
      plan.steps[0].status = 'completed';
      plan.steps[1].status = 'in_progress';

      await storage.savePlan(plan);

      const writeCall = (fs.default.writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
      const content = writeCall[1] as string;

      // Completed step should have checkmark
      expect(content).toMatch(/\[x\].*First step/i);
      // In-progress step should have arrow or marker
      expect(content).toMatch(/\[[\->]\].*Second step/i);
      // Pending step should be unchecked
      expect(content).toMatch(/\[ \].*Third step/i);
    });

    it('should return the file path', async () => {
      const { PlanFileStorage } = await import('../../../src/modes/planMode/PlanFileStorage.js');
      const storage = new PlanFileStorage();

      const plan = createTestPlan();
      const filePath = await storage.savePlan(plan);

      expect(filePath).toContain('plan-abc123.md');
    });
  });

  describe('loadPlan', () => {
    it('should load plan from file by ID', async () => {
      const fs = await import('fs-extra');
      (fs.default.pathExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(`
# Plan: plan-abc123

Created: 2025-01-19T10:00:00.000Z

## Steps

- [ ] 1. First step
- [ ] 2. Second step
- [ ] 3. Third step
`);

      const { PlanFileStorage } = await import('../../../src/modes/planMode/PlanFileStorage.js');
      const storage = new PlanFileStorage();

      const plan = await storage.loadPlan('plan-abc123');

      expect(plan).not.toBeNull();
      expect(plan!.id).toBe('plan-abc123');
      expect(plan!.steps).toHaveLength(3);
    });

    it('should return null if plan file does not exist', async () => {
      const fs = await import('fs-extra');
      (fs.default.pathExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const { PlanFileStorage } = await import('../../../src/modes/planMode/PlanFileStorage.js');
      const storage = new PlanFileStorage();

      const plan = await storage.loadPlan('nonexistent-plan');

      expect(plan).toBeNull();
    });

    it('should parse step statuses from markdown checkboxes', async () => {
      const fs = await import('fs-extra');
      (fs.default.pathExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (fs.default.readFile as ReturnType<typeof vi.fn>).mockResolvedValue(`
# Plan: plan-abc123

## Steps

- [x] 1. First step (completed)
- [>] 2. Second step (in progress)
- [ ] 3. Third step (pending)
`);

      const { PlanFileStorage } = await import('../../../src/modes/planMode/PlanFileStorage.js');
      const storage = new PlanFileStorage();

      const plan = await storage.loadPlan('plan-abc123');

      expect(plan!.steps[0].status).toBe('completed');
      expect(plan!.steps[1].status).toBe('in_progress');
      expect(plan!.steps[2].status).toBe('pending');
    });
  });

  describe('listPlans', () => {
    it('should list all plan files in the plans directory', async () => {
      const fs = await import('fs-extra');
      (fs.default.pathExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      // Mock readdir to return plan files
      const mockReaddir = vi.fn().mockResolvedValue([
        'plan-abc123.md',
        'plan-def456.md',
        'plan-ghi789.md',
      ]);
      (fs.default as any).readdir = mockReaddir;

      const { PlanFileStorage } = await import('../../../src/modes/planMode/PlanFileStorage.js');
      const storage = new PlanFileStorage();

      const plans = await storage.listPlans();

      expect(plans).toHaveLength(3);
      expect(plans).toContain('plan-abc123');
      expect(plans).toContain('plan-def456');
    });

    it('should return empty array if plans directory does not exist', async () => {
      const fs = await import('fs-extra');
      (fs.default.pathExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const { PlanFileStorage } = await import('../../../src/modes/planMode/PlanFileStorage.js');
      const storage = new PlanFileStorage();

      const plans = await storage.listPlans();

      expect(plans).toEqual([]);
    });
  });

  describe('deletePlan', () => {
    it('should delete plan file by ID', async () => {
      const fs = await import('fs-extra');
      (fs.default.pathExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const { PlanFileStorage } = await import('../../../src/modes/planMode/PlanFileStorage.js');
      const storage = new PlanFileStorage();

      await storage.deletePlan('plan-abc123');

      expect(fs.default.remove).toHaveBeenCalled();
      const removeCall = (fs.default.remove as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(removeCall[0]).toContain('plan-abc123.md');
    });

    it('should return false if plan does not exist', async () => {
      const fs = await import('fs-extra');
      (fs.default.pathExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const { PlanFileStorage } = await import('../../../src/modes/planMode/PlanFileStorage.js');
      const storage = new PlanFileStorage();

      const result = await storage.deletePlan('nonexistent');

      expect(result).toBe(false);
      expect(fs.default.remove).not.toHaveBeenCalled();
    });
  });

  describe('getPlansDirectory', () => {
    it('should return the plans directory path', async () => {
      const { PlanFileStorage } = await import('../../../src/modes/planMode/PlanFileStorage.js');
      const storage = new PlanFileStorage();

      const dir = storage.getPlansDirectory();

      expect(dir).toContain('.autohand');
      expect(dir).toContain('plans');
    });
  });
});
