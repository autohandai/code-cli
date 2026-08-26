/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { PeersScreen } from '../../../src/ui/ink/components/PeersScreen.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';
import type { ActiveAgentRecord } from '../../../src/session/ActiveAgentRegistry.js';

function peer(sessionId: string, overrides: Partial<ActiveAgentRecord> = {}): ActiveAgentRecord {
  return {
    version: 1,
    pid: 4242,
    sessionId,
    workspaceRoot: '/repo',
    projectName: 'repo',
    provider: 'openrouter',
    model: 'anthropic/claude-sonnet-4',
    mode: 'interactive',
    status: 'working',
    startedAt: '2026-07-27T10:00:00.000Z',
    updatedAt: '2026-07-27T10:05:00.000Z',
    messageCount: 1,
    contextPercent: 10,
    tokensUsed: 0,
    ...overrides,
  };
}

// Instances left mounted keep listening on stdin and interfere with the
// escape-sequence parsing of later tests.
const mounted: Array<{ unmount: () => void }> = [];

afterEach(() => {
  for (const instance of mounted.splice(0)) {
    instance.unmount();
  }
});

function renderScreen(peers: ActiveAgentRecord[], rows = 20, onClose = vi.fn()) {
  const instance = render(
    <ThemeProvider>
      <PeersScreen peers={peers} rows={rows} onClose={onClose} />
    </ThemeProvider>,
  );
  mounted.push(instance);
  return { ...instance, onClose };
}

/**
 * Ink defers a lone ESC briefly to see whether more bytes follow, so a
 * microtask tick alone reads state before that timer fires. A short real delay
 * covers both the deferral and the re-render.
 */
async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
}

function lineCount(frame: string | undefined): number {
  return (frame ?? '').split('\n').length;
}

describe('PeersScreen', () => {
  it('shows the peer count and card details', () => {
    const { lastFrame } = renderScreen([peer('peer-1')]);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('Peers');
    expect(frame).toContain('1 peer');
    expect(frame).toContain('peer-1');
    expect(frame).toContain('anthropic/claude-sonnet-4');
  });

  it('pluralizes the peer count', () => {
    const { lastFrame } = renderScreen([peer('peer-1'), peer('peer-2')]);
    expect(lastFrame()).toContain('2 peers');
  });

  it('keeps the frame the same height regardless of content', () => {
    // A frame that changes height is what makes the alternate screen flicker.
    const few = renderScreen([peer('peer-1')], 20);
    const many = renderScreen([peer('a'), peer('b'), peer('c'), peer('d')], 20);
    expect(lineCount(few.lastFrame())).toBe(lineCount(many.lastFrame()));
  });

  it('offers scrolling hints only when the content overflows', () => {
    const overflowing = renderScreen([peer('a'), peer('b'), peer('c')], 12);
    expect(overflowing.lastFrame()).toContain('↑↓ scroll');

    const fitting = renderScreen([peer('only')], 60);
    expect(fitting.lastFrame()).toContain('q close');
    expect(fitting.lastFrame()).not.toContain('↑↓ scroll');
  });

  it('shows a scroll position when the content overflows', () => {
    const { lastFrame } = renderScreen([peer('a'), peer('b'), peer('c')], 12);
    expect(lastFrame()).toMatch(/\d+-\d+ of \d+/);
  });

  it('scrolls down and back with the arrow keys', async () => {
    const { stdin, lastFrame } = renderScreen([peer('a'), peer('b'), peer('c')], 12);
    const before = lastFrame();

    stdin.write('\u001B[B'); // down
    await tick();
    expect(lastFrame()).not.toBe(before);

    stdin.write('\u001B[A'); // up
    await tick();
    expect(lastFrame()).toBe(before);
  });

  it('jumps to the end and back with g and G', async () => {
    const { stdin, lastFrame } = renderScreen([peer('a'), peer('b'), peer('c')], 12);
    const top = lastFrame();

    stdin.write('G');
    await tick();
    expect(lastFrame()).not.toBe(top);

    stdin.write('g');
    await tick();
    expect(lastFrame()).toBe(top);
  });

  it('does not scroll past the top', async () => {
    const { stdin, lastFrame } = renderScreen([peer('a'), peer('b'), peer('c')], 12);
    const top = lastFrame();
    stdin.write('\u001B[A');
    await tick();
    stdin.write('\u001B[A');
    await tick();
    expect(lastFrame()).toBe(top);
  });

  it('closes on q', () => {
    const { stdin, onClose } = renderScreen([peer('peer-1')]);
    stdin.write('q');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on escape', async () => {
    const { stdin, onClose } = renderScreen([peer('peer-1')]);
    stdin.write('\u001B');
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders a peer with no activity data without crashing', () => {
    const { lastFrame } = renderScreen([peer('bare')]);
    expect(lastFrame()).toContain('bare');
    expect(lastFrame()).toContain('no activity data');
  });
});
