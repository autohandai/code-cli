/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Session } from 'tuistory';
import { afterEach, describe, expect, it } from 'vitest';
import { SCRIPT, SCRIPT_DESCRIPTION, runScriptTurn } from '../../src/testing/scenarios/codeModeScenario.js';
import {
  createMockAutohandAINativeSequenceServer, createTempAutohandHome, exitInteractive,
  launchBuiltAutohand, type MockNativeToolServer, type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];
const servers: MockNativeToolServer[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) session.close();
  for (const server of servers.splice(0)) await server.close();
  for (const state of states.splice(0)) await state.cleanup();
});

async function launch(
  codeMode?: boolean,
  sequence?: Parameters<typeof createMockAutohandAINativeSequenceServer>[0],
  provider: 'autohandai' | 'custom:fixture' = 'autohandai',
) {
  const server = await createMockAutohandAINativeSequenceServer(sequence ?? [
    {
      content: 'Running a script.',
      toolCall: { id: 'script-call', name: 'run_tool_script', args: { script: SCRIPT, description: SCRIPT_DESCRIPTION } },
    },
    { content: 'CODE_MODE_DONE' },
  ]);
  servers.push(server);
  const state = await createTempAutohandHome({ config: {
    provider,
    autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'tuistory-test-key', model: 'moa', baseUrl: server.baseUrl, backgroundCalls: false, maxConcurrentThreads: 1 },
    ...(provider === 'custom:fixture' ? { customProviders: { fixture: {
      id: 'fixture', displayName: 'Fixture', apiFormat: 'openai-compatible' as const,
      apiKeyRequired: false, model: 'fixture-model', baseUrl: server.baseUrl,
      backgroundCalls: false, maxConcurrentThreads: 1,
    } } } : {}),
    features: { autohand_inference: true, codeMode },
    agent: { autoMemory: false, maxIterations: 4, sessionRetryLimit: 0 },
    network: { maxRetries: 0, retryDelay: 0 },
    ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
  } });
  states.push(state);
  const hookLog = path.join(state.autohandHome, 'hook.log');
  // Written after the home exists so the hook can log to a path inside it.
  const config = JSON.parse(await readFile(state.configPath, 'utf8')) as Record<string, unknown>;
  config.hooks = { hooks: [
    { event: 'pre-tool', command: `echo "pre $HOOK_TOOL parent=$HOOK_PARENT_TOOL_CALL_ID" >> "${hookLog}"` },
    { event: 'post-tool', command: `echo "post $HOOK_TOOL parent=$HOOK_PARENT_TOOL_CALL_ID" >> "${hookLog}"` },
  ] };
  await writeFile(state.configPath, JSON.stringify(config, null, 2));

  const session = await launchBuiltAutohand(
    ['--config', state.configPath, '--path', state.workspaceRoot],
    { autohandHome: state.autohandHome, cwd: state.workspaceRoot, rows: 50, waitForDataTimeout: 15_000 },
  );
  sessions.push(session);
  return { session, server, hookLog };
}

function advertisedTools(server: MockNativeToolServer): string[] {
  const tools = server.requests[0]?.tools as Array<{ function: { name: string } }> | undefined;
  return tools?.map((tool) => tool.function.name) ?? [];
}

function toolResult(server: MockNativeToolServer, toolCallId: string): string {
  for (const request of server.requests) {
    const messages = request.messages as Array<{ role: string; tool_call_id?: string; content?: string }> | undefined;
    const result = messages?.find((message) => message.role === 'tool' && message.tool_call_id === toolCallId)?.content;
    if (result) return result;
  }
  return '';
}

