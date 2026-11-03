/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CLIOptions } from '../../../src/types.js';
import { showQuestionModal } from '../../../src/ui/questionModal.js';
import { confirmAgentDangerousAction, executeAgentAskFollowupQuestion } from '../../../src/core/agent/AgentCommandRuntime.js';

vi.mock('../../../src/ui/questionModal.js', () => ({
  showQuestionModal: vi.fn(),
}));

const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

interface FollowupTestHost {
  runtime: {
    options: CLIOptions;
    config: { ui: { autoConfirm?: boolean } };
    isCommandMode?: boolean;
    isRpcMode?: boolean;
  };
  notificationService: { notify: (notification: unknown, guards: unknown) => Promise<void> };
  getNotificationGuards: () => Record<string, unknown>;
  withModalPause: (callback: () => Promise<string>) => Promise<string>;
  consecutiveCancellations: number;
  followupQuestionCallback?: (question: string, suggestedAnswers?: string[]) => Promise<string | undefined>;
}

function createHost(overrides: Partial<FollowupTestHost> = {}): FollowupTestHost {
  return {
    runtime: { options: {}, config: { ui: {} } },
    notificationService: { notify: vi.fn(async () => undefined) },
    getNotificationGuards: vi.fn().mockReturnValue({}),
    withModalPause: vi.fn(async (callback: () => Promise<string>) => callback()),
    consecutiveCancellations: 0,
    ...overrides,
  };
}

