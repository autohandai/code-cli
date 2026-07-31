/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import {
  lstat,
  readFile,
  readdir,
  readlink,
  realpath,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { z } from 'zod';

import type { AutohandConfig, LoadedConfig } from '../../types.js';
import type {
  AuthenticationState,
  BlueprintAnswerEnvelope,
  BlueprintAnswerResult,
  BlueprintCliIdentity,
  InferenceDestination,
  RpcClientContext,
  RuntimeFacts,
} from './types.js';
import type { LLMProvider } from '../../providers/LLMProvider.js';
import {
  BlueprintLocalProviderError,
  BLUEPRINT_LOCAL_PROVIDER_ID,
  inspectBlueprintLocalNativePackage,
  verifyBlueprintLocalModelArtifact,
} from '../../providers/BlueprintLocalProvider.js';
import { runtimeVersion } from '../../utils/runtimeVersion.js';

export const BLUEPRINT_ANSWER_CONTRACT_VERSION = 1 as const;

export const BLUEPRINT_ARTIFACT_CLASSES = [
  'code',
  'source_snippet',
  'symbol',
  'repository_path',
  'comment',
  'diff',
  'lineage',
  'rationale',
  'design_record',
  'document_chunk',
  'media_chunk',
  'binary_media',
  'credential',
] as const;

export const BLUEPRINT_ANSWER_LIMITS = {
  maxInputBytes: 8 * 1024,
  maxOutputBytes: 64 * 1024,
  maxArtifacts: 64,
} as const;

export type BlueprintAnswerErrorKind =
  | 'profile_violation'
  | 'contract_invalid'
  | 'input_limit_exceeded'
  | 'authentication_required'
  | 'inference_destination_blocked'
  | 'inference_failed'
  | 'local_model_setup_required'
  | 'local_model_invalid'
  | 'local_engine_unavailable'
  | 'output_invalid'
  | 'output_limit_exceeded'
  | 'identity_unavailable';

export class BlueprintAnswerError extends Error {
  constructor(
    public readonly kind: BlueprintAnswerErrorKind,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'BlueprintAnswerError';
  }
}

export interface AnswerOnlyRuntimeProfile {
  answerOnly: true;
  clientContext: 'blueprint';
  permissionMode: 'restricted';
  toolsEnabled: false;
  hooksEnabled: false;
  mcpEnabled: false;
  memoryEnabled: false;
  telemetryEnabled: false;
  backgroundWorkEnabled: false;
  browserEnabled: false;
  sessionPersistenceEnabled: false;
}

interface AnswerOnlyLaunchOptions {
  answerOnly?: boolean;
  restricted?: boolean;
  clientContext?: RpcClientContext | string;
}

const artifactSchema = z.strictObject({
  id: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/u),
  class: z.enum(BLUEPRINT_ARTIFACT_CLASSES),
  content: z.string().min(1).max(BLUEPRINT_ANSWER_LIMITS.maxInputBytes),
});

const outputSchemaSchema = z.object({
  type: z.literal('object'),
  additionalProperties: z.literal(false),
  properties: z.record(z.string(), z.unknown()),
  required: z.array(z.string()).max(128),
}).loose();

const envelopeSchema = z.strictObject({
  contractVersion: z.literal(BLUEPRINT_ANSWER_CONTRACT_VERSION),
  policyHash: z.string().regex(/^[a-f0-9]{64}$/u),
  artifacts: z.array(artifactSchema)
    .min(1)
    .max(BLUEPRINT_ANSWER_LIMITS.maxArtifacts),
  outputSchema: outputSchemaSchema,
});

function serializedByteLength(value: unknown): number {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new BlueprintAnswerError('contract_invalid', 'Answer envelope must be JSON serializable.');
  }
  return Buffer.byteLength(serialized, 'utf8');
}

function compileOutputSchema(outputSchema: Record<string, unknown>): z.ZodType {
  try {
    return z.fromJSONSchema(
      outputSchema as Parameters<typeof z.fromJSONSchema>[0],
    );
  } catch {
    throw new BlueprintAnswerError(
      'contract_invalid',
      'outputSchema is not a supported strict JSON Schema.',
    );
  }
}

