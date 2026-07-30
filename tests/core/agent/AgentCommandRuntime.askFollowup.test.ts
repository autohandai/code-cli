/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { showQuestionModal } from '../../../src/ui/questionModal.js';
import { executeAgentAskFollowupQuestion } from '../../../src/core/agent/AgentCommandRuntime.js';

vi.mock('../../../src/ui/questionModal.js', () => ({
  showQuestionModal: vi.fn(),
}));

const originalCi = process.env.CI;
const originalNonInteractive = process.env.AUTOHAND_NON_INTERACTIVE;

function createHost(overrides: Record<string, unknown> = {}) {
  return {
    runtime: { options: {} },
    notificationService: { notify: vi.fn().mockResolvedValue(undefined) },
    getNotificationGuards: vi.fn().mockReturnValue({}),
    withModalPause: async (callback: () => Promise<string>) => callback(),
    consecutiveCancellations: 0,
    ...overrides,
  };
}

describe('agent follow-up question routing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(showQuestionModal).mockReset();
    if (originalCi === undefined) delete process.env.CI;
    else process.env.CI = originalCi;
    if (originalNonInteractive === undefined) delete process.env.AUTOHAND_NON_INTERACTIVE;
    else process.env.AUTOHAND_NON_INTERACTIVE = originalNonInteractive;
  });

  it('returns a typed mobile answer without opening the local modal', async () => {
    const followupQuestionCallback = vi.fn().mockResolvedValue('Staging');
    const host = createHost({ followupQuestionCallback });

    await expect(executeAgentAskFollowupQuestion(
      host,
      'Which environment should I deploy?',
      ['Staging', 'Production'],
    )).resolves.toBe('<answer>Staging</answer>');

    expect(followupQuestionCallback).toHaveBeenCalledWith(
      'Which environment should I deploy?',
      ['Staging', 'Production'],
    );
    expect(showQuestionModal).not.toHaveBeenCalled();
  });

  it('falls back to the local modal when the mobile wait is unavailable', async () => {
    const followupQuestionCallback = vi.fn().mockResolvedValue(undefined);
    vi.mocked(showQuestionModal).mockResolvedValue('Production');
    const host = createHost({ followupQuestionCallback });

    await expect(executeAgentAskFollowupQuestion(
      host,
      'Which environment should I deploy?',
      ['Staging', 'Production'],
    )).resolves.toBe('<answer>Production</answer>');

    expect(showQuestionModal).toHaveBeenCalledWith({
      question: 'Which environment should I deploy?',
      suggestedAnswers: ['Staging', 'Production'],
    });
  });

  it.each([
    { mode: 'yes', options: { yes: true } },
    { mode: 'unrestricted', options: { unrestricted: true } },
  ])('preserves the $mode auto-answer before mobile routing', async ({ options }) => {
    const followupQuestionCallback = vi.fn().mockResolvedValue('No');
    const host = createHost({
      runtime: { options },
      followupQuestionCallback,
    });

    await expect(executeAgentAskFollowupQuestion(
      host,
      'Should I continue?',
    )).resolves.toBe('<answer>Yes</answer>');

    expect(followupQuestionCallback).not.toHaveBeenCalled();
    expect(showQuestionModal).not.toHaveBeenCalled();
  });

  it('preserves the non-interactive skip before mobile routing', async () => {
    process.env.AUTOHAND_NON_INTERACTIVE = '1';
    const followupQuestionCallback = vi.fn().mockResolvedValue('Continue');
    const host = createHost({ followupQuestionCallback });

    await expect(executeAgentAskFollowupQuestion(
      host,
      'Should I continue?',
    )).resolves.toBe('<answer>Skipped (non-interactive mode)</answer>');

    expect(followupQuestionCallback).not.toHaveBeenCalled();
    expect(showQuestionModal).not.toHaveBeenCalled();
  });
});
