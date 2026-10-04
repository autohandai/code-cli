/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { markdownRenderingSample, setMarkdownRendering, submitPromptAndWait } from '../../src/testing/scenarios/markdownRenderingScenario.js';
import {
  createMockAuthServer,
  createMockAutohandAINativeSequenceServer,
  createTempAutohandHome,
  exitInteractive,
  launchBuiltAutohand,
  type MockAuthServer,
  type MockNativeToolServer,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];
const servers: Array<MockNativeToolServer | MockAuthServer> = [];

afterEach(async () => {
  sessions.splice(0).forEach(session => session.close());
  await Promise.all(servers.splice(0).map(server => server.close()));
  await Promise.all(states.splice(0).map(state => state.cleanup()));
});

describe('markdown rendering in the built CLI', () => {
  it.each([60, 120])('renders rich markdown at %i columns and preserves the raw setting', async (columns) => {
    const server = await createMockAutohandAINativeSequenceServer([
      { content: markdownRenderingSample('RENDERED_HEADING') },
      { content: markdownRenderingSample('RAW_HEADING') },
    ]);
    servers.push(server);
    const authServer = await createMockAuthServer();
    servers.push(authServer);
    const state = await createTempAutohandHome({ config: {
      provider: 'autohandai',
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'tuistory-key', model: 'moa', baseUrl: server.baseUrl },
      features: { autohand_inference: true }, agent: { autoMemory: false, sessionRetryLimit: 0 },
      ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
      network: { maxRetries: 0 },
    } });
    states.push(state);

    const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--yes'], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, cols: columns, rows: 50,
      env: { AUTOHAND_AUTH_API_URL: `${authServer.baseUrl}/api/auth` },
    });
    sessions.push(session);
    await session.waitForText('❯');

    await submitPromptAndWait(session, 'show the release notes', 'RENDERED_HEADING');
    let screen = await session.text();
    expect(screen).not.toContain('### RENDERED_HEADING');
    expect(screen).toMatch(/•\s+first `inline_code` item/);
    expect(screen).toMatch(/Area\s+│\s+Status/);
    expect(screen).not.toContain('| --- | --- |');
    expect(screen).toContain('Image: Architecture');
    expect(screen).toContain('https://example.test/docs');
    expect(screen).not.toContain('[docs]:');
    const snapshot = await fs.readFile(new URL('../../src/testing/snapshots/markdown-rich.txt', import.meta.url), 'utf8');
    for (const block of snapshot.trimEnd().split('\n\n')) {
      expect(screen).toContain(block);
    }

    await setMarkdownRendering(session, false);
    await submitPromptAndWait(session, 'show them as written', 'RAW_HEADING');
    screen = await session.text();
    expect(screen).toContain('### RAW_HEADING');
    expect(screen).toContain('- first `inline_code` item');
    expect(screen).toContain('| --- | --- |');

    await exitInteractive(session);
    expect((await fs.readJson(state.configPath)).ui.renderMarkdown).toBe(false);
  }, 90_000);
});
