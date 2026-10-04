/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import stripAnsi from 'strip-ansi';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const modal = vi.hoisted(() => ({ showPlanAcceptModal: vi.fn() }));
const opener = vi.hoisted(() => ({ openPlanFile: vi.fn(async () => 'code') }));

vi.mock('../../../src/ui/planAcceptModal.js', () => ({ showPlanAcceptModal: modal.showPlanAcceptModal }));
vi.mock('../../../src/modes/planMode/openPlanFile.js', () => ({ openPlanFile: opener.openPlanFile }));

import { getPlanModeManager } from '../../../src/commands/plan.js';
import {
  handleAgentExitPlanMode,
  handleAgentPlanCreated,
  type AgentCommandRuntimeHost,
} from '../../../src/core/agent/AgentCommandRuntime.js';
import { PlanFileStorage } from '../../../src/modes/planMode/PlanFileStorage.js';
import type { Plan } from '../../../src/modes/planMode/types.js';

const NOTES = [
  '## Goal',
  'Refresh tokens lazily.',
  '',
  '1. Read the store',
  '   - note the callers',
  '2. Run tests',
].join('\n');

const plan = (): Plan => ({
  id: 'plan-abc123',
  steps: [
    { number: 1, description: 'Read the store', status: 'pending' },
    { number: 2, description: 'Run tests', status: 'pending' },
  ],
  rawText: NOTES,
  createdAt: 1,
});

function createHost() {
  const notes: string[] = [];
  const host = {
    runtime: { options: {}, workspaceRoot: '/repo' },
    conversation: { addSystemNote: (note: string) => { notes.push(note); } },
    withModalPause: <T>(callback: () => Promise<T>) => callback(),
    resetConversationContext: vi.fn(async () => {}),
  };
  return { host: host as unknown as AgentCommandRuntimeHost, notes, resetConversationContext: host.resetConversationContext };
}

