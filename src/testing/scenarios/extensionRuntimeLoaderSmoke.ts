/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import { ExtensionRuntimeHost } from '../../extensions/ExtensionRuntimeHost.js';
import { ExtensionService } from '../../extensions/ExtensionService.js';

const root = process.argv[2];
if (!root) throw new Error('Expected fixture root');
const service = new ExtensionService({ userRoot: path.join(root, 'extensions') });
const host = new ExtensionRuntimeHost();
try {
  for (const value of ['one', 'two']) {
    await fs.writeFile(path.join(root, 'source/value.mjs'), `export const value = ${JSON.stringify(value)};`);
    const diagnostics = await host.sync(await service.list());
    if (diagnostics.length) throw new Error(JSON.stringify(diagnostics));
    if (host.getCommand('/shared')?.description !== 'Shared graph') throw new Error('Shared module graph is unavailable');
    const command = host.getCommand('/smoke');
    const result = await command?.execute({ args: [], workspaceRoot: root, isNonInteractive: true,
      cli: { getOption: () => undefined }, ui: { open: (viewId) => ({ type: 'extension-view', viewId }) } });
    if (result !== value) throw new Error(`Expected ${value}, received ${String(result)}`);
  }
  console.log('EXTENSION_BINARY_RELOAD_OK');
} finally {
  await host.deactivateAll();
}