export function parseBlueprintAnswerEnvelope(input: unknown): BlueprintAnswerEnvelope {
  const parsed = envelopeSchema.safeParse(input);
  if (!parsed.success) {
    throw new BlueprintAnswerError(
      'contract_invalid',
      'Answer envelope does not match contract version 1.',
    );
  }

  if (new Set(parsed.data.artifacts.map((artifact) => artifact.id)).size
      !== parsed.data.artifacts.length) {
    throw new BlueprintAnswerError('contract_invalid', 'Artifact ids must be unique.');
  }

  const propertyNames = new Set(Object.keys(parsed.data.outputSchema.properties));
  if (new Set(parsed.data.outputSchema.required).size !== parsed.data.outputSchema.required.length
      || parsed.data.outputSchema.required.some((name) => !propertyNames.has(name))) {
    throw new BlueprintAnswerError(
      'contract_invalid',
      'outputSchema.required must contain unique declared property names.',
    );
  }

  compileOutputSchema(parsed.data.outputSchema);
  if (serializedByteLength(parsed.data) > BLUEPRINT_ANSWER_LIMITS.maxInputBytes) {
    throw new BlueprintAnswerError(
      'input_limit_exceeded',
      `Serialized answer input exceeds ${BLUEPRINT_ANSWER_LIMITS.maxInputBytes} bytes.`,
    );
  }

  return parsed.data;
}

export function createAnswerOnlyRuntimeProfile(
  options: AnswerOnlyLaunchOptions,
): AnswerOnlyRuntimeProfile {
  if (options.answerOnly !== true
      || options.restricted !== true
      || options.clientContext !== 'blueprint') {
    throw new BlueprintAnswerError(
      'profile_violation',
      'Blueprint answer-only mode requires --answer-only --restricted --client-context blueprint.',
    );
  }

  return {
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
  };
}