describe('plan presentation and review', () => {
  let printed: () => string;
  const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  const savedCi = process.env.CI;

  beforeEach(() => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printed = () => stripAnsi(consoleSpy.mock.calls.map((call) => call.join(' ')).join('\n'));
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    delete process.env.CI;
    modal.showPlanAcceptModal.mockReset();
    opener.openPlanFile.mockClear();
    getPlanModeManager().enable();
  });

  afterEach(() => {
    getPlanModeManager().disable();
    vi.restoreAllMocks();
    if (ttyDescriptor) {
      Object.defineProperty(process.stdin, 'isTTY', ttyDescriptor);
    } else {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
    }
    if (savedCi !== undefined) process.env.CI = savedCi;
  });

  describe('when the plan is created', () => {
    it('shows the plan as the model wrote it, once, with where it was saved', async () => {
      const { host } = createHost();

      await handleAgentPlanCreated(host, plan(), '/home/plans/plan-abc123.md');

      const output = printed();
      expect(output).toContain('Goal');
      expect(output).toContain('Refresh tokens lazily.');
      expect(output).toContain('note the callers');
      expect(output).toContain('/home/plans/plan-abc123.md');
      expect(output.match(/Read the store/gu)).toHaveLength(1);
      expect(output.match(/plan-abc123\.md/gu)).toHaveLength(1);
    });

    it('tells the model what to do next without garbled wording', async () => {
      const { host } = createHost();

      const result = await handleAgentPlanCreated(host, plan(), '/home/plans/plan-abc123.md');

      expect(result).toContain('Plan saved to /home/plans/plan-abc123.md (2 step(s)).');
      expect(result).toContain('present the plan to the user');
      expect(result).not.toContain('host plan');
      expect(getPlanModeManager().getPlan()?.id).toBe('plan-abc123');
    });

    it('shows the same plan when plan mode is off, and says how to get the review flow', async () => {
      getPlanModeManager().disable();
      const { host } = createHost();

      const result = await handleAgentPlanCreated(host, plan(), '/home/plans/plan-abc123.md');

      expect(printed()).toContain('Refresh tokens lazily.');
      expect(result).toContain('Plan mode is not active');
    });
  });

  describe('when the plan is reviewed', () => {
    beforeEach(() => {
      getPlanModeManager().setPlan(plan());
    });

    it('gives the review prompt the real location of the plan file and a way to open it', async () => {
      modal.showPlanAcceptModal.mockResolvedValue({ type: 'cancel' });
      vi.spyOn(PlanFileStorage.prototype, 'loadPlan').mockResolvedValue(plan());
      const { host } = createHost();

      await handleAgentExitPlanMode(host);

      const options = modal.showPlanAcceptModal.mock.calls[0]?.[0] as { planFilePath: string; onOpenPlan: () => Promise<string | null> };
      const expectedPath = path.join(new PlanFileStorage().getPlansDirectory(), 'plan-abc123.md');
      expect(options.planFilePath).toBe(expectedPath);
      await expect(options.onOpenPlan()).resolves.toBe('code');
      expect(opener.openPlanFile).toHaveBeenCalledExactlyOnceWith(expectedPath);
    });

    it('accepts an untouched plan and lists its steps for execution', async () => {
      modal.showPlanAcceptModal.mockResolvedValue({ type: 'option', optionId: 'manual_approve' });
      vi.spyOn(PlanFileStorage.prototype, 'loadPlan').mockResolvedValue(plan());
      const { host } = createHost();

      const outcome = await handleAgentExitPlanMode(host);

      expect(outcome).toMatchObject({ success: true });
      expect(outcome.output).toContain('Plan accepted with option: manual_approve');
      expect(outcome.output).toContain('1. Read the store\n2. Run tests');
      expect(outcome.output).not.toContain('edited');
    });

    it('executes the version the user edited in the file', async () => {
      modal.showPlanAcceptModal.mockResolvedValue({ type: 'option', optionId: 'auto_accept' });
      const editedNotes = '## Goal\nRefresh tokens lazily.\n\n1. Read the store\n2. Add a migration\n3. Run tests';
      vi.spyOn(PlanFileStorage.prototype, 'loadPlan').mockResolvedValue({ ...plan(), rawText: editedNotes });
      const { host } = createHost();

      const outcome = await handleAgentExitPlanMode(host);

      expect(outcome.output).toContain('The user edited the plan before accepting it');
      expect(outcome.output).toContain('1. Read the store\n2. Add a migration\n3. Run tests');
      expect(outcome.output).toContain(editedNotes);
      expect(getPlanModeManager().getPlan()?.steps.map(({ description }) => description)).toEqual([
        'Read the store', 'Add a migration', 'Run tests',
      ]);
      expect(printed()).toContain('edited');
    });

    it('accepts the plan as presented when the file cannot be read back', async () => {
      modal.showPlanAcceptModal.mockResolvedValue({ type: 'option', optionId: 'manual_approve' });
      vi.spyOn(PlanFileStorage.prototype, 'loadPlan').mockRejectedValue(new Error('EACCES'));
      const { host } = createHost();

      const outcome = await handleAgentExitPlanMode(host);

      expect(outcome).toMatchObject({ success: true });
      expect(outcome.output).toContain('1. Read the store\n2. Run tests');
    });

    it('keeps planning when the user asks for a revision', async () => {
      modal.showPlanAcceptModal.mockResolvedValue({ type: 'custom', customText: 'split step 2' });
      vi.spyOn(PlanFileStorage.prototype, 'loadPlan').mockResolvedValue(plan());
      const { host, notes } = createHost();

      const outcome = await handleAgentExitPlanMode(host);

      expect(outcome.output).toContain('User feedback on plan: split step 2');
      expect(notes.join('\n')).toContain('provided feedback');
      expect(getPlanModeManager().getPhase()).toBe('planning');
    });
  });
});

describe('wording sent to the model and the user', () => {
  it('carries no leftovers of the this-to-host rename in its messages', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(path.resolve(process.cwd(), 'src/core/agent/AgentCommandRuntime.ts'), 'utf8');
    const literals = source.match(/'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/gu) ?? [];

    const damaged = literals.filter((literal) => /\bhost (?:question|plan|session|command|tool|turn)\b/u.test(literal));

    expect(damaged).toEqual([]);
  });
});

