/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import {
  acceptConfiguredOpenAIModel,
  openConfiguredOpenAIModelPicker,
} from '../../src/testing/scenarios/providerSwitchScenario.js';
import {
  createMockAuthServer,
  createTempAutohandHome,
  exitInteractive,
  launchBuiltAutohand,
  type MockAuthServer,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];
const servers: MockAuthServer[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) session.close();
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(states.splice(0).map((state) => state.cleanup()));
});

describe('provider model isolation', () => {
  it('selects and restores the saved OpenAI model when switching from Moa', async () => {
    const authServer = await createMockAuthServer();
    servers.push(authServer);
    const state = await createTempAutohandHome({
      config: {
        provider: 'autohandai',
        features: { autohand_inference: true },
        autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'tuistory-key', model: 'moa' },
        openai: {
          authMode: 'chatgpt',
          model: 'gpt-5.3-codex',
          reasoningEffort: 'high',
          chatgptAuth: {
            accessToken: 'tuistory-chatgpt-token',
            accountId: 'tuistory-chatgpt-account',
            expiresAt: Date.now() + 3_600_000,
          },
        },
      },
    });
    states.push(state);
    const launch = async (): Promise<Session> => {
      const session = await launchBuiltAutohand([
        '--path', state.workspaceRoot, '--config', state.configPath,
      ], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        env: {
          AUTOHAND_API_URL: authServer.baseUrl,
          AUTOHAND_AUTH_URL: authServer.baseUrl,
          AUTOHAND_AUTH_API_URL: `${authServer.baseUrl}/api/auth`,
        },
        waitForDataTimeout: 15_000,
      });
      sessions.push(session);
      return session;
    };
    const session = await launch();
    await session.waitForText('(Autohand AI, moa)');

    const picker = await openConfiguredOpenAIModelPicker(session);
    expect(picker.split('\n').find((line) => line.includes('▸'))).toContain('gpt-5.3-codex');
    await acceptConfiguredOpenAIModel(session);
    await session.waitForText('(OpenAI, gpt-5.3-codex)');
    await exitInteractive(session);

    const saved: {
      provider: string;
      openai: { model: string; authMode: string };
      autohandai: { model: string };
    } = JSON.parse(await readFile(state.configPath, 'utf8'));
    expect(saved.provider).toBe('openai');
    expect(saved.openai).toMatchObject({ model: 'gpt-5.3-codex', authMode: 'chatgpt' });
    expect(saved.autohandai.model).toBe('moa');

    const restarted = await launch();
    await restarted.waitForText('(OpenAI, gpt-5.3-codex)');
    await exitInteractive(restarted);
  });
});
