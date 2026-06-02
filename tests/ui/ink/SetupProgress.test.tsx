/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import {
  SetupProgressView,
  renderSetupBar,
  runWithProgress,
} from '../../../src/ui/ink/components/SetupProgress.js';
import type { AutohandAISetupProgress } from '../../../src/providers/autohandAILocalSetup.js';

describe('renderSetupBar', () => {
  it('clamps the ratio and renders filled/empty blocks', () => {
    expect(renderSetupBar(0, 10)).toBe('░'.repeat(10));
    expect(renderSetupBar(1, 10)).toBe('█'.repeat(10));
    expect(renderSetupBar(0.5, 10)).toBe('█'.repeat(5) + '░'.repeat(5));
    // Out-of-range ratios are clamped, never producing negative repeats.
    expect(renderSetupBar(-1, 10)).toBe('░'.repeat(10));
    expect(renderSetupBar(2, 10)).toBe('█'.repeat(10));
  });
});

describe('SetupProgressView', () => {
  it('renders the title and the seeded progress event', () => {
    const emitter = new EventEmitter();
    const { lastFrame, unmount } = render(
      <SetupProgressView
        title="Setting up Autohand AI Local"
        emitter={emitter}
        initial={{ phase: 'download', label: 'Downloading Qwen2.5 Coder 7B', progress: 0.58 }}
      />,
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Setting up Autohand AI Local');
    expect(frame).toContain('58%');
    expect(frame).toContain('Downloading Qwen2.5 Coder 7B');
    expect(frame).toContain('█');

    unmount();
  });

  it('shows a completion marker when the ready phase is reached', () => {
    const emitter = new EventEmitter();
    const { lastFrame, unmount } = render(
      <SetupProgressView
        title="Local"
        emitter={emitter}
        initial={{ phase: 'ready', label: 'Autohand AI Local server is ready', progress: 1 }}
      />,
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('100%');
    expect(frame).toContain('✓');

    unmount();
  });

  it('updates live as progress events are emitted', async () => {
    const emitter = new EventEmitter();
    const { lastFrame, unmount } = render(
      <SetupProgressView title="Local" emitter={emitter} />,
    );

    // The subscribing effect attaches asynchronously; emit until the frame
    // reflects the update rather than relying on a single fixed delay.
    await vi.waitFor(() => {
      emitter.emit('progress', {
        phase: 'start-server',
        label: 'Starting MLX server',
        progress: 0.78,
      } satisfies AutohandAISetupProgress);
      expect(lastFrame() ?? '').toContain('78%');
    });
    expect(lastFrame() ?? '').toContain('Starting MLX server');

    unmount();
  });
});

describe('runWithProgress (non-TTY fallback)', () => {
  // The test runner's stdout is not a TTY, so runWithProgress takes its
  // headless path: it runs the task without mounting Ink. We rely on the
  // ambient non-TTY rather than mutating the shared process.stdout.isTTY,
  // which would leak into other tests sharing the process.
  it('runs the task without rendering and resolves with its result', async () => {
    let received: AutohandAISetupProgress | undefined;
    const result = await runWithProgress({ title: 'Local' }, async (onProgress) => {
      onProgress({ phase: 'probe', label: 'Checking', progress: 0.1 });
      received = { phase: 'probe', label: 'Checking', progress: 0.1 };
      return 'done';
    });

    expect(result).toBe('done');
    // The onProgress callback is safe to call even with no UI mounted.
    expect(received?.phase).toBe('probe');
  });

  it('propagates task rejections', async () => {
    await expect(
      runWithProgress({ title: 'Local' }, async () => {
        throw new Error('setup failed');
      }),
    ).rejects.toThrow('setup failed');
  });
});
