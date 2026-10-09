/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { collectReportEnvironment } from '../../src/feedback/environment.js';

describe('collectReportEnvironment', () => {
  it('describes the operating system and JavaScript runtime', () => {
    const environment = collectReportEnvironment({ env: {} });

    expect(environment.os).toBe(`${process.platform} ${os.release()} (${process.arch})`);
    expect(environment.runtime).toMatch(/^(bun|node) /u);
  });

  it('reports the terminal, shell, multiplexer and locale without their paths', () => {
    const environment = collectReportEnvironment({
      env: {
        SHELL: '/opt/homebrew/bin/fish',
        TERM: 'xterm-ghostty',
        TERM_PROGRAM: 'ghostty',
        TERM_PROGRAM_VERSION: '1.2.0',
        TMUX: '/private/tmp/tmux-501/default,1,0',
        LANG: 'en_NZ.UTF-8',
        SSH_CONNECTION: '10.0.0.1 22 10.0.0.2 22',
        CI: 'true',
      },
    });

    expect(environment).toMatchObject({
      shell: 'fish',
      term: 'xterm-ghostty',
      terminal: 'ghostty 1.2.0',
      multiplexer: 'tmux',
      locale: 'en_NZ.UTF-8',
      ssh: 'yes',
      ci: 'yes',
    });
    expect(JSON.stringify(environment)).not.toContain('/private/tmp');
    expect(JSON.stringify(environment)).not.toContain('10.0.0.1');
  });

  it('includes the provider, model and interaction mode in use', () => {
    const environment = collectReportEnvironment({
      env: {},
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-5-5',
      interactionMode: 'automode',
    });

    expect(environment).toMatchObject({
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-5-5',
      mode: 'automode',
    });
  });

  it('omits everything it cannot determine instead of sending blanks', () => {
    const environment = collectReportEnvironment({ env: {} });

    expect(Object.keys(environment).sort()).toEqual(
      expect.arrayContaining(['os', 'runtime']),
    );
    for (const key of ['shell', 'terminal', 'term', 'multiplexer', 'locale', 'ssh', 'ci', 'provider', 'model', 'mode']) {
      expect(environment).not.toHaveProperty(key);
    }
    for (const value of Object.values(environment)) {
      expect(value).not.toBe('');
    }
  });

  it('never carries secrets or the working directory', () => {
    const environment = collectReportEnvironment({
      env: {
        OPENAI_API_KEY: 'sk-abcdefghijklmnop1234',
        PWD: '/Users/alice/secret-project',
        HOME: '/Users/alice',
        TERM_PROGRAM: 'x'.repeat(500),
      },
    });
    const serialized = JSON.stringify(environment);

    expect(serialized).not.toContain('sk-abcdefghijklmnop1234');
    expect(serialized).not.toContain('alice');
    expect(environment.terminal?.length).toBeLessThanOrEqual(200);
  });
});
