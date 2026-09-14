/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import fs from 'fs-extra';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import stripAnsi from 'strip-ansi';
import packageJson from '../../package.json' with { type: 'json' };
import { createStalledGitVersionPreload } from '../../src/testing/scenarios/gitVersionScenario.js';
import {
  createMockAutohandAINativeSequenceServer,
  createMockAutohandAINativeToolServer,
  createMockAutohandAIQuotaServer,
  createFailingOpenRouterFetchPreload,
  createMockOpenRouterFetchPreload,
  createMockOpenRouterSequenceServer,
  createMockSkillInstallFetchPreload,
  createMockSubAgentCatalogFetchPreload,
  createTempAutohandHome,
  exitInteractive,
  expectCleanExit,
  launchBuiltAutohand,
  waitForExit,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';
import {
  latestStableRepositoryVersion,
  mockOpenRouterFetchPreloads,
  mockServers,
  registerBuiltCliCleanup,
  tempStates,
  trackSession,
  typeLikeUser,
} from './helpers/builtCli.js';

registerBuiltCliCleanup();

describe('built CLI Tuistory smoke tests', () => {
  it('keeps a prior-session goal dormant when a fresh MOA session starts with an acknowledgement', async () => {
    const nativeToolServer = await createMockAutohandAINativeSequenceServer([
      {
        content: 'Checking whether an old goal should drive this turn.',
        toolCall: {
          id: 'call_get_goal',
          name: 'get_goal',
        },
      },
      { content: 'FRESH_SESSION_ACKNOWLEDGED' },
    ]);
    mockServers.push(nativeToolServer);
    const state = await createTempAutohandHome({
      config: {
        provider: 'autohandai',
        autohandai: {
          plan: 'cloud',
          authMode: 'api-key',
          apiKey: 'tuistory-autohand-api-key',
          model: 'moa',
          baseUrl: nativeToolServer.baseUrl,
        },
        features: { autohand_inference: true, slashGoal: true },
        agent: { autoMemory: false, maxIterations: 4, sessionRetryLimit: 0 },
        network: { maxRetries: 0, retryDelay: 0 },
        ui: {
          promptSuggestions: false,
          showCompletionNotification: false,
          terminalBell: false,
        },
      },
    });
    tempStates.push(state);

    const staleGoalPath = path.join(state.workspaceRoot, '.autohand', 'goals.local.json');
    const staleUpdatedAt = Date.parse('2026-06-01T00:00:00.000Z');
    await fs.outputJson(staleGoalPath, {
      version: 1,
      goal: {
        goalId: 'prior-session-goal',
        objective: 'WRITE_THE_OLD_JUNE_IMPROVEMENT_REPORT',
        status: 'active',
        tokensUsed: 27_424_831,
        timeUsedSeconds: 5_270_977,
        createdAt: staleUpdatedAt,
        updatedAt: staleUpdatedAt,
      },
      queue: [],
      completed: [],
      updatedAt: staleUpdatedAt,
    });

    const session = await trackSession(launchBuiltAutohand([
      '--path', state.workspaceRoot,
      '--config', state.configPath,
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      waitForDataTimeout: 15_000,
    }));

    await session.waitForText('❯', { timeout: 20_000 });
    await session.type('ok');
    await session.press('enter');
    await session.waitForText('FRESH_SESSION_ACKNOWLEDGED', { timeout: 20_000 });

    const continuationMessages = nativeToolServer.requests[1]?.messages as Array<{
      role?: string;
      content?: string;
      tool_call_id?: string;
    }>;
    const goalResult = continuationMessages.find((message) => (
      message.role === 'tool' && message.tool_call_id === 'call_get_goal'
    ));
    expect(goalResult?.content).toContain('not attached to the current session');
    expect(goalResult?.content).not.toContain('WRITE_THE_OLD_JUNE_IMPROVEMENT_REPORT');

    const persisted = await fs.readJson(staleGoalPath) as {
      goal: { tokensUsed: number; timeUsedSeconds: number; updatedAt: number };
    };
    expect(persisted.goal).toMatchObject({
      tokensUsed: 27_424_831,
      timeUsedSeconds: 5_270_977,
      updatedAt: staleUpdatedAt,
    });

    await exitInteractive(session);
  }, 45_000);

  it('round-trips one native Moa tool result without repeating the call', async () => {
    const nativeToolServer = await createMockAutohandAINativeToolServer();
    mockServers.push(nativeToolServer);
    const state = await createTempAutohandHome({
      config: {
        provider: 'autohandai',
        autohandai: {
          plan: 'cloud',
          authMode: 'api-key',
          apiKey: 'tuistory-autohand-api-key',
          model: 'moa',
          baseUrl: nativeToolServer.baseUrl,
        },
        features: { autohand_inference: true },
        agent: { maxIterations: 4, sessionRetryLimit: 0 },
        network: { maxRetries: 0, retryDelay: 0 },
      },
    });
    tempStates.push(state);

    const session = await trackSession(launchBuiltAutohand([
      '--path', state.workspaceRoot,
      '--config', state.configPath,
      '--prompt', 'Read package.json exactly once and report its package name.',
      '--y',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      waitForDataTimeout: 15_000,
    }));

    await waitForExit(session, 30_000);
    const output = session.readAll();
    expect(output).toContain('MOA_NATIVE_TOOL_HISTORY_OK');
    expect(output).not.toContain('I stopped repeated tool calls');
    expect(nativeToolServer.requests).toHaveLength(2);

    const firstTools = nativeToolServer.requests[0]?.tools as Array<{
      function?: { name?: string };
    }>;
    expect(firstTools.some((tool) => tool.function?.name === 'read_file')).toBe(true);

    const continuationMessages = nativeToolServer.requests[1]?.messages as Array<{
      role?: string;
      content?: string;
      tool_call_id?: string;
      tool_calls?: Array<{ id?: string }>;
    }>;
    expect(continuationMessages).toContainEqual(expect.objectContaining({
      role: 'assistant',
      tool_calls: [expect.objectContaining({ id: 'call_read_package' })],
    }));
    expect(continuationMessages).toContainEqual(expect.objectContaining({
      role: 'tool',
      tool_call_id: 'call_read_package',
      content: expect.stringContaining('tuistory-workspace'),
    }));
    expectCleanExit(session);
  }, 45_000);

  it('validates a command-mode answer against --output-schema, repairing once and failing with the violations', async () => {
    const autohandConfig = (baseUrl: string) => ({
      provider: 'autohandai',
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'tuistory-autohand-api-key', model: 'moa', baseUrl },
      features: { autohand_inference: true },
      agent: { maxIterations: 2, sessionRetryLimit: 0, autoMemory: false },
      network: { maxRetries: 0, retryDelay: 0 },
      ui: { promptSuggestions: false, showCompletionNotification: false },
    });
    const repairedServer = await createMockAutohandAINativeSequenceServer([
      { content: 'The workspace has two files.' },
      { content: '{"files": 2, "summary": "two files"}' },
    ]);
    mockServers.push(repairedServer);
    const state = await createTempAutohandHome({ config: autohandConfig(repairedServer.baseUrl) });
    tempStates.push(state);
    const schemaPath = path.join(state.workspaceRoot, 'answer.schema.json');
    await writeFile(schemaPath, JSON.stringify({ type: 'object', required: ['files'], properties: { files: { type: 'integer' }, summary: { type: 'string' } } }));

    const session = await trackSession(launchBuiltAutohand([
      '--path', state.workspaceRoot, '--config', state.configPath, '--prompt', 'Count the files.', '--output-schema', schemaPath, '--json', 'local', '--y',
    ], { autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 15_000 }));
    await waitForExit(session, 45_000);
    const result = JSON.parse(stripAnsi(session.readAll()).split('\n').filter((line) => line.startsWith('{')).at(-1) ?? '{}');
    expect(result.type).toBe('result');
    expect(JSON.parse(result.content)).toEqual({ files: 2, summary: 'two files' });
    // Side requests (naming, suggestions) may interleave; the repair turn is the one carrying the violations.
    const repairRequests = repairedServer.requests.filter((request) => JSON.stringify(request.messages).includes('the final response contained no JSON document'));
    expect(repairRequests).toHaveLength(1);
    expect(repairedServer.requests.length).toBeGreaterThanOrEqual(2);
    expect(session.exitInfo?.exitCode).toBe(0);

    const stubbornServer = await createMockAutohandAINativeSequenceServer([{ content: 'I cannot produce JSON right now.' }]);
    mockServers.push(stubbornServer);
    const failing = await createTempAutohandHome({ config: autohandConfig(stubbornServer.baseUrl) });
    tempStates.push(failing);
    const failure = await trackSession(launchBuiltAutohand([
      '--path', failing.workspaceRoot, '--config', failing.configPath, '--prompt', 'Count the files.', '--output-schema', schemaPath, '--json', 'local', '--y',
    ], { autohandHome: failing.autohandHome, cwd: failing.workspaceRoot, waitForDataTimeout: 15_000 }));
    await waitForExit(failure, 45_000);
    const error = JSON.parse(stripAnsi(failure.readAll()).split('\n').filter((line) => line.startsWith('{')).at(-1) ?? '{}');
    expect(error.type).toBe('error');
    expect(error.message).toContain('did not match the output schema');
    expect(error.message).toContain('contained no JSON document');
    expect(failure.exitInfo?.exitCode).toBe(1);
  }, 120_000);

  it('leaves no session behind after an --ephemeral command-mode run', async () => {
    const nativeServer = await createMockAutohandAINativeSequenceServer([{ content: 'EPHEMERAL_OK' }]);
    mockServers.push(nativeServer);
    const state = await createTempAutohandHome({
      config: {
        provider: 'autohandai',
        autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'tuistory-autohand-api-key', model: 'moa', baseUrl: nativeServer.baseUrl },
        features: { autohand_inference: true },
        agent: { maxIterations: 2, sessionRetryLimit: 0 },
        network: { maxRetries: 0, retryDelay: 0 },
      },
    });
    tempStates.push(state);
    const sessionsDir = path.join(state.autohandHome, 'sessions');

    const session = await trackSession(launchBuiltAutohand([
      '--path', state.workspaceRoot, '--config', state.configPath, '--prompt', 'Say EPHEMERAL_OK.', '--ephemeral', '--y',
    ], { autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 15_000 }));
    await waitForExit(session, 30_000);
    expect(session.readAll()).toContain('EPHEMERAL_OK');
    expectCleanExit(session);

    const indexPath = path.join(sessionsDir, 'index.json');
    if (existsSync(indexPath)) {
      expect((await fs.readJson(indexPath)).sessions).toEqual([]);
    }
    const sessionDirs = existsSync(sessionsDir)
      ? (await fs.readdir(sessionsDir)).filter((entry) => existsSync(path.join(sessionsDir, entry, 'metadata.json')))
      : [];
    expect(sessionDirs).toEqual([]);

    const refused = await trackSession(launchBuiltAutohand([
      '--path', state.workspaceRoot, '--config', state.configPath, '--ephemeral', '--fork', 'anything',
    ], { autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 15_000 }));
    await waitForExit(refused, 15_000);
    expect(refused.readAll()).toContain('--ephemeral cannot be combined with --resume or --fork');
    expect(refused.exitInfo?.exitCode).toBe(1);
  }, 60_000);

  it('withholds --disallowed-tools from the advertised tool schemas', async () => {
    const nativeServer = await createMockAutohandAINativeSequenceServer([{ content: 'TOOL_SCOPE_OK' }]);
    mockServers.push(nativeServer);
    const state = await createTempAutohandHome({
      config: {
        provider: 'autohandai',
        autohandai: {
          plan: 'cloud',
          authMode: 'api-key',
          apiKey: 'tuistory-autohand-api-key',
          model: 'moa',
          baseUrl: nativeServer.baseUrl,
        },
        features: { autohand_inference: true },
        agent: { maxIterations: 2, sessionRetryLimit: 0, autoMemory: false },
        network: { maxRetries: 0, retryDelay: 0 },
      },
    });
    tempStates.push(state);

    const session = await trackSession(launchBuiltAutohand([
      '--path', state.workspaceRoot,
      '--config', state.configPath,
      '--prompt', 'Say TOOL_SCOPE_OK.',
      '--disallowed-tools', 'delete_path,write_file',
      '--disallowed-tools', 'run_command',
      '--y',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      waitForDataTimeout: 15_000,
    }));

    await waitForExit(session, 30_000);
    expect(session.readAll()).toContain('TOOL_SCOPE_OK');
    expect(nativeServer.requests.length).toBeGreaterThanOrEqual(1);
    const advertised = (nativeServer.requests[0]?.tools as Array<{ function?: { name?: string } }>).map((tool) => tool.function?.name);
    expect(advertised).toContain('read_file');
    expect(advertised).not.toContain('delete_path');
    expect(advertised).not.toContain('write_file');
    expect(advertised).not.toContain('run_command');
    expectCleanExit(session);
  }, 45_000);

  it('recommends upgrading when an Autohand AI request quota is exhausted', async () => {
    const quotaServer = await createMockAutohandAIQuotaServer();
    mockServers.push(quotaServer);
    const state = await createTempAutohandHome({
      config: {
        provider: 'autohandai',
        autohandai: {
          plan: 'cloud',
          authMode: 'api-key',
          apiKey: 'tuistory-autohand-api-key',
          model: 'fantail',
          baseUrl: quotaServer.baseUrl,
        },
        features: { autohand_inference: true },
        network: { maxRetries: 0, retryDelay: 0 },
      },
    });
    tempStates.push(state);
    const session = await trackSession(launchBuiltAutohand([
      '--path', state.workspaceRoot,
      '--config', state.configPath,
      '--offline',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      env: { TZ: 'Pacific/Auckland' },
      waitForDataTimeout: 15_000,
    }));

    await session.waitForText('❯', { timeout: 15_000 });
    await typeLikeUser(session, 'hey');
    await session.press('enter');
    await session.waitForText('Upgrade your Autohand Code plan for more usage', { timeout: 20_000 });
    const output = session.readAll();

    expect(output).toContain('Autohand AI 24-hour request quota reached.');
    expect(output).toContain("You've used all your requests in this 24-hour window.");
    expect(output).toContain('(Pacific/Auckland) · in 2h 30m.');
    expect(output).toContain(
      'Upgrade your Autohand Code plan for more usage: https://console.autohand.ai/upgrade/?from=cli&tier=pro',
    );
    expect(output).not.toContain('Please wait a moment and try again');
    expect(output.match(/Autohand AI 24-hour request quota reached\./gu)).toHaveLength(1);
    await exitInteractive(session);
  });

  it('stops a command-mode run at --max-requests before the next model request', async () => {
    const nativeServer = await createMockAutohandAINativeSequenceServer([
      { content: '', toolCall: { id: 'call_tree', name: 'list_tree', args: { path: '.' } } },
      { content: 'BUDGET_SHOULD_NOT_REACH_THIS' },
    ]);
    mockServers.push(nativeServer);
    const state = await createTempAutohandHome({
      config: {
        provider: 'autohandai',
        autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'tuistory-autohand-api-key', model: 'moa', baseUrl: nativeServer.baseUrl },
        features: { autohand_inference: true },
        agent: { maxIterations: 4, sessionRetryLimit: 0, autoMemory: false },
        network: { maxRetries: 0, retryDelay: 0 },
        ui: { promptSuggestions: false, showCompletionNotification: false },
      },
    });
    tempStates.push(state);
    const session = await trackSession(launchBuiltAutohand([
      '--path', state.workspaceRoot, '--config', state.configPath, '--prompt', 'List the tree, then summarize.', '--max-requests', '1', '--json', 'local', '--y',
    ], { autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 15_000 }));
    await waitForExit(session, 45_000);
    const output = stripAnsi(session.readAll());
    const last = JSON.parse(output.split('\n').filter((line) => line.startsWith('{')).at(-1) ?? '{}');
    expect(last.type).toBe('error');
    expect(last.message).toContain('Run budget exhausted: 1 of 1 model requests used');
    expect(output).not.toContain('BUDGET_SHOULD_NOT_REACH_THIS');
    expect(nativeServer.requests).toHaveLength(1);
    expect(session.exitInfo?.exitCode).toBe(1);
  }, 60_000);

  it('renders help from the built dist entrypoint', async () => {
    const session = await trackSession(launchBuiltAutohand(['--help'], {
      waitForDataTimeout: 15_000,
    }));

    await session.waitForText('Usage', { timeout: 10_000 });
    const output = session.readAll();

    expect(output).toContain('Usage');
    expect(output).toContain('--prompt');
    expect(output).toContain('--mode');
    expect(output).toContain('--browser');
    expect(output).toContain('--no-browser');
    expect(output).not.toContain('--chrome');
    expect(output).not.toContain('--no-chrome');
    expect(output).toMatch(/\bbrowser\b/u);
    expect(output).not.toMatch(/^\s+chrome\s/mu);
    expect(output).toContain('--help');
    expect(output).toContain('--version');

    await waitForExit(session);
    expectCleanExit(session);
  });

  it('documents the model-only update flow from the built CLI', async () => {
    const session = await trackSession(launchBuiltAutohand(['update', '--help'], {
      waitForDataTimeout: 15_000,
    }));

    await session.waitForText('--models', { timeout: 10_000 });
    const output = session.readAll();

    expect(output).toContain('--models');
    expect(output).toContain('model catalog');

    await waitForExit(session);
    expectCleanExit(session);
  });

  it('documents offline model-catalog behavior for resumed sessions', async () => {
    const session = await trackSession(launchBuiltAutohand(['resume', '--help'], {
      waitForDataTimeout: 15_000,
    }));

    await session.waitForText('--offline', { timeout: 10_000 });
    const output = session.readAll();

    expect(output).toContain('--offline');
    expect(output).toContain('model catalog');

    await waitForExit(session);
    expectCleanExit(session);
  });

  it('renders version from the built dist entrypoint', async () => {
    const session = await trackSession(launchBuiltAutohand(['--version'], {
      waitForDataTimeout: 15_000,
    }));

    await session.waitForText(packageJson.version, { timeout: 10_000 });
    const output = session.readAll();

    expect(output).toContain(packageJson.version);
    expect(output).toMatch(/\d+\.\d+\.\d+ \((?:[0-9a-f]{7,40}|unknown)\)/);

    await waitForExit(session);
    expectCleanExit(session);
  });

  it('starts when a user catalog has an incomplete Fantail override', async () => {
    const state = await createTempAutohandHome();
    tempStates.push(state);
    await writeFile(
      path.join(state.autohandHome, 'models.json'),
      JSON.stringify({
        providers: {
          autohandai: {
            defaultModel: 'fantail',
            models: ['fantail'],
          },
        },
      }),
    );
    const session = await trackSession(launchBuiltAutohand(['--version'], {
      autohandHome: state.autohandHome,
      waitForDataTimeout: 15_000,
    }));

    await session.waitForText(packageJson.version, { timeout: 10_000 });
    const output = session.readAll();

    expect(output).not.toContain('missing contextWindow');
    await waitForExit(session);
    expectCleanExit(session);
  });

  it('renders the packaged version when the Git metadata subprocess stalls', async () => {
    const state = await createTempAutohandHome({ initializeGit: false });
    tempStates.push(state);
    const session = await trackSession(launchBuiltAutohand(['--version'], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      env: {
        NODE_OPTIONS: await createStalledGitVersionPreload(state.autohandHome),
        AUTOHAND_VERSION_SOURCE: 'git',
      },
      waitForDataTimeout: 15_000,
    }));

    await waitForExit(session, 15_000);
    const output = session.readAll();
    expect(output).toContain(`${packageJson.version} (`);
    expect(output).not.toContain('999.0.0');
    expectCleanExit(session);
  });

  it('renders the latest stable repository tag when development versioning is enabled', async () => {
    const expectedVersion = latestStableRepositoryVersion();
    const session = await trackSession(launchBuiltAutohand(['--version'], {
      env: { AUTOHAND_VERSION_SOURCE: 'git' },
      waitForDataTimeout: 15_000,
    }));

    await session.waitForText(expectedVersion, { timeout: 10_000 });
    const output = session.readAll();

    expect(output).toContain(`${expectedVersion} (`);
    expect(output).toMatch(/\d+\.\d+\.\d+ \((?:[0-9a-f]{7,40}|unknown)\)/);

    await waitForExit(session);
    expectCleanExit(session);
  });

  it('returns truthful process statuses for built command-mode turns', async () => {
    const commandConfig = {
      agent: {
        sessionRetryLimit: 0,
        sessionRetryDelay: 0,
      },
      network: {
        maxRetries: 0,
        retryDelay: 0,
      },
      openrouter: {
        baseUrl: 'https://mock.openrouter.test/api/v1',
      },
    };
    const failedState = await createTempAutohandHome({ config: commandConfig });
    const successfulState = await createTempAutohandHome({ config: commandConfig });
    tempStates.push(failedState, successfulState);

    const failingPreload = await createFailingOpenRouterFetchPreload();
    const successfulPreload = await createMockOpenRouterFetchPreload(
      'Deterministic command success.',
    );
    mockOpenRouterFetchPreloads.push(failingPreload, successfulPreload);

    const launchCommand = async (
      state: TuistoryTempState,
      importSpecifier: string,
    ): Promise<Session> => trackSession(
      launchBuiltAutohand([
        '--path',
        state.workspaceRoot,
        '--config',
        state.configPath,
        '--prompt',
        'Run the deterministic command-mode test.',
      ], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        env: {
          NODE_OPTIONS: [
            process.env.NODE_OPTIONS,
            `--import=${importSpecifier}`,
          ].filter(Boolean).join(' '),
        },
        waitForDataTimeout: 15_000,
      })
    );

    const failedSession = await launchCommand(failedState, failingPreload.importSpecifier);
    await waitForExit(failedSession, 15_000);
    expect(failedSession.exitInfo?.exitCode).toBe(1);
    expect(failedSession.readAll()).not.toContain('Deterministic command success.');

    const successfulSession = await launchCommand(successfulState, successfulPreload.importSpecifier);
    await successfulSession.waitForText('Deterministic command success.', { timeout: 15_000 });
    await waitForExit(successfulSession, 15_000);
    expect(successfulSession.exitInfo?.exitCode).toBe(0);
  });

  it('does not publish a patch after a built command-mode failure', async () => {
    const state = await createTempAutohandHome({
      config: {
        agent: { sessionRetryLimit: 0, sessionRetryDelay: 0 },
        network: { maxRetries: 0, retryDelay: 0 },
        openrouter: { baseUrl: 'https://mock.openrouter.test/api/v1' },
      },
    });
    tempStates.push(state);
    const failingPreload = await createFailingOpenRouterFetchPreload();
    mockOpenRouterFetchPreloads.push(failingPreload);

    const session = await trackSession(launchBuiltAutohand([
      '--path',
      state.workspaceRoot,
      '--config',
      state.configPath,
      '--prompt',
      'Run the deterministic patch-mode test.',
      '--patch',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      env: {
        NODE_OPTIONS: [
          process.env.NODE_OPTIONS,
          `--import=${failingPreload.importSpecifier}`,
        ].filter(Boolean).join(' '),
      },
      waitForDataTimeout: 15_000,
    }));

    await waitForExit(session, 15_000);
    expect(session.exitInfo?.exitCode).toBe(1);
    expect(session.readAll()).not.toMatch(/^diff --git /m);
  });

  it('installs a catalog sub-agent and delegates to it in the same built prompt turn', async () => {
    const openRouterServer = await createMockOpenRouterSequenceServer([
      JSON.stringify({
        thought: 'Find a catalog UI specialist first.',
        toolCalls: [{ tool: 'find_sub_agents', args: { query: 'accessible UI' } }],
      }),
      JSON.stringify({
        reflection: 'The catalog result identifies ui-designer as the exact accessible UI match.',
        thought: 'Install the exact matching specialist.',
        toolCalls: [{ tool: 'install_sub_agent', args: { name: 'ui-designer' } }],
      }),
      JSON.stringify({
        reflection: 'The install result confirms ui-designer is available in the current registry.',
        thought: 'Delegate the UI review to the newly installed specialist.',
        toolCalls: [{
          tool: 'delegate_task',
          args: { agent_name: 'ui-designer', task: 'Review the UI accessibility approach.' },
        }],
      }),
      JSON.stringify({
        finalResponse: 'UI_AGENT_OK',
        toolCalls: [],
      }),
      JSON.stringify({
        finalResponse: 'Catalog delegation verified: UI_AGENT_OK',
        toolCalls: [],
      }),
    ]);
    mockServers.push(openRouterServer);
    const catalogPreload = await createMockSubAgentCatalogFetchPreload();
    mockOpenRouterFetchPreloads.push(catalogPreload);
    const state = await createTempAutohandHome({
      config: {
        openrouter: { baseUrl: openRouterServer.baseUrl },
        agent: { maxIterations: 8, sessionRetryLimit: 0 },
        features: { automaticSpecialists: false },
      },
    });
    tempStates.push(state);
    const nodeOptions = [
      process.env.NODE_OPTIONS,
      `--import ${catalogPreload.importSpecifier}`,
    ].filter(Boolean).join(' ');
    const session = await trackSession(launchBuiltAutohand([
      '--path', state.workspaceRoot,
      '--config', state.configPath,
      '-p', 'bring in an accessible UI specialist and delegate a review',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      env: { NODE_OPTIONS: nodeOptions },
      waitForDataTimeout: 15_000,
    }));

    await session.waitForText('Install sub-agent from the default Autohand catalog?', { timeout: 20_000 });
    await session.press('enter');
    await waitForExit(session, 60_000);

    const output = session.readAll();
    expect(session.exitInfo?.exitCode, output).toBe(0);
    expect(output).toContain('Installing sub-agent: ui-designer');
    expect(output).toContain('Installed sub-agent ui-designer');
    expect(output).toContain("Sub-agent 'ui-designer' starting task");
    expect(output).toContain('Catalog delegation verified: UI_AGENT_OK');

    const installedAgentPath = path.join(state.autohandHome, 'agents', 'ui-designer.md');
    expect(await readFile(installedAgentPath, 'utf8')).toContain('Own UI implementation');
  }, 90_000);

  it('opens the active agents dashboard and exits with Escape', async () => {
    const state = await createTempAutohandHome({ initializeGit: false });
    tempStates.push(state);
    const session = await trackSession(launchBuiltAutohand(['agents'], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      waitForDataTimeout: 15_000,
    }));

    await session.waitForText('No active Autohand agents found.', { timeout: 10_000 });
    await session.press('escape');

    await waitForExit(session);
    expectCleanExit(session);
  });

  it('installs a direct skill from Skilled when the primary CLI registry misses', async () => {
    const state = await createTempAutohandHome();
    tempStates.push(state);
    const preload = await createMockSkillInstallFetchPreload();
    mockOpenRouterFetchPreloads.push(preload);

    const nodeOptions = [
      process.env.NODE_OPTIONS,
      `--import ${preload.importSpecifier}`,
    ].filter(Boolean).join(' ');
    const session = await trackSession(
      launchBuiltAutohand([
        '--path',
        state.workspaceRoot,
        '--config',
        state.configPath,
        '--skill-install',
        'dotnet-aspnetcore',
      ], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        env: {
          NODE_OPTIONS: nodeOptions,
        },
        waitForDataTimeout: 15_000,
      })
    );

    await session.waitForText('Install location', { timeout: 10_000 });
    await session.press('enter');
    await session.waitForText('Validating source files', { timeout: 10_000 });
    await session.waitForText('Installing validated files', { timeout: 10_000 });
    await session.waitForText('Installed dotnet-aspnetcore', { timeout: 10_000 });
    await session.waitForText('Would you like to use the skill "dotnet-aspnetcore" now?', { timeout: 10_000 });
    await session.press('enter');

    await waitForExit(session);
    expectCleanExit(session);

    const installedSkillPath = path.join(
      state.autohandHome,
      'skills',
      'dotnet-aspnetcore',
      'SKILL.md'
    );
    expect(await fs.pathExists(installedSkillPath)).toBe(true);
    expect(await fs.readFile(installedSkillPath, 'utf8')).toContain('Tuistory skill body.');
  });

  it('installs a direct skill with --y and opens the interactive TUI with the skill active', async () => {
    const state = await createTempAutohandHome();
    tempStates.push(state);
    const preload = await createMockSkillInstallFetchPreload();
    mockOpenRouterFetchPreloads.push(preload);

    const nodeOptions = [
      process.env.NODE_OPTIONS,
      `--import ${preload.importSpecifier}`,
    ].filter(Boolean).join(' ');
    const session = await trackSession(
      launchBuiltAutohand([
        '--path',
        state.workspaceRoot,
        '--config',
        state.configPath,
        '--skill-install',
        'dotnet-aspnetcore',
        '--y',
      ], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        env: {
          NODE_OPTIONS: nodeOptions,
        },
        waitForDataTimeout: 15_000,
      })
    );

    await session.waitForText('Installed dotnet-aspnetcore', { timeout: 10_000 });
    await session.waitForText('❯', { timeout: 20_000 });
    const initialInteractiveScreen = await session.text({ immediate: true, trimEnd: true });
    expect(initialInteractiveScreen).not.toContain('Would you like to use the skill');

    await session.type('/skills info dotnet-aspnetcore');
    await session.press('enter');
    await session.waitForText('Status:', { timeout: 10_000 });
    await session.waitForText('Active', { timeout: 10_000 });

    await exitInteractive(session);

    const installedSkillPath = path.join(
      state.autohandHome,
      'skills',
      'dotnet-aspnetcore',
      'SKILL.md'
    );
    expect(await fs.pathExists(installedSkillPath)).toBe(true);
  });
});
