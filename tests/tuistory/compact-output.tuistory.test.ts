/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
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
  outputViewport,
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

async function launch(ui: Record<string, unknown> = {}, largeDiff = false) {
  const server = await createMockAutohandAINativeSequenceServer([
    { content: 'Listing rows.', toolCall: { id: 'long-output', name: largeDiff ? 'git_diff' : 'run_command', args: largeDiff ? {} : LONG_OUTPUT_COMMAND } },
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
  if (largeDiff) {
    await writeFile(path.join(state.workspaceRoot, 'large.ts'), Array.from({ length: 690 }, (_, i) => `export const row${i + 1} = ${i + 1};`).join('\n'));
    execFileSync('git', ['add', '--intent-to-add', 'large.ts'], { cwd: state.workspaceRoot });
  }
  // --yes: the scenario is about how the output is shown, not about approving the command.
  const session = await launchBuiltAutohand(
    ['--yes', '--config', state.configPath, '--path', state.workspaceRoot],
    { autohandHome: state.autohandHome, cwd: state.workspaceRoot, rows: largeDiff ? 24 : 60, cols: largeDiff ? 80 : 120, waitForDataTimeout: 15_000 },
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

  it('keeps a 690-line diff and its expanded pages above a usable composer', async () => {
    const { session, server } = await launch({}, true);
    await runLongOutputTurn(session, 'COMPACT_OUTPUT_DONE');
    await session.waitForText('Completed in');
    const compact = outputViewport(session);
    expect(compact).toContain('ctrl+o to expand');
    expect(compact).toContain('❯');
    expect(compact).not.toContain('row690');
    expect(toolResult(server, 'long-output')).toContain('row690');

    await session.press(['ctrl', 'o']);
    await session.waitForText('PgUp/PgDn');
    await session.text();
    const first = outputViewport(session);
    expect(first).toContain('Ctrl+O collapse');
    expect(first).toContain('diff --git');
    expect(first).toContain('❯');
    await session.type('draft stays editable');
    await session.waitForText('❯ draft stays editable');
    await session.press('pagedown');
    await session.waitForText('Rows 9–16');
    const second = outputViewport(session);
    const details = second.slice(second.indexOf('git_diff details'));
    expect(details).not.toContain('diff --git');
    const snapshot = await readFile(new URL('../../src/testing/snapshots/large-output-page.txt', import.meta.url), 'utf8');
    for (const row of snapshot.trimEnd().split('\n')) expect(details).toContain(row);
    expect(second).toContain('❯ draft stays editable');
    await session.press('pageup');
    await session.waitForText('Rows 1–8');
    expect(outputViewport(session)).toContain('diff --git');
    await session.resize({ cols: 60, rows: 20 });
    await session.text();
    expect(outputViewport(session)).toContain('❯ draft stays editable');
    await collapseLatestOutput(session);
    expect(outputViewport(session)).toContain('❯ draft stays editable');
    await exitInteractive(session);
  }, 90_000);

  it('prints the whole result when ui.toolOutput is full', async () => {
    const { session } = await launch({ toolOutput: 'full', readFileCharLimit: 5_000 });

    const finished = await runLongOutputTurn(session, 'COMPACT_OUTPUT_DONE');

    expect(finished).toContain(LAST_ROW);
    expect(finished).not.toContain('ctrl+o to expand');

    await exitInteractive(session);
  });
});
