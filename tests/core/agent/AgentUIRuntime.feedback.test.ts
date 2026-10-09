/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const inkUIManager = vi.hoisted(() => ({
  createInkUIManager: vi.fn((options: Record<string, unknown>) => ({ options })),
}));

vi.mock('../../../src/ui/InkUIManager.js', () => ({
  createInkUIManager: inkUIManager.createInkUIManager,
}));

type SurveyAnswerHandler = (id: string, key: string) => void;

describe('feedback survey wiring', () => {
  const ttyDescriptors = {
    stdout: Object.getOwnPropertyDescriptor(process.stdout, 'isTTY'),
    stdin: Object.getOwnPropertyDescriptor(process.stdin, 'isTTY'),
  };

  function restoreTTY(stream: NodeJS.WriteStream | NodeJS.ReadStream, descriptor: PropertyDescriptor | undefined): void {
    if (descriptor) {
      Object.defineProperty(stream, 'isTTY', descriptor);
    } else {
      delete (stream as { isTTY?: boolean }).isTTY;
    }
  }

  beforeEach(() => {
    inkUIManager.createInkUIManager.mockClear();
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  });

  afterEach(() => {
    restoreTTY(process.stdout, ttyDescriptors.stdout);
    restoreTTY(process.stdin, ttyDescriptors.stdin);
  });

  function makeUIHost(feedbackSurvey?: { answer: SurveyAnswerHandler }) {
    return {
      useInkRenderer: true,
      runtime: {
        config: { ui: {} as Record<string, unknown> },
        options: { bare: false },
        workspaceRoot: '/tmp/workspace',
      },
      activityIndicator: { nextTipFitting: vi.fn() },
      feedbackSurvey,
    };
  }

  async function capturedAnswerHandler(host: ReturnType<typeof makeUIHost>): Promise<SurveyAnswerHandler> {
    const { initializeAgentUIManager } = await import('../../../src/core/agent/AgentUIRuntime.js');
    initializeAgentUIManager(host as never);
    expect(inkUIManager.createInkUIManager).toHaveBeenCalledTimes(1);
    const options = inkUIManager.createInkUIManager.mock.calls[0]?.[0] as { onFeedbackSurveyAnswer?: SurveyAnswerHandler };
    expect(options.onFeedbackSurveyAnswer).toBeTypeOf('function');
    return options.onFeedbackSurveyAnswer!;
  }

  it('routes a survey key from the composer to the survey controller', async () => {
    const answer = vi.fn();
    const onAnswer = await capturedAnswerHandler(makeUIHost({ answer }));

    onAnswer('feedback-survey-1', '3');

    expect(answer).toHaveBeenCalledExactlyOnceWith('feedback-survey-1', '3');
  });

  it('ignores a survey key on a host built without a controller', async () => {
    const onAnswer = await capturedAnswerHandler(makeUIHost());

    expect(() => onAnswer('feedback-survey-1', '3')).not.toThrow();
  });

  it('no longer exposes a modal feedback prompt that pauses the renderer', async () => {
    const runtime = await import('../../../src/core/agent/AgentUIRuntime.js') as Record<string, unknown>;

    expect(runtime.showAgentFeedbackWithPause).toBeUndefined();
  });
});
