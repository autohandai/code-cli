import fs from 'fs-extra';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { describeSessionEndHook, openLifecycleHooks } from '../../src/testing/scenarios/lifecycleHooksScenario.js';
import { createTempAutohandHome, createMockAutohandAINativeSequenceServer, launchBuiltAutohand,
  exitInteractive, type TuistoryTempState, type MockNativeToolServer, type MockNativeAssistantTurn } from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];
const servers: MockNativeToolServer[] = [];
afterEach(async () => {
  sessions.splice(0).forEach(session => session.close());
  await Promise.all(servers.splice(0).map(server => server.close()));
  await Promise.all(states.splice(0).map(state => state.cleanup()));
});

const hookDraft = { content: JSON.stringify({
    event: 'session-end', description: 'Record session completion', timeout: 5000, async: false,
    script: "require('node:fs').appendFileSync('lifecycle.log', 'SESSION_END_HOOK_RAN\\n');",
  }) };

async function launch(turns: MockNativeAssistantTurn[] = [hookDraft]) {
  const server = await createMockAutohandAINativeSequenceServer(turns);
  servers.push(server);
  const state = await createTempAutohandHome({ config: {
    provider: 'autohandai',
    autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'tuistory-key', model: 'moa', baseUrl: server.baseUrl },
    features: { autohand_inference: true }, agent: { autoMemory: false, sessionRetryLimit: 0 },
    ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    network: { maxRetries: 0 },
  } });
  states.push(state);
  const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--yes'], {
    autohandHome: state.autohandHome, cwd: state.workspaceRoot, cols: 120, rows: 32,
  });
  sessions.push(session);
  return { session, state, server };
}

describe('lifecycle hooks built CLI', () => {
  it('navigates, creates, reviews, persists and triggers the hook at session end', async () => {
    const { session, state, server } = await launch();
    await describeSessionEndHook(session);
    expect(session.readAll()).toContain('appendFileSync');
    expect(await fs.pathExists(path.join(state.workspaceRoot, 'lifecycle.log'))).toBe(false);
    await session.press('s');
    await session.waitForText('Created session-end hook');
    const config = await fs.readJson(state.configPath);
    expect(config.hooks.hooks).toContainEqual(expect.objectContaining({ event: 'session-end', enabled: true, description: 'Record session completion' }));
    expect(server.requests).toHaveLength(1);
    await session.press('escape');
    await exitInteractive(session);
    expect(await fs.readFile(path.join(state.workspaceRoot, 'lifecycle.log'), 'utf8')).toContain('SESSION_END_HOOK_RAN');
  }, 60_000);

  it('cancels creation and closes the table with Ctrl+C without changing config', async () => {
    const { session, state } = await launch();
    await describeSessionEndHook(session);
    await session.press('escape');
    await session.waitForText('Creation cancelled. No hook installed.');
    expect(await fs.pathExists(path.join(state.autohandHome, 'hooks', 'generated'))).toBe(false);
    await session.press(['ctrl', 'c']);
    await session.waitForText('❯');
    expect(session.exitInfo).toBeNull();
    await openLifecycleHooks(session);
    await session.press('escape');
    await exitInteractive(session);
  }, 60_000);

  it('lets Autohand AI list, author and disable hooks through native tools', async () => {
    const { session, state, server } = await launch([
      { content: 'I will inspect the existing lifecycle hooks before adding the requested automation.', toolCall: { id: 'hooks-list', name: 'list_hooks' } },
      { content: 'The session-end event has one existing config hook. I will add the requested logger without changing it.', toolCall: { id: 'hooks-create', name: 'create_hook', args: { prompt: 'Log completion at session end', event: 'session-end' } } },
      hookDraft,
      { content: 'The new logger was saved at session-end index one. I will disable it now as the user requested.', toolCall: { id: 'hooks-disable', name: 'set_hook_enabled', args: { event: 'session-end', index: 1, enabled: false } } },
      { content: 'LIFECYCLE_TOOLS_COMPLETE' },
    ]);
    await session.waitForText('❯');
    await session.type('Create a lifecycle hook to log session completion, then leave it disabled');
    await session.press('enter');
    await session.waitForText('LIFECYCLE_TOOLS_COMPLETE', { timeout: 30_000 });
    const config = await fs.readJson(state.configPath);
    expect(config.hooks.hooks).toContainEqual(expect.objectContaining({ description: 'Record session completion', enabled: false }));
    expect(server.requests.some(request => JSON.stringify(request.tools).includes('create_hook'))).toBe(true);
    await exitInteractive(session);
    expect(await fs.pathExists(path.join(state.workspaceRoot, 'lifecycle.log'))).toBe(false);
  }, 60_000);
});
