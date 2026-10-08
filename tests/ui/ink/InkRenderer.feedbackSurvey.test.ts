/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'vitest';
import { InkRenderer } from '../../../src/ui/ink/InkRenderer.js';

const SURVEY = {
  id: 'survey-1',
  question: 'How is Autohand doing this session? (optional)',
  options: [{ key: '1', label: 'Bad' }, { key: '0', label: 'Dismiss' }],
};

describe('InkRenderer feedback survey', () => {
  const renderers: InkRenderer[] = [];
  const makeRenderer = () => {
    const renderer = new InkRenderer({ onInstruction: () => {}, onEscape: () => {}, onCtrlC: () => {} });
    renderers.push(renderer);
    return renderer;
  };

  afterEach(() => {
    for (const renderer of renderers.splice(0)) renderer.stop();
  });

  it('starts without a survey', () => {
    expect(makeRenderer().getState().feedbackSurvey).toBeUndefined();
  });

  it('shows and clears the survey', () => {
    const renderer = makeRenderer();

    renderer.setFeedbackSurvey(SURVEY);
    expect(renderer.getState().feedbackSurvey).toEqual(SURVEY);

    renderer.setFeedbackSurvey(undefined);
    expect(renderer.getState().feedbackSurvey).toBeUndefined();
  });

  it('keeps the survey when the UI resets for the next turn', () => {
    const renderer = makeRenderer();
    renderer.setFeedbackSurvey(SURVEY);

    renderer.reset();
    expect(renderer.getState().feedbackSurvey).toEqual(SURVEY);

    renderer.resetAndClearScreen();
    expect(renderer.getState().feedbackSurvey).toEqual(SURVEY);
  });
});
