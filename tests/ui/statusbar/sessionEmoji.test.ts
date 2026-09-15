/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  SESSION_EMOJI,
  PROJECT_EMOJI,
  emojiForName,
  emojiForProject,
  hashString,
} from '../../../src/ui/statusbar/sessionEmoji.js';

describe('session emoji', () => {
  it('maps the same name to the same emoji deterministically', () => {
    const name = 'fix wb feeding notification';
    expect(emojiForName(name)).toBe(emojiForName(name));
    expect(emojiForName(name)).toBe('🐙');
  });

  it('returns no emoji for empty or whitespace-only names', () => {
    expect(emojiForName('')).toBe('');
    expect(emojiForName('   ')).toBe('');
  });

  it('always returns an emoji from the curated set', () => {
    const names = [
      'fix login bug',
      'ship the caret fix',
      'autohand login',
      'Idle timeout — session ended',
      'which is the most rich?',
      'Inspect our status line preview code',
    ];
    for (const name of names) {
      expect(SESSION_EMOJI).toContain(emojiForName(name));
    }
  });

  it('distributes distinct names across the emoji set', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 64; i++) {
      seen.add(emojiForName(`session ${i}`));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('hashes deterministically and non-negatively', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).toBeGreaterThanOrEqual(0);
  });
});

describe('project emoji', () => {
  it('maps the same project path to the same emoji deterministically', () => {
    const path = '/Users/faceleg/Work/code-cli';
    expect(emojiForProject(path)).toBe(emojiForProject(path));
  });

  it('returns no emoji for empty or whitespace-only paths', () => {
    expect(emojiForProject('')).toBe('');
    expect(emojiForProject('   ')).toBe('');
  });

  it('always returns an emoji from the curated set', () => {
    const paths = [
      '/Users/faceleg/Work/code-cli',
      '/home/user/projects/my-app',
      '/dev/shm/scratch',
      'C:\\Users\\dev\\projects\\win-tool',
      '/tmp/throwaway',
    ];
    for (const path of paths) {
      expect(PROJECT_EMOJI).toContain(emojiForProject(path));
    }
  });

  it('distributes distinct paths across the emoji set', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 64; i++) {
      seen.add(emojiForProject(`/projects/project-${i}`));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('uses a disjoint pool from session emoji', () => {
    const sessionSet = new Set(SESSION_EMOJI);
    const projectSet = new Set(PROJECT_EMOJI);
    for (const emoji of projectSet) {
      expect(sessionSet.has(emoji as (typeof SESSION_EMOJI)[number])).toBe(false);
    }
    for (const emoji of sessionSet) {
      expect(projectSet.has(emoji as (typeof PROJECT_EMOJI)[number])).toBe(false);
    }
  });
});