/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentUI, createInitialUIState, type AgentUIState } from '../../../src/ui/ink/AgentUI.js';
import { I18nProvider } from '../../../src/ui/i18n/index.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';

const SURVEY = {
  id: 'survey-1',
  question: 'How is Autohand doing this session? (optional)',
  options: [
    { key: '1', label: 'Bad' },
    { key: '2', label: 'Fine' },
    { key: '3', label: 'Good' },
    { key: '0', label: 'Dismiss' },
  ],
};

function renderUI(state: AgentUIState) {
  const onFeedbackSurveyAnswer = vi.fn();
  const onInputChange = vi.fn();
  const onInstruction = vi.fn();
  const rendered = render(
    <I18nProvider>
      <ThemeProvider>
        <AgentUI
          state={state}
          onInstruction={onInstruction}
          onEscape={vi.fn()}
          onCtrlC={vi.fn()}
          onInputChange={onInputChange}
          onFeedbackSurveyAnswer={onFeedbackSurveyAnswer}
        />
      </ThemeProvider>
    </I18nProvider>,
  );
  return { ...rendered, onFeedbackSurveyAnswer, onInputChange, onInstruction };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

afterEach(() => {
  cleanup();
});

describe('AgentUI feedback survey', () => {
  it('renders the survey above the status section without taking over the composer', () => {
    const { lastFrame } = renderUI({
      ...createInitialUIState(),
      isWorking: true,
      status: 'Thinking',
      feedbackSurvey: SURVEY,
    });
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n');
    const questionRow = lines.findIndex((line) => line.includes(SURVEY.question));
    const optionsRow = lines.findIndex((line) => line.includes('1: Bad'));
    const statusRow = lines.findIndex((line) => line.includes('Thinking'));

    expect(frame).toContain('How is Autohand doing this session?');
    expect(questionRow).toBeGreaterThanOrEqual(0);
    expect(optionsRow).toBe(questionRow + 1);
    expect(optionsRow).toBeLessThan(statusRow);
  });

  it.each(['1', '2', '3', '0'])('answers with %s on an empty composer and types nothing', async (key) => {
    const { stdin, onFeedbackSurveyAnswer, onInputChange } = renderUI({
      ...createInitialUIState(),
      feedbackSurvey: SURVEY,
    });
    onInputChange.mockClear();

    stdin.write(key);
    await flush();

    expect(onFeedbackSurveyAnswer).toHaveBeenCalledExactlyOnceWith('survey-1', key);
    expect(onInputChange).not.toHaveBeenCalled();
  });

  it('types the digit normally once the composer has a draft', async () => {
    const { stdin, lastFrame, onFeedbackSurveyAnswer } = renderUI({
      ...createInitialUIState(),
      currentInput: 'step ',
      feedbackSurvey: SURVEY,
    });

    stdin.write('1');
    await flush();

    expect(onFeedbackSurveyAnswer).not.toHaveBeenCalled();
    expect(lastFrame()).toContain('step 1');
  });

  it('lets every key that is not an option reach the composer', async () => {
    const { stdin, lastFrame, onFeedbackSurveyAnswer } = renderUI({
      ...createInitialUIState(),
      feedbackSurvey: SURVEY,
    });

    stdin.write('4');
    await flush();
    stdin.write('h');
    await flush();

    expect(onFeedbackSurveyAnswer).not.toHaveBeenCalled();
    expect(lastFrame()).toContain('4h');
  });

  it('submits a prompt while the survey is showing', async () => {
    const { stdin, onInstruction, onFeedbackSurveyAnswer } = renderUI({
      ...createInitialUIState(),
      feedbackSurvey: SURVEY,
    });

    stdin.write('fix it');
    await flush();
    stdin.write('\r');
    await flush();

    expect(onInstruction.mock.calls[0]?.[0]).toBe('fix it');
    expect(onFeedbackSurveyAnswer).not.toHaveBeenCalled();
  });

  it('treats digits as text when no survey is showing', async () => {
    const { stdin, lastFrame, onFeedbackSurveyAnswer } = renderUI(createInitialUIState());

    stdin.write('2');
    await flush();

    expect(onFeedbackSurveyAnswer).not.toHaveBeenCalled();
    expect(lastFrame()).toContain('2');
  });

  it('stops claiming digits once the survey has been answered', async () => {
    const { stdin, lastFrame, onFeedbackSurveyAnswer } = renderUI({
      ...createInitialUIState(),
      feedbackSurvey: { ...SURVEY, acknowledgement: 'Thanks for the feedback!' },
    });

    stdin.write('3');
    await flush();

    expect(onFeedbackSurveyAnswer).not.toHaveBeenCalled();
    expect(lastFrame()).toContain('Thanks for the feedback!');
  });
});
