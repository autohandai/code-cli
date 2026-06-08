/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import stringWidth from 'string-width';

describe('/about command', () => {
  it('shows a personalized welcome and suggestions for signed-in users', async () => {
    const { about } = await import('../../src/commands/about.js');

    const output = await about({
      config: {
        configPath: '/tmp/autohand-config.json',
        auth: {
          token: 'test-token',
          user: {
            id: 'user-1',
            email: 'igor@example.com',
            name: 'Igor Costa',
          },
        },
      },
    });

    expect(output).toContain('Hey Igor');
    expect(output).toContain('here are a few suggestions');
    expect(output).toContain('/usage');
    expect(output).toContain('/status');
    expect(output).toContain('/experiments');
  });

  it('does not show the personalized welcome for anonymous users', async () => {
    const { about } = await import('../../src/commands/about.js');

    const output = await about({
      config: {
        configPath: '/tmp/autohand-config.json',
      },
    });

    expect(output).not.toContain('Hey');
    expect(output).not.toContain('here are a few suggestions');
  });

  it('uses terminal-width-aware logo art', async () => {
    const { about } = await import('../../src/commands/about.js');

    const output = await about({ terminalColumns: 12 });
    const logoLines = output!.split('\n').slice(0, 2);

    expect(logoLines).toEqual(['o o o o', 'o o o o']);
    expect(logoLines.every((line) => stringWidth(line) <= 12)).toBe(true);
  });
});
