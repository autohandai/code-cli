import { describe, it, expect, beforeEach } from 'vitest';
import { TipsBag } from '../../src/ui/tips.js';

describe('TipsBag', () => {
  let bag: TipsBag;

  beforeEach(() => {
    bag = new TipsBag();
  });

  it('returns a non-empty string', () => {
    const tip = bag.next();
    expect(tip).toBeTruthy();
    expect(typeof tip).toBe('string');
  });

  it('does not repeat until pool is exhausted', () => {
    const seen = new Set<string>();
    const poolSize = bag.size;
    for (let i = 0; i < poolSize; i++) {
      const tip = bag.next();
      expect(seen.has(tip)).toBe(false);
      seen.add(tip);
    }
    const tip = bag.next();
    expect(tip).toBeTruthy();
  });

  it('accepts a custom tip pool', () => {
    const custom = new TipsBag(['Tip A', 'Tip B']);
    const tips = [custom.next(), custom.next()];
    expect(tips).toContain('Tip A');
    expect(tips).toContain('Tip B');
  });

  it('handles single-element pool', () => {
    const single = new TipsBag(['Only tip']);
    expect(single.next()).toBe('Only tip');
    expect(single.next()).toBe('Only tip');
  });
});
