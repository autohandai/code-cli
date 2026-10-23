/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExtensionRuntimeHost } from '../../src/extensions/ExtensionRuntimeHost.js';
import { ExtensionService } from '../../src/extensions/ExtensionService.js';

const roots: string[] = [];
const hosts: ExtensionRuntimeHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.deactivateAll()));
  await Promise.all(roots.splice(0).map((root) => fs.remove(root)));
});

describe('extension runtime module graphs', () => {
  it('shares helpers across entrypoints and preserves import/activation order on every generation', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-runtime-graph-'));
    roots.push(root);
    const source = path.join(root, 'source');
    await fs.ensureDir(source);
    await fs.writeJson(path.join(source, 'autohand.extension.json'), {
      schemaVersion:1, extensionApi:1, id:'autohand.graph', name:'Shared graph', version:'1.0.0',
      description:'Shared graph fixture', contributes:{runtime:['first.mjs','second.mjs']},
    });
    await fs.writeFile(path.join(source,'shared.mjs'), 'export const state = {value:"one", activated:false, count:0};');
    await fs.writeFile(path.join(source,'first.mjs'), `import {state} from './shared.mjs';
      export function activate(api) {
        state.activated = true; state.count++;
        api.commands.register({command:'/first',description:state.value+':'+state.count,execute:()=>state.value});
      }`);
    await fs.writeFile(path.join(source,'second.mjs'), `import {state} from './shared.mjs';
      if (!state.activated) throw new Error('Entrypoint imported before the earlier activation completed');
      export async function activate(api) {
        state.count++;
        api.commands.register({command:'/second',description:state.value+':'+state.count,execute:()=>state.value});
      }`);
    const service = new ExtensionService({userRoot:path.join(root,'extensions')});
    await service.install(source,{link:true,trust:true});
    const host = new ExtensionRuntimeHost();
    hosts.push(host);
    expect(await host.sync(await service.list())).toEqual([]);
    expect(host.getCommand('/first')?.description).toBe('one:1');
    expect(host.getCommand('/second')?.description).toBe('one:2');
    await fs.writeFile(path.join(source,'shared.mjs'), 'export const state = {value:"two", activated:false, count:0};');
    expect(await host.sync(await service.list())).toEqual([]);
    expect(host.getCommand('/first')?.description).toBe('two:1');
    expect(host.getCommand('/second')?.description).toBe('two:2');
  });
});
