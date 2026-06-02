/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Box, Text, render } from 'ink';
import Spinner from 'ink-spinner';
import { EventEmitter } from 'node:events';
import { inkRenderOptions } from '../../inkRenderOptions.js';
import { prepareModalRender, cleanupModalRender } from './Modal.js';
import type { AutohandAISetupProgress } from '../../../providers/autohandAILocalSetup.js';

/** Filled block character. */
const FILLED = '█';
/** Empty block character. */
const EMPTY = '░';

/**
 * Render a determinate progress bar from a 0..1 ratio.
 *
 * @param progress - Completion ratio (clamped to 0..1)
 * @param width    - Character width of the bar
 * @returns A string like `████████░░░░░░░░░░░░░░░░`
 */
export function renderSetupBar(progress: number, width = 24): string {
  const ratio = Math.min(Math.max(progress, 0), 1);
  const filled = Math.round(ratio * width);
  return `${FILLED.repeat(filled)}${EMPTY.repeat(width - filled)}`;
}

/**
 * Props for {@link SetupProgressView}.
 */
export interface SetupProgressViewProps {
  /** Heading shown above the bar (already localized by the caller). */
  title: string;
  /** Emits `'progress'` events carrying the latest {@link AutohandAISetupProgress}. */
  emitter: EventEmitter;
  /** Optional initial event so the first frame is not empty. */
  initial?: AutohandAISetupProgress;
}

/**
 * Live, single-line progress view for long-running local setup steps.
 *
 * State is fed from outside the React tree via an {@link EventEmitter}, so the
 * imperative setup pipeline can drive it without re-rendering the whole wizard.
 */
export function SetupProgressView({ title, emitter, initial }: SetupProgressViewProps) {
  const [event, setEvent] = useState<AutohandAISetupProgress | undefined>(initial);

  useEffect(() => {
    const onProgress = (next: AutohandAISetupProgress) => setEvent(next);
    emitter.on('progress', onProgress);
    return () => {
      emitter.off('progress', onProgress);
    };
  }, [emitter]);

  const ratio = event ? event.progress : 0;
  const percent = Math.round(Math.min(Math.max(ratio, 0), 1) * 100);
  const done = event?.phase === 'ready';

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="cyan" bold>{title}</Text>
      <Text>{''}</Text>
      <Box>
        <Text color={done ? 'green' : 'cyan'}>
          {done ? '✓' : <Spinner type="dots" />}{' '}
        </Text>
        <Text color={done ? 'green' : undefined}>{renderSetupBar(ratio)}</Text>
        <Text> {String(percent).padStart(3, ' ')}%</Text>
      </Box>
      {event?.label ? <Text color="gray">  {event.label}</Text> : null}
    </Box>
  );
}

/**
 * Run a long-running setup task while rendering live Ink progress in the
 * alternate screen (matching the modal lifecycle so output never bleeds into
 * the primary composer screen). The task receives an `onProgress` callback to
 * report {@link AutohandAISetupProgress} updates.
 *
 * In non-interactive contexts (no TTY) the task still runs, just without a
 * rendered UI, so CI and tests behave identically.
 */
export async function runWithProgress<T>(
  options: { title: string },
  task: (onProgress: (event: AutohandAISetupProgress) => void) => Promise<T>,
): Promise<T> {
  if (!process.stdout.isTTY) {
    return task(() => {});
  }

  prepareModalRender(process.stdout);
  // Yield a macrotask so React 19's scheduler flushes any pending passive-effect
  // cleanup from a just-unmounted Ink instance before we mount this one.
  await new Promise<void>((resolve) => setImmediate(resolve));

  const emitter = new EventEmitter();
  const instance = render(
    <SetupProgressView title={options.title} emitter={emitter} />,
    inkRenderOptions({
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      exitOnCtrlC: false,
    }),
  );

  try {
    return await task((event) => emitter.emit('progress', event));
  } finally {
    instance.unmount();
    await instance.waitUntilExit();
    cleanupModalRender(process.stdout);
  }
}
