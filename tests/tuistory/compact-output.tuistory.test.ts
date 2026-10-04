/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Session } from 'tuistory';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EXPAND_HINT,
  FIRST_HIDDEN_ROW,
  LAST_ROW,
  LONG_OUTPUT_COMMAND,
  collapseLatestOutput,
  expandLatestOutput,
  runLongOutputTurn,
} from '../../src/testing/scenarios/compactOutputScenario.js';
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

async function launch(ui: Record<string, unknown> = {}) {
  const server = await createMockAutohandAINativeSequenceServer([
    { content: 'Listing rows.', toolCall: { id: 'long-output', name: 'run_command', args: LONG_OUTPUT_COMMAND } },
    { content: 'COMPACT_OUTPUT_DONE' },
  ]);
  servers.push(server);
  const state = await createTempAutohandHome({ config: {
    provider: 'autohandai',
    autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'tuistory-test-key', model: 'moa', baseUrl: server.baseUrl },
    features: { autohand_inference: true },
    agent: { autoMemory: false, maxIterations: 4, sessionRetryLimit: 0 },
    network: { maxRetries: 0, retryDelay: 0 },
    ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false, ...ui },
  } });
  states.push(state);
  // --yes: the scenario is about how the output is shown, not about approving the command.
  const session = await launchBuiltAutohand(
    ['--yes', '--config', state.configPath, '--path', state.workspaceRoot],
    { autohandHome: state.autohandHome, cwd: state.workspaceRoot, rows: 60, waitForDataTimeout: 15_000 },
  );
  sessions.push(session);
  return { session, server };
}

function toolResult(server: MockNativeToolServer, toolCallId: string): string {
  for (const request of server.requests) {
    const messages = request.messages as Array<{ role: string; tool_call_id?: string; content?: string }> | undefined;
    const result = messages?.find((message) => message.role === 'tool' && message.tool_call_id === toolCallId)?.content;
    if (result) return result;
  }
  return '';
}

describe('compact tool output', () => {
  it('shows a three-line preview, expands with ctrl+o, and collapses again', async () => {
    const { session, server } = await launch();

    const finished = await runLongOutputTurn(session, 'COMPACT_OUTPUT_DONE');
    expect(finished).toContain('row-3');
    expect(finished).toContain(EXPAND_HINT);
    expect(finished).not.toContain(`${FIRST_HIDDEN_ROW}\n`);
    expect(finished).not.toContain(LAST_ROW);
    expect(toolResult(server, 'long-output')).toContain(LAST_ROW);

    const expanded = await expandLatestOutput(session);
    expect(expanded).toContain(LAST_ROW);
    expect(expanded).toContain('❯');

    const collapsed = await collapseLatestOutput(session);
    expect(collapsed).not.toContain(LAST_ROW);
    expect(collapsed).toContain(EXPAND_HINT);

    await exitInteractive(session);
  });

  it('prints the whole result when ui.toolOutput is full', async () => {
    const { session } = await launch({ toolOutput: 'full', readFileCharLimit: 5_000 });

    const finished = await runLongOutputTurn(session, 'COMPACT_OUTPUT_DONE');

    expect(finished).toContain(LAST_ROW);
    expect(finished).not.toContain('ctrl+o to expand');

    await exitInteractive(session);
  });
});
