import fs from 'fs-extra';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'tuistory';
import type { HookDefinition } from '../../src/types.js';
import { describeSessionEndHook, openLifecycleHooks, importClaudeHooks, enableImportedHook, submitHookScenarioPrompt } from '../../src/testing/scenarios/lifecycleHooksScenario.js';
import { createTempAutohandHome, createMockAutohandAINativeSequenceServer, createMockAuthServer, launchBuiltAutohand,
  exitInteractive, waitForExit, type TuistoryTempState, type MockAuthServer, type MockNativeToolServer, type MockNativeAssistantTurn } from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];
const servers: MockNativeToolServer[] = [];
const authServers: MockAuthServer[] = [];
afterEach(async () => {
  sessions.splice(0).forEach(session => session.close());
  await Promise.all(servers.splice(0).map(server => server.close()));
  await Promise.all(authServers.splice(0).map(server => server.close()));
  await Promise.all(states.splice(0).map(state => state.cleanup()));
});

const hookDraft = { content: JSON.stringify({
    event: 'session-end', description: 'Record session completion', timeout: 5000, async: false,
    script: "require('node:fs').appendFileSync('lifecycle.log', 'SESSION_END_HOOK_RAN\\n');",
  }) };

async function launch(turns: MockNativeAssistantTurn[] = [hookDraft], hooks: HookDefinition[] = [], prepare?: (state: TuistoryTempState) => Promise<void>) {
  const server = await createMockAutohandAINativeSequenceServer(turns);
  servers.push(server);
  const state = await createTempAutohandHome({ config: {
    hooks: { hooks },
    provider: 'autohandai',
    autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'tuistory-key', model: 'moa', baseUrl: server.baseUrl },
    features: { autohand_inference: true }, agent: { autoMemory: false, sessionRetryLimit: 0 },
    ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    network: { maxRetries: 0 },
  } });
  states.push(state);
  await prepare?.(state);
  const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--yes'], {
    env: { CLAUDE_CONFIG_DIR: path.join(state.workspaceRoot, 'source-home') },
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


describe('imported hooks in the built CLI', () => {
  it('imports project hooks, enables them in the current session, blocks a prompt and recovers', async () => {
    const { session, state, server } = await launch([{ content: 'ALLOWED_PROMPT_COMPLETE' }], [], async state => {
      await fs.outputJson(path.join(state.workspaceRoot, '.claude/settings.json'), { hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node .claude/prompt.cjs' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'echo unsupported' }] }],
      } });
      await fs.outputFile(path.join(state.workspaceRoot, '.claude/prompt.cjs'), `let input=''; process.stdin.on('data', c => input += c); process.stdin.on('end', () => {
        const value = JSON.parse(input);
        if (value.prompt.includes('denied request')) console.log(JSON.stringify({decision:'block',reason:'IMPORTED_PROMPT_BLOCKED'}));
      });`);
    });
    await importClaudeHooks(session);
    expect(session.readAll()).toContain('Stop: no equivalent');
    const saved = await fs.readJson(state.configPath);
    const index = saved.hooks.hooks.findIndex((hook: HookDefinition) => hook.importedFrom?.source === 'claude');
    expect(index).toBeGreaterThanOrEqual(0);
    expect(saved.hooks.hooks[index].enabled).toBe(false);
    expect(server.requests).toHaveLength(0);
    await enableImportedHook(session, index);
    await submitHookScenarioPrompt(session, 'denied request', 'IMPORTED_PROMPT_BLOCKED');
    expect(server.requests).toHaveLength(0);
    await submitHookScenarioPrompt(session, 'tell me hello', 'ALLOWED_PROMPT_COMPLETE');
    expect(server.requests).toHaveLength(1);
    await exitInteractive(session);
  }, 90_000);

  it('runs the learn guard before analysis without calling the model', async () => {
    const { session, server } = await launch([], [{ event: 'pre-learn', command: `printf '%s' '{"decision":"block","reason":"LEARN_GUARD_BLOCKED"}'` }]);
    await session.waitForText('❯');
    await submitHookScenarioPrompt(session, '/learn', 'LEARN_GUARD_BLOCKED');
    expect(server.requests).toHaveLength(0);
    await exitInteractive(session);
  }, 60_000);
});


