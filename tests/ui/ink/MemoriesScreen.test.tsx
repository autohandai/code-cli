/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { MemoriesScreen, displayMemoryPath, type MemoriesOverview } from '../../../src/ui/ink/components/MemoriesScreen.js';
import { planMemoryReset, type MemoriesScreenResult } from '../../../src/ui/ink/memoriesScreenModel.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';
import type { LocalMemoryStore } from '../../../src/memory/MemoryManager.js';

const STORES: LocalMemoryStore[] = [
  { level: 'project', directory: '/repo/.autohand/memory', entries: 3 },
  { level: 'user', directory: path.join(os.homedir(), '.autohand', 'memory'), entries: 5 },
];

function overview(overrides: Partial<MemoriesOverview> & { sharedProject?: boolean } = {}): MemoriesOverview {
  const { sharedProject = false, ...rest } = overrides;
  const stores = rest.stores ?? STORES;
  const userSynced = rest.userSynced ?? false;
  return {
    settings: { use: true, generate: true },
    configPath: path.join(os.homedir(), '.autohand', 'config.json'),
    stores,
    userSynced,
    resetPlan: planMemoryReset(stores, { userSynced, sharedProject }),
    ...rest,
  };
}

const mounted: Array<{ unmount: () => void }> = [];

afterEach(() => {
  for (const instance of mounted.splice(0)) instance.unmount();
});

function renderScreen(value: MemoriesOverview = overview(), columns = 110) {
  const onDone = vi.fn<(result: MemoriesScreenResult) => void>();
  const instance = render(
    <ThemeProvider>
      <MemoriesScreen overview={value} onDone={onDone} columns={columns} />
    </ThemeProvider>,
  );
  mounted.push(instance);
  const frame = (): string => stripAnsi(instance.lastFrame() ?? '');
  const lines = (): string[] => frame().split('\n');
  return { ...instance, onDone, frame, lines };
}

/** Ink defers a lone ESC briefly; a short real delay covers that and the re-render. */
async function press(stdin: { write(data: string): void }, data: string): Promise<void> {
  stdin.write(data);
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
}

const KEY = { up: '\x1b[A', down: '\x1b[B', enter: '\r', space: ' ', esc: '\x1b' };

