/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { ExtensionService } from '../../src/extensions/ExtensionService.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.remove(root))); });

describe('standalone extension runtime loader', () => {
  it('reloads installed API v1 modules in a compiled executable without an external build service', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-runtime-binary-'));
    roots.push(root);
    const source = path.join(root, 'source');
    await fs.ensureDir(source);
    await fs.writeJson(path.join(source, 'autohand.extension.json'), {
      schemaVersion: 1, extensionApi: 1, id: 'autohand.binary', name: 'Binary smoke', version: '1.0.0',
      description: 'Compiled CLI runtime smoke', contributes: { runtime: ['runtime.mjs', 'second.mjs'] },
    });
    await fs.writeFile(path.join(source, 'value.mjs'), 'export const value = "one";');
    await fs.writeFile(path.join(source, 'asset.txt'), 'asset');
    await fs.writeFile(path.join(source, 'helper.cjs'), 'module.exports = {activated:false};');
    await fs.writeFile(path.join(source, 'runtime.mjs'), `import {value} from './value.mjs';
      import React from 'react';
      import {jsx} from 'react/jsx-runtime';
      import {readFile} from 'node:fs/promises';
      import common from './helper.cjs';
      const asset = await readFile(new URL('./asset.txt', import.meta.url), 'utf8');
      const ready = await Promise.resolve(value);
      export function activate(api) {
        if (asset !== 'asset' || !common || React !== api.ui.React || !jsx) throw new Error('Runtime compatibility failed');
        common.activated = true;
        api.commands.register({command:'/smoke',description:'Smoke',execute:()=>ready}); }`);
    await fs.writeFile(path.join(source, 'second.mjs'), `import common from './helper.cjs';
      if (!common.activated) throw new Error('Entrypoint activation order changed');
      export function activate(api) { api.commands.register({command:'/shared',description:'Shared graph',execute:()=> 'shared'}); }`);
    const service = new ExtensionService({ userRoot: path.join(root, 'extensions') });
    await service.install(source, { trust: true, link: true });
    const executable = path.join(root, process.platform === 'win32' ? 'loader.exe' : 'loader');
    const compiled = spawnSync('bun', ['build', './src/testing/scenarios/extensionRuntimeLoaderSmoke.ts', '--compile', '--outfile', executable], {
      encoding: 'utf8', timeout: 60_000,
    });
    expect(compiled.status, `${compiled.stdout}\n${compiled.stderr}`).toBe(0);
    const run = spawnSync(executable, [root], { cwd: root, encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, ESBUILD_BINARY_PATH: path.join(root, 'missing-esbuild') } });
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(run.stdout).toContain('EXTENSION_BINARY_RELOAD_OK');
  }, 90_000);
});