describe('prompt hook cancellation', () => {
  it('cancels a running hook with Escape and accepts the next prompt', async () => {
    const { session, state, server } = await launch([{ content: 'HOOK_CANCEL_RECOVERED' }], [{ event: 'pre-prompt', command: 'node prompt-wait.cjs && echo HOOK_SHELL_FINISHED', timeout: 30_000 }], async state => {
      await fs.writeFile(path.join(state.workspaceRoot, 'prompt-wait.cjs'), `let input=''; process.stdin.on('data', c => input += c); process.stdin.on('end', () => {
        if (JSON.parse(input).instruction === 'wait for hook') {
          require('fs').writeFileSync('hook-started.txt', 'started');
          setTimeout(() => {}, 20000);
        }
      });`);
    });
    await session.waitForText('❯');
    await session.type('wait for hook');
    await session.press('enter');
    await vi.waitFor(async () => expect(await fs.pathExists(path.join(state.workspaceRoot, 'hook-started.txt'))).toBe(true));
    await session.press('escape');
    await submitHookScenarioPrompt(session, 'tell me hello', 'HOOK_CANCEL_RECOVERED');
    expect(server.requests).toHaveLength(1);
    await exitInteractive(session);
  }, 45_000);
});



describe('project lifecycle hooks in the built CLI', () => {
  const TRUST_PROMPT = 'This workspace wants to run commands';

  async function createProject(turns: MockNativeAssistantTurn[]) {
    const server = await createMockAutohandAINativeSequenceServer(turns);
    servers.push(server);
    // Startup validates the saved account token; a mock keeps it valid across relaunches.
    const authServer = await createMockAuthServer();
    authServers.push(authServer);
    const state = await createTempAutohandHome({ config: {
      hooks: { hooks: [] },
      provider: 'autohandai',
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'tuistory-key', model: 'moa', baseUrl: server.baseUrl },
      features: { autohand_inference: true }, agent: { autoMemory: false, sessionRetryLimit: 0 },
      ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
      network: { maxRetries: 0 },
    } });
    states.push(state);
    await fs.writeFile(path.join(state.workspaceRoot, 'record-hook.cjs'),
      "require('node:fs').appendFileSync('project-hooks.log', process.argv[2] + '\\n');");
    await writeProjectConfigHook(state, 'PROJECT_CONFIG_HOOK');
    await fs.outputJson(path.join(state.workspaceRoot, '.autohand', 'settings.local.json'), {
      version: 1,
      hooks: { 'pre-prompt': ['node record-hook.cjs LOCAL_SETTINGS_HOOK'] },
    });
    return { server, state, authServer };
  }

  async function writeProjectConfigHook(state: TuistoryTempState, marker: string) {
    await fs.outputJson(path.join(state.workspaceRoot, '.autohand', 'config.json'), {
      hooks: { hooks: [{ event: 'pre-prompt', command: `node record-hook.cjs ${marker}`, description: 'Project config prompt hook' }] },
    });
  }

  async function launchFromOutside(state: TuistoryTempState, authServer: MockAuthServer, extraArgs: string[] = []) {
    // Launch from the parent directory so project files must come from --path.
    const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--yes', ...extraArgs], {
      autohandHome: state.autohandHome, cwd: path.dirname(state.workspaceRoot), cols: 120, rows: 40,
      env: { AUTOHAND_AUTH_API_URL: `${authServer.baseUrl}/api/auth` },
    });
    sessions.push(session);
    return session;
  }

  const readHookLog = (state: TuistoryTempState) =>
    fs.readFile(path.join(state.workspaceRoot, 'project-hooks.log'), 'utf8').catch(() => '');
  const trustStorePath = (state: TuistoryTempState) => path.join(state.autohandHome, 'trusted-workspaces.json');

  it('asks before running project hooks, runs them once trusted, and asks again only after they change', async () => {
    const { state, authServer } = await createProject([{ content: 'PROJECT_HOOKS_PROMPT_COMPLETE' }, { content: 'TRUSTED_AGAIN_COMPLETE' }]);

    let session = await launchFromOutside(state, authServer);
    await session.waitForText(TRUST_PROMPT);
    expect(session.readAll()).toContain('node record-hook.cjs PROJECT_CONFIG_HOOK');
    expect(session.readAll()).toContain('node record-hook.cjs LOCAL_SETTINGS_HOOK');
    expect(session.readAll()).toContain('Trust this workspace');
    expect(await readHookLog(state)).toBe('');
    await session.press('enter');
    await session.waitForText('❯');
    await submitHookScenarioPrompt(session, 'run the project hooks', 'PROJECT_HOOKS_PROMPT_COMPLETE');
    expect(await readHookLog(state)).toContain('PROJECT_CONFIG_HOOK');
    expect(await readHookLog(state)).toContain('LOCAL_SETTINGS_HOOK');
    await exitInteractive(session);

    const saved = await fs.readJson(state.configPath);
    expect(JSON.stringify(saved)).not.toMatch(/PROJECT_CONFIG_HOOK|LOCAL_SETTINGS_HOOK|workspaceOverlay|workspaceTrust/);
    const store = await fs.readJson(trustStorePath(state));
    expect(Object.keys(store.workspaces)).toContain(await fs.realpath(state.workspaceRoot));

    session = await launchFromOutside(state, authServer);
    await session.waitForText('❯');
    expect(session.readAll()).not.toContain(TRUST_PROMPT);
    await submitHookScenarioPrompt(session, 'run the trusted hooks again', 'TRUSTED_AGAIN_COMPLETE');
    await exitInteractive(session);

    await writeProjectConfigHook(state, 'CHANGED_PROJECT_HOOK');
    session = await launchFromOutside(state, authServer);
    await session.waitForText(TRUST_PROMPT);
    expect(session.readAll()).toContain('node record-hook.cjs CHANGED_PROJECT_HOOK');
    await session.press('escape');
    await session.waitForText('❯');
    await exitInteractive(session);
  }, 120_000);

  it('starts without project hooks when the prompt is declined with Escape or Ctrl+C, and asks again next launch', async () => {
    const { state, authServer } = await createProject([{ content: 'UNTRUSTED_PROMPT_COMPLETE' }]);

    let session = await launchFromOutside(state, authServer);
    await session.waitForText(TRUST_PROMPT);
    await session.press('escape');
    await session.waitForText('Autohand will ask again next time');
    await session.waitForText('❯');
    await submitHookScenarioPrompt(session, 'run without project hooks', 'UNTRUSTED_PROMPT_COMPLETE');
    expect(await readHookLog(state)).toBe('');
    await exitInteractive(session);
    expect(await fs.pathExists(trustStorePath(state))).toBe(false);

    session = await launchFromOutside(state, authServer);
    await session.waitForText(TRUST_PROMPT);
    await session.press(['ctrl', 'c']);
    await session.waitForText('Autohand will ask again next time');
    await session.waitForText('❯');
    expect(session.exitInfo).toBeNull();
    await exitInteractive(session);
    expect(await readHookLog(state)).toBe('');
  }, 90_000);

  it('skips untrusted project hooks with a warning in command mode', async () => {
    const { state, authServer } = await createProject([{ content: 'COMMAND_MODE_COMPLETE' }]);

    const session = await launchFromOutside(state, authServer, ['-p', 'run in command mode']);
    await waitForExit(session, 60_000);
    const output = session.readAll();

    expect(session.exitInfo?.exitCode, output).toBe(0);
    expect(output).toContain('Skipped 2 project hooks from');
    expect(output).toContain('not trusted');
    expect(output).toContain('COMMAND_MODE_COMPLETE');
    expect(output).not.toContain(TRUST_PROMPT);
    expect(await readHookLog(state)).toBe('');
  }, 90_000);
});