describe('MemoriesScreen', () => {
  it('shows the title, where changes are saved, both rows with descriptions, and the key hints', () => {
    const { frame, lines } = renderScreen();

    expect(lines()[0].trim()).toBe('Memories');
    expect(frame()).toContain('Changes are saved to ~/.autohand/config.json.');
    const rows = lines().filter((line) => /Use memories|Generate memories|Reset all memories/u.test(line));
    expect(rows.map((line) => line.trim().replace(/\s{2,}.*$/u, ''))).toEqual([
      '› [x] Use memories', '[x] Generate memories', 'Reset all memories',
    ]);
    expect(rows[0]).toMatch(/› \[x\] Use memories\s{2,}Give stored memories to the model, starting with the next turn/u);
    const generate = lines().find((line) => line.includes('Generate memories'));
    expect(generate).toMatch(/\[x\] Generate memories\s{2,}Save durable memories after completed turns/u);
    expect(generate).not.toContain('›');
    const reset = lines().find((line) => line.includes('Reset all memories'));
    expect(reset).toMatch(/^\s+Reset all memories\s{2,}Delete memory files and summaries on this machine/u);
    expect(reset).not.toContain('›');
    expect(reset).not.toContain('[');
    expect(frame()).toContain('↑↓ move · space toggle · enter save/select · esc cancel');
  });

  it('lines the action label up with the checkbox labels', () => {
    const { lines } = renderScreen();

    const column = (text: string) => lines().find((line) => line.includes(text))!.indexOf(text);
    expect(column('Reset all memories')).toBe(column('Generate memories'));
    expect(column('Use memories')).toBe(column('Generate memories'));
  });

  it('summarises where memories live and whether they sync', () => {
    const local = renderScreen();
    expect(local.frame()).toContain('Project memories: 3 saved in /repo/.autohand/memory');
    expect(local.frame()).toContain('User memories: 5 saved in ~/.autohand/memory');
    expect(local.frame()).toContain('User memories stay on this machine (sync is off).');
    expect(local.frame()).not.toContain('shared with your team');
    expect(local.frame()).toContain('View saved memories with /memory.');

    const synced = renderScreen(overview({ userSynced: true, sharedProject: true }));
    expect(synced.frame()).toContain('User memories sync with your Autohand account.');
    expect(synced.frame()).toContain('Project memories for this repository are shared with your team.');
  });

  it('reflects saved "off" values the next time it opens and says stored memories are not used', () => {
    const { frame } = renderScreen(overview({ settings: { use: false, generate: false } }));

    expect(frame()).toContain('› [ ] Use memories');
    expect(frame()).toContain('  [ ] Generate memories');
    expect(frame()).toContain('Project memories: 3 saved in /repo/.autohand/memory');
    expect(frame()).toContain('Stored memories are not given to the model (Use memories is off).');
  });

  it('does not claim memories are unused while the switch is on', () => {
    expect(renderScreen().frame()).not.toContain('not given to the model');
  });

  it('toggles Use memories with space and saves it with enter, leaving Generate memories on', async () => {
    const { stdin, frame, onDone } = renderScreen();

    await press(stdin, KEY.space);
    expect(frame()).toContain('› [ ] Use memories');
    expect(frame()).toContain('  [x] Generate memories');
    expect(onDone).not.toHaveBeenCalled();
    await press(stdin, KEY.space);
    expect(frame()).toContain('› [x] Use memories');
    await press(stdin, KEY.space);
    await press(stdin, KEY.enter);

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith({ kind: 'save', settings: { use: false, generate: true } });
  });

  it('saves both switches together with one enter', async () => {
    const { stdin, frame, onDone } = renderScreen();

    await press(stdin, KEY.space);
    await press(stdin, KEY.down);
    await press(stdin, KEY.space);
    expect(frame()).toContain('  [ ] Use memories');
    expect(frame()).toContain('› [ ] Generate memories');
    await press(stdin, KEY.enter);

    expect(onDone).toHaveBeenCalledWith({ kind: 'save', settings: { use: false, generate: false } });
  });

  it('cancels with escape without reporting the pending toggles as saved', async () => {
    const { stdin, onDone } = renderScreen();

    await press(stdin, KEY.space);
    await press(stdin, KEY.down);
    await press(stdin, KEY.space);
    await press(stdin, KEY.esc);

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith({ kind: 'cancel' });
  });

  it('moves the marker with the arrow keys and ignores space on the action row', async () => {
    const { stdin, lines, onDone } = renderScreen();
    const row = (text: string) => lines().find((line) => line.includes(text));

    await press(stdin, KEY.down);
    expect(row('Generate memories')).toContain('›');
    expect(row('Use memories')).not.toContain('›');
    await press(stdin, KEY.down);
    expect(row('Reset all memories')).toContain('›');
    await press(stdin, KEY.space);
    expect(row('Generate memories')).toContain('[x]');
    expect(row('Use memories')).toContain('[x]');
    await press(stdin, KEY.up);
    await press(stdin, KEY.up);
    expect(row('Use memories')).toContain('›');
    expect(onDone).not.toHaveBeenCalled();
  });

  describe('reset confirmation', () => {
    async function openConfirmation(value: MemoriesOverview = overview(), columns = 110) {
      const screen = renderScreen(value, columns);
      await press(screen.stdin, KEY.down);
      await press(screen.stdin, KEY.down);
      await press(screen.stdin, KEY.enter);
      return screen;
    }

    it('names every directory that will be deleted and what is left alone', async () => {
      const { frame, onDone } = await openConfirmation();

      expect(onDone).not.toHaveBeenCalled();
      expect(frame()).toContain('Reset all memories?');
      expect(frame()).toContain('This permanently deletes from this machine:');
      expect(frame()).toContain('- Project memories: 3 saved, with their history and summaries');
      expect(frame()).toContain('/repo/.autohand/memory');
      expect(frame()).toContain('- User memories: 5 saved, with their history and summaries');
      expect(frame()).toContain('~/.autohand/memory');
      expect(frame()).toContain('- Conversation sessions and existing threads.');
      expect(frame()).toContain('- Anything stored in your Autohand account or the Console.');
      expect(frame()).toContain('› Keep memories');
      expect(frame()).toContain('  Delete local memories');
      expect(frame()).toContain('↑↓ move · enter select · esc back');
    });

    it('keeps everything when enter is pressed on the default choice', async () => {
      const { stdin, frame, onDone } = await openConfirmation();

      await press(stdin, KEY.enter);

      expect(onDone).not.toHaveBeenCalled();
      expect(frame()).toContain('Generate memories');
      expect(frame()).not.toContain('Reset all memories?');
    });

    it('goes back to the options on escape instead of closing the screen', async () => {
      const { stdin, lines, onDone } = await openConfirmation();

      await press(stdin, KEY.down);
      await press(stdin, KEY.esc);

      expect(onDone).not.toHaveBeenCalled();
      expect(lines().find((line) => line.includes('Reset all memories'))).toContain('›');
    });

    it('resets only after the destructive choice is selected and confirmed', async () => {
      const { stdin, frame, onDone } = await openConfirmation();

      await press(stdin, KEY.down);
      expect(frame()).toContain('› Delete local memories');
      expect(onDone).not.toHaveBeenCalled();
      await press(stdin, KEY.enter);

      expect(onDone).toHaveBeenCalledTimes(1);
      expect(onDone).toHaveBeenCalledWith({ kind: 'reset', settings: { use: true, generate: true } });
    });

    it('lists a synced user library and shared project memories as kept, not deleted', async () => {
      const { frame } = await openConfirmation(overview({ userSynced: true, sharedProject: true }));
      const [deleted, kept] = frame().split('Not changed:');

      expect(deleted).toContain('- Project memories: 3 saved');
      expect(deleted).not.toContain('User memories');
      expect(kept).toContain('User memories in ~/.autohand/memory: they sync with your Autohand account.');
      expect(kept).toContain('/memory delete user <id>');
      expect(kept).toContain('- Project memories shared with your team.');
    });

    it('offers only a way back when there is nothing local to delete', async () => {
      const { stdin, frame, onDone } = await openConfirmation(overview({ stores: [STORES[1]], userSynced: true }));

      expect(frame()).toContain('There are no local memory files to delete.');
      expect(frame()).toContain('› Back');
      expect(frame()).not.toContain('Delete local memories');
      await press(stdin, KEY.down);
      await press(stdin, KEY.enter);

      expect(onDone).not.toHaveBeenCalled();
      expect(frame()).toContain('Generate memories');
    });

    it('wraps inside a narrow terminal without losing a directory', async () => {
      const { frame, lines } = await openConfirmation(overview(), 44);

      expect(Math.max(...lines().map((line) => line.length))).toBeLessThanOrEqual(44);
      expect(frame().replace(/\s+/gu, ' ')).toContain('- Project memories: 3 saved, with their history and summaries');
      expect(frame()).toContain('/repo/.autohand/memory');
    });
  });

  it('puts each description under its label when the terminal is narrow', () => {
    const { lines, frame } = renderScreen(overview(), 50);

    const use = lines().findIndex((line) => line.includes('Use memories'));
    expect(lines()[use].trimEnd()).toMatch(/› \[x\] Use memories$/u);
    expect(lines()[use + 1]).toMatch(/^\s{6,}Give stored memories/u);
    const generate = lines().findIndex((line) => line.includes('Generate memories'));
    expect(lines()[generate].trimEnd()).toMatch(/\[x\] Generate memories$/u);
    expect(lines()[generate + 1]).toMatch(/^\s{6,}Save durable memories/u);
    expect(frame()).toContain('Reset all memories');
    expect(frame().replace(/\s+/gu, ' ')).toContain('enter save/select · esc cancel');
    expect(Math.max(...lines().map((line) => line.length))).toBeLessThanOrEqual(50);
  });

});

describe('displayMemoryPath', () => {
  it('abbreviates the home directory and leaves other paths alone', () => {
    expect(displayMemoryPath(path.join(os.homedir(), '.autohand', 'memory'))).toBe(path.join('~', '.autohand', 'memory'));
    expect(displayMemoryPath(os.homedir())).toBe('~');
    expect(displayMemoryPath(`${os.homedir()}-backup/memory`)).toBe(`${os.homedir()}-backup/memory`);
    expect(displayMemoryPath('/repo/.autohand/memory')).toBe('/repo/.autohand/memory');
  });
});
