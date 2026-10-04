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

async function launch(codeMode: boolean) {
  const server = await createMockAutohandAINativeSequenceServer([
    {
      content: 'Running a script.',
      toolCall: { id: 'script-call', name: 'run_tool_script', args: { script: SCRIPT, description: SCRIPT_DESCRIPTION } },
    },
    { content: 'CODE_MODE_DONE' },
  ]);
  servers.push(server);
  const state = await createTempAutohandHome({ config: {
    provider: 'autohandai',
    autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'tuistory-test-key', model: 'moa', baseUrl: server.baseUrl },
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
  it('runs one script, returns only its answer to the model, and reports nested calls to hooks', async () => {
    const { session, server, hookLog } = await launch(true);

    const screen = await runScriptTurn(session, 'CODE_MODE_DONE');

    expect(advertisedTools(server)).toContain('run_tool_script');
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

  it('does not offer the tool while the feature is off', async () => {
    const { session, server } = await launch(false);

    await runScriptTurn(session, 'CODE_MODE_DONE');

    expect(advertisedTools(server)).not.toContain('run_tool_script');
    expect(toolResult(server, 'script-call')).not.toContain('"hasName"');

    await exitInteractive(session);
  });
});
