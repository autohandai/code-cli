import { describe, it, expect, beforeEach } from 'vitest';
import { ActivityIndicator } from '../../src/ui/activityIndicator.js';

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

describe('ActivityIndicator', () => {
  let indicator: ActivityIndicator;

  beforeEach(() => {
    indicator = new ActivityIndicator();
  });

  it('returns formatted activity text with verb and tip', () => {
    const result = indicator.next();
    expect(result).toContain('...');
    expect(result).toContain('Tip:');
  });

  it('rotates verbs across calls', () => {
    const verbs = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const result = stripAnsi(indicator.next());
      const match = result.match(/^\S+\s+(\w+)\.\.\./);
      expect(match).toBeTruthy();
      verbs.add(match![1]);
    }
    expect(verbs.size).toBeGreaterThanOrEqual(2);
  });

  it('accepts custom verbs via config', () => {
    const custom = new ActivityIndicator({
      activityVerbs: ['Hacking'],
      activitySymbol: '⚡',
    });
    const result = custom.next();
    expect(result).toContain('⚡');
    expect(result).toContain('Hacking...');
  });

  it('accepts a single string verb', () => {
    const custom = new ActivityIndicator({
      activityVerbs: 'Processing',
    });
    const result = custom.next();
    expect(result).toContain('Processing...');
  });

  it('getVerb returns just the verb string', () => {
    const custom = new ActivityIndicator({ activityVerbs: 'Building' });
    expect(custom.getVerb()).toBe('Building');
  });

  it('getTip returns just the tip string', () => {
    const tip = indicator.getTip();
    expect(tip).toBeTruthy();
    expect(typeof tip).toBe('string');
  });
});
