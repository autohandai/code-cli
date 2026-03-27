import { describe, it, expect } from 'vitest';

describe('review hook events', () => {
  it('HookEvent type includes all review lifecycle events', async () => {
    const { HOOK_EVENTS } = await import('../src/commands/hooks.js');
    expect(HOOK_EVENTS).toContain('review:start');
    expect(HOOK_EVENTS).toContain('review:end');
    expect(HOOK_EVENTS).toContain('review:paused');
    expect(HOOK_EVENTS).toContain('review:failed');
    expect(HOOK_EVENTS).toContain('review:completed');
  });
});
