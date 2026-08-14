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

export interface MockNativeToolServer extends MockOpenRouterServer {
  requests: JsonRecord[];
}

export interface MockNativeAssistantTurn {
  content: string;
  toolCall?: {
    id: string;
    name: string;
    args?: JsonRecord;
  };
}

export interface MockOpenRouterFetchPreload {
  importSpecifier: string;
  cleanup: () => Promise<void>;
}

export interface MockAuthServer {
  baseUrl: string;
  close: () => Promise<void>;
}

export interface MockAuthServerOptions {
  authorizeAfterPolls?: number;
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

export async function createMockAutohandAIQuotaServer(): Promise<MockOpenRouterServer> {
  const server = createServer((request, response) => {
    if (request.url === '/chat/completions' && request.method === 'POST') {
      request.resume();
      const resetAt = Math.floor(Date.now() / 1000) + 2 * 60 * 60 + 30 * 60;
      response.writeHead(429, {
        'content-type': 'application/json',
        'retry-after': String(2 * 60 * 60 + 30 * 60),
      });
      response.end(JSON.stringify({
        error: {
          type: 'rate_limited',
          message: "You've used all your messages in this 5-hour window.",
          scope: 'window_5h',
          resetAt,
          upgradeUrl: 'https://console-v2.autohand.ai/upgrade/?from=cli&tier=pro',
        },
      }));
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
    throw new Error('Mock Autohand AI quota server did not bind to a TCP port.');
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

export async function createMockAutohandAINativeToolServer(): Promise<MockNativeToolServer> {
  return createMockAutohandAINativeSequenceServer([
    {
      content: 'Read package.json once.',
      toolCall: {
        id: 'call_read_package',
        name: 'read_file',
        args: { path: 'package.json' },
      },
    },
    { content: 'MOA_NATIVE_TOOL_HISTORY_OK' },
  ]);
}

export async function createMockAutohandAINativeSequenceServer(
  turns: MockNativeAssistantTurn[],
): Promise<MockNativeToolServer> {
  const requests: JsonRecord[] = [];
  const server = createServer(async (request, response) => {
    if (request.url !== '/chat/completions' || request.method !== 'POST') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = recordOrEmpty(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
    requests.push(body);

    const turn = turns[Math.min(requests.length - 1, turns.length - 1)]
      ?? { content: '' };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      id: `chatcmpl-autohand-native-${requests.length}`,
      created: Math.floor(Date.now() / 1000),
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: turn.content,
          ...(turn.toolCall
            ? {
                tool_calls: [{
                  id: turn.toolCall.id,
                  type: 'function',
                  function: {
                    name: turn.toolCall.name,
                    arguments: JSON.stringify(turn.toolCall.args ?? {}),
                  },
                }],
              }
            : {}),
        },
        finish_reason: turn.toolCall ? 'tool_calls' : 'stop',
      }],
      usage: {
        prompt_tokens: 42,
        completion_tokens: 12,
        total_tokens: 54,
      },
    }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Mock Autohand AI native tool server did not bind to a TCP port.');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
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

export async function createMockOpenRouterSequenceServer(
  responseContents: string[],
  delayMs = 0
): Promise<MockOpenRouterServer> {
  let completionCalls = 0;
  const server = createServer((request, response) => {
    if (request.url === '/chat/completions' && request.method === 'POST') {
      request.resume();
      setTimeout(() => {
        const index = Math.min(completionCalls, responseContents.length - 1);
        completionCalls += 1;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          id: `chatcmpl-tuistory-${completionCalls}`,
          created: Math.floor(Date.now() / 1000),
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: responseContents[index] ?? '',
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
    throw new Error('Mock OpenRouter sequence server did not bind to a TCP port.');
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

export async function createMockChangelogFetchPreload(): Promise<MockOpenRouterFetchPreload> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'autohand-tuistory-changelog-'));
  const preloadPath = path.join(tempRoot, 'mock-changelog-fetch.mjs');
  const moduleSource = `
const originalFetch = globalThis.fetch?.bind(globalThis);

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

  if (url === 'https://api.github.com/repos/autohandai/code-cli/releases?per_page=10') {
    return new Response(JSON.stringify([{
      tag_name: 'v9.8.7',
      name: 'Tuistory release',
      body: '- Visible changelog output',
      published_at: '2026-07-27T00:00:00Z',
      html_url: 'https://github.com/autohandai/code-cli/releases/tag/v9.8.7',
      prerelease: false,
    }]), {
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

export async function createMockMobilePairingFetchPreload(): Promise<MockOpenRouterFetchPreload> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'autohand-tuistory-mobile-pairing-'));
  const preloadPath = path.join(tempRoot, 'mock-mobile-pairing-fetch.mjs');
  const pairingUrl = 'https://autohand.ai/code/go?pairing=019fabbc-2445-7c21-9356-18aa3816db03&token='
    + 'tuistory-pairing-token-0123456789abcdef0123456789abcdef';
  const moduleSource = `
const pairingUrl = ${JSON.stringify(pairingUrl)};
const originalFetch = globalThis.fetch?.bind(globalThis);

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');

  if (url.endsWith('/me') && method.toUpperCase() === 'GET') {
    return new Response(JSON.stringify({
      user: {
        id: 'tuistory-test-user',
        email: 'tuistory@example.com',
        name: 'Tuistory Test',
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (url.endsWith('/v1/devices/register') && method.toUpperCase() === 'POST') {
    return new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (url.endsWith('/v1/mobile/pairings') && method.toUpperCase() === 'POST') {
    return new Response(JSON.stringify({
      success: true,
      pairing: {
        id: '019fabbc-2445-7c21-9356-18aa3816db03',
        pairingUrl,
        expiresAt: '2099-01-01T00:00:00.000Z',
        pollIntervalMs: 2000,
        session: {
          id: 'tuistory-mobile-session',
          deviceId: 'tuistory-mobile-device',
          workspacePath: '/tmp/tuistory-workspace',
          projectName: 'tuistory-workspace',
          model: 'openai/gpt-4o-mini',
          provider: 'openrouter',
        },
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

export async function createFailingOpenRouterFetchPreload(
  status = 503,
): Promise<MockOpenRouterFetchPreload> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'autohand-tuistory-fetch-failure-'));
  const preloadPath = path.join(tempRoot, 'mock-openrouter-fetch-failure.mjs');
  const moduleSource = `
const status = ${JSON.stringify(status)};
const originalFetch = globalThis.fetch?.bind(globalThis);

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');

  if (url.endsWith('/chat/completions') && method.toUpperCase() === 'POST') {
    return new Response(JSON.stringify({
      error: { message: 'Deterministic Tuistory provider failure' },
    }), {
      status,
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

export async function createMockOpenRouterFetchSequencePreload(
  responseContents: string[],
  delayMs = 0,
): Promise<MockOpenRouterFetchPreload> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'autohand-tuistory-fetch-sequence-'));
  const preloadPath = path.join(tempRoot, 'mock-openrouter-fetch-sequence.mjs');
  const moduleSource = `
const responseContents = ${JSON.stringify(responseContents)};
const delayMs = ${JSON.stringify(delayMs)};
const originalFetch = globalThis.fetch?.bind(globalThis);
let completionCalls = 0;

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

    const index = Math.min(completionCalls, responseContents.length - 1);
    completionCalls += 1;
    return new Response(JSON.stringify({
      id: 'chatcmpl-tuistory-' + completionCalls,
      created: Math.floor(Date.now() / 1000),
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: responseContents[index] ?? '',
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
        url: 'https://skilled.autohand.ai/skill/dotnet-aspnetcore',
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

  if (url === 'https://skilled.autohand.ai/skills/dotnet-aspnetcore.json') {
    return new Response(JSON.stringify({
      ...skilledRegistry.skills[0],
      content: '---\\nname: dotnet-aspnetcore\\ndescription: ASP.NET Core web development skills.\\n---\\n\\nTuistory skill body.\\n',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (url === 'https://raw.githubusercontent.com/dotnet/skills/main/plugins/dotnet-aspnetcore/SKILL.md') {
    return new Response('', { status: 404 });
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

export async function createMockSubAgentCatalogFetchPreload(): Promise<MockOpenRouterFetchPreload> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'autohand-tuistory-fetch-'));
  const preloadPath = path.join(tempRoot, 'mock-sub-agent-catalog-fetch.mjs');
  const registryUrl = 'https://raw.githubusercontent.com/autohandai/awesome-sub-agents/main/registry.json';
  const agentUrl = 'https://raw.githubusercontent.com/autohandai/awesome-sub-agents/main/categories/03-design-experience/ui-designer.md';
  const registry = {
    schemaVersion: 1,
    repository: 'https://github.com/autohandai/awesome-sub-agents',
    agents: [
      {
        name: 'ui-designer',
        description: 'Designs accessible production user interfaces',
        category: '03-design-experience',
        path: 'categories/03-design-experience/ui-designer.md',
        tools: ['read_file'],
      },
    ],
  };
  const agentMarkdown = [
    '---',
    'description: Designs accessible production user interfaces',
    'tools: read_file',
    '---',
    '',
    'Own UI implementation and accessibility validation.',
    '',
  ].join('\n');
  const moduleSource = `
const originalFetch = globalThis.fetch?.bind(globalThis);
const registryUrl = ${JSON.stringify(registryUrl)};
const agentUrl = ${JSON.stringify(agentUrl)};
const registry = ${JSON.stringify(registry)};
const agentMarkdown = ${JSON.stringify(agentMarkdown)};

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

  if (url === registryUrl) {
    return new Response(JSON.stringify(registry), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (url === agentUrl) {
    return new Response(agentMarkdown, {
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

export async function createMockAuthServer(
  options: MockAuthServerOptions = {},
): Promise<MockAuthServer> {
  let pollCount = 0;
  const deviceCode = 'D'.repeat(43);
  const server = createServer((request, response) => {
    if (request.url === '/api/auth/me' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        user: {
          id: 'tuistory-test-user',
          email: 'tuistory@example.com',
          name: 'Tuistory Test',
        },
        entitlement: {
          tier: 'pro',
          freeRemaining: null,
          limits: {
            displayName: 'Autohand Code Pro',
            messagesPer5h: 100,
            messagesPerWeek: 1000,
            rpm: 100,
            requiresEligibility: false,
            perSeat: false,
            models: ['fantail', 'moa'],
          },
          quota: {
            available: true,
            window5h: {
              used: 12,
              remaining: 88,
              limit: 100,
              resetAt: '2026-08-10T06:00:00.000Z',
            },
            week: {
              used: 120,
              remaining: 880,
              limit: 1000,
              resetAt: '2026-08-17T01:00:00.000Z',
            },
          },
        },
      }));
      return;
    }

    if (request.url === '/v1/auth/cli/initiate' && request.method === 'POST') {
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        success: true,
        schemaVersion: 2,
        deviceCode,
        userCode: 'TEST-CAFE',
        verificationUri: 'https://autohand.ai/signin',
        verificationUriComplete: 'https://autohand.ai/signin?user_code=TEST-CAFE',
        expiresIn: 300,
        interval: 1,
      }));
      return;
    }

    if (request.url === '/v1/auth/cli/poll' && request.method === 'POST') {
      pollCount += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      if (
        options.authorizeAfterPolls !== undefined
        && pollCount >= options.authorizeAfterPolls
      ) {
        response.end(JSON.stringify({
          success: true,
          schemaVersion: 2,
          status: 'authorized',
          token: `ahc_${'C'.repeat(43)}`,
          user: {
            id: 'tuistory-authorized-user',
            email: 'authorized@example.test',
            name: 'Authorized Tuistory User',
          },
        }));
        return;
      }
      response.end(JSON.stringify({
        success: true,
        schemaVersion: 2,
        status: 'pending',
        interval: 1,
      }));
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

export async function createStalledSyncFetchPreload(): Promise<MockOpenRouterFetchPreload> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'autohand-stalled-sync-fetch-'));
  const preloadPath = path.join(tempRoot, 'preload.mjs');
  const moduleSource = `
const originalFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;

  if (url.endsWith('/v1/sync/manifest')) {
    return await new Promise((_, reject) => {
      const rejectAbort = () => {
        const error = new Error('Request aborted');
        error.name = 'AbortError';
        reject(error);
      };

      if (init?.signal?.aborted) {
        rejectAbort();
        return;
      }
      init?.signal?.addEventListener('abort', rejectAbort, { once: true });
    });
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

export async function launchBuiltAutohand(
  args: string[],
  options: LaunchBuiltAutohandOptions = {}
): Promise<Session> {
  const root = repoRoot();
  const env: Record<string, string | undefined> = {
    ...process.env,
    CI: 'false',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    AUTOHAND_NO_BANNER: '1',
    AUTOHAND_SKIP_PING: '1',
    AUTOHAND_SKIP_UPDATE_CHECK: '1',
    AUTOHAND_OFFLINE: '1',
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
