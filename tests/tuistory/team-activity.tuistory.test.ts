/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { Session } from 'tuistory';
import {
  createTempAutohandHome,
  exitInteractive,
  launchBuiltAutohand,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const tempStates: TuistoryTempState[] = [];
const servers: Server[] = [];

async function createTeamSequenceServer(): Promise<string> {
  let leadTurn = 0;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      if (request.url !== '/chat/completions' || request.method !== 'POST') {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'not found' }));
        return;
      }

      const payload = JSON.parse(Buffer.concat(chunks).toString()) as {
        messages?: Array<{ role?: string; content?: string }>;
      };
      const isSecurityTeammate = payload.messages?.some(
        (message) => message.role === 'system'
          && message.content?.includes('You are a security auditor.'),
      ) ?? false;

      let content: string;
      let delayMs = 0;
      if (isSecurityTeammate) {
        content = JSON.stringify({ finalResponse: 'SECURITY_TASK_DONE', toolCalls: [] });
        delayMs = 5_000;
      } else {
        leadTurn += 1;
        const leadResponses = [
          {
            thought: 'Create the team.',
            toolCalls: [{ tool: 'create_team', args: { name: 'team-e2e' } }],
          },
          {
            reflection: 'The team exists.',
            thought: 'Add the security teammate.',
            toolCalls: [{
              tool: 'add_teammate',
              args: {
                name: 'security-reviewer',
                agent_name: 'security-auditor',
              },
            }],
          },
          {
            reflection: 'The teammate is starting.',
            thought: 'Create its task.',
            toolCalls: [{
              tool: 'create_task',
              args: {
                subject: 'Review authentication',
                description: 'Review authentication for security risks.',
              },
            }],
          },
          { finalResponse: 'TEAM_BACKGROUND_WORK_STARTED', toolCalls: [] },
        ];
        content = JSON.stringify(
          leadResponses[Math.min(leadTurn - 1, leadResponses.length - 1)],
        );
      }

      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          id: `chatcmpl-team-${leadTurn}`,
          created: Math.floor(Date.now() / 1000),
          choices: [{
            index: 0,
            message: { role: 'assistant', content },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 42, completion_tokens: 12, total_tokens: 54 },
        }));
      }, delayMs);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Team server did not bind.');
  return `http://127.0.0.1:${address.port}`;
}

describe('interactive team activity', () => {
  afterEach(async () => {
    for (const session of sessions.splice(0)) session.close();
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    })));
    await Promise.all(tempStates.splice(0).map((state) => state.cleanup()));
  });

  it('keeps background team progress visible, opens both team views, and completes /tasks', async () => {
    const baseUrl = await createTeamSequenceServer();
    const state = await createTempAutohandHome({
      config: {
        openrouter: { baseUrl },
        agent: { maxIterations: 6, sessionRetryLimit: 0 },
        ui: { promptSuggestions: false },
        features: { automaticSpecialists: false },
      },
    });
    tempStates.push(state);
    const session = await launchBuiltAutohand([
      '--path', state.workspaceRoot,
      '--config', state.configPath,
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      waitForDataTimeout: 15_000,
    });
    sessions.push(session);

    await session.waitForText('❯', { timeout: 20_000 });
    await session.type('Create a security team and let it work in the background.');
    await session.press('enter');
    const activeScreen = await session.text({
      timeout: 60_000,
      waitFor: (text) => text.includes('team-e2e · 0/1 done')
        && text.includes('cmd+t team')
        && text.includes('AUTO'),
    });
    expect(activeScreen).toContain('Review authentication');
    await session.text({
      timeout: 30_000,
      waitFor: (text) => text.includes('TEAM_BACKGROUND_WORK_STARTED')
        && text.includes('team-e2e · 0/1 done'),
    });

    await session.press(['ctrl', 't']);
    await session.waitForText('Team: team-e2e', { timeout: 10_000 });
    expect(await session.text({ immediate: true })).toContain('Review authentication');

    await session.press(['ctrl', 't']);
    await session.type('/team view');
    await session.press('enter');
    await session.waitForText('Team: team-e2e', { timeout: 10_000 });
    expect(session.readAll()).not.toContain('Teammate process exited unexpectedly');

    await session.text({
      timeout: 45_000,
      waitFor: (text) => text.includes('team-e2e · 1/1 done')
        && text.includes('Review authentication'),
    });
    await session.type('/tasks');
    await session.press('enter');
    const completedScreen = await session.text({
      timeout: 10_000,
      waitFor: (text) => text.includes('Tasks [1/1 done]'),
    });
    expect(completedScreen).toContain('Review authentication');

    await exitInteractive(session);
  }, 90_000);
});
