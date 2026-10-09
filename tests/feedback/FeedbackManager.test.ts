/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const submit = vi.hoisted(() => vi.fn(async () => ({ success: true, id: 'feedback-1' })));
const feedbackHome = vi.hoisted(() => ({ dir: '' }));

vi.mock('../../src/feedback/FeedbackApiClient.js', () => ({
  getFeedbackApiClient: () => ({ submit }),
}));

vi.mock('../../src/constants.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/constants.js')>();
  return {
    ...actual,
    AUTOHAND_PATHS: new Proxy(actual.AUTOHAND_PATHS, {
      get: (target, key) => (key === 'feedback' ? feedbackHome.dir : Reflect.get(target, key)),
    }),
  };
});

const flushState = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('FeedbackManager', () => {
  beforeEach(async () => {
    feedbackHome.dir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-feedback-'));
    submit.mockClear();
    submit.mockResolvedValue({ success: true, id: 'feedback-1' });
  });

  afterEach(async () => {
    await flushState();
    await fs.remove(feedbackHome.dir);
  });

  async function createManager(overrides: Record<string, unknown> = {}) {
    const { FeedbackManager } = await import('../../src/feedback/FeedbackManager.js');
    return new FeedbackManager({ minInteractions: 0, minSessions: 0, promptProbability: 1, ...overrides });
  }

  it('offers the survey after a completed task once the minimums are met', async () => {
    const manager = await createManager();

    expect(manager.shouldPrompt({ taskCompleted: true })).toBe('task_complete');
  });

  it('stays quiet when disabled or before the minimum usage', async () => {
    expect((await createManager({ enabled: false })).shouldPrompt({ taskCompleted: true })).toBeNull();
    expect((await createManager({ minSessions: 3 })).shouldPrompt({ taskCompleted: true })).toBeNull();
  });

  it('asks at most once per session and respects the cooldown afterwards', async () => {
    const manager = await createManager();

    manager.markPrompted();
    expect(manager.shouldPrompt({ taskCompleted: true })).toBeNull();
    await flushState();

    const nextProcess = await createManager();
    expect(nextProcess.shouldPrompt({ taskCompleted: true })).toBeNull();
    expect(nextProcess.getStats().lastPromptedAt).not.toBeNull();
  });

  it('records an answer locally and submits it with the session id', async () => {
    const manager = await createManager();

    await manager.recordSurveyAnswer({ npsScore: 5, trigger: 'task_complete', sessionId: 'session-1' });
    await flushState();

    expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      npsScore: 5,
      triggerType: 'task_complete',
      sessionId: 'session-1',
      timestamp: expect.any(String),
    }));
    expect(manager.getStats()).toMatchObject({ feedbackCount: 1, npsScores: [5], averageNps: 5 });
    await expect(manager.exportResponses()).resolves.toEqual([
      expect.objectContaining({ npsScore: 5, sessionId: 'session-1' }),
    ]);
  });

  it('keeps the answer when the API is unreachable', async () => {
    submit.mockRejectedValueOnce(new Error('offline'));
    const manager = await createManager();

    await expect(manager.recordSurveyAnswer({ npsScore: 1, trigger: 'gratitude' })).resolves.toBeUndefined();

    expect(manager.getStats().feedbackCount).toBe(1);
    await expect(manager.exportResponses()).resolves.toHaveLength(1);
  });

  it('does not call the API when sending is switched off', async () => {
    const manager = await createManager({ sendToApi: false });

    await manager.recordSurveyAnswer({ npsScore: 3, trigger: 'long_session' });

    expect(submit).not.toHaveBeenCalled();
    expect(manager.getStats().npsScores).toEqual([3]);
  });

  it('counts dismissals without touching the scores', async () => {
    const manager = await createManager();

    manager.recordDismissal();
    manager.recordDismissal();

    expect(manager.getStats()).toMatchObject({ dismissed: 2, feedbackCount: 0, npsScores: [] });
  });

  it('never blocks: it exposes no modal or raw-stdin prompt', async () => {
    const manager = await createManager() as unknown as Record<string, unknown>;

    expect(manager.promptForFeedback).toBeUndefined();
    expect(manager.quickRating).toBeUndefined();
  });
});
