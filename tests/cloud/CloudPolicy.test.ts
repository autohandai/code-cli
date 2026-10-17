import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateCloudPolicy } from '../../src/cloud/CloudPolicy.js';
import type { LoadedConfig } from '../../src/types.js';
const roots: string[] = [];
const config: LoadedConfig = { configPath: '/fixture/config.json' };
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function workspace(name: string, contents: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'autohand-cloud-policy-')); roots.push(root);
  await mkdir(path.join(root, '.autohand'));
  await writeFile(path.join(root, '.autohand', name), contents);
  return root;
}
describe('project cloud security policy', () => {
  it('refuses a project command prohibition in both execution and plan mode', async () => {
    const root = await workspace('settings.local.json', JSON.stringify({ permissions: { denyList: ['run_command:*'] } }));
    for (const readOnly of [false, true]) await expect(validateCloudPolicy(config, root, readOnly)).rejects.toThrow('local security policy');
  });
  it('preserves session mutation restrictions only in hosted read-only mode', async () => {
    const root = await workspace('session-permissions.json', JSON.stringify({ version: 1, denyList: ['apply_patch:*', 'git_merge:*'] }));
    await expect(validateCloudPolicy(config, root)).rejects.toThrow('local security policy');
    await expect(validateCloudPolicy(config, root, true)).resolves.toBeUndefined();
  });
  it('fails closed on malformed or oversized local policy files', async () => {
    for (const contents of ['{', JSON.stringify({ permissions: { mode: 42 } }), ' '.repeat(64_001)]) {
      const root = await workspace('settings.local.json', contents);
      await expect(validateCloudPolicy(config, root)).rejects.toThrow();
    }
  });
  it('keeps global restrictions when the project contains no policy', async () => {
    const root = await workspace('settings.local.json', '{}');
    await expect(validateCloudPolicy(config, root)).resolves.toBeUndefined();
    await expect(validateCloudPolicy({ ...config, permissions: { denyList: ['run_command:*'] } }, root)).rejects.toThrow('local security policy');
  });
});
