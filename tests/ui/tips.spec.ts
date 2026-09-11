import { describe, it, expect } from 'vitest';
import { TipsBag, expandToolTips, type ToolTip } from '../../src/ui/tips.js';
import toolTips from '../../src/ui/tool_tips.json' with { type: 'json' };

describe('tool_tips.json', () => {
  it('keeps the full built-in pool and mentions the extension builder', () => {
    const texts = toolTips.tips.map((tip) => tip.text);
    expect(texts.length).toBeGreaterThanOrEqual(20);
    expect(texts.some((text) => text.includes('$extension-builder'))).toBe(true);
    expect(toolTips.tips.some((tip) => tip.kind === 'skill')).toBe(true);
    expect(toolTips.tips.some((tip) => tip.kind === 'command')).toBe(true);
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
});
