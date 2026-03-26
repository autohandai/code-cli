import { describe, expect, it, vi } from 'vitest';

import { automode } from '../../src/commands/automode.js';

describe('/automode interactive toggle', () => {
  function createContext(enabled = false) {
    let interactiveEnabled = enabled;

    return {
      ctx: {
        isInteractiveAutomodeEnabled: () => interactiveEnabled,
        setInteractiveAutomodeEnabled: vi.fn((next: boolean) => {
          interactiveEnabled = next;
        }),
      },
      getEnabled: () => interactiveEnabled,
    };
  }

  it('toggles on when invoked without args and interactive auto-mode is off', async () => {
    const { ctx, getEnabled } = createContext(false);

    const result = await automode(ctx, []);

    expect(result).toContain('enabled');
    expect(getEnabled()).toBe(true);
  });

  it('toggles off when invoked without args and interactive auto-mode is on', async () => {
    const { ctx, getEnabled } = createContext(true);

    const result = await automode(ctx, []);

    expect(result).toContain('disabled');
    expect(getEnabled()).toBe(false);
  });

  it('supports explicit on and off subcommands', async () => {
    const on = createContext(false);
    const onResult = await automode(on.ctx, ['on']);
    expect(onResult).toContain('enabled');
    expect(on.getEnabled()).toBe(true);

    const off = createContext(true);
    const offResult = await automode(off.ctx, ['off']);
    expect(offResult).toContain('disabled');
    expect(off.getEnabled()).toBe(false);
  });

  it('reports interactive auto-mode status when no loop manager exists', async () => {
    const { ctx } = createContext(true);

    const result = await automode(ctx, ['status']);

    expect(result).toContain('Interactive auto-mode: enabled');
    expect(result).toContain('No auto-mode session is currently active.');
  });
});
