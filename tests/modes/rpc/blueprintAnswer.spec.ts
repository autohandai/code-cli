/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFile } from 'node:fs/promises';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { AutohandConfig, LLMResponse } from '../../../src/types.js';
import type { LLMProvider } from '../../../src/providers/LLMProvider.js';
import { loadConfig } from '../../../src/config.js';
import {
  BLUEPRINT_ANSWER_CONTRACT_VERSION,
  BlueprintAnswerError,
  BLUEPRINT_ANSWER_LIMITS,
  classifyInferenceDestination,
  createAnswerOnlyRuntimeProfile,
  inspectBlueprintRuntime,
  inspectBlueprintCliIdentity,
  parseBlueprintAnswerEnvelope,
  runBlueprintAnswer,
} from '../../../src/modes/rpc/blueprintAnswer.js';
import { handleBlueprintRpcRequest } from '../../../src/modes/rpc/blueprintRpc.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const schemaDirectory = path.resolve(testDirectory, '../../../schema');

async function readGolden(name: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(schemaDirectory, name), 'utf8')) as unknown;
}

function providerResponse(content: string): LLMResponse {
  return {
    id: 'response-1',
    created: 1,
    content,
    finishReason: 'stop',
    raw: {},
  };
}

describe('Blueprint answer-only contract', () => {
  it('accepts the canonical valid vector and rejects the canonical invalid vector', async () => {
    const valid = await readGolden('blueprint-answer-contract-v1.valid.json');
    const invalid = await readGolden('blueprint-answer-contract-v1.invalid.json');

    expect(parseBlueprintAnswerEnvelope(valid).contractVersion).toBe(
      BLUEPRINT_ANSWER_CONTRACT_VERSION,
    );
    expect(() => parseBlueprintAnswerEnvelope(invalid)).toThrow(BlueprintAnswerError);
  });

  it('enforces the serialized 8 KiB classified-input limit', async () => {
    const valid = await readGolden('blueprint-answer-contract-v1.valid.json') as {
      artifacts: Array<{ content: string }>;
    };
    valid.artifacts[0].content = 'x'.repeat(BLUEPRINT_ANSWER_LIMITS.maxInputBytes);

    expect(() => parseBlueprintAnswerEnvelope(valid)).toThrowError(
      expect.objectContaining({ kind: 'input_limit_exceeded' }),
    );
  });

  it('creates one centralized profile with every unrelated capability disabled', () => {
    expect(createAnswerOnlyRuntimeProfile({
      answerOnly: true,
      restricted: true,
      clientContext: 'blueprint',
    })).toEqual({
      answerOnly: true,
      clientContext: 'blueprint',
      permissionMode: 'restricted',
      toolsEnabled: false,
      hooksEnabled: false,
      mcpEnabled: false,
      memoryEnabled: false,
      telemetryEnabled: false,
      backgroundWorkEnabled: false,
      browserEnabled: false,
      sessionPersistenceEnabled: false,
    });

    expect(() => createAnswerOnlyRuntimeProfile({
      answerOnly: true,
      restricted: false,
      clientContext: 'blueprint',
    })).toThrowError(expect.objectContaining({ kind: 'profile_violation' }));
  });

  it('loads missing configuration read-only for passive startup', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'autohand-answer-config-'));
    const configPath = path.join(directory, 'nested', 'config.json');
    try {
      const config = await loadConfig(configPath, directory, {
        createIfMissing: false,
        initializeTheme: false,
      });

      expect(config.isNewConfig).toBe(true);
      expect(config.configPath).toBe(configPath);
      await expect(access(configPath)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('binds the development runtime to its source tree, commit, and executable', async () => {
    const identity = await inspectBlueprintCliIdentity(path.resolve('src/index.ts'));

    expect(identity.symlinkChain.length).toBeGreaterThan(0);
    expect(identity.package).toMatchObject({
      name: 'autohand-cli',
      version: expect.any(String),
      commit: expect.stringMatching(/^[a-f0-9]{40}$/u),
    });
    expect(identity.artifacts.length).toBeGreaterThan(1);
    expect(identity.artifacts.every((artifact) => (
      artifact.size > 0 && /^[a-f0-9]{64}$/u.test(artifact.sha256)
    ))).toBe(true);
    expect(identity.identityHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it.each([
    {
      name: 'Autohand AI cloud',
      config: {
        provider: 'autohandai',
        autohandai: { plan: 'cloud', model: 'fantail', accountToken: 'secret' },
      },
      expected: { kind: 'hosted', provider: 'autohandai', origin: 'https://api.autohand.ai' },
    },
    {
      name: 'Autohand AI local',
      config: {
        provider: 'autohandai',
        autohandai: { plan: 'local', model: 'local-model', port: 9876 },
      },
      expected: { kind: 'local_service', provider: 'autohandai', origin: 'http://localhost:9876' },
    },
    {
      name: 'Ollama',
      config: { provider: 'ollama', ollama: { model: 'qwen' } },
      expected: { kind: 'local_service', provider: 'ollama', origin: 'http://localhost:11434' },
    },
    {
      name: 'llama.cpp',
      config: { provider: 'llamacpp', llamacpp: { model: 'qwen', port: 8081 } },
      expected: { kind: 'local_service', provider: 'llamacpp', origin: 'http://localhost:8081' },
    },
    {
      name: 'MLX',
      config: { provider: 'mlx', mlx: { model: 'qwen' } },
      expected: { kind: 'local_service', provider: 'mlx', origin: 'http://localhost:8080' },
    },
    {
      name: 'OpenRouter',
      config: {
        provider: 'openrouter',
        openrouter: { model: 'openai/gpt-5', apiKey: 'secret' },
      },
      expected: { kind: 'hosted', provider: 'openrouter', origin: 'https://openrouter.ai' },
    },
    {
      name: 'custom provider',
      config: {
        provider: 'custom:private',
        customProviders: {
          private: {
            id: 'private',
            displayName: 'Private',
            apiFormat: 'openai-compatible',
            model: 'model',
            baseUrl: 'http://localhost:9000/v1?token=secret',
          },
        },
      },
      expected: { kind: 'opaque' },
    },
    {
      name: 'unknown extension provider',
      config: {
        provider: 'extension:unknown',
        extensionProviders: {
          'extension:unknown': { model: 'model', baseUrl: 'http://localhost:9000/v1' },
        },
      },
      expected: { kind: 'opaque' },
    },
  ] satisfies Array<{
    name: string;
    config: AutohandConfig;
    expected: ReturnType<typeof classifyInferenceDestination>;
  }>)('classifies $name without exposing endpoint paths or credentials', ({ config, expected }) => {
    expect(classifyInferenceDestination(config)).toEqual(expected);
  });

  it('reports passive runtime facts from config without constructing a provider', async () => {
    const facts = await inspectBlueprintRuntime({
      config: {
        provider: 'autohandai',
        auth: { token: 'never-return-this' },
        autohandai: { plan: 'cloud', model: 'fantail' },
      },
      profile: createAnswerOnlyRuntimeProfile({
        answerOnly: true,
        restricted: true,
        clientContext: 'blueprint',
      }),
      identity: {
        invocationPath: '/bin/autohand',
        resolvedPath: '/opt/autohand/dist/index.js',
        symlinkChain: [{ path: '/bin/autohand', target: '/opt/autohand/dist/index.js' }],
        package: { name: 'autohand-cli', version: '0.8.2', commit: 'abc123' },
        artifacts: [{ path: '/opt/autohand/dist/index.js', size: 12, sha256: 'a'.repeat(64) }],
        identityHash: 'b'.repeat(64),
      },
    });

    expect(facts.authentication).toBe('configured');
    expect(JSON.stringify(facts)).not.toContain('never-return-this');
    expect(facts.toolsEnabled).toBe(false);
    expect(facts.cliIdentity.identityHash).toBe('b'.repeat(64));
  });

  it('blocks network destinations before provider construction or inference', async () => {
    const factory = vi.fn<() => LLMProvider>();
    const valid = parseBlueprintAnswerEnvelope(
      await readGolden('blueprint-answer-contract-v1.valid.json'),
    );

    await expect(runBlueprintAnswer({
      envelope: valid,
      destination: { kind: 'hosted', provider: 'openrouter', origin: 'https://openrouter.ai' },
      providerId: 'openrouter',
      providerFactory: factory,
    })).rejects.toMatchObject({ kind: 'inference_destination_blocked' });
    expect(factory).not.toHaveBeenCalled();
  });

  it('exposes passive inspection without constructing a provider', async () => {
    const providerFactory = vi.fn<() => LLMProvider>();
    const profile = createAnswerOnlyRuntimeProfile({
      answerOnly: true,
      restricted: true,
      clientContext: 'blueprint',
    });
    const runtimeFacts = await inspectBlueprintRuntime({
      config: { provider: 'ollama', ollama: { model: 'qwen' } },
      profile,
      identity: {
        invocationPath: '/bin/autohand',
        resolvedPath: '/opt/autohand/dist/index.js',
        symlinkChain: [{ path: '/bin/autohand', target: '/opt/autohand/dist/index.js' }],
        package: { name: 'autohand-cli', version: '0.8.2' },
        artifacts: [{ path: '/opt/autohand/dist/index.js', size: 12, sha256: 'a'.repeat(64) }],
        identityHash: 'b'.repeat(64),
      },
    });

    const outcome = await handleBlueprintRpcRequest({
      jsonrpc: '2.0',
      method: 'autohand.runtimeInspect',
      id: 1,
    }, {
      config: {
        provider: 'ollama',
        ollama: { model: 'qwen' },
        configPath: '/tmp/config.json',
      },
      profile,
      runtimeFacts,
      providerFactory,
    });

    expect(outcome).toMatchObject({
      terminal: false,
      response: { id: 1, result: { answerOnly: true, toolsEnabled: false } },
    });
    expect(providerFactory).not.toHaveBeenCalled();
  });

  it('treats every unrelated or permission method as a terminal profile error', async () => {
    const profile = createAnswerOnlyRuntimeProfile({
      answerOnly: true,
      restricted: true,
      clientContext: 'blueprint',
    });
    const runtimeFacts = await inspectBlueprintRuntime({
      config: { provider: 'ollama', ollama: { model: 'qwen' } },
      profile,
      identity: {
        invocationPath: '/bin/autohand',
        resolvedPath: '/opt/autohand/dist/index.js',
        symlinkChain: [{ path: '/bin/autohand', target: '/opt/autohand/dist/index.js' }],
        package: { name: 'autohand-cli', version: '0.8.2' },
        artifacts: [{ path: '/opt/autohand/dist/index.js', size: 12, sha256: 'a'.repeat(64) }],
        identityHash: 'b'.repeat(64),
      },
    });
    const outcome = await handleBlueprintRpcRequest({
      jsonrpc: '2.0',
      method: 'autohand.permissionResponse',
      params: { permissionId: 'permission-1', allowed: true },
      id: 2,
    }, {
      config: { configPath: '/tmp/config.json' },
      profile,
      runtimeFacts,
      providerFactory: vi.fn(),
    });

    expect(outcome.terminal).toBe(true);
    expect(outcome.response?.error).toMatchObject({
      code: -32014,
      data: { kind: 'profile_violation', retryable: false },
    });
  });

  it('performs one tool-free completion and strictly validates the full JSON result', async () => {
    const complete = vi.fn(async () => providerResponse(JSON.stringify({
      answer: 'Authentication is owned by ensureAuthenticated.',
      citations: ['evidence-1'],
    })));
    const provider: LLMProvider = {
      getName: () => 'blueprint-local',
      complete,
      listModels: vi.fn(async () => []),
      isAvailable: vi.fn(async () => true),
      setModel: vi.fn(),
    };
    const envelope = parseBlueprintAnswerEnvelope(
      await readGolden('blueprint-answer-contract-v1.valid.json'),
    );

    const result = await runBlueprintAnswer({
      envelope,
      destination: { kind: 'in_process', provider: 'blueprint-local' },
      providerId: 'blueprint-local',
      model: 'local.gguf',
      providerFactory: () => provider,
    });

    expect(result.result).toEqual({
      answer: 'Authentication is owned by ensureAuthenticated.',
      citations: ['evidence-1'],
    });
    expect(complete).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0]?.[0]).toMatchObject({
      stream: false,
      tools: [],
      toolChoice: 'none',
    });
    expect(provider.listModels).not.toHaveBeenCalled();
    expect(provider.isAvailable).not.toHaveBeenCalled();
  });

  it('rejects prose, trailing framing, schema mismatch, and oversized output', async () => {
    const envelope = parseBlueprintAnswerEnvelope(
      await readGolden('blueprint-answer-contract-v1.valid.json'),
    );
    const runWith = (content: string) => runBlueprintAnswer({
      envelope,
      destination: { kind: 'in_process', provider: 'blueprint-local' } as const,
      providerId: 'blueprint-local',
      providerFactory: () => ({
        getName: () => 'blueprint-local',
        complete: async () => providerResponse(content),
        listModels: async () => [],
        isAvailable: async () => true,
        setModel: () => {},
      }),
    });

    await expect(runWith('The answer is ...')).rejects.toMatchObject({ kind: 'output_invalid' });
    await expect(runWith('{"answer":"ok","citations":[]} trailing')).rejects.toMatchObject({
      kind: 'output_invalid',
    });
    await expect(runWith('{"answer":"ok","citations":[],"inventedSuccess":true}')).rejects.toMatchObject({
      kind: 'output_invalid',
    });
    await expect(runWith(' '.repeat(BLUEPRINT_ANSWER_LIMITS.maxOutputBytes + 1))).rejects.toMatchObject({
      kind: 'output_limit_exceeded',
    });
  });
});
