/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import {
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  BlueprintLocalProvider,
  BlueprintLocalProviderError,
  inspectBlueprintLocalNativePackage,
  verifyBlueprintLocalModelArtifact,
  type BlueprintLocalEngine,
  type BlueprintLocalEngineGenerateOptions,
  type BlueprintLocalNativePackageIdentity,
} from '../../src/providers/BlueprintLocalProvider.js';
import { ProviderFactory } from '../../src/providers/ProviderFactory.js';
import type {
  BlueprintLocalSettings,
  LLMRequest,
} from '../../src/types.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(
    (directory) => rm(directory, { recursive: true, force: true }),
  ));
});

async function modelFixture(bytes = Buffer.from('test-only-gguf-bytes')): Promise<{
  settings: BlueprintLocalSettings;
  modelPath: string;
}> {
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), 'blueprint-local-provider-')),
  );
  temporaryDirectories.push(directory);
  const modelPath = path.join(directory, 'model.gguf');
  await writeFile(modelPath, bytes);
  return {
    modelPath,
    settings: {
      model: 'test-model-q4',
      modelPath,
      modelSha256: createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

function nativeIdentity(): BlueprintLocalNativePackageIdentity {
  return {
    enginePackage: 'node-llama-cpp',
    engineVersion: '3.18.1',
    nativePackage: '@node-llama-cpp/mac-arm64-metal',
    nativeVersion: '3.18.1',
    llamaCppRelease: 'b8390',
    platform: 'darwin-arm64',
  };
}

function answerRequest(model = 'test-model-q4'): LLMRequest {
  return {
    messages: [
      {
        role: 'system',
        content: 'Return one strict JSON value from the classified envelope.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          purpose: 'blueprint_classified_answer',
          policyHash: 'a'.repeat(64),
          artifacts: [{ id: 'evidence-1', class: 'code', content: 'source' }],
        }),
      },
    ],
    model,
    maxTokens: 16_384,
    stream: false,
    tools: [],
    toolChoice: 'none',
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        answer: { type: 'string' },
      },
      required: ['answer'],
    },
  };
}

describe('BlueprintLocalProvider', () => {
  it('verifies bytes before one constrained in-process generation and disposes the engine', async () => {
    const { settings, modelPath } = await modelFixture();
    const generate = vi.fn(async (
      _options: BlueprintLocalEngineGenerateOptions,
    ) => ({
      content: '{"answer":"test-double-result"}',
      stopReason: 'eogToken',
    }));
    const dispose = vi.fn(async () => {});
    const engine: BlueprintLocalEngine = {
      buildType: 'prebuilt',
      llamaCppRelease: {
        repo: 'ggml-org/llama.cpp',
        release: 'b8390',
      },
      generate,
      dispose,
    };
    const engineLoader = vi.fn(async () => engine);
    const inspectNativePackage = vi.fn(async () => nativeIdentity());
    const provider = new BlueprintLocalProvider(
      settings,
      engineLoader,
      inspectNativePackage,
    );

    const response = await provider.complete(answerRequest());

    expect(response.content).toBe('{"answer":"test-double-result"}');
    expect(response.raw).toMatchObject({
      engine: 'node-llama-cpp',
      engineVersion: '3.18.1',
      llamaCppRelease: 'b8390',
    });
    expect(engineLoader).toHaveBeenCalledOnce();
    expect(inspectNativePackage).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledWith({
      modelPath,
      systemPrompt: 'Return one strict JSON value from the classified envelope.',
      classifiedEnvelope: expect.stringContaining('blueprint_classified_answer'),
      outputSchema: answerRequest().outputSchema,
      maxTokens: 4_096,
    });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('does not load the native engine after a model hash mismatch', async () => {
    const { settings, modelPath } = await modelFixture();
    await writeFile(modelPath, 'changed-after-configuration');
    const engineLoader = vi.fn();
    const inspectNativePackage = vi.fn(async () => nativeIdentity());
    const provider = new BlueprintLocalProvider(
      settings,
      engineLoader,
      inspectNativePackage,
    );

    await expect(provider.complete(answerRequest())).rejects.toMatchObject({
      kind: 'local_model_invalid',
    });
    expect(engineLoader).not.toHaveBeenCalled();
    expect(inspectNativePackage).not.toHaveBeenCalled();
  });

  it('rejects arbitrary executable and argument fields in local settings', async () => {
    const { settings } = await modelFixture();
    const unsafeSettings = {
      ...settings,
      executable: '/tmp/llama',
      args: ['--listen'],
    } as unknown as BlueprintLocalSettings;

    expect(() => new BlueprintLocalProvider(unsafeSettings)).toThrow(
      expect.objectContaining({
        kind: 'local_model_setup_required',
        message: expect.stringContaining('not supported'),
      }),
    );
  });

  it('requires a canonical regular-file .gguf path', async () => {
    const { settings, modelPath } = await modelFixture();
    const linkedPath = path.join(path.dirname(modelPath), 'linked.gguf');
    await symlink(modelPath, linkedPath);

    await expect(verifyBlueprintLocalModelArtifact({
      ...settings,
      modelPath: linkedPath,
    })).rejects.toMatchObject({
      kind: 'local_model_setup_required',
      message: expect.stringContaining('canonical'),
    });
  });

  it('rejects tools, streaming, and requests without a strict output schema', async () => {
    const { settings } = await modelFixture();
    const provider = new BlueprintLocalProvider(
      settings,
      vi.fn(),
      vi.fn(async () => nativeIdentity()),
    );
    const request = answerRequest();
    delete request.outputSchema;
    request.tools = [{ name: 'shell', description: 'must stay disabled' }];

    await expect(provider.complete(request)).rejects.toMatchObject({
      kind: 'inference_failed',
    });
  });

  it('reports unsupported platforms as unavailable without probing packages', async () => {
    await expect(inspectBlueprintLocalNativePackage('linux', 'x64')).rejects.toEqual(
      expect.objectContaining<Partial<BlueprintLocalProviderError>>({
        kind: 'local_engine_unavailable',
        message: expect.stringContaining('linux-x64'),
      }),
    );
  });

  it('keeps blueprint-local out of the normal provider factory', async () => {
    const { settings } = await modelFixture();
    const config = {
      provider: 'blueprint-local',
      blueprintLocal: settings,
    } as const;

    expect(ProviderFactory.create(config).getName()).toBe('unconfigured');
    expect(ProviderFactory.createBlueprintAnswerProvider(config).getName())
      .toBe('blueprint-local');
    expect(ProviderFactory.getProviderNames(config)).not.toContain('blueprint-local');
  });
});