describe('agent follow-up question routing', () => {
  beforeEach(() => {
    vi.stubEnv('CI', 'false');
    vi.stubEnv('AUTOHAND_NON_INTERACTIVE', '0');
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.mocked(showQuestionModal).mockReset();
    if (stdinTty) Object.defineProperty(process.stdin, 'isTTY', stdinTty);
    else Reflect.deleteProperty(process.stdin, 'isTTY');
    if (stdoutTty) Object.defineProperty(process.stdout, 'isTTY', stdoutTty);
    else Reflect.deleteProperty(process.stdout, 'isTTY');
  });

  it.each([
    { mode: 'yes', options: { yes: true } },
    { mode: 'unrestricted', options: { unrestricted: true } },
  ])('collects an actual three-choice answer under $mode instead of inventing Yes', async ({ options }) => {
    const question = 'Choose local discovery, registry matching, or skill creation.';
    const choices = ['Local discovery', 'Registry matching', 'Skill creation'];
    const followupQuestionCallback = vi.fn(async () => 'Registry matching');
    const host = createHost({ runtime: { options, config: { ui: {} } }, followupQuestionCallback });

    await expect(executeAgentAskFollowupQuestion(host, question, choices))
      .resolves.toBe('<answer>Registry matching</answer>');
    expect(followupQuestionCallback).toHaveBeenCalledWith(question, choices);
    expect(showQuestionModal).not.toHaveBeenCalled();
  });

  it.each([
    { mode: 'yes', options: { yes: true } },
    { mode: 'unrestricted', options: { unrestricted: true } },
  ])('shows the factual three-choice modal under $mode', async ({ options }) => {
    vi.mocked(showQuestionModal).mockResolvedValue('Skill creation');
    const host = createHost({ runtime: { options, config: { ui: {} } } });
    const choices = ['Local discovery', 'Registry matching', 'Skill creation'];

    await expect(executeAgentAskFollowupQuestion(host, 'Which workflow?', choices))
      .resolves.toBe('<answer>Skill creation</answer>');
    expect(showQuestionModal).toHaveBeenCalledWith({ question: 'Which workflow?', suggestedAnswers: choices });
    expect(host.withModalPause).toHaveBeenCalledOnce();
  });

  it('collects free text when choices are mentioned only in the question under yes', async () => {
    vi.mocked(showQuestionModal).mockResolvedValue('Registry matching');
    const host = createHost({ runtime: { options: { yes: true }, config: { ui: {} } } });
    const question = 'Choose local discovery, registry matching, or skill creation.';

    await expect(executeAgentAskFollowupQuestion(host, question))
      .resolves.toBe('<answer>Registry matching</answer>');
    expect(showQuestionModal).toHaveBeenCalledWith({ question, suggestedAnswers: undefined });
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
  ])('collects an actual binary answer under $mode', async ({ options }) => {
    const followupQuestionCallback = vi.fn().mockResolvedValue('No');
    const host = createHost({
      runtime: { options, config: { ui: {} } },
      followupQuestionCallback,
    });

    await expect(executeAgentAskFollowupQuestion(
      host,
      'Should I continue?',
    )).resolves.toBe('<answer>No</answer>');

    expect(followupQuestionCallback).toHaveBeenCalledWith('Should I continue?', undefined);
    expect(showQuestionModal).not.toHaveBeenCalled();
  });

  it('uses a configured answer channel in non-interactive mode', async () => {
    vi.stubEnv('AUTOHAND_NON_INTERACTIVE', '1');
    const followupQuestionCallback = vi.fn().mockResolvedValue('Continue');
    const host = createHost({ followupQuestionCallback });

    await expect(executeAgentAskFollowupQuestion(
      host,
      'Should I continue?',
    )).resolves.toBe('<answer>Continue</answer>');

    expect(followupQuestionCallback).toHaveBeenCalledWith('Should I continue?', undefined);
    expect(showQuestionModal).not.toHaveBeenCalled();
  });

  it.each(['stdin', 'stdout', 'ci-one', 'ci-true', 'non-interactive', 'rpc', 'command', 'prompt'] as const)(
    'reports the question unanswered when %s has no answer channel', async mode => {
      const host = createHost({ consecutiveCancellations: 2 });
      if (mode === 'stdin') Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
      if (mode === 'stdout') Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });
      if (mode === 'ci-one') vi.stubEnv('CI', '1');
      if (mode === 'ci-true') vi.stubEnv('CI', 'true');
      if (mode === 'non-interactive') vi.stubEnv('AUTOHAND_NON_INTERACTIVE', '1');
      if (mode === 'rpc') host.runtime.isRpcMode = true;
      if (mode === 'command') host.runtime.isCommandMode = true;
      if (mode === 'prompt') host.runtime.options.prompt = 'Run unattended';

      const result = await executeAgentAskFollowupQuestion(host, 'Which workflow?');

      expect(result).toMatch(/^<unanswered>[\s\S]*<\/unanswered>$/);
      expect(result).toContain('No user answer was collected');
      expect(result).toContain('not user consent or approval');
      expect(result).toContain('Do NOT call ask_followup_question again');
      expect(result).toContain('report the blocker instead of inventing an answer');
      expect(result).not.toContain('<answer>');
      expect(host.consecutiveCancellations).toBe(2);
      expect(host.notificationService.notify).not.toHaveBeenCalled();
      expect(host.withModalPause).not.toHaveBeenCalled();
      expect(showQuestionModal).not.toHaveBeenCalled();
    },
  );

  it.each([
    { mode: 'yes', options: { yes: true } },
    { mode: 'unrestricted', options: { unrestricted: true } },
  ])('does not fabricate a headless answer under $mode', async ({ options }) => {
    vi.stubEnv('AUTOHAND_NON_INTERACTIVE', '1');
    const host = createHost({ runtime: { options, config: { ui: {} } } });

    expect(await executeAgentAskFollowupQuestion(host, 'Which workflow?')).toMatch(/^<unanswered>/);
    expect(showQuestionModal).not.toHaveBeenCalled();
  });

  it.each(['unavailable', 'failed'] as const)('returns unanswered when the headless callback is %s', async mode => {
    vi.stubEnv('AUTOHAND_NON_INTERACTIVE', '1');
    const followupQuestionCallback = vi.fn(async () => {
      if (mode === 'failed') throw new Error('Transport unavailable');
      return undefined;
    });
    const host = createHost({ followupQuestionCallback });

    expect(await executeAgentAskFollowupQuestion(host, 'Which workflow?')).toMatch(/^<unanswered>/);
    expect(followupQuestionCallback).toHaveBeenCalledOnce();
    expect(showQuestionModal).not.toHaveBeenCalled();
  });

  it('falls back to the interactive modal when the callback throws', async () => {
    vi.mocked(showQuestionModal).mockResolvedValue('Local discovery');
    const host = createHost({ followupQuestionCallback: vi.fn(async () => { throw new Error('Transport unavailable'); }) });

    await expect(executeAgentAskFollowupQuestion(host, 'Which workflow?')).resolves.toBe('<answer>Local discovery</answer>');
    expect(host.withModalPause).toHaveBeenCalledOnce();
  });

  it('preserves question cancellation and modal cleanup under yes', async () => {
    vi.mocked(showQuestionModal).mockResolvedValue(null);
    const host = createHost({ runtime: { options: { yes: true }, config: { ui: {} } }, consecutiveCancellations: 1 });

    const result = await executeAgentAskFollowupQuestion(host, 'Which workflow?');

    expect(result).toContain('User cancelled this question. Do NOT call ask_followup_question again.');
    expect(host.consecutiveCancellations).toBe(2);
    expect(host.withModalPause).toHaveBeenCalledOnce();
  });

  it('resets the cancellation count after a real modal answer', async () => {
    vi.mocked(showQuestionModal).mockResolvedValue('Registry matching');
    const host = createHost({ consecutiveCancellations: 2 });

    await executeAgentAskFollowupQuestion(host, 'Which workflow?');

    expect(host.consecutiveCancellations).toBe(0);
  });

  it.each([
    { mode: 'yes', options: { yes: true } },
    { mode: 'unrestricted', options: { unrestricted: true } },
  ])('preserves real permission auto-approval under $mode', async ({ options }) => {
    const host = createHost({ runtime: { options, config: { ui: {} } } });

    await expect(confirmAgentDangerousAction(host, 'May I write this file?')).resolves.toEqual({ decision: 'allow_once' });
    expect(host.withModalPause).not.toHaveBeenCalled();
    expect(showQuestionModal).not.toHaveBeenCalled();
  });
});
