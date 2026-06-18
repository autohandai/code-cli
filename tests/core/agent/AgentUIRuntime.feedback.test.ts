/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { showAgentFeedbackWithPause } from '../../../src/core/agent/AgentUIRuntime.js';

describe('showAgentFeedbackWithPause', () => {
  it('defers automatic feedback while the Ink request queue has user prompts', async () => {
    const promptForFeedback = vi.fn();
    const host = {
      persistentInputActiveTurn: false,
      persistentInput: {
        getQueueLength: () => 0,
      },
      inkRenderer: {
        isRunning: () => true,
        getQueueCount: () => 2,
        pause: vi.fn(),
        resume: vi.fn(),
      },
      feedbackManager: {
        promptForFeedback,
      },
    };

    await showAgentFeedbackWithPause(host, 'interaction_count', 'session-queued');

    expect(promptForFeedback).not.toHaveBeenCalled();
    expect(host.inkRenderer.pause).not.toHaveBeenCalled();
    expect(host.inkRenderer.resume).not.toHaveBeenCalled();
  });

  it('pauses and resumes the Ink renderer around automatic feedback prompts', async () => {
    const callOrder: string[] = [];
    const host = {
      persistentInputActiveTurn: false,
      persistentInput: {
        getQueueLength: () => 0,
      },
      inkRenderer: {
        isRunning: () => true,
        getQueueCount: () => 0,
        pause: vi.fn(() => {
          callOrder.push('ink.pause');
        }),
        resume: vi.fn(async () => {
          callOrder.push('ink.resume');
        }),
      },
      feedbackManager: {
        promptForFeedback: vi.fn(async () => {
          callOrder.push('feedback.prompt');
          return true;
        }),
      },
    };

    await showAgentFeedbackWithPause(host, 'task_complete', 'session-feedback');

    expect(callOrder).toEqual(['ink.pause', 'feedback.prompt', 'ink.resume']);
  });
});