export function applyAnswerOnlyRuntimeConfig(config: LoadedConfig): LoadedConfig {
  return {
    ...config,
    ui: {
      ...config.ui,
      checkForUpdates: false,
      notifications: false,
      promptSuggestions: false,
    },
    permissions: {
      ...config.permissions,
      mode: 'restricted',
      rememberSession: false,
    },
    hooks: {
      ...config.hooks,
      enabled: false,
      hooks: [],
    },
    mcp: {
      ...config.mcp,
      enabled: false,
      servers: [],
    },
    agent: {
      ...config.agent,
      autoMemory: false,
      enableRequestQueue: false,
    },
    telemetry: {
      ...config.telemetry,
      enabled: false,
      enableSessionSync: false,
    },
    autoReport: {
      ...config.autoReport,
      enabled: false,
    },
    sync: {
      ...config.sync,
      enabled: false,
    },
    communitySkills: {
      ...config.communitySkills,
      enabled: false,
      showSuggestionsOnStartup: false,
      autoBackup: false,
    },
    externalAgents: {
      enabled: false,
      paths: [],
    },
    teams: {
      ...config.teams,
      enabled: false,
    },
    chrome: {
      ...config.chrome,
      enabledByDefault: false,
    },
  };
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeOrigin(endpoint: string | undefined): string | undefined {
  if (!endpoint) return undefined;
  try {
    const url = new URL(endpoint);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:')
        || url.username
        || url.password) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function isLoopbackOrigin(origin: string): boolean {
  const hostname = new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname.endsWith('.localhost');
}

function classifyKnownEndpoint(
  provider: string,
  endpoint: string | undefined,
): InferenceDestination {
  const origin = normalizeOrigin(endpoint);
  if (!origin) return { kind: 'opaque' };
  if (isLoopbackOrigin(origin)) {
    return { kind: 'local_service', provider, origin };
  }
  return { kind: 'hosted', provider, origin };
}

function configuredProviderEndpoint(
  config: AutohandConfig,
  provider: string,
): string | undefined {
  switch (provider) {
    case 'autohandai': {
      const settings = config.autohandai;
      if (!settings) return undefined;
      if (settings.baseUrl) return settings.baseUrl;
      return settings.plan === 'local'
        ? `http://localhost:${settings.port || 8080}`
        : 'https://api.autohand.ai/v1';
    }
    case 'ollama':
      return config.ollama?.baseUrl
        ?? `http://localhost:${config.ollama?.port || 11434}`;
    case 'llamacpp':
      return config.llamacpp?.baseUrl
        ?? `http://localhost:${config.llamacpp?.port || 8080}`;
    case 'mlx':
      return config.mlx?.baseUrl
        ?? `http://localhost:${config.mlx?.port || 8080}`;
    case 'openrouter':
      return config.openrouter?.baseUrl ?? 'https://openrouter.ai/api/v1';
    case 'openai':
      if (config.openai?.baseUrl) return config.openai.baseUrl;
      return config.openai?.authMode === 'chatgpt'
        ? 'https://chatgpt.com/backend-api/codex'
        : 'https://api.openai.com/v1';
    case 'llmgateway':
      return config.llmgateway?.baseUrl ?? 'https://api.llmgateway.io/v1';
    case 'azure':
      if (config.azure?.baseUrl) return config.azure.baseUrl;
      if (config.azure?.resourceName?.startsWith('http://')
          || config.azure?.resourceName?.startsWith('https://')) {
        return config.azure.resourceName;
      }
      return config.azure?.resourceName
        ? `https://${config.azure.resourceName}.openai.azure.com`
        : undefined;
    case 'zai':
      return config.zai?.baseUrl ?? 'https://api.z.ai/api/paas/v4';
    case 'sakana':
      return config.sakana?.baseUrl ?? 'https://api.sakana.ai/v1';
    case 'vertexai':
      return `https://${config.vertexai?.endpoint ?? 'aiplatform.googleapis.com'}`;
    case 'xai':
      if (config.xai?.baseUrl) return config.xai.baseUrl;
      return config.xai?.authMode === 'oauth'
        ? 'https://cli-chat-proxy.grok.com/v1'
        : 'https://api.x.ai/v1';
    case 'cerebras':
      return config.cerebras?.baseUrl ?? 'https://api.cerebras.ai/v1';
    case 'nvidia':
      return config.nvidia?.baseUrl ?? 'https://integrate.api.nvidia.com/v1';
    case 'deepseek':
      return config.deepseek?.baseUrl ?? 'https://api.deepseek.com';
    case 'bedrock':
      return config.bedrock?.endpoint
        ?? (config.bedrock?.region
          ? `https://bedrock-runtime.${config.bedrock.region}.amazonaws.com`
          : undefined);
    default:
      return undefined;
  }
}

export function classifyInferenceDestination(
  config: AutohandConfig,
): InferenceDestination {
  const provider = typeof config.provider === 'string'
    ? config.provider
    : 'openrouter';
  if (provider === BLUEPRINT_LOCAL_PROVIDER_ID) {
    return { kind: 'in_process', provider };
  }
  if (provider.startsWith('custom:') || provider.startsWith('extension:')) {
    return { kind: 'opaque' };
  }

  const endpoint = configuredProviderEndpoint(config, provider);
  if (!endpoint) {
    const knownHosted = new Set([
      'openrouter',
      'openai',
      'llmgateway',
      'azure',
      'zai',
      'sakana',
      'vertexai',
      'xai',
      'cerebras',
      'nvidia',
      'deepseek',
      'bedrock',
    ]);
    return knownHosted.has(provider)
      ? { kind: 'hosted', provider }
      : { kind: 'opaque' };
  }
  return classifyKnownEndpoint(provider, endpoint);
}

export function inspectAuthenticationState(config: AutohandConfig): AuthenticationState {
  const provider = typeof config.provider === 'string'
    ? config.provider
    : 'openrouter';
  if (provider.startsWith('extension:')) return 'unknown';
  if (provider.startsWith('custom:')) {
    const id = provider.slice('custom:'.length);
    const settings = config.customProviders?.[id];
    if (!settings) return 'unknown';
    if (settings.apiKeyRequired === false) return 'not_required';
    return nonEmpty(settings.apiKey) ? 'configured' : 'missing';
  }

  switch (provider) {
    case BLUEPRINT_LOCAL_PROVIDER_ID:
    case 'ollama':
    case 'llamacpp':
    case 'mlx':
      return 'not_required';
    case 'autohandai':
      if (config.autohandai?.plan === 'local') return 'not_required';
      return nonEmpty(config.autohandai?.apiKey)
        || nonEmpty(config.autohandai?.accountToken)
        || nonEmpty(config.auth?.token)
        ? 'configured'
        : 'missing';
    case 'openai':
      if (config.openai?.authMode === 'chatgpt') {
        return nonEmpty(config.openai.chatgptAuth?.accessToken) ? 'configured' : 'missing';
      }
      return nonEmpty(config.openai?.apiKey) ? 'configured' : 'missing';
    case 'xai':
      if (config.xai?.authMode === 'oauth') {
        return nonEmpty(config.xai.oauthAuth?.accessToken) ? 'configured' : 'missing';
      }
      return nonEmpty(config.xai?.apiKey) ? 'configured' : 'missing';
    case 'azure':
      if (config.azure?.authMethod === 'managed-identity') return 'unknown';
      if (config.azure?.authMethod === 'entra-id') {
        return nonEmpty(config.azure.clientId)
          && nonEmpty(config.azure.tenantId)
          && nonEmpty(config.azure.clientSecret)
          ? 'configured'
          : 'missing';
      }
      return nonEmpty(config.azure?.apiKey) ? 'configured' : 'missing';
    case 'bedrock':
      if (config.bedrock?.authMode === 'bedrock-api-key') {
        return nonEmpty(config.bedrock.apiKey) ? 'configured' : 'missing';
      }
      return nonEmpty(config.bedrock?.profile) ? 'configured' : 'unknown';
    case 'vertexai':
      return nonEmpty(config.vertexai?.authToken) ? 'configured' : 'missing';
    case 'openrouter':
      return nonEmpty(config.openrouter?.apiKey) ? 'configured' : 'missing';
    case 'llmgateway':
      return nonEmpty(config.llmgateway?.apiKey) ? 'configured' : 'missing';
    case 'zai':
      return nonEmpty(config.zai?.apiKey) ? 'configured' : 'missing';
    case 'sakana':
      return nonEmpty(config.sakana?.apiKey) ? 'configured' : 'missing';
    case 'cerebras':
      return nonEmpty(config.cerebras?.apiKey) ? 'configured' : 'missing';
    case 'nvidia':
      return nonEmpty(config.nvidia?.apiKey) ? 'configured' : 'missing';
    case 'deepseek':
      return nonEmpty(config.deepseek?.apiKey) ? 'configured' : 'missing';
    default:
      return 'unknown';
  }
}

function configuredModel(config: AutohandConfig, provider: string): string | undefined {
  if (provider === BLUEPRINT_LOCAL_PROVIDER_ID) {
    return config.blueprintLocal?.model;
  }
  if (provider.startsWith('custom:')) {
    return config.customProviders?.[provider.slice('custom:'.length)]?.model;
  }
  if (provider.startsWith('extension:')) {
    return config.extensionProviders?.[provider as keyof typeof config.extensionProviders]?.model;
  }
  const settings = config[provider as keyof AutohandConfig] as { model?: unknown } | undefined;
  return nonEmpty(settings?.model) ? settings.model : undefined;
}

export interface InspectBlueprintRuntimeOptions {
  config: AutohandConfig;
  profile: AnswerOnlyRuntimeProfile;
  identity?: BlueprintCliIdentity;
  modelOverride?: string;
}

export async function inspectBlueprintRuntime(
  options: InspectBlueprintRuntimeOptions,
): Promise<RuntimeFacts> {
  const providerId = typeof options.config.provider === 'string'
    ? options.config.provider
    : 'openrouter';
  const model = options.modelOverride ?? configuredModel(options.config, providerId);
  if (providerId === BLUEPRINT_LOCAL_PROVIDER_ID) {
    if (!options.config.blueprintLocal) {
      throw new BlueprintAnswerError(
        'local_model_setup_required',
        'Configure blueprintLocal.model, modelPath, and modelSha256 before using local answers.',
      );
    }
    if (options.modelOverride && options.modelOverride !== options.config.blueprintLocal.model) {
      throw new BlueprintAnswerError(
        'local_model_setup_required',
        '--model must match the hash-bound blueprintLocal.model label.',
      );
    }
    try {
      await verifyBlueprintLocalModelArtifact(options.config.blueprintLocal);
      await inspectBlueprintLocalNativePackage();
    } catch (error) {
      if (error instanceof BlueprintLocalProviderError) {
        throw new BlueprintAnswerError(error.kind, error.message, error.retryable);
      }
      throw new BlueprintAnswerError(
        'local_engine_unavailable',
        'The pinned Blueprint local inference engine could not be inspected.',
      );
    }
  }
  return {
    cliVersion: runtimeVersion,
    answerContractVersion: BLUEPRINT_ANSWER_CONTRACT_VERSION,
    cliIdentity: options.identity ?? await inspectBlueprintCliIdentity(),
    providerId,
    ...(model ? { model } : {}),
    authentication: inspectAuthenticationState(options.config),
    clientContext: options.profile.clientContext,
    answerOnly: true,
    permissionMode: 'restricted',
    toolsEnabled: false,
    hooksEnabled: false,
    mcpEnabled: false,
    memoryEnabled: false,
    sessionPersistenceEnabled: false,
    inferenceDestination: classifyInferenceDestination(options.config),
  };
}

function hashBytes(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function findPackageRoot(startPath: string): Promise<string | undefined> {
  let current = path.dirname(startPath);
  while (true) {
    try {
      const manifest = JSON.parse(await readFile(path.join(current, 'package.json'), 'utf8')) as {
        name?: unknown;
      };
      if (manifest.name === 'autohand-cli') return current;
    } catch {
      // Keep walking. Packaged binaries may not have a manifest beside them.
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

async function resolveSymlinkChain(invocationPath: string): Promise<{
  resolvedPath: string;
  symlinkChain: Array<{ path: string; target: string }>;
}> {
  const absoluteInvocation = path.resolve(invocationPath);
  const symlinkChain: Array<{ path: string; target: string }> = [];
  const visited = new Set<string>();
  let current = absoluteInvocation;

  while (!visited.has(current)) {
    visited.add(current);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch {
      break;
    }
    if (!metadata.isSymbolicLink()) break;
    const rawTarget = await readlink(current);
    const target = path.resolve(path.dirname(current), rawTarget);
    symlinkChain.push({ path: current, target });
    current = target;
  }

  let resolvedPath = current;
  try {
    resolvedPath = await realpath(absoluteInvocation);
  } catch {
    // The subsequent artifact read reports a typed identity failure.
  }
  if (symlinkChain.length === 0) {
    symlinkChain.push({ path: absoluteInvocation, target: resolvedPath });
  }
  return { resolvedPath, symlinkChain };
}

async function listSourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && /\.(?:[cm]?[jt]sx?|json)$/u.test(entry.name)) {
        files.push(entryPath);
      }
    }
  };
  await visit(root);
  return files;
}

async function sourceTreeArtifact(sourceRoot: string): Promise<{
  path: string;
  size: number;
  sha256: string;
}> {
  const manifest: string[] = [];
  let totalSize = 0;
  for (const file of await listSourceFiles(sourceRoot)) {
    const bytes = await readFile(file);
    totalSize += bytes.byteLength;
    manifest.push(`${path.relative(sourceRoot, file)}\0${bytes.byteLength}\0${hashBytes(bytes)}\n`);
  }
  return {
    path: sourceRoot,
    size: totalSize,
    sha256: hashBytes(manifest.join('')),
  };
}

async function fileArtifact(file: string): Promise<{
  path: string;
  size: number;
  sha256: string;
}> {
  const bytes = await readFile(file);
  return {
    path: file,
    size: bytes.byteLength,
    sha256: hashBytes(bytes),
  };
}

async function readRepositoryCommit(packageRoot: string): Promise<string | undefined> {
  const dotGit = path.join(packageRoot, '.git');
  let gitDirectory = dotGit;
  try {
    const metadata = await stat(dotGit);
    if (!metadata.isDirectory()) {
      const pointer = (await readFile(dotGit, 'utf8')).trim();
      if (!pointer.startsWith('gitdir:')) return undefined;
      gitDirectory = path.resolve(packageRoot, pointer.slice('gitdir:'.length).trim());
    }
  } catch {
    try {
      const pointer = (await readFile(dotGit, 'utf8')).trim();
      if (!pointer.startsWith('gitdir:')) return undefined;
      gitDirectory = path.resolve(packageRoot, pointer.slice('gitdir:'.length).trim());
    } catch {
      return undefined;
    }
  }

  let head: string;
  try {
    head = (await readFile(path.join(gitDirectory, 'HEAD'), 'utf8')).trim();
  } catch {
    return undefined;
  }
  if (/^[a-f0-9]{40}$/u.test(head)) return head;
  if (!head.startsWith('ref: ')) return undefined;

  const reference = head.slice('ref: '.length);
  const candidates = [path.join(gitDirectory, reference)];
  try {
    const common = (await readFile(path.join(gitDirectory, 'commondir'), 'utf8')).trim();
    candidates.push(path.resolve(gitDirectory, common, reference));
  } catch {
    // Normal checkouts have no commondir file.
  }
  for (const candidate of candidates) {
    try {
      const commit = (await readFile(candidate, 'utf8')).trim();
      if (/^[a-f0-9]{40}$/u.test(commit)) return commit;
    } catch {
      // Try the next worktree/common-dir location.
    }
  }
  return undefined;
}

export async function inspectBlueprintCliIdentity(
  invocationPath = process.argv[1],
): Promise<BlueprintCliIdentity> {
  if (!invocationPath) {
    throw new BlueprintAnswerError(
      'identity_unavailable',
      'The executed CLI path is unavailable.',
    );
  }
  const invocation = path.resolve(invocationPath);
  const { resolvedPath, symlinkChain } = await resolveSymlinkChain(invocation);
  const modulePath = fileURLToPath(import.meta.url);
  const packageRoot = await findPackageRoot(resolvedPath)
    ?? await findPackageRoot(modulePath);

  let packageName = 'autohand-cli';
  let packageVersion = runtimeVersion;
  const artifacts: BlueprintCliIdentity['artifacts'] = [];
  if (packageRoot) {
    const manifestPath = path.join(packageRoot, 'package.json');
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        name?: unknown;
        version?: unknown;
      };
      if (nonEmpty(manifest.name)) packageName = manifest.name;
      if (nonEmpty(manifest.version)) packageVersion = manifest.version;
      artifacts.push(await fileArtifact(manifestPath));
    } catch {
      // The executable artifact below remains mandatory.
    }

    const sourceRoot = path.join(packageRoot, 'src');
    try {
      artifacts.push(await sourceTreeArtifact(sourceRoot));
    } catch {
      // Installed packages normally execute one bundled dist artifact.
    }
    try {
      artifacts.push(await fileArtifact(path.join(packageRoot, 'bun.lock')));
    } catch {
      // Published packages may omit the development lock file.
    }
  }

  if (!artifacts.some((artifact) => artifact.path === resolvedPath)) {
    try {
      artifacts.push(await fileArtifact(resolvedPath));
    } catch {
      if (artifacts.length === 0) {
        throw new BlueprintAnswerError(
          'identity_unavailable',
          'The executed CLI artifacts cannot be read.',
        );
      }
    }
  }

  artifacts.sort((left, right) => left.path.localeCompare(right.path));
  const commit = packageRoot ? await readRepositoryCommit(packageRoot) : undefined;
  const identityWithoutHash = {
    invocationPath: invocation,
    resolvedPath,
    symlinkChain,
    package: {
      name: packageName,
      version: packageVersion,
      ...(commit ? { commit } : {}),
    },
    artifacts,
  };
  return {
    ...identityWithoutHash,
    identityHash: hashBytes(JSON.stringify(identityWithoutHash)),
  };
}

