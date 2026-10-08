/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FEEDBACK_SURVEY_ACKNOWLEDGEMENT_MS,
  FeedbackSurveyController,
  type FeedbackSurveySink,
} from '../../../src/core/agent/FeedbackSurveyController.js';
import type { FeedbackSurveyState } from '../../../src/ui/ink/FeedbackSurveyLine.js';

function createHarness(options: { running?: boolean; queued?: number } = {}) {
  const shown: Array<FeedbackSurveyState | undefined> = [];
  const sink: FeedbackSurveySink = {
    isRunning: () => options.running ?? true,
    getQueueCount: () => options.queued ?? 0,
    setFeedbackSurvey: (survey) => { shown.push(survey); },
  };
  const recorder = {
    markPrompted: vi.fn(),
    recordSurveyAnswer: vi.fn(async () => {}),
    recordDismissal: vi.fn(),
  };
  const controller = new FeedbackSurveyController({ getSink: () => sink, recorder });
  return { controller, recorder, shown, current: () => shown.at(-1) };
}

describe('FeedbackSurveyController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows all five scores with a dismiss key and starts the cooldown', () => {
    const { controller, recorder, current } = createHarness();

    expect(controller.show('task_complete', 'session-1')).toBe(true);

    expect(current()?.options.map(({ key }) => key)).toEqual(['1', '2', '3', '4', '5', '0']);
    expect(current()?.acknowledgement).toBeUndefined();
    expect(recorder.markPrompted).toHaveBeenCalledOnce();
  });

  it.each([
    ['1', 1],
    ['2', 2],
    ['3', 3],
    ['4', 4],
    ['5', 5],
  ])('records option %s as score %i and thanks the user', (key, npsScore) => {
    const { controller, recorder, current } = createHarness();
    controller.show('gratitude', 'session-1');

    controller.answer(current()!.id, key);

    expect(recorder.recordSurveyAnswer).toHaveBeenCalledExactlyOnceWith({
      npsScore,
      trigger: 'gratitude',
      sessionId: 'session-1',
    });
    expect(recorder.recordDismissal).not.toHaveBeenCalled();
    expect(current()?.acknowledgement).toBeTruthy();
  });

  it('points an unhappy answer at /feedback so the details can follow', () => {
    const { controller, current } = createHarness();
    controller.show('task_complete');

    controller.answer(current()!.id, '1');

    expect(current()?.acknowledgement).toContain('/feedback');
  });

  it('removes the acknowledgement on its own after a moment', () => {
    const { controller, current } = createHarness();
    controller.show('task_complete');
    controller.answer(current()!.id, '3');

    vi.advanceTimersByTime(FEEDBACK_SURVEY_ACKNOWLEDGEMENT_MS - 1);
    expect(current()?.acknowledgement).toBeTruthy();
    vi.advanceTimersByTime(1);
    expect(current()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('dismisses on 0 without recording a score', () => {
    const { controller, recorder, current } = createHarness();
    controller.show('task_complete');

    controller.answer(current()!.id, '0');

    expect(recorder.recordDismissal).toHaveBeenCalledOnce();
    expect(recorder.recordSurveyAnswer).not.toHaveBeenCalled();
    expect(current()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('counts a survey the user typed past as dismissed', () => {
    const { controller, recorder, current } = createHarness();
    controller.show('task_complete');

    controller.clear();

    expect(recorder.recordDismissal).toHaveBeenCalledOnce();
    expect(current()).toBeUndefined();
  });

  it('does not count an answered survey as dismissed when the user moves on', () => {
    const { controller, recorder, current } = createHarness();
    controller.show('task_complete');
    controller.answer(current()!.id, '2');

    controller.clear();

    expect(recorder.recordDismissal).not.toHaveBeenCalled();
    expect(current()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores stale ids, unknown keys and repeated answers', () => {
    const { controller, recorder, current } = createHarness();
    controller.show('task_complete');
    const { id } = current()!;

    controller.answer('some-other-survey', '3');
    controller.answer(id, '9');
    expect(recorder.recordSurveyAnswer).not.toHaveBeenCalled();

    controller.answer(id, '3');
    controller.answer(id, '1');
    expect(recorder.recordSurveyAnswer).toHaveBeenCalledOnce();
  });

  it('is a no-op to clear when nothing is showing', () => {
    const { controller, recorder, shown } = createHarness();

    controller.clear();

    expect(recorder.recordDismissal).not.toHaveBeenCalled();
    expect(shown).toEqual([]);
  });

  it.each([
    [{ running: false }, 'the composer is not on screen'],
    [{ queued: 2 }, 'queued prompts would dismiss it immediately'],
  ])('does not show or start the cooldown when %j (%s)', (options) => {
    const { controller, recorder, shown } = createHarness(options);

    expect(controller.show('task_complete')).toBe(false);

    expect(shown).toEqual([]);
    expect(recorder.markPrompted).not.toHaveBeenCalled();
  });

  it('does not show without a renderer at all', () => {
    const recorder = { markPrompted: vi.fn(), recordSurveyAnswer: vi.fn(async () => {}), recordDismissal: vi.fn() };
    const controller = new FeedbackSurveyController({ getSink: () => undefined, recorder });

    expect(controller.show('manual')).toBe(false);
    expect(recorder.markPrompted).not.toHaveBeenCalled();
  });

  it('gives every survey its own id so a late key cannot answer the next one', () => {
    const { controller, recorder, current } = createHarness();
    controller.show('task_complete');
    const firstId = current()!.id;
    controller.clear();
    controller.show('long_session');

    expect(current()!.id).not.toBe(firstId);
    controller.answer(firstId, '3');
    expect(recorder.recordSurveyAnswer).not.toHaveBeenCalled();
  });

  it('never lets a failed delivery escape as an unhandled rejection', async () => {
    const { controller, recorder, current } = createHarness();
    recorder.recordSurveyAnswer.mockRejectedValueOnce(new Error('offline'));
    controller.show('task_complete');

    expect(() => controller.answer(current()!.id, '3')).not.toThrow();
    await vi.runAllTimersAsync();
  });

  it('releases its timer and the line on dispose', () => {
    const { controller, current } = createHarness();
    controller.show('task_complete');
    controller.answer(current()!.id, '3');

    controller.dispose();

    expect(vi.getTimerCount()).toBe(0);
    expect(current()).toBeUndefined();
  });
});
