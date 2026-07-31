/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  readFile,
  realpath,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import type {
  GbnfJsonObjectSchema,
  Llama,
  LlamaChatSession,
  LlamaContext,
  LlamaModel,
} from 'node-llama-cpp';

import type {
  BlueprintLocalSettings,
  LLMRequest,
  LLMResponse,
} from '../types.js';
import {
  BLUEPRINT_LOCAL_CONTEXT_TOKENS,
  BLUEPRINT_LOCAL_MAX_OUTPUT_TOKENS,
} from './modelCapabilities.js';
import type {
  LLMProvider,
  LLMProviderCapabilities,
} from './LLMProvider.js';

export const BLUEPRINT_LOCAL_PROVIDER_ID = 'blueprint-local' as const;

export const BLUEPRINT_LOCAL_ENGINE_IDENTITY = Object.freeze({
  packageName: 'node-llama-cpp',
  packageVersion: '3.18.1',
  packageRevision: '57bea3d',
  llamaCppRepository: 'ggml-org/llama.cpp',
  llamaCppRelease: 'b8390',
});

const MAC_ARM64_NATIVE_FILES = Object.freeze({
  '_nlcBuildMetadata.json': 'f5281c75dde72de4d9d0fa26801dddcfabda07b23f0e418d5bdca822a7c29f29',
  'libggml-base.dylib': '35bab443383d1a5caaabe574a8d9afda910967c42218d5bba58849a6736e2f41',
  'libggml-blas.so': 'f60c3cc89ffb053abdd9a3b845bc4881d5edccc135fa74d7293316190a7d4877',
  'libggml-cpu.so': '7708099615c6746e7f4b5e0e0b547a8a9bd6da5a63407620f815ded39f4e63ae',
  'libggml-metal.so': '111d0052ec2e336c4aeab185b8f7c92c8dea0cca0500840d850e97d54cffd2d6',
  'libggml.metal.b8390.dylib': '76061a95edb70a10ae064406321b3fe9bfe4984ffedcb31bb82f63b72ddd7492',
  'libllama.metal.b8390.dylib': 'c39f606829f7be6afa031d8de4417af94151ab2fb0a60c3971256fc4e916a88f',
  'llama-addon.node': 'd7ceb753cf2dfdbd62045322920d7b840afe194ceccb3968598a030c764d65b2',
});

const BLUEPRINT_LOCAL_ALLOWED_SETTING_KEYS = new Set([
  'model',
  'modelPath',
  'modelSha256',
]);

const requireFromProvider = createRequire(import.meta.url);

export type BlueprintLocalProviderErrorKind =
  | 'local_model_setup_required'
  | 'local_model_invalid'
  | 'local_engine_unavailable'
  | 'inference_failed';

export class BlueprintLocalProviderError extends Error {
  constructor(
    public readonly kind: BlueprintLocalProviderErrorKind,
    message: string,
    public readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'BlueprintLocalProviderError';
  }
}

export interface VerifiedBlueprintLocalModel {
  model: string;
  modelPath: string;
  modelSha256: string;
  size: number;
}

export interface BlueprintLocalNativePackageIdentity {
  enginePackage: string;
  engineVersion: string;
  nativePackage: string;
  nativeVersion: string;
  llamaCppRelease: string;
  platform: 'darwin-arm64';
}

export interface BlueprintLocalEngineResult {
  content: string;
  stopReason: string;
}

export interface BlueprintLocalEngineGenerateOptions {
  modelPath: string;
  systemPrompt: string;
  classifiedEnvelope: string;
  outputSchema: Record<string, unknown>;
  maxTokens: number;
  signal?: AbortSignal;
}

export interface BlueprintLocalEngine {
  readonly buildType: string;
  readonly llamaCppRelease: {
    readonly repo: string;
    readonly release: string;
  };
  generate(options: BlueprintLocalEngineGenerateOptions): Promise<BlueprintLocalEngineResult>;
  dispose(): Promise<void>;
}

export type BlueprintLocalEngineLoader = () => Promise<BlueprintLocalEngine>;
export type BlueprintLocalNativePackageInspector =
  () => Promise<BlueprintLocalNativePackageIdentity>;