function serializeEnvelopeAtProviderBoundary(envelope: BlueprintAnswerEnvelope): string {
  return JSON.stringify({
    purpose: 'blueprint_classified_answer',
    contractVersion: envelope.contractVersion,
    policyHash: envelope.policyHash,
    artifacts: envelope.artifacts,
    outputSchema: envelope.outputSchema,
  });
}

function validateStructuredOutput(
  content: string,
  outputSchema: Record<string, unknown>,
): unknown {
  if (Buffer.byteLength(content, 'utf8') > BLUEPRINT_ANSWER_LIMITS.maxOutputBytes) {
    throw new BlueprintAnswerError(
      'output_limit_exceeded',
      `Generated structured output exceeds ${BLUEPRINT_ANSWER_LIMITS.maxOutputBytes} bytes.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new BlueprintAnswerError(
      'output_invalid',
      'Provider output is not one complete JSON value.',
    );
  }

  const validation = compileOutputSchema(outputSchema).safeParse(parsed);
  if (!validation.success || !isDeepStrictEqual(validation.data, parsed)) {
    throw new BlueprintAnswerError(
      'output_invalid',
      'Provider output does not match the requested strict JSON Schema.',
    );
  }
  return parsed;
}

export interface RunBlueprintAnswerOptions {
  envelope: BlueprintAnswerEnvelope;
  destination: InferenceDestination;
  providerId: string;
  model?: string;
  authentication?: AuthenticationState;
  providerFactory: () => LLMProvider;
  signal?: AbortSignal;
}

export async function runBlueprintAnswer(
  options: RunBlueprintAnswerOptions,
): Promise<BlueprintAnswerResult> {
  if (options.authentication === 'missing') {
    throw new BlueprintAnswerError(
      'authentication_required',
      'The configured provider requires authentication.',
      true,
    );
  }
  if (options.destination.kind !== 'in_process'
      && options.destination.kind !== 'local_subprocess') {
    throw new BlueprintAnswerError(
      'inference_destination_blocked',
      `Inference destination ${options.destination.kind} is not authorized for classified Ask evidence.`,
    );
  }

  const provider = options.providerFactory();
  let response;
  try {
    response = await provider.complete({
      messages: [
        {
          role: 'system',
          content: [
            'Answer only from the classified envelope.',
            'Return exactly one JSON value matching outputSchema.',
            'Do not add Markdown, prose framing, tool calls, or unrequested fields.',
          ].join(' '),
        },
        {
          role: 'user',
          content: serializeEnvelopeAtProviderBoundary(options.envelope),
        },
      ],
      temperature: 0,
      maxTokens: 16_384,
      stream: false,
      tools: [],
      toolChoice: 'none',
      ...(options.model ? { model: options.model } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      outputSchema: options.envelope.outputSchema,
    });
  } catch (error) {
    if (error instanceof BlueprintLocalProviderError) {
      throw new BlueprintAnswerError(error.kind, error.message, error.retryable);
    }
    throw new BlueprintAnswerError(
      'inference_failed',
      'The configured provider failed to produce an answer.',
      true,
    );
  }

  const result = validateStructuredOutput(response.content, options.envelope.outputSchema);
  return {
    contractVersion: BLUEPRINT_ANSWER_CONTRACT_VERSION,
    result,
    providerId: options.providerId,
    ...(options.model ? { model: options.model } : {}),
    inferenceDestination: options.destination,
  };
}
