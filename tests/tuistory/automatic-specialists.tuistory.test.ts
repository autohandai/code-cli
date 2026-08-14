/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Session } from 'tuistory';
import {
  createTempAutohandHome,
  createMockSubAgentCatalogFetchPreload,
  launchBuiltAutohand,
  waitForExit,
  type MockOllamaServer,
  type TuistoryTempState,
  type MockOpenRouterFetchPreload,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const tempStates: TuistoryTempState[] = [];
const mockServers: MockOllamaServer[] = [];
const fetchPreloads: MockOpenRouterFetchPreload[] = [];

async function createRecordingSequenceServer(responseContents: string[]) {
  const requests: Array<Record<string, unknown>> = [];
  let completionCalls = 0;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      if (request.url !== '/chat/completions' || request.method !== 'POST') {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'not found' }));
        return;
      }
      requests.push(JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>);
      const index = Math.min(completionCalls, responseContents.length - 1);
      completionCalls += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        id: `chatcmpl-specialist-${completionCalls}`,
        created: Math.floor(Date.now() / 1000),
        choices: [{
          index: 0,
          message: { role: 'assistant', content: responseContents[index] ?? '' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 42, completion_tokens: 12, total_tokens: 54 },
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Recording server did not bind.');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

describe('automatic specialist orchestration', () => {
  afterEach(async () => {
    for (const session of sessions.splice(0)) {
      session.close();
    }
    await Promise.all(mockServers.splice(0).map((server) => server.close()));
    await Promise.all(fetchPreloads.splice(0).map((preload) => preload.cleanup()));
    await Promise.all(tempStates.splice(0).map((state) => state.cleanup()));
  });

  it('resolves and runs an explicit UI, UX, and security team before the lead turn', async () => {
    const server = await createRecordingSequenceServer([
      JSON.stringify({ finalResponse: 'UI_SPECIALIST_OK', toolCalls: [] }),
      JSON.stringify({ finalResponse: 'UX_SPECIALIST_OK', toolCalls: [] }),
      JSON.stringify({ finalResponse: 'SECURITY_SPECIALIST_OK', toolCalls: [] }),
      JSON.stringify({ finalResponse: 'LEAD_SYNTHESIS_OK', toolCalls: [] }),
    ]);
    mockServers.push(server);
    const state = await createTempAutohandHome({
      config: {
        openrouter: { baseUrl: server.baseUrl },
        agent: { maxIterations: 4, sessionRetryLimit: 0 },
        features: { automaticSpecialists: true },
      },
    });
    tempStates.push(state);
    const inlineAgents = JSON.stringify({
      'ui-designer': {
        description: 'Inspects repository user-interface implementation.',
        prompt: 'Inspect the user interface and return concise findings.',
        tools: ['read_file'],
      },
      'ux-researcher': {
        description: 'Inspects repository user-experience flows.',
        prompt: 'Inspect the user experience and return concise findings.',
        tools: ['read_file'],
      },
    });

    const session = await launchBuiltAutohand([
      '--path', state.workspaceRoot,
      '--config', state.configPath,
      '--agents', inlineAgents,
      '-p', 'Bring a team of ui, ux, security to inspect this repo.',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      waitForDataTimeout: 15_000,
    });
    sessions.push(session);

    await waitForExit(session, 60_000);
    const output = session.readAll();

    expect(session.exitInfo?.exitCode, output).toBe(0);
    expect(output).toContain('Specialist roster');
    expect(output).toContain('UI → ui-designer [session]');
    expect(output).toContain('UX → ux-researcher [session]');
    expect(output).toContain('Security → security-auditor [builtin]');
    expect(output).toContain("Sub-agent 'ui-designer' starting task");
    expect(output).toContain("Sub-agent 'ux-researcher' starting task");
    expect(output).toContain("Sub-agent 'security-auditor' starting task");
    expect(output).toContain('LEAD_SYNTHESIS_OK');
  }, 90_000);

  it('launches a resolved built-in definition through the real team child-process path', async () => {
    const server = await createRecordingSequenceServer([
      JSON.stringify({
        thought: 'Create the durable review team.',
        toolCalls: [{ tool: 'create_team', args: { name: 'security-review' } }],
      }),
      JSON.stringify({
        reflection: 'The security-review team was created and the registry lists security-auditor.',
        thought: 'Launch the resolved security specialist.',
        toolCalls: [{
          tool: 'add_teammate',
          args: {
            name: 'security-reviewer',
            agent_name: 'security-auditor',
            requested_role: 'security',
            agent_source: 'builtin',
          },
        }],
      }),
      JSON.stringify({
        reflection: 'The teammate launch result confirms security-reviewer is running security-auditor.',
        thought: 'Confirm the launched roster.',
        toolCalls: [{ tool: 'team_status', args: {} }],
      }),
      JSON.stringify({ finalResponse: 'TEAM_LAUNCH_OK', toolCalls: [] }),
    ]);
    mockServers.push(server);
    const state = await createTempAutohandHome({
      config: {
        openrouter: { baseUrl: server.baseUrl },
        agent: { maxIterations: 6, sessionRetryLimit: 0 },
      },
    });
    tempStates.push(state);

    const session = await launchBuiltAutohand([
      '--path', state.workspaceRoot,
      '--config', state.configPath,
      '-p', 'Create a /team and launch the security specialist to inspect this repo.',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      waitForDataTimeout: 15_000,
    });
    sessions.push(session);

    await waitForExit(session, 60_000);
    const output = session.readAll();

    expect(session.exitInfo?.exitCode, output).toBe(0);
    expect(output).toContain('Team "security-review" created');
    expect(output).toContain('TEAM_LAUNCH_OK');
    expect(output).not.toContain('Agent not found');
    const providerContext = JSON.stringify(server.requests);
    expect(providerContext).toContain('Teammate \\"security-reviewer\\" added (agent: security-auditor)');
    expect(providerContext).toContain('requested: security');
    expect(providerContext).toContain('source: builtin');
  }, 90_000);

  it('requests one aggregate approval before installing a resolved catalog roster', async () => {
    const server = await createRecordingSequenceServer([
      JSON.stringify({ finalResponse: 'UI_CATALOG_OK', toolCalls: [] }),
      JSON.stringify({ finalResponse: 'SECURITY_BUILTIN_OK', toolCalls: [] }),
      JSON.stringify({ finalResponse: 'AGGREGATE_APPROVAL_OK', toolCalls: [] }),
    ]);
    mockServers.push(server);
    const preload = await createMockSubAgentCatalogFetchPreload();
    fetchPreloads.push(preload);
    const state = await createTempAutohandHome({
      config: {
        openrouter: { baseUrl: server.baseUrl },
        agent: { maxIterations: 5, sessionRetryLimit: 0 },
        features: { automaticSpecialists: true },
      },
    });
    tempStates.push(state);
    const nodeOptions = [process.env.NODE_OPTIONS, `--import ${preload.importSpecifier}`]
      .filter(Boolean)
      .join(' ');

    const session = await launchBuiltAutohand([
      '--path', state.workspaceRoot,
      '--config', state.configPath,
      '-p', 'Bring a team of ui and security agents to inspect this repo.',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      env: { NODE_OPTIONS: nodeOptions },
      waitForDataTimeout: 15_000,
    });
    sessions.push(session);

    await session.waitForText('Install these resolved specialists from the default Autohand catalog?', {
      timeout: 20_000,
    });
    await session.press('enter');
    await waitForExit(session, 60_000);
    const output = session.readAll();

    expect(session.exitInfo?.exitCode, output).toBe(0);
    expect(output).toContain('ui-designer');
    expect(output).toContain('AGGREGATE_APPROVAL_OK');
    await expect(readFile(path.join(state.autohandHome, 'agents', 'ui-designer.md'), 'utf8'))
      .resolves.toContain('Own UI implementation');
  }, 90_000);

  it('installs the aggregate catalog roster without prompting in YOLO mode', async () => {
    const server = await createRecordingSequenceServer([
      JSON.stringify({ finalResponse: 'UI_YOLO_OK', toolCalls: [] }),
      JSON.stringify({ finalResponse: 'SECURITY_YOLO_OK', toolCalls: [] }),
      JSON.stringify({ finalResponse: 'YOLO_INSTALL_OK', toolCalls: [] }),
    ]);
    mockServers.push(server);
    const preload = await createMockSubAgentCatalogFetchPreload();
    fetchPreloads.push(preload);
    const state = await createTempAutohandHome({
      config: {
        openrouter: { baseUrl: server.baseUrl },
        agent: { maxIterations: 5, sessionRetryLimit: 0 },
        features: { automaticSpecialists: true },
      },
    });
    tempStates.push(state);
    const nodeOptions = [process.env.NODE_OPTIONS, `--import ${preload.importSpecifier}`]
      .filter(Boolean)
      .join(' ');

    const session = await launchBuiltAutohand([
      '--path', state.workspaceRoot,
      '--config', state.configPath,
      '--yes',
      '-p', 'Bring a team of ui and security agents to inspect this repo.',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      env: { NODE_OPTIONS: nodeOptions },
      waitForDataTimeout: 15_000,
    });
    sessions.push(session);

    await waitForExit(session, 60_000);
    const output = session.readAll();

    expect(session.exitInfo?.exitCode, output).toBe(0);
    expect(output).not.toContain('Install these resolved specialists from the default Autohand catalog?');
    expect(output).toContain('YOLO_INSTALL_OK');
    await expect(readFile(path.join(state.autohandHome, 'agents', 'ui-designer.md'), 'utf8'))
      .resolves.toContain('Own UI implementation');
  }, 90_000);
});