class BlueprintLocalEngineStageError extends Error {
  constructor(
    public readonly stage: 'model_load' | 'inference' | 'cleanup',
    options?: ErrorOptions,
  ) {
    super(`Blueprint local engine failed during ${stage}.`, options);
    this.name = 'BlueprintLocalEngineStageError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizedSettings(settings: BlueprintLocalSettings): BlueprintLocalSettings {
  if (!isRecord(settings)) {
    throw new BlueprintLocalProviderError(
      'local_model_setup_required',
      'Configure blueprintLocal.model, modelPath, and modelSha256 before using local answers.',
    );
  }
  const unsupportedKey = Object.keys(settings)
    .find((key) => !BLUEPRINT_LOCAL_ALLOWED_SETTING_KEYS.has(key));
  if (unsupportedKey) {
    throw new BlueprintLocalProviderError(
      'local_model_setup_required',
      `blueprintLocal.${unsupportedKey} is not supported.`,
    );
  }

  const model = settings.model?.trim();
  const modelPath = settings.modelPath?.trim();
  const modelSha256 = settings.modelSha256?.trim();
  if (
    !model
    || !/^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/u.test(model)
    || !modelPath
    || !modelSha256
  ) {
    throw new BlueprintLocalProviderError(
      'local_model_setup_required',
      'Configure a safe model label, canonical absolute GGUF path, and lowercase SHA-256.',
    );
  }
  if (!/^[a-f0-9]{64}$/u.test(modelSha256)) {
    throw new BlueprintLocalProviderError(
      'local_model_setup_required',
      'blueprintLocal.modelSha256 must be one lowercase SHA-256.',
    );
  }
  if (!path.isAbsolute(modelPath) || path.resolve(modelPath) !== modelPath) {
    throw new BlueprintLocalProviderError(
      'local_model_setup_required',
      'blueprintLocal.modelPath must be a canonical absolute path.',
    );
  }
  if (path.extname(modelPath) !== '.gguf') {
    throw new BlueprintLocalProviderError(
      'local_model_setup_required',
      'blueprintLocal.modelPath must identify a .gguf file.',
    );
  }
  return { model, modelPath, modelSha256 };
}

interface StableFileIdentity {
  device: bigint;
  inode: bigint;
  size: bigint;
  modifiedNanoseconds: bigint;
}

async function stableFileIdentity(filePath: string): Promise<StableFileIdentity> {
  let metadata;
  try {
    metadata = await lstat(filePath, { bigint: true });
  } catch (error) {
    throw new BlueprintLocalProviderError(
      'local_model_setup_required',
      'The configured local GGUF file is unavailable.',
      false,
      { cause: error },
    );
  }
  if (!metadata.isFile()) {
    throw new BlueprintLocalProviderError(
      'local_model_setup_required',
      'The configured local GGUF path must be a regular file.',
    );
  }
  return {
    device: metadata.dev,
    inode: metadata.ino,
    size: metadata.size,
    modifiedNanoseconds: metadata.mtimeNs,
  };
}

function sameFileIdentity(left: StableFileIdentity, right: StableFileIdentity): boolean {
  return left.device === right.device
    && left.inode === right.inode
    && left.size === right.size
    && left.modifiedNanoseconds === right.modifiedNanoseconds;
}

async function sha256File(filePath: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath, {
    ...(signal ? { signal } : {}),
  });
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

export async function verifyBlueprintLocalModelArtifact(
  settings: BlueprintLocalSettings,
  signal?: AbortSignal,
): Promise<VerifiedBlueprintLocalModel> {
  const normalized = normalizedSettings(settings);
  const canonicalPath = await realpath(normalized.modelPath).catch((error: unknown) => {
    throw new BlueprintLocalProviderError(
      'local_model_setup_required',
      'The configured local GGUF file is unavailable.',
      false,
      { cause: error },
    );
  });
  if (canonicalPath !== normalized.modelPath) {
    throw new BlueprintLocalProviderError(
      'local_model_setup_required',
      'blueprintLocal.modelPath must be the canonical regular-file path, not a symlink.',
    );
  }

  const before = await stableFileIdentity(canonicalPath);
  if (before.size <= 0n) {
    throw new BlueprintLocalProviderError(
      'local_model_invalid',
      'The configured local GGUF file is empty.',
    );
  }

  let actualSha256: string;
  try {
    actualSha256 = await sha256File(canonicalPath, signal);
  } catch (error) {
    if (error instanceof BlueprintLocalProviderError) throw error;
    throw new BlueprintLocalProviderError(
      'local_model_invalid',
      'The configured local GGUF bytes could not be verified.',
      false,
      { cause: error },
    );
  }
  const after = await stableFileIdentity(canonicalPath);
  if (!sameFileIdentity(before, after)) {
    throw new BlueprintLocalProviderError(
      'local_model_invalid',
      'The configured local GGUF file changed while it was being verified.',
    );
  }
  if (actualSha256 !== normalized.modelSha256) {
    throw new BlueprintLocalProviderError(
      'local_model_invalid',
      'The configured local GGUF SHA-256 does not match its bytes.',
    );
  }
  return {
    ...normalized,
    size: Number(after.size),
  };
}

function assertSupportedPlatform(
  platform = process.platform,
  architecture = process.arch,
): asserts platform is 'darwin' {
  if (platform !== 'darwin' || architecture !== 'arm64') {
    throw new BlueprintLocalProviderError(
      'local_engine_unavailable',
      `Blueprint local inference is unavailable on ${platform}-${architecture}.`,
    );
  }
}

async function findPackageRoot(packageName: string): Promise<string> {
  let current = path.dirname(requireFromProvider.resolve(packageName));
  while (true) {
    try {
      const manifest = JSON.parse(
        await readFile(path.join(current, 'package.json'), 'utf8'),
      ) as { name?: unknown };
      if (manifest.name === packageName) return current;
    } catch {
      // Continue toward the package root.
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new BlueprintLocalProviderError(
        'local_engine_unavailable',
        'The pinned Blueprint local inference package is unavailable.',
      );
    }
    current = parent;
  }
}

async function readPackageVersion(packageRoot: string): Promise<string> {
  const manifest = JSON.parse(
    await readFile(path.join(packageRoot, 'package.json'), 'utf8'),
  ) as { version?: unknown };
  return typeof manifest.version === 'string' ? manifest.version : '';
}

export async function inspectBlueprintLocalNativePackage(
  platform = process.platform,
  architecture = process.arch,
): Promise<BlueprintLocalNativePackageIdentity> {
  assertSupportedPlatform(platform, architecture);

  let engineRoot: string;
  let nativeRoot: string;
  try {
    [engineRoot, nativeRoot] = await Promise.all([
      findPackageRoot(BLUEPRINT_LOCAL_ENGINE_IDENTITY.packageName),
      findPackageRoot('@node-llama-cpp/mac-arm64-metal'),
    ]);
  } catch (error) {
    if (error instanceof BlueprintLocalProviderError) throw error;
    throw new BlueprintLocalProviderError(
      'local_engine_unavailable',
      'The pinned Blueprint local inference package is unavailable.',
      false,
      { cause: error },
    );
  }

  const [engineVersion, nativeVersion, llamaInfoText] = await Promise.all([
    readPackageVersion(engineRoot),
    readPackageVersion(nativeRoot),
    readFile(path.join(engineRoot, 'llama', 'llama.cpp.info.json'), 'utf8'),
  ]);
  const llamaInfo = JSON.parse(llamaInfoText) as {
    tag?: unknown;
    llamaCppGithubRepo?: unknown;
  };
  if (
    engineVersion !== BLUEPRINT_LOCAL_ENGINE_IDENTITY.packageVersion
    || nativeVersion !== BLUEPRINT_LOCAL_ENGINE_IDENTITY.packageVersion
    || llamaInfo.tag !== BLUEPRINT_LOCAL_ENGINE_IDENTITY.llamaCppRelease
    || llamaInfo.llamaCppGithubRepo !== BLUEPRINT_LOCAL_ENGINE_IDENTITY.llamaCppRepository
  ) {
    throw new BlueprintLocalProviderError(
      'local_engine_unavailable',
      'The installed Blueprint local inference package does not match the pinned engine identity.',
    );
  }

  const binsDirectory = path.join(nativeRoot, 'bins', 'mac-arm64-metal');
  for (const [fileName, expectedSha256] of Object.entries(MAC_ARM64_NATIVE_FILES)) {
    let actualSha256: string;
    try {
      actualSha256 = await sha256File(path.join(binsDirectory, fileName));
    } catch (error) {
      throw new BlueprintLocalProviderError(
        'local_engine_unavailable',
        'The pinned Blueprint local native package is incomplete.',
        false,
        { cause: error },
      );
    }
    if (actualSha256 !== expectedSha256) {
      throw new BlueprintLocalProviderError(
        'local_engine_unavailable',
        'The pinned Blueprint local native package failed its binary digest check.',
      );
    }
  }

  return {
    enginePackage: BLUEPRINT_LOCAL_ENGINE_IDENTITY.packageName,
    engineVersion,
    nativePackage: '@node-llama-cpp/mac-arm64-metal',
    nativeVersion,
    llamaCppRelease: BLUEPRINT_LOCAL_ENGINE_IDENTITY.llamaCppRelease,
    platform: 'darwin-arm64',
  };
}

async function disposeEngineResources(
  session: LlamaChatSession | undefined,
  context: LlamaContext | undefined,
  model: LlamaModel | undefined,
): Promise<void> {
  let disposalFailed = false;
  try {
    session?.dispose({ disposeSequence: true });
  } catch {
    disposalFailed = true;
  }
  try {
    await context?.dispose();
  } catch {
    disposalFailed = true;
  }
  try {
    await model?.dispose();
  } catch {
    disposalFailed = true;
  }
  if (disposalFailed) {
    throw new BlueprintLocalEngineStageError('cleanup');
  }
}

function createProductionEngine(llama: Llama): BlueprintLocalEngine {
  return {
    buildType: llama.buildType,
    llamaCppRelease: llama.llamaCppRelease,
    async generate(options): Promise<BlueprintLocalEngineResult> {
      let model: LlamaModel | undefined;
      let context: LlamaContext | undefined;
      let session: LlamaChatSession | undefined;
      let result: BlueprintLocalEngineResult | undefined;
      let failure: unknown;
      let stage: 'model_load' | 'inference' = 'model_load';
      try {
        model = await llama.loadModel({
          modelPath: options.modelPath,
          gpuLayers: 'auto',
          useMmap: true,
          useDirectIo: false,
          useMlock: false,
          checkTensors: true,
          ...(options.signal ? { loadSignal: options.signal } : {}),
        });
        stage = 'inference';
        context = await model.createContext({
          sequences: 1,
          contextSize: {
            min: 8_192,
            max: BLUEPRINT_LOCAL_CONTEXT_TOKENS,
          },
        });
        const nodeLlama = await import('node-llama-cpp');
        session = new nodeLlama.LlamaChatSession({
          contextSequence: context.getSequence(),
          systemPrompt: options.systemPrompt,
          autoDisposeSequence: true,
        });
        const grammar = await llama.createGrammarForJsonSchema(
          options.outputSchema as unknown as GbnfJsonObjectSchema,
        );
        const generated = await session.promptWithMeta(
          options.classifiedEnvelope,
          {
            grammar,
            maxTokens: options.maxTokens,
            temperature: 0,
            trimWhitespaceSuffix: true,
            stopOnAbortSignal: false,
            ...(options.signal ? { signal: options.signal } : {}),
          },
        );
        result = {
          content: generated.responseText,
          stopReason: generated.stopReason,
        };
      } catch (error) {
        failure = error instanceof BlueprintLocalEngineStageError
          ? error
          : new BlueprintLocalEngineStageError(stage, { cause: error });
      }

      try {
        await disposeEngineResources(session, context, model);
      } catch (error) {
        failure ??= error;
      }
      if (failure) throw failure;
      if (!result) {
        throw new BlueprintLocalEngineStageError('inference');
      }
      return result;
    },
    dispose: () => llama.dispose(),
  };
}

const loadProductionEngine: BlueprintLocalEngineLoader = async () => {
  const nodeLlama = await import('node-llama-cpp');
  const llama = await nodeLlama.getLlama({
    gpu: 'metal',
    build: 'never',
    skipDownload: true,
    usePrebuiltBinaries: true,
    progressLogs: false,
    logger: () => {},
    debug: false,
    numa: false,
  });
  return createProductionEngine(llama);
};

function requireAnswerOnlyRequest(request: LLMRequest): {
  systemPrompt: string;
  classifiedEnvelope: string;
  outputSchema: Record<string, unknown>;
} {
  const [systemMessage, userMessage] = request.messages;
  if (
    request.messages.length !== 2
    || systemMessage?.role !== 'system'
    || userMessage?.role !== 'user'
    || request.stream !== false
    || request.toolChoice !== 'none'
    || (request.tools?.length ?? 0) !== 0
    || !isRecord(request.outputSchema)
  ) {
    throw new BlueprintLocalProviderError(
      'inference_failed',
      'Blueprint local inference accepts only one strict, tool-free answer request.',
    );
  }
  return {
    systemPrompt: systemMessage.content,
    classifiedEnvelope: userMessage.content,
    outputSchema: request.outputSchema,
  };
}

function assertEngineIdentity(engine: BlueprintLocalEngine): void {
  if (
    engine.buildType !== 'prebuilt'
    || engine.llamaCppRelease.repo !== BLUEPRINT_LOCAL_ENGINE_IDENTITY.llamaCppRepository
    || engine.llamaCppRelease.release !== BLUEPRINT_LOCAL_ENGINE_IDENTITY.llamaCppRelease
  ) {
    throw new BlueprintLocalProviderError(
      'local_engine_unavailable',
      'The loaded Blueprint local engine does not match the pinned prebuilt identity.',
    );
  }
}

function providerErrorForEngineFailure(error: unknown): BlueprintLocalProviderError {
  if (error instanceof BlueprintLocalProviderError) return error;
  if (error instanceof BlueprintLocalEngineStageError && error.stage === 'model_load') {
    return new BlueprintLocalProviderError(
      'local_model_invalid',
      'The configured GGUF is invalid or incompatible with the pinned local engine.',
      false,
      { cause: error },
    );
  }
  return new BlueprintLocalProviderError(
    'inference_failed',
    'The pinned local engine failed to produce a structured answer.',
    true,
    { cause: error },
  );
}

export class BlueprintLocalProvider implements LLMProvider {
  private readonly settings: BlueprintLocalSettings;

