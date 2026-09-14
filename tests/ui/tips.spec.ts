import { describe, it, expect } from 'vitest';
import {
  TIP_ROTATION_MS, TipsBag, expandToolTips, type ToolTip } from '../../src/ui/tips.js';
import { SLASH_COMMANDS } from '../../src/core/slashCommands.js';
import toolTips from '../../src/ui/tool_tips.json' with { type: 'json' };

const staticTips = (toolTips.tips as ToolTip[])
  .filter((tip) => !tip.kind || tip.kind === 'static')
  .map((tip) => tip.text);

const skillTips = (toolTips.tips as ToolTip[]).filter((tip) => tip.kind === 'skill');

describe('tool_tips.json', () => {
  it('keeps the full built-in pool and mentions the extension builder', () => {
    const texts = toolTips.tips.map((tip) => tip.text);
    expect(texts.length).toBeGreaterThanOrEqual(20);
    expect(texts.some((text) => text.includes('$extension-builder'))).toBe(true);
    expect(toolTips.tips.some((tip) => tip.kind === 'skill')).toBe(true);
    expect(toolTips.tips.some((tip) => tip.kind === 'command')).toBe(true);
  });

  it('teaches every composer trigger', () => {
    for (const trigger of ['/', '@', '$', '!', ':', '?']) {
      expect(staticTips.some((text) => new RegExp(`(^|\\s)\\${trigger}`).test(text)), trigger).toBe(true);
    }
  });

  it('points every static tip at a trigger, a slash command or a key', () => {
    const actionable = /(^|\s)[/@$!:?]|\b(Shift|Ctrl|Esc|Tab)\b|↑/u;
    for (const text of staticTips) {
      expect(text).toMatch(actionable);
    }
  });

  it('keeps every static tip short enough to sit beside the completion summary', () => {
    for (const text of staticTips) {
      expect(text.length, text).toBeLessThanOrEqual(60);
    }
  });

  it('names only slash commands that exist', () => {
    // Every command a tip names must be registered in its own right, so a tip
    // can never teach a form the composer would reject.
    const registered = new Set(SLASH_COMMANDS.map((command) => command.command));
    for (const [, , command] of staticTips.join('\n').matchAll(/(^|\s)(\/[a-z-]+)/gu)) {
      expect(registered.has(command), command).toBe(true);
    }
  });

  it('covers the features worth discovering, goals included', () => {
    const pool = staticTips.join('\n');
    for (const command of ['/goal', '/goals', '/memory', '/resume', '/team', '/agents', '/mcp', '/hooks', '/skills']) {
      expect(pool, command).toContain(`${command} `);
    }
    expect(staticTips.length).toBeGreaterThanOrEqual(40);
  });

  it('suggests the user own installed skills, with a short form for tight rows', () => {
    expect(skillTips.length).toBeGreaterThanOrEqual(2);
    expect(skillTips.some((tip) => tip.text.includes('{{description}}'))).toBe(true);
    expect(skillTips.some((tip) => !tip.text.includes('{{description}}'))).toBe(true);
  });
});

describe('expandToolTips', () => {
  const tips: ToolTip[] = [
    { text: 'Plain tip' },
    { kind: 'skill', text: 'Try ${{skill}}: {{description}}' },
    { kind: 'command', text: 'Type {{command}} to {{description}}' },
  ];

  it('expands skill and command templates once per item', () => {
    const expanded = expandToolTips(tips, {
      listSkills: () => [{ name: 'deploy', description: 'Ship to production' }],
      listCommands: () => [
        { command: '/goal', description: 'Track a persistent goal' },
        { command: '/undo', description: 'revert the last change' },
      ],
    });
    expect(expanded).toEqual([
      'Plain tip',
      'Try $deploy: ship to production',
      'Type /goal to track a persistent goal',
      'Type /undo to revert the last change',
    ]);
  });

  it('drops template tips when there is nothing to fill them with', () => {
    expect(expandToolTips(tips, {})).toEqual(['Plain tip']);
    expect(expandToolTips(tips, { listSkills: () => [] })).toEqual(['Plain tip']);
  });

  it('skips skills without a description and malformed entries', () => {
    const expanded = expandToolTips(
      [...tips, { text: '' } as ToolTip, { kind: 'static' } as ToolTip],
      { listSkills: () => [{ name: 'bare' }] },
    );
    expect(expanded).toEqual(['Plain tip']);
  });
});

describe('TipsBag', () => {
  it('returns a non-empty string from the built-in pool', () => {
    const tip = new TipsBag().next();
    expect(typeof tip).toBe('string');
    expect(tip.length).toBeGreaterThan(0);
  });

  it('does not repeat until the pool is exhausted', () => {
    const bag = new TipsBag();
    const seen = new Set<string>();
    for (let i = 0; i < bag.size; i++) {
      const tip = bag.next();
      expect(seen.has(tip)).toBe(false);
      seen.add(tip);
    }
    expect(bag.next()).toBeTruthy();
  });

  it('accepts a custom pool and handles a single entry', () => {
    const custom = new TipsBag([{ text: 'Tip A' }, { text: 'Tip B' }]);
    expect([custom.next(), custom.next()].sort()).toEqual(['Tip A', 'Tip B']);
    const single = new TipsBag([{ text: 'Only tip' }]);
    expect(single.next()).toBe('Only tip');
    expect(single.next()).toBe('Only tip');
  });

  it('re-expands templates each time the pool refills so new skills appear', () => {
    const skills: { name: string; description: string }[] = [];
    const bag = new TipsBag(
      [{ text: 'Plain' }, { kind: 'skill', text: '{{skill}}' }],
      { listSkills: () => skills },
    );
    expect(bag.next()).toBe('Plain');
    skills.push({ name: 'later', description: 'added later' });
    expect(new Set([bag.next(), bag.next()])).toEqual(new Set(['Plain', 'later']));
  });

  it('falls back to a generic tip when nothing expands', () => {
    expect(new TipsBag([]).next()).toBe('Type /help to see all available slash commands');
  });

  describe('nextFitting', () => {
    const short = (tip: string) => tip.length <= 5;

    it('draws the next tip that fits and keeps skipped tips for a wider screen', () => {
      const bag = new TipsBag([{ text: 'a much longer tip' }, { text: 'short' }]);
      expect(bag.nextFitting(short)).toBe('short');
      expect(bag.nextFitting(() => true)).toBe('a much longer tip');
    });

    it('refills before giving up so a narrow screen keeps cycling the tips that fit', () => {
      const bag = new TipsBag([{ text: 'a much longer tip' }, { text: 'short' }]);
      expect(bag.nextFitting(short)).toBe('short');
      expect(bag.nextFitting(short)).toBe('short');
    });

    it('returns undefined when no tip fits and leaves the pool intact', () => {
      const bag = new TipsBag([{ text: 'too long for this' }]);
      expect(bag.nextFitting(() => false)).toBeUndefined();
      expect(bag.next()).toBe('too long for this');
    });
  });
});

describe('TIP_ROTATION_MS', () => {
  it('leaves an idle tip on screen long enough to read before the next one', () => {
    expect(TIP_ROTATION_MS).toBeGreaterThanOrEqual(30_000);
  });
});
