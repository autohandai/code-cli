/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchTerminal, type Session } from 'tuistory';

type JsonRecord = Record<string, unknown>;

function recordOrEmpty(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

export interface TuistoryTempState {
  autohandHome: string;
  configPath: string;
  workspaceRoot: string;
  cleanup: () => Promise<void>;
}

export interface LaunchBuiltAutohandOptions {
  autohandHome?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  cols?: number;
  rows?: number;
  waitForData?: boolean;
  waitForDataTimeout?: number;
}

export interface CreateTempAutohandHomeOptions {
  config?: JsonRecord;
  initializeGit?: boolean;
  writePackageJson?: boolean;
}

export interface MockOllamaServer {
  baseUrl: string;
  close: () => Promise<void>;
}

export interface MockOpenRouterServer {
  baseUrl: string;
  close: () => Promise<void>;
}

export interface MockOpenRouterFetchPreload {
  importSpecifier: string;
  cleanup: () => Promise<void>;
}

export interface MockAuthServer {
  baseUrl: string;
  close: () => Promise<void>;
}

export function repoRoot(): string {
  return path.resolve(import.meta.dirname, '../../..');
}

export async function createTempAutohandHome(options: CreateTempAutohandHomeOptions = {}): Promise<TuistoryTempState> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'autohand-tuistory-'));
  const autohandHome = path.join(tempRoot, 'home');
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const configPath = path.join(autohandHome, 'config.json');

  await mkdir(autohandHome, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  if (options.initializeGit ?? true) {
    execFileSync('git', ['init'], { cwd: workspaceRoot, stdio: 'ignore' });
  }

  const baseConfig: JsonRecord = {
    provider: 'openrouter',
    openrouter: {
      apiKey: 'tuistory-test-api-key',
      model: 'openai/gpt-4o-mini',
    },
    auth: {
      token: 'tuistory-test-token',
      expiresAt: '2099-01-01T00:00:00.000Z',
      user: {
        id: 'tuistory-test-user',
        email: 'tuistory@example.com',
        name: 'Tuistory Test',
      },
    },
    sync: {
      enabled: false,
    },
    ui: {
      checkForUpdates: false,
    },
  };
  const overrideConfig = options.config ?? {};
  const config = {
    ...baseConfig,
    ...overrideConfig,
    openrouter: {
      ...recordOrEmpty(baseConfig.openrouter),
      ...recordOrEmpty(overrideConfig.openrouter),
    },
    auth: {
      ...recordOrEmpty(baseConfig.auth),
      ...recordOrEmpty(overrideConfig.auth),
    },
    sync: {
      ...recordOrEmpty(baseConfig.sync),
      ...recordOrEmpty(overrideConfig.sync),
    },
    ui: {
      ...recordOrEmpty(baseConfig.ui),
      ...recordOrEmpty(overrideConfig.ui),
    },
  };

  await writeFile(configPath, JSON.stringify(config, null, 2));
  if (options.writePackageJson ?? true) {
    await writeFile(path.join(workspaceRoot, 'package.json'), '{"name":"tuistory-workspace","version":"0.0.0"}\n');
  }

  return {
    autohandHome,
    configPath,
    workspaceRoot,
    cleanup: async () => {
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}

export async function createMockOllamaServer(models: string[]): Promise<MockOllamaServer> {
  const server = createServer((request, response) => {
    if (request.url === '/api/tags') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ models: models.map((name) => ({ name })) }));
      return;
    }

    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Mock Ollama server did not bind to a TCP port.');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

export async function createMockOpenRouterServer(responseContent: string, delayMs = 0): Promise<MockOpenRouterServer> {
  const server = createServer((request, response) => {
    if (request.url === '/chat/completions' && request.method === 'POST') {
      request.resume();
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          id: 'chatcmpl-tuistory',
          created: Math.floor(Date.now() / 1000),
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: responseContent,
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 42,
            completion_tokens: 12,
            total_tokens: 54,
          },
        }));
      }, delayMs);
      return;
    }

    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Mock OpenRouter server did not bind to a TCP port.');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

