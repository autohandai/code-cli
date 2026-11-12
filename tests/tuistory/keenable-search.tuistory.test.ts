import { describe, expect, it, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTempAutohandHome, exitInteractive, launchBuiltAutohand } from './helpers/autohandTuistory.js';

// Uses the real built CLI and password modal. No provider request or real key.
describe('Keenable search setup', () => {
  it('selects Keenable, masks and saves its key, then restores it after restart', async () => {
    const state = await createTempAutohandHome({ config: {
      search: { provider: 'browser-profile' },
      features: { automaticSpecialists: false }, agent: { autoMemory: false },
      mcp: { enabled: false, servers: [] }, ui: { promptSuggestions: false },
    } });
    const preload = path.join(state.autohandHome, 'offline-search.mjs');
    await writeFile(preload, 'globalThis.fetch = async () => new Response(null, {status:503});');
    let session: Awaited<ReturnType<typeof launchBuiltAutohand>> | undefined;
    const launch = () => launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--offline', '--no-daemon'], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, cols: 120, rows: 40,
      env: { KEENABLE_API_KEY: '', NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` },
    });
    try {
      session = await launch();
      await session.waitForText('Plan, search, build anything');
      await session.type('/search'); await session.press('enter');
      await session.waitForText('Select search provider:');
      // Without account access, Keenable is the fifth entry in the real modal.
      await session.press('5');
      await session.waitForText('Enter Keenable API key:');
      await session.type('kn-terminal-fixture');
      expect(await session.text({ immediate: true })).not.toContain('kn-terminal-fixture');
      await session.press('enter');
      await session.waitForText('Search provider set to keenable and saved to config');
      await vi.waitFor(async () => expect(JSON.parse(await readFile(state.configPath, 'utf8')).search)
        .toMatchObject({ provider: 'keenable', keenableApiKey: 'kn-terminal-fixture' }));
      await exitInteractive(session); session.close();
      session = await launch();
      await session.waitForText('Plan, search, build anything');
      await session.type('/search'); await session.press('enter');
      await session.waitForText('Select search provider:');
      expect(await session.text({ immediate: true })).toMatch(/▸\s+5\. Keenable/);
      await session.press('enter');
      await session.waitForText('Search provider set to keenable and saved to config');
      expect(await session.text({ immediate: true })).not.toContain('kn-terminal-fixture');
      await exitInteractive(session);
    } finally {
      session?.close(); await session?.waitForExit(5_000); await state.cleanup();
    }
  }, 60_000);
});
