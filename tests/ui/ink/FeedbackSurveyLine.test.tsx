/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { cleanup, render } from 'ink-testing-library';
import stringWidth from 'string-width';
import { afterEach, describe, expect, it } from 'vitest';
import { FeedbackSurveyLine } from '../../../src/ui/ink/FeedbackSurveyLine.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';

const SURVEY = {
  id: 'survey-1',
  question: 'How is Autohand doing this session? (optional)',
  options: [
    { key: '1', label: 'Bad' },
    { key: '2', label: 'Poor' },
    { key: '3', label: 'Fine' },
    { key: '4', label: 'Good' },
    { key: '5', label: 'Great' },
    { key: '0', label: 'Dismiss' },
  ],
};

function renderLine(props: React.ComponentProps<typeof FeedbackSurveyLine>) {
  return render(
    <ThemeProvider>
      <FeedbackSurveyLine {...props} />
    </ThemeProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('FeedbackSurveyLine', () => {
  it('shows every numbered option on the row below the question', () => {
    const { lastFrame } = renderLine({ survey: SURVEY, columns: 120 });
    const frame = lastFrame() ?? '';

    expect(frame).toMatchInlineSnapshot(`
      "● How is Autohand doing this session? (optional)
      1: Bad  2: Poor  3: Fine  4: Good  5: Great  0: Dismiss"
    `);
  });

  it('replaces the options with the acknowledgement once answered', () => {
    const { lastFrame } = renderLine({
      survey: { ...SURVEY, acknowledgement: 'Thanks for the feedback!' },
      columns: 120,
    });
    const frame = lastFrame() ?? '';

    expect(frame).toContain('Thanks for the feedback!');
    expect(frame).not.toContain('1: Bad');
    expect(frame).not.toContain('How is Autohand doing');
  });

  it.each([20, 40, 60])('never exceeds a %i column terminal', (columns) => {
    const { lastFrame } = renderLine({ survey: SURVEY, columns });
    const lines = (lastFrame() ?? '').split('\n');

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('● How');
    for (const key of ['1', '2', '3', '4', '5', '0']) expect(lines[1]).toContain(key);
    for (const line of lines) {
      expect(stringWidth(line)).toBeLessThanOrEqual(columns);
    }
  });

  it('keeps the options readable when the question does not fit', () => {
    const { lastFrame } = renderLine({ survey: SURVEY, columns: 50 });
    const frame = lastFrame() ?? '';

    for (const key of ['1', '2', '3', '4', '5']) expect(frame).toContain(key);
    expect(frame).toContain('0: Dismiss');
  });

  it('keeps every score and dismissal key visible in a very narrow terminal', () => {
    const { lastFrame } = renderLine({ survey: SURVEY, columns: 20 });
    for (const key of ['1', '2', '3', '4', '5', '0']) expect(lastFrame()).toContain(key);
  });

  it('is memoized so the bottom region can re-render on every spinner tick', () => {
    expect((FeedbackSurveyLine as unknown as { $$typeof?: symbol }).$$typeof)
      .toBe(Symbol.for('react.memo'));
  });
});
