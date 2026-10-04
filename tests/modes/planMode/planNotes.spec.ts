/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { applyPlanEdits, parsePlanNotes } from '../../../src/modes/planMode/PlanParser.js';
import type { Plan } from '../../../src/modes/planMode/types.js';

const descriptions = (notes: string) => parsePlanNotes(notes).map(({ number, description }) => `${number}. ${description}`);

describe('parsePlanNotes', () => {
  it('reads a plain numbered plan', () => {
    expect(parsePlanNotes('1. Read the code\n2. Write the module\n3. Run tests')).toEqual([
      { number: 1, description: 'Read the code', status: 'pending' },
      { number: 2, description: 'Write the module', status: 'pending' },
      { number: 3, description: 'Run tests', status: 'pending' },
    ]);
  });

  it('keeps sub-bullets, headings and other sections out of the step list', () => {
    const notes = [
      '## Goal',
      'Refresh tokens lazily instead of at startup.',
      '',
      '## Steps',
      '1. Read src/session/store.ts and list every caller of refreshToken',
      '   - note which callers await the result',
      '   - note which callers run at startup',
      '2. Extract a TokenRefresher class',
      '3. Replace the eager refresh with a lazy getter',
      '',
      '## Risks',
      '- Callers that rely on the eager refresh during startup',
      '- The mobile relay reads the token synchronously',
    ].join('\n');

    expect(descriptions(notes)).toEqual([
      '1. Read src/session/store.ts and list every caller of refreshToken',
      '2. Extract a TokenRefresher class',
      '3. Replace the eager refresh with a lazy getter',
    ]);
  });

  it('treats nested numbered lists as detail of their parent step', () => {
    const notes = '1. Prepare\n   1. install deps\n   2. build\n2. Ship';

    expect(descriptions(notes)).toEqual(['1. Prepare', '2. Ship']);
  });

  it('accepts an indented top level and the "1)" style', () => {
    expect(descriptions('  1) First\n  2) Second')).toEqual(['1. First', '2. Second']);
  });

  it('renumbers steps when numbering restarts across sections', () => {
    const notes = '## Phase 1\n1. Audit\n2. Design\n\n## Phase 2\n1. Build\n2. Verify';

    expect(descriptions(notes)).toEqual(['1. Audit', '2. Design', '3. Build', '4. Verify']);
  });

  it('keeps the author\'s numbers when they only skip ahead', () => {
    expect(descriptions('1. One\n3. Three\n7. Seven')).toEqual(['1. One', '3. Three', '7. Seven']);
  });

  it('falls back to top-level bullets when nothing is numbered', () => {
    const notes = '- Read the code\n  - including tests\n* Write the module\n- Run tests';

    expect(descriptions(notes)).toEqual(['1. Read the code', '2. Write the module', '3. Run tests']);
  });

  it('ignores list-looking lines inside code fences', () => {
    const notes = '1. Add the script\n```sh\n1. not a step\n- not a step either\n```\n2. Run it';

    expect(descriptions(notes)).toEqual(['1. Add the script', '2. Run it']);
  });

  it('handles Windows line endings and tab indentation', () => {
    expect(descriptions('1. One\r\n\t- detail\r\n2. Two\r\n')).toEqual(['1. One', '2. Two']);
  });

  it('uses the first line of free text as a single step instead of cutting it mid-word', () => {
    const notes = `# Refactor\n\nRework the session store so tokens refresh lazily. ${'More prose. '.repeat(40)}`;

    const steps = parsePlanNotes(notes);

    expect(steps).toHaveLength(1);
    expect(steps[0]?.number).toBe(1);
    expect(steps[0]?.description.startsWith('Rework the session store so tokens refresh lazily.')).toBe(true);
    expect(steps[0]?.description.length).toBeLessThanOrEqual(200);
    expect(steps[0]?.description.endsWith('…')).toBe(true);
  });

  it.each(['', '   \n\n', '## Only a heading'])('returns no steps for %j', (notes) => {
    expect(parsePlanNotes(notes)).toEqual([]);
  });
});

describe('applyPlanEdits', () => {
  const original: Plan = {
    id: 'plan-1',
    steps: [
      { number: 1, description: 'Read the store', status: 'pending' },
      { number: 2, description: 'Run tests', status: 'pending' },
    ],
    rawText: '## Goal\nLazy refresh.\n\n1. Read the store\n2. Run tests',
    createdAt: 1,
  };

  it('reports no change for an untouched file', () => {
    expect(applyPlanEdits(original, structuredClone(original))).toBeNull();
  });

  it('re-derives the steps when the user rewrote the notes', () => {
    const edited = { ...original, rawText: '## Goal\nLazy refresh.\n\n1. Read the store\n2. Add a migration\n3. Run tests' };

    expect(applyPlanEdits(original, edited)).toEqual({
      ...original,
      rawText: edited.rawText,
      steps: [
        { number: 1, description: 'Read the store', status: 'pending' },
        { number: 2, description: 'Add a migration', status: 'pending' },
        { number: 3, description: 'Run tests', status: 'pending' },
      ],
    });
  });

  it('takes the checklist when only the checklist was edited', () => {
    const edited: Plan = {
      ...original,
      steps: [{ number: 1, description: 'Read the store and its tests', status: 'pending' }],
    };

    expect(applyPlanEdits(original, edited)?.steps).toEqual(edited.steps);
  });

  it('falls back to the first line of prose when rewritten notes contain no list', () => {
    const edited: Plan = { ...original, rawText: '## Goal\nOnly prose now.\n\n## Nothing else' };

    const result = applyPlanEdits(original, edited);

    expect(result?.rawText).toBe(edited.rawText);
    expect(result?.steps).toHaveLength(1);
    expect(result?.steps[0]?.description).toBe('Only prose now.');
  });

  it('ignores a status-only difference', () => {
    const edited: Plan = { ...original, steps: original.steps.map((step) => ({ ...step, status: 'completed' as const })) };

    expect(applyPlanEdits(original, edited)).toBeNull();
  });
});