  constructor(
    settings: BlueprintLocalSettings,
    private readonly engineLoader: BlueprintLocalEngineLoader = loadProductionEngine,
    private readonly nativePackageInspector: BlueprintLocalNativePackageInspector =
      inspectBlueprintLocalNativePackage,
  ) {
    this.settings = normalizedSettings(settings);
  }

  getName(): string {
    return BLUEPRINT_LOCAL_PROVIDER_ID;
  }

  getCapabilities(): LLMProviderCapabilities {
    return { nativeToolCalling: false };
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const answerRequest = requireAnswerOnlyRequest(request);
    if (request.model && request.model !== this.settings.model) {
      throw new BlueprintLocalProviderError(
        'local_model_setup_required',
        'The requested model label does not match blueprintLocal.model.',
      );
    }
    await verifyBlueprintLocalModelArtifact(this.settings, request.signal);
    await this.nativePackageInspector();

    let engine: BlueprintLocalEngine | undefined;
    let generated: BlueprintLocalEngineResult | undefined;
    let failure: unknown;
    try {
      try {
        engine = await this.engineLoader();
      } catch (error) {
        throw new BlueprintLocalProviderError(
          'local_engine_unavailable',
          'The pinned Blueprint local native engine could not be loaded.',
          false,
          { cause: error },
        );
      }
      assertEngineIdentity(engine);
      generated = await engine.generate({
        modelPath: this.settings.modelPath,
        systemPrompt: answerRequest.systemPrompt,
        classifiedEnvelope: answerRequest.classifiedEnvelope,
        outputSchema: answerRequest.outputSchema,
        maxTokens: Math.min(
          request.maxTokens ?? BLUEPRINT_LOCAL_MAX_OUTPUT_TOKENS,
          BLUEPRINT_LOCAL_MAX_OUTPUT_TOKENS,
        ),
        ...(request.signal ? { signal: request.signal } : {}),
      });
    } catch (error) {
      failure = providerErrorForEngineFailure(error);
    }

    if (engine) {
      try {
        await engine.dispose();
      } catch (error) {
        failure ??= new BlueprintLocalProviderError(
          'inference_failed',
          'The pinned local engine failed to shut down cleanly.',
          true,
          { cause: error },
        );
      }
    }
    if (failure) throw failure;
    if (!generated) {
      throw new BlueprintLocalProviderError(
        'inference_failed',
        'The pinned local engine returned no terminal result.',
        true,
      );
    }

    return {
      id: `blueprint-local-${randomUUID()}`,
      created: Date.now(),
      content: generated.content,
      finishReason: generated.stopReason === 'maxTokens' ? 'length' : 'stop',
      raw: {
        engine: BLUEPRINT_LOCAL_ENGINE_IDENTITY.packageName,
        engineVersion: BLUEPRINT_LOCAL_ENGINE_IDENTITY.packageVersion,
        llamaCppRelease: BLUEPRINT_LOCAL_ENGINE_IDENTITY.llamaCppRelease,
        stopReason: generated.stopReason,
      },
    };
  }

  async listModels(): Promise<string[]> {
    return [this.settings.model];
  }

  async isAvailable(): Promise<boolean> {
    try {
      await verifyBlueprintLocalModelArtifact(this.settings);
      await this.nativePackageInspector();
      return true;
    } catch {
      return false;
    }
  }

  setModel(model: string): void {
    if (model !== this.settings.model) {
      throw new BlueprintLocalProviderError(
        'local_model_setup_required',
        'Blueprint local inference cannot replace its hash-bound model at runtime.',
      );
    }
  }
}
