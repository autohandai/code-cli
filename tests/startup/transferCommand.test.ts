import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { createTransferRunConfig, registerTransferCommand } from '../../src/startup/transferCommand.js';
import { applyCliProviderOverride, saveConfig } from '../../src/config.js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { LoadedConfig } from '../../src/types.js';
import { SessionTransferClient } from '../../src/session/transfer/transfer-client.js';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const received = { transfer: { id, accountId: 'personal_ada', expiresAt: '2099-01-01T00:00:00.000Z' }, snapshot: {
  version: 1 as const, source: 'web' as const, sourceSessionId: 'web-chat', title: 'Parser work', createdAt: '2026-09-08T00:00:00.000Z',
  model: 'moa', provider: 'autohandai', repository: null, messages: [{ role: 'user' as const, content: 'Continue the parser', createdAt: '2026-09-08T00:00:00.000Z' }],
} };
function fixture(confirmed = true) {
  const program = new Command().exitOverride().option('--auto-mode <prompt>').option('--plan'); program.configureOutput({ writeErr: () => {}, writeOut: () => {} });
  const receive = vi.fn(async () => received), prepare = vi.fn(async () => ({ sessionId: `web-${id}`, workspace: '/isolated/parser' }));
  const confirm = vi.fn(async () => confirmed), run = vi.fn(), report = vi.fn();
  registerTransferCommand(program, { receive, prepare, confirm, run, report });
  return { receive, prepare, confirm, run, report, parse: (args: string[]) => program.parseAsync(['transfer', id, '--account', 'personal_ada', ...args], { from: 'user' }) };
}
describe('standalone Web transfer command', () => {
  it('uses the launch-owned authentication flow when receiving a transfer', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'autohand-transfer-auth-'));
    directories.push(directory);
    const configPath = path.join(directory, 'config.json');
    await writeFile(configPath, JSON.stringify({ auth: { token: 'saved-device-token' } }));
    const authenticate = vi.fn(async (config: LoadedConfig) => ({
      ...config,
      auth: { token: 'launch-owner-token' },
    }));
    const download = vi.spyOn(SessionTransferClient.prototype, 'download').mockResolvedValue(received);
    const program = new Command().exitOverride();
    const run = vi.fn();
    registerTransferCommand(program, {
      authenticate,
      prepare: async () => ({ sessionId: `web-${id}`, workspace: directory }),
      run,
    });

    try {
      await program.parseAsync(['transfer', id, '--account', 'personal_ada', '--config', configPath, '--accept'], { from: 'user' });

      expect(authenticate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ configPath }));
      expect(download).toHaveBeenCalledWith(id, expect.objectContaining({ token: 'launch-owner-token' }));
      expect(run).toHaveBeenCalledOnce();
    } finally {
      download.mockRestore();
    }
  });
  it.each([false, true])('keeps transfer credentials, account and model out of configuration saves with existing Autohand settings: %s', async existing => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'autohand-transfer-config-')); directories.push(directory);
    const config: LoadedConfig = { configPath: path.join(directory, 'config.json'), provider: 'openrouter', auth: { token: 'fixture-native-token' }, api: { accountId: 'personal_local' }, ui: { showTips: false }, runOverlay: { entries: [{ path: ['ui', 'showTips'], hadBase: true, base: true, applied: false }] }, ...(existing ? { autohandai: { plan: 'local', model: 'saved-local-model' } } : {}) };
    await writeFile(config.configPath, JSON.stringify({ ...config, ui: { showTips: true }, runOverlay: undefined }));
    const selected = createTransferRunConfig(config, { account: 'personal_cloud', model: 'auto' });
    expect(selected.provider).toBe('autohandai');
    expect(selected.api?.accountId).toBe('personal_cloud');
    expect(selected.autohandai).toMatchObject({ plan: 'cloud', model: 'auto', accountToken: 'fixture-native-token' });
    await saveConfig(applyCliProviderOverride({ ...selected, hooks: { enabled: false } }, 'autohandai'));
    const saved = JSON.parse(await readFile(config.configPath, 'utf8'));
    expect(saved.provider).toBe(config.provider);
    expect(saved.api.accountId).toBe('personal_local');
    expect(saved.auth).toEqual(config.auth);
    expect(saved.autohandai).toEqual(config.autohandai);
    expect(saved.hooks).toEqual({ enabled: false });
    expect(saved.ui.showTips).toBe(true);
  });
  it('preserves an explicitly requested read-only plan when continuing locally', async () => {
    const test = fixture(); await test.parse(['--plan']);
    expect(test.run).toHaveBeenCalledWith(expect.objectContaining({ plan: true }));
  });
  it('reviews before importing and resumes the imported model without replaying an autonomous prompt', async () => {
    const test = fixture(); await test.parse(['--path', '/checkouts', '--auto-mode', 'must not execute']);
    expect(test.confirm).toHaveBeenCalledWith(received.snapshot);
    expect(test.prepare).toHaveBeenCalledWith(received, '/checkouts');
    expect(test.run).toHaveBeenCalledWith({ path: '/isolated/parser', resumeSessionId: `web-${id}`, model: 'moa', provider: 'autohandai', offline: false, config: undefined, account: 'personal_ada' });
    expect(test.run.mock.invocationCallOrder[0]).toBeGreaterThan(test.prepare.mock.invocationCallOrder[0]);
  });
  it('cancels without creating a checkout or session', async () => {
    const test = fixture(false); await test.parse([]);
    expect(test.prepare).not.toHaveBeenCalled(); expect(test.run).not.toHaveBeenCalled();
  });
  it('supports explicit noninteractive import without launching inference', async () => {
    const test = fixture(false); await test.parse(['--accept', '--import-only']);
    expect(test.confirm).not.toHaveBeenCalled(); expect(test.prepare).toHaveBeenCalledOnce(); expect(test.run).not.toHaveBeenCalled();
    expect(test.report).toHaveBeenCalledWith(expect.stringContaining(`web-${id}`));
  });
  it('rejects malformed account selectors and preserves download errors before writes', async () => {
    const test = fixture(); await expect(test.parse(['--account', '../other'])).rejects.toThrow('Invalid transfer account');
    expect(test.receive).not.toHaveBeenCalled();
    test.receive.mockRejectedValueOnce(new Error('This transfer expired'));
    await expect(test.parse([])).rejects.toThrow('This transfer expired'); expect(test.prepare).not.toHaveBeenCalled();
  });
});