export async function createMockOpenRouterFetchPreload(
  responseContent: string,
  delayMs = 0,
): Promise<MockOpenRouterFetchPreload> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'autohand-tuistory-fetch-'));
  const preloadPath = path.join(tempRoot, 'mock-openrouter-fetch.mjs');
  const moduleSource = `
const responseContent = ${JSON.stringify(responseContent)};
const delayMs = ${JSON.stringify(delayMs)};
const originalFetch = globalThis.fetch?.bind(globalThis);

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');

  if (url.endsWith('/chat/completions') && method.toUpperCase() === 'POST') {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    return new Response(JSON.stringify({
      id: 'chatcmpl-tuistory',
      created: Math.floor(Date.now() / 1000),
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: responseContent,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 42,
        completion_tokens: 12,
        total_tokens: 54,
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!originalFetch) {
    throw new Error('fetch is not available in this runtime');
  }

  return originalFetch(input, init);
};
`;

  await writeFile(preloadPath, moduleSource);

  return {
    importSpecifier: pathToFileURL(preloadPath).href,
    cleanup: async () => {
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}

export async function createMockSkillInstallFetchPreload(): Promise<MockOpenRouterFetchPreload> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'autohand-tuistory-fetch-'));
  const preloadPath = path.join(tempRoot, 'mock-skill-install-fetch.mjs');
  const primaryRegistry = {
    version: '1.0.0',
    updatedAt: '2026-06-30T00:00:00.000Z',
    skills: [],
    categories: [],
  };
  const skilledRegistry = {
    version: '1.0.0',
    updatedAt: '2026-06-30T00:00:00.000Z',
    skills: [
      {
        id: 'dotnet-aspnetcore',
        name: 'dotnet-aspnetcore',
        description: 'ASP.NET Core web development skills.',
        category: 'dotnet',
        tags: ['dotnet', 'aspnetcore'],
        languages: ['csharp'],
        frameworks: ['.net', 'asp.net-core'],
        directory: 'dotnet-aspnetcore',
        files: ['SKILL.md'],
        author: 'dotnet',
        sourceUrl: 'https://github.com/dotnet/skills/tree/main/plugins/dotnet-aspnetcore',
      },
    ],
    categories: [{ id: 'dotnet', name: '.NET', count: 1 }],
  };

  const moduleSource = `
const originalFetch = globalThis.fetch?.bind(globalThis);
const primaryRegistry = ${JSON.stringify(primaryRegistry)};
const skilledRegistry = ${JSON.stringify(skilledRegistry)};

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

  if (url === 'https://raw.githubusercontent.com/autohandai/community-skills/main/registry.json') {
    return new Response(JSON.stringify(primaryRegistry), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (url === 'https://skilled.autohand.ai/skills-index.json') {
    return new Response(JSON.stringify(skilledRegistry), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (url === 'https://raw.githubusercontent.com/dotnet/skills/main/plugins/dotnet-aspnetcore/SKILL.md') {
    return new Response('---\\nname: dotnet-aspnetcore\\ndescription: ASP.NET Core web development skills.\\n---\\n\\nTuistory skill body.\\n', {
      status: 200,
      headers: { 'content-type': 'text/markdown' },
    });
  }

  if (!originalFetch) {
    throw new Error('fetch is not available in this runtime');
  }

  return originalFetch(input, init);
};
`;

  await writeFile(preloadPath, moduleSource);

  return {
    importSpecifier: pathToFileURL(preloadPath).href,
    cleanup: async () => {
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}

export async function createMockAuthServer(): Promise<MockAuthServer> {
  const server = createServer((request, response) => {
    if (request.url === '/api/auth/cli/initiate' && request.method === 'POST') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        deviceCode: 'tuistory-device-code',
        userCode: 'TUI-123',
        verificationUri: 'https://auth.example.test/device',
        verificationUriComplete: 'https://auth.example.test/device?code=TUI-123',
        expiresIn: 300,
        interval: 1,
      }));
      return;
    }

    if (request.url === '/api/auth/cli/poll' && request.method === 'POST') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ success: true, status: 'pending' }));
      return;
    }

    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Mock auth server did not bind to a TCP port.');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

export async function launchBuiltAutohand(
  args: string[],
  options: LaunchBuiltAutohandOptions = {}
): Promise<Session> {
  const root = repoRoot();
  const env: Record<string, string | undefined> = {
    ...process.env,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    AUTOHAND_NO_BANNER: '1',
    AUTOHAND_SKIP_PING: '1',
    AUTOHAND_SKIP_UPDATE_CHECK: '1',
    AUTOHAND_HOME: options.autohandHome,
    ...options.env,
  };

  return await launchTerminal({
    command: process.execPath,
    args: [path.join(root, 'dist/index.js'), ...args],
    cwd: options.cwd ?? root,
    env,
    cols: options.cols ?? 120,
    rows: options.rows ?? 36,
    waitForData: options.waitForData,
    waitForDataTimeout: options.waitForDataTimeout,
  });
}

export async function waitForExit(session: Session, timeout = 10_000): Promise<void> {
  const start = Date.now();
  while (!session.exitInfo) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for process exit. Current screen:\n${await session.text({ immediate: true })}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export function expectCleanExit(session: Session): void {
  if (!session.exitInfo) {
    throw new Error('Expected process to have exited, but it is still running.');
  }
  if (session.exitInfo.exitCode !== 0) {
    throw new Error(`Expected clean exit, got exitCode=${session.exitInfo.exitCode} signal=${session.exitInfo.signal}`);
  }
}

export async function exitInteractive(session: Session): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await session.press(['ctrl', 'c']);
    try {
      await waitForExit(session, 1_000);
      expectCleanExit(session);
      return;
    } catch {
      // The first Ctrl+C may clear composer text or show the exit warning.
    }
  }

  await waitForExit(session);
  expectCleanExit(session);
}

export async function clearComposerInput(session: Session): Promise<void> {
  await session.press(['ctrl', 'c']);
  await session.text({
    timeout: 10_000,
    waitFor: (text) => text.includes('❯') && !text.includes('Tab to accept'),
  });
}

export async function dismissAutocompleteMenu(session: Session): Promise<void> {
  await session.press('escape');
  await session.text({
    timeout: 10_000,
    waitFor: (text) => !text.includes('Tab to accept'),
  });
}