describe('code mode', () => {
  it.each(['autohandai', 'custom:fixture'] as const)('keeps the %s wire tool array and leading policy stable when a later turn switches to goal tools', async provider => {
    const { session, server } = await launch(undefined, [
      { content: 'Checking files.', toolCall: { id: 'first-script', name: 'run_tool_script', args: { script: SCRIPT } } },
      { content: 'FIRST_DONE' },
      { content: 'Checking goal state.', toolCall: { id: 'goal-script', name: 'run_tool_script', args: {
        script: 'const goal = await tools.get_goal({}); return { checked: goal.ok };',
      } } },
      { content: 'SECOND_DONE' },
    ], provider);
    await runScriptTurn(session, 'FIRST_DONE');
    await session.type('Inspect the persistent goal state using get_goal in a script');
    await session.press('enter');
    await session.waitForText('SECOND_DONE', { timeout: 30000 });
    expect(server.requests).toHaveLength(4);
    expect(new Set(server.requests.map(request => JSON.stringify(request.tools))).size).toBe(1);
    const leadingPolicies = server.requests.map(request => (request.messages as Array<{ role: string; content: string }>)[0]);
    expect(new Set(leadingPolicies.map(message => JSON.stringify(message))).size).toBe(1);
    expect(leadingPolicies[0].role).toBe('system');
    for (const request of server.requests) {
      const messages = request.messages as Array<{ role: string }>;
      expect(messages.filter(message => message.role === 'system')).toHaveLength(1);
      expect(messages[1].role).toBe('user');
    }
    expect(JSON.parse(toolResult(server, 'goal-script'))).toMatchObject({
      ok: true, result: { checked: true }, calls: { total: 1, failed: 0, byTool: { get_goal: 1 } },
    });
    expect(advertisedTools(server)).not.toContain('get_goal');
    await exitInteractive(session);
  });

  it('uses compact programmatic dispatch by default and reports checked nested calls to hooks', async () => {
    const { session, server, hookLog } = await launch();

    const screen = await runScriptTurn(session, 'CODE_MODE_DONE');

    expect(advertisedTools(server)).toContain('run_tool_script');
    expect(advertisedTools(server)).not.toContain('read_file');
    expect(new Set(server.requests.map(request => JSON.stringify(request.tools))).size).toBe(1);
    expect(session.readAll()).toContain(`run_tool_script ${SCRIPT_DESCRIPTION}`);
    expect(screen).toContain('2 tool calls (read_file ×2), 1 failed');
    expect(screen).toContain('"hasName": true');

    const result = JSON.parse(toolResult(server, 'script-call')) as Record<string, unknown>;
    expect(result).toMatchObject({
      ok: true,
      result: { hasName: true, missingReadable: false },
      logs: 'checked true false',
      calls: { total: 2, failed: 1, byTool: { read_file: 2 } },
    });
    expect(toolResult(server, 'script-call')).not.toContain('"version"');

    const hooks = (await readFile(hookLog, 'utf8')).trim().split('\n');
    expect(hooks.filter((line) => line.startsWith('pre run_tool_script parent=')).map((line) => line.trim())).toEqual(['pre run_tool_script parent=']);
    expect(hooks.filter((line) => /^pre read_file parent=.+/u.test(line))).toHaveLength(2);
    expect(hooks.filter((line) => /^post read_file parent=.+/u.test(line))).toHaveLength(2);
    expect(hooks.at(-1)).toBe('post run_tool_script parent=');

    await exitInteractive(session);
  });

  it('crops live conversation history through a script and continues with the returned evidence', async () => {
    const { session, server } = await launch(undefined, [
      { content: 'Trimming previous context.', toolCall: { id: 'crop-script', name: 'run_tool_script', args: {
        script: 'return await tools.smart_context_cropper({ crop_direction: "top", crop_amount: 1 });',
      } } },
      { content: 'CONTEXT_CROP_DONE' },
    ]);
    await runScriptTurn(session, 'CONTEXT_CROP_DONE');
    expect(JSON.parse(toolResult(server, 'crop-script'))).toMatchObject({
      ok: true, result: { ok: true, output: expect.stringMatching(/^Cropped \d+ message/) },
      calls: { total: 1, failed: 0, byTool: { smart_context_cropper: 1 } },
    });
    await exitInteractive(session);
  });

  it('does not offer the tool while the feature is off', async () => {
    const { session, server } = await launch(false);

    await runScriptTurn(session, 'CODE_MODE_DONE');

    expect(advertisedTools(server)).not.toContain('run_tool_script');
    expect(toolResult(server, 'script-call')).not.toContain('"hasName"');

    await exitInteractive(session);
  });
});
