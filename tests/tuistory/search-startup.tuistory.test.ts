import { describe, expect, it, vi } from 'vitest';
import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { typeBeforeSearchCapabilityCheck } from '../../src/testing/scenarios/searchStartupScenario.js';
import { createTempAutohandHome, exitInteractive, launchBuiltAutohand } from './helpers/autohandTuistory.js';

describe('search capability startup', () => {
  it.each([false, true])('accepts a draft before checking account search (fullscreen=%s)', async fullScreenMode => {
    const state = await createTempAutohandHome({ config: {
      features: { fullScreenMode, automaticSpecialists: false },
      ui: { promptSuggestions: false }, agent: { autoMemory: false },
      mcp: { enabled: false, servers: [] },
    } });
    const started = path.join(state.autohandHome, 'capability.started');
    const aborted = path.join(state.autohandHome, 'capability.aborted');
    const preload = path.join(state.autohandHome, 'search-fetch.mjs');
    await writeFile(preload, `
      import { writeFileSync } from 'node:fs';
      globalThis.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url === 'https://dev.autohand.ai/api/native/web-search') {
          writeFileSync(${JSON.stringify(started)}, 'started');
          return new Promise((resolve, reject) => {
            const keepAlive = setInterval(() => {}, 1_000);
            const abort = () => { clearInterval(keepAlive); writeFileSync(${JSON.stringify(aborted)}, 'aborted'); reject(init.signal.reason); };
            if (init.signal.aborted) abort();
            else init.signal.addEventListener('abort', abort, { once: true });
          });
        }
        return new Response(null, { status: 503 });
      };
    `);
    let session: Awaited<ReturnType<typeof launchBuiltAutohand>> | undefined;
    try {
      session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--offline', '--no-daemon'], {
        autohandHome: state.autohandHome, cwd: state.workspaceRoot, cols: 120, rows: 36, waitForData: false,
        env: { NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` },
      });
      await typeBeforeSearchCapabilityCheck(session);
      await expect(access(started)).rejects.toMatchObject({ code: 'ENOENT' });
      await session.press('enter');
      await vi.waitFor(() => access(started), { timeout: 10_000 });
      await session.press('escape');
      try {
        await vi.waitFor(() => access(aborted), { timeout: 2_000 });
      } catch {
        throw new Error(`Capability request did not cancel. Screen:\n${await session.text({ immediate: true })}`);
      }
      await exitInteractive(session);
    } finally {
      session?.close();
      await session?.waitForExit(5_000);
      await state.cleanup();
    }
  }, 30_000);
});
