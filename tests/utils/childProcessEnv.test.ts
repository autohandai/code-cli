/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyChildProcessEnvPolicy,
  buildAutohandChildProcessEnv,
  configureChildProcessEnvPolicy,
} from '../../src/utils/childProcessEnv.js';

const base: NodeJS.ProcessEnv = {
  PATH: '/usr/bin',
  HOME: '/Users/me',
  SHELL: '/bin/zsh',
  AWS_SECRET_ACCESS_KEY: 'sentinel-aws',
  GITHUB_TOKEN: 'sentinel-gh',
  NODE_OPTIONS: '--max-old-space-size=4096',
  NPM_TOKEN: 'sentinel-npm',
  AUTOHAND_DEBUG: '1',
  EDITOR: 'vim',
};

afterEach(() => configureChildProcessEnvPolicy(undefined));

describe('applyChildProcessEnvPolicy', () => {
  it('inherits everything by default', () => {
    expect(applyChildProcessEnvPolicy(base, undefined)).toEqual(base);
    expect(applyChildProcessEnvPolicy(base, {})).toEqual(base);
  });

  it('keeps only the essential shell variables plus Autohand variables with inherit: essential', () => {
    const env = applyChildProcessEnvPolicy(base, { inherit: 'essential' });
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/Users/me', SHELL: '/bin/zsh', AUTOHAND_DEBUG: '1' });
  });

  it('starts empty with inherit: none and adds back include globs', () => {
    const env = applyChildProcessEnvPolicy(base, { inherit: 'none', include: ['PATH', 'NODE_*'] });
    expect(env).toEqual({ PATH: '/usr/bin', NODE_OPTIONS: '--max-old-space-size=4096', AUTOHAND_DEBUG: '1' });
  });

  it('removes excluded names and globs and pins explicit values', () => {
    const env = applyChildProcessEnvPolicy(base, { exclude: ['*_TOKEN', 'AWS_*'], set: { CI: '1', EDITOR: 'nano' } });
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.NPM_TOKEN).toBeUndefined();
    expect(env).toMatchObject({ PATH: '/usr/bin', CI: '1', EDITOR: 'nano', NODE_OPTIONS: '--max-old-space-size=4096' });
  });

  it('never strips the variables Autohand itself relies on', () => {
    const env = applyChildProcessEnvPolicy(base, { inherit: 'none', exclude: ['AUTOHAND_*'] });
    expect(env.AUTOHAND_DEBUG).toBe('1');
  });
});

describe('buildAutohandChildProcessEnv with a configured policy', () => {
  it('applies the installed policy and still sets the Autohand runtime variables', () => {
    configureChildProcessEnvPolicy({ inherit: 'essential', exclude: ['SHELL'] });
    const env = buildAutohandChildProcessEnv({ EXTRA: 'yes' }, { ...base, AUTOHAND_HOME: '/tmp/ah-home' });
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.SHELL).toBeUndefined();
    expect(env).toMatchObject({ PATH: '/usr/bin', EXTRA: 'yes', AUTOHAND_CLI: '1', AUTOHAND_HOME: '/tmp/ah-home', CODEX_HOME: '/tmp/ah-home' });
  });

  it('lets an explicit policy argument override the installed one', () => {
    configureChildProcessEnvPolicy({ inherit: 'none' });
    const env = buildAutohandChildProcessEnv({}, base, null);
    expect(env.GITHUB_TOKEN).toBe('sentinel-gh');
  });
});
