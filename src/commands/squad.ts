/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { constants as fsConstants, existsSync } from 'node:fs';
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { arch as osArch, homedir, platform as osPlatform } from 'node:os';
import path from 'node:path';
import type { SlashCommand } from '../core/slashCommands.js';
import type { LoadedConfig } from '../types.js';

const DEFAULT_API_BASE_URL = 'https://api.autohand.ai';
const DEFAULT_CHANNEL = 'stable';
const SQUAD_FEATURE_FLAG = 'squad_daemon';
const REQUIRED_BINARIES = ['squad', 'autohand-squad-daemon', 'autohand-squad-analytics', 'autohand-squad-tray', 'autohand-squad-ui'] as const;
type RequiredBinary = typeof REQUIRED_BINARIES[number];
const START_ACTIONS = new Set<SquadAction>(['start', 'open', 'restart']);

type SquadAction = 'start' | 'status' | 'restart' | 'stop' | 'queue' | 'open' | 'config';

interface SquadContext {
  config?: LoadedConfig;
  workspaceRoot: string;
}

interface SquadDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  homeDir?: string;
  now?: () => Date;
  spawnProcess?: typeof spawn;
}

export interface SquadCommandResult {
  code: number;
  output: string;
}

interface ParsedSquadCommand {
  action: SquadAction;
  passthroughArgs: string[];
}

interface SquadEntitlement {
  ok: boolean;
  message?: string;
  latestAllowedVersion?: string;
  manifestUrl?: string;
  updateChannel: string;
  accountEmail?: string;
  planState?: string;
  telemetryPolicy?: string;
}

interface ReleaseManifest {
  latestAllowedVersion?: string;
  latest_allowed_version?: string;
  version?: string;
  channel?: string;
  artifacts?: ReleaseArtifact[];
}

interface ReleaseArtifact {
  os?: string;
  arch?: string;
  url?: string;
  sha256?: string;
  binaryName?: string;
  binary_name?: string;
  signature?: string;
  publicKey?: string;
  public_key?: string;
}

interface InstallRecord {
  version: string;
  channel: string;
  installedAt: string;
  artifacts: Array<{
    binaryName: string;
    url: string;
    sha256: string;
  }>;
}

interface RuntimeConfig {
  apiBaseUrl: string;
  updateChannel: string;
  accountEmail?: string;
  planState?: string;
  telemetryPolicy: string;
  openUrl?: string;
  hostedUiUrl?: string;
  proxyUrl?: string;
  apiGatewayUrl?: string;
  fixedPort?: number;
}

export const metadata: SlashCommand = {
  command: '/squad',
  description: 'open and manage the local Autohand Squad runtime',
  implemented: true,
};

export async function squad(
  ctx: SquadContext,
  args: string[] = [],
  deps: SquadDeps = {},
): Promise<string> {
  const result = await runSquadCommand(ctx, args, deps);
  return result.output;
}

export async function runSquadCommand(
  ctx: SquadContext,
  args: string[] = [],
  deps: SquadDeps = {},
): Promise<SquadCommandResult> {
  const parsed = parseSquadCommand(args);
  const env = deps.env ?? process.env;
  const paths = squadPaths(env, deps.homeDir);
  let runtimeEntitlement: SquadEntitlement | undefined;

  if (START_ACTIONS.has(parsed.action)) {
    const entitlement = await evaluateSquadEntitlement(ctx.config, deps);
    if (!entitlement.ok) {
      return {
        code: 1,
        output: entitlement.message ?? chalk.red('Autohand Squad is not available for this account.'),
      };
    }
    runtimeEntitlement = entitlement;

    const install = await ensureSquadRuntime(paths, entitlement, deps);
    if (install.code !== 0) {
      return install;
    }
    await writeRuntimeConfig(paths, ctx.config, entitlement, env);
  } else if (!hasLocalRuntime(paths)) {
    return {
      code: 1,
      output: [
        chalk.yellow('Autohand Squad runtime is not installed.'),
        chalk.gray('Run `autohand squad` to install and start it after entitlement is verified.'),
      ].join('\n'),
    };
  }

  const binary = resolveSquadBinary(paths, env);
  if (!binary) {
    return {
      code: 1,
      output: chalk.red(`Squad launcher was not found under ${paths.binDir}.`),
    };
  }

  const runtimeArgs = buildRuntimeArgs(parsed, ctx.workspaceRoot, ctx.config, env, runtimeEntitlement);
  const runtimeEnv = buildRuntimeEnv(ctx.config, env, runtimeEntitlement);
  return runRuntime(binary, runtimeArgs, deps, runtimeEnv);
}

export function parseSquadCommand(args: string[]): ParsedSquadCommand {
  const first = args[0]?.toLowerCase();
  if (isSquadAction(first)) {
    return { action: first, passthroughArgs: args.slice(1) };
  }

  const openBrowser = !args.includes('--no-open');
  return {
    action: openBrowser ? 'open' : 'start',
    passthroughArgs: args,
  };
}

function isSquadAction(value: string | undefined): value is SquadAction {
  return value === 'start'
    || value === 'status'
    || value === 'restart'
    || value === 'stop'
    || value === 'queue'
    || value === 'open'
    || value === 'config';
}

function buildRuntimeArgs(
  parsed: ParsedSquadCommand,
  workspaceRoot: string,
  config: LoadedConfig | undefined,
  env: NodeJS.ProcessEnv,
  entitlement?: Pick<SquadEntitlement, 'updateChannel' | 'accountEmail' | 'planState' | 'telemetryPolicy'>,
): string[] {
  const passthroughArgs = parsed.passthroughArgs.filter((arg) => arg !== '--no-open');
  const args = [parsed.action, ...passthroughArgs];
  if ((parsed.action === 'open' || parsed.action === 'start') && !hasOption(passthroughArgs, '--open-url')) {
    args.push('--open-url', buildOpenUrl(workspaceRoot, passthroughArgs));
  }
  pushOption(args, passthroughArgs, '--api-base-url', apiBaseUrlFromConfig(config, env));
  pushOption(args, passthroughArgs, '--update-channel', entitlement?.updateChannel || env.AUTOHAND_SQUAD_UPDATE_CHANNEL || DEFAULT_CHANNEL);
  pushOptionalOption(args, passthroughArgs, '--account-email', entitlement?.accountEmail || config?.auth?.user?.email || env.AUTOHAND_SQUAD_ACCOUNT_EMAIL);
  pushOptionalOption(args, passthroughArgs, '--plan-state', entitlement?.planState || env.AUTOHAND_SQUAD_PLAN_STATE);
  pushOption(args, passthroughArgs, '--telemetry-policy', entitlement?.telemetryPolicy || telemetryPolicyFromConfig(config, env));
  return args;
}

function buildOpenUrl(workspaceRoot: string, args: string[]): string {
  const { host, port } = readHostPortArgs(args);
  const url = new URL(`http://${host}:${port}/conversations/new`);
  url.searchParams.set('workspace', workspaceRoot);
  return url.toString();
}

function readHostPortArgs(args: string[]): { host: string; port: string } {
  let host = '127.0.0.1';
  let port = '19821';
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--host' && args[index + 1]) {
      host = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--host=')) {
      host = arg.slice('--host='.length);
      continue;
    }
    if (arg === '--port' && args[index + 1]) {
      port = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--port=')) {
      port = arg.slice('--port='.length);
    }
  }
  return { host, port };
}

function hasOption(args: string[], name: string): boolean {
  return args.some((arg) => arg === name || arg.startsWith(`${name}=`));
}

function pushOption(args: string[], passthroughArgs: string[], name: string, value: string): void {
  if (!hasOption(passthroughArgs, name)) {
    args.push(name, value);
  }
}

function pushOptionalOption(args: string[], passthroughArgs: string[], name: string, value: string | undefined): void {
  if (value && !hasOption(passthroughArgs, name)) {
    args.push(name, value);
  }
}

async function evaluateSquadEntitlement(
  config: LoadedConfig | undefined,
  deps: SquadDeps,
): Promise<SquadEntitlement> {
  const token = config?.auth?.token;
  if (!token) {
    return {
      ok: false,
      updateChannel: DEFAULT_CHANNEL,
      message: [
        chalk.yellow('Sign in to Autohand before starting Squad.'),
        chalk.gray('Run `autohand login`, then try `autohand squad` again.'),
      ].join('\n'),
    };
  }

  const env = deps.env ?? process.env;
  const apiBaseUrl = apiBaseUrlFromConfig(config, env);
  const updateChannel = env.AUTOHAND_SQUAD_UPDATE_CHANNEL || DEFAULT_CHANNEL;
  const fetchImpl = deps.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(`${apiBaseUrl}/v1/squad/entitlement`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok || payload.success === false) {
      return {
        ok: false,
        updateChannel,
        message: entitlementMessage(payload, 'Unable to verify Squad entitlement.'),
      };
    }

    const hasPlan = Boolean(
      payload.activePlan
      ?? payload.planActive
      ?? payload.hasSquadPlan
      ?? (payload.plan === 'squad')
    );
    if (!hasPlan) {
      return {
        ok: false,
        updateChannel,
        message: [
          chalk.yellow('Autohand Squad is not active on this account.'),
          chalk.gray('Upgrade to an active Squad plan before installing the local daemon.'),
        ].join('\n'),
      };
    }

    const flagEnabled = Boolean(
      payload.featureEnabled
      ?? payload.squadDaemonEnabled
      ?? readNestedFlag(payload, SQUAD_FEATURE_FLAG)
    );
    if (!flagEnabled) {
      return {
        ok: false,
        updateChannel,
        message: [
          chalk.yellow('Autohand Squad daemon is not enabled for this account yet.'),
          chalk.gray(`Feature flag required: ${SQUAD_FEATURE_FLAG}`),
        ].join('\n'),
      };
    }

    return {
      ok: true,
      updateChannel: stringField(payload.updateChannel) || updateChannel,
      latestAllowedVersion: stringField(payload.latestAllowedVersion) || stringField(payload.latest_allowed_version),
      manifestUrl: stringField(payload.releaseManifestUrl) || stringField(payload.manifestUrl),
      accountEmail: stringField(payload.accountEmail) || stringField(payload.email) || config.auth?.user?.email,
      planState: stringField(payload.planState) || stringField(payload.plan) || stringField(payload.plan_state),
      telemetryPolicy: stringField(payload.telemetryPolicy) || stringField(payload.telemetry_policy),
    };
  } catch (error) {
    return {
      ok: false,
      updateChannel,
      message: [
        chalk.red('Unable to verify Squad entitlement.'),
        chalk.gray((error as Error).message),
      ].join('\n'),
    };
  }
}

async function ensureSquadRuntime(
  paths: ReturnType<typeof squadPaths>,
  entitlement: SquadEntitlement,
  deps: SquadDeps,
): Promise<SquadCommandResult> {
  if (hasLocalRuntime(paths) && await isLatestAllowed(paths, entitlement.latestAllowedVersion)) {
    return { code: 0, output: '' };
  }

  const manifest = await fetchReleaseManifest(entitlement, deps);
  if (!manifest.ok) return manifest;

  const version = manifestVersion(manifest.value, entitlement);
  const artifacts = selectRequiredArtifacts(manifest.value);
  if (!artifacts.ok) return artifacts;

  const installed: InstallRecord['artifacts'] = [];
  await mkdir(paths.binDir, { recursive: true });

  for (const artifact of artifacts.value) {
    const binaryName = artifactBinaryName(artifact);
    const artifactResult = await downloadArtifact(artifact, deps);
    if (!artifactResult.ok) return artifactResult;
    const targetPath = path.join(paths.binDir, binaryFileName(binaryName));
    await writeFile(targetPath, artifactResult.bytes);
    await chmod(targetPath, 0o755);
    installed.push({
      binaryName,
      url: artifact.url ?? '',
      sha256: artifact.sha256 ?? '',
    });
  }

  await writeInstallRecord(paths.installJson, {
    version,
    channel: manifest.value.channel || entitlement.updateChannel,
    installedAt: (deps.now?.() ?? new Date()).toISOString(),
    artifacts: installed,
  });

  return { code: 0, output: '' };
}

async function writeRuntimeConfig(
  paths: ReturnType<typeof squadPaths>,
  config: LoadedConfig | undefined,
  entitlement: SquadEntitlement,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const runtimeConfig: RuntimeConfig = {
    apiBaseUrl: apiBaseUrlFromConfig(config, env),
    updateChannel: entitlement.updateChannel,
    accountEmail: entitlement.accountEmail || config?.auth?.user?.email || env.AUTOHAND_SQUAD_ACCOUNT_EMAIL,
    planState: entitlement.planState || env.AUTOHAND_SQUAD_PLAN_STATE,
    telemetryPolicy: entitlement.telemetryPolicy || telemetryPolicyFromConfig(config, env),
    openUrl: env.AUTOHAND_SQUAD_OPEN_URL,
    hostedUiUrl: env.AUTOHAND_SQUAD_HOSTED_UI_URL,
    proxyUrl: env.AUTOHAND_SQUAD_PROXY_URL,
    apiGatewayUrl: env.AUTOHAND_SQUAD_API_GATEWAY_URL,
    fixedPort: numberFromEnv(env.AUTOHAND_SQUAD_FIXED_PORT),
  };
  await mkdir(path.dirname(paths.configJson), { recursive: true });
  await writeFile(paths.configJson, `${JSON.stringify(stripUndefined(runtimeConfig), null, 2)}\n`, { mode: 0o600 });
}

async function fetchReleaseManifest(
  entitlement: SquadEntitlement,
  deps: SquadDeps,
): Promise<{ ok: true; value: ReleaseManifest } | SquadCommandResult & { ok: false }> {
  const env = deps.env ?? process.env;
  const apiBaseUrl = env.AUTOHAND_SQUAD_API_BASE_URL || env.AUTOHAND_API_URL || DEFAULT_API_BASE_URL;
  const manifestUrl = entitlement.manifestUrl
    || `${apiBaseUrl.replace(/\/+$/, '')}/v1/squad/releases/${entitlement.updateChannel}/manifest`;
  try {
    const response = await (deps.fetchImpl ?? fetch)(manifestUrl, {
      headers: { Accept: 'application/json' },
    });
    const payload = await response.json() as ReleaseManifest;
    if (!response.ok) {
      return {
        ok: false,
        code: 1,
        output: chalk.red(`Failed to fetch Squad release manifest: HTTP ${response.status}`),
      };
    }
    return { ok: true, value: payload };
  } catch (error) {
    return {
      ok: false,
      code: 1,
      output: [
        chalk.red('Failed to fetch Squad release manifest.'),
        chalk.gray((error as Error).message),
      ].join('\n'),
    };
  }
}

function selectRequiredArtifacts(
  manifest: ReleaseManifest,
): { ok: true; value: ReleaseArtifact[] } | SquadCommandResult & { ok: false } {
  const artifacts = manifest.artifacts ?? [];
  const selected = REQUIRED_BINARIES.map((binaryName) => {
    return artifacts.find((artifact) => {
      return targetOsMatches(artifact.os)
        && targetArchMatches(artifact.arch)
        && artifactBinaryName(artifact) === binaryName;
    });
  });

  if (selected.some((artifact) => !artifact)) {
    return {
      ok: false,
      code: 1,
      output: [
        chalk.red('Squad release manifest does not contain binaries for this OS/arch.'),
        chalk.gray(`Need: ${REQUIRED_BINARIES.join(', ')} for ${targetOs()}/${targetArch()}`),
      ].join('\n'),
    };
  }

  return { ok: true, value: selected as ReleaseArtifact[] };
}

async function downloadArtifact(
  artifact: ReleaseArtifact,
  deps: SquadDeps,
): Promise<{ ok: true; bytes: Buffer } | SquadCommandResult & { ok: false }> {
  if (!artifact.url || !artifact.sha256) {
    return { ok: false, code: 1, output: chalk.red('Invalid Squad artifact manifest entry.') };
  }

  try {
    const response = await (deps.fetchImpl ?? fetch)(artifact.url);
    if (!response.ok) {
      return { ok: false, code: 1, output: chalk.red(`Failed to download Squad artifact: HTTP ${response.status}`) };
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual.toLowerCase() !== artifact.sha256.toLowerCase()) {
      return {
        ok: false,
        code: 1,
        output: chalk.red(`Checksum mismatch for ${artifactBinaryName(artifact)}.`),
      };
    }
    const signatureError = verifyArtifactSignature(artifact);
    if (signatureError) {
      return { ok: false, code: 1, output: chalk.red(signatureError) };
    }
    return { ok: true, bytes };
  } catch (error) {
    return {
      ok: false,
      code: 1,
      output: [
        chalk.red(`Failed to download ${artifactBinaryName(artifact)}.`),
        chalk.gray((error as Error).message),
      ].join('\n'),
    };
  }
}

function verifyArtifactSignature(artifact: ReleaseArtifact): string | null {
  const signature = artifact.signature;
  if (!signature) return null;
  const publicKey = artifact.publicKey ?? artifact.public_key;
  if (!publicKey) {
    return `Artifact ${artifactBinaryName(artifact)} is signed but no public key was provided.`;
  }

  try {
    const rawPublicKey = Buffer.from(publicKey, 'base64');
    const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const key = createPublicKey({
      key: Buffer.concat([spkiPrefix, rawPublicKey]),
      format: 'der',
      type: 'spki',
    });
    const ok = cryptoVerify(
      null,
      Buffer.from(artifact.sha256 ?? ''),
      key,
      Buffer.from(signature, 'base64'),
    );
    return ok ? null : `Signature verification failed for ${artifactBinaryName(artifact)}.`;
  } catch (error) {
    return `Signature verification failed for ${artifactBinaryName(artifact)}: ${(error as Error).message}`;
  }
}

function runRuntime(
  binary: string,
  args: string[],
  deps: SquadDeps,
  runtimeEnv: NodeJS.ProcessEnv,
): Promise<SquadCommandResult> {
  const spawnProcess = deps.spawnProcess ?? spawn;
  return new Promise((resolve) => {
    const child = spawnProcess(binary, args, {
      env: { ...process.env, ...(deps.env ?? {}), ...runtimeEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    }) as ChildProcess;
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      resolve({ code: 1, output: chalk.red(error.message) });
    });
    child.on('close', (code) => {
      resolve({
        code: code ?? 0,
        output: [stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join('\n'),
      });
    });
  });
}

function hasLocalRuntime(paths: ReturnType<typeof squadPaths>): boolean {
  return REQUIRED_BINARIES.every((binaryName) => existsSync(path.join(paths.binDir, binaryFileName(binaryName))));
}

async function isLatestAllowed(paths: ReturnType<typeof squadPaths>, latestAllowedVersion?: string): Promise<boolean> {
  if (!latestAllowedVersion) return true;
  try {
    const record = JSON.parse(await readFile(paths.installJson, 'utf8')) as Partial<InstallRecord>;
    return record.version === latestAllowedVersion;
  } catch {
    return false;
  }
}

function resolveSquadBinary(paths: ReturnType<typeof squadPaths>, env: NodeJS.ProcessEnv): string | null {
  const explicit = env.AUTOHAND_SQUAD_BIN;
  if (explicit && existsSync(explicit)) return explicit;
  const installed = path.join(paths.binDir, binaryFileName('squad'));
  if (existsSync(installed)) return installed;
  return findOnPath(binaryFileName('squad'), env.PATH);
}

function findOnPath(binaryName: string, pathValue: string | undefined): string | null {
  for (const entry of (pathValue ?? '').split(path.delimiter)) {
    if (!entry) continue;
    const candidate = path.join(entry, binaryName);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function squadPaths(env: NodeJS.ProcessEnv, homeDir = homedir()) {
  const root = env.AUTOHAND_SQUAD_HOME
    || path.join(env.AUTOHAND_HOME || path.join(homeDir, '.autohand'), 'squad');
  return {
    root,
    binDir: path.join(root, 'bin'),
    configJson: path.join(root, 'config.json'),
    installJson: path.join(root, 'install.json'),
  };
}

async function writeInstallRecord(filePath: string, record: InstallRecord): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`);
}

function manifestVersion(manifest: ReleaseManifest, entitlement: SquadEntitlement): string {
  return manifest.latestAllowedVersion
    || manifest.latest_allowed_version
    || manifest.version
    || entitlement.latestAllowedVersion
    || '0.0.0';
}

function artifactBinaryName(artifact: ReleaseArtifact): RequiredBinary {
  const value = artifact.binaryName || artifact.binary_name || 'autohand-squad-daemon';
  return isRequiredBinary(value) ? value : 'autohand-squad-daemon';
}

function isRequiredBinary(value: string): value is RequiredBinary {
  return (REQUIRED_BINARIES as readonly string[]).includes(value);
}

function binaryFileName(binaryName: string): string {
  return process.platform === 'win32' ? `${binaryName}.exe` : binaryName;
}

function targetOs(): string {
  return osPlatform();
}

function targetArch(): string {
  return osArch();
}

function targetOsMatches(value: string | undefined): boolean {
  return value === targetOs();
}

function targetArchMatches(value: string | undefined): boolean {
  const arch = targetArch();
  return value === arch || (arch === 'x64' && value === 'x86_64') || (arch === 'arm64' && value === 'aarch64');
}

function apiBaseUrlFromConfig(config: LoadedConfig | undefined, env: NodeJS.ProcessEnv): string {
  const configApi = config ? (config as LoadedConfig & { api?: { baseUrl?: string } }).api?.baseUrl : undefined;
  return (env.AUTOHAND_SQUAD_API_BASE_URL
    || env.AUTOHAND_API_URL
    || configApi
    || config?.telemetry?.apiBaseUrl
    || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
}

function buildRuntimeEnv(
  config: LoadedConfig | undefined,
  env: NodeJS.ProcessEnv,
  entitlement?: SquadEntitlement,
): NodeJS.ProcessEnv {
  return stripUndefined({
    AUTOHAND_SQUAD_API_BASE_URL: apiBaseUrlFromConfig(config, env),
    AUTOHAND_SQUAD_UPDATE_CHANNEL: entitlement?.updateChannel || env.AUTOHAND_SQUAD_UPDATE_CHANNEL || DEFAULT_CHANNEL,
    AUTOHAND_SQUAD_ACCOUNT_EMAIL: entitlement?.accountEmail || config?.auth?.user?.email || env.AUTOHAND_SQUAD_ACCOUNT_EMAIL,
    AUTOHAND_SQUAD_PLAN_STATE: entitlement?.planState || env.AUTOHAND_SQUAD_PLAN_STATE,
    AUTOHAND_SQUAD_TELEMETRY_POLICY: entitlement?.telemetryPolicy || telemetryPolicyFromConfig(config, env),
    AUTOHAND_SQUAD_API_AUTH_TOKEN: config?.auth?.token || env.AUTOHAND_SQUAD_API_AUTH_TOKEN || env.AUTOHAND_SQUAD_AUTH_TOKEN || env.AUTOHAND_TOKEN,
    AUTOHAND_SQUAD_COMPANY_SECRET: env.AUTOHAND_SQUAD_COMPANY_SECRET || config?.api?.companySecret || config?.telemetry?.companySecret || env.AUTOHAND_SECRET,
  });
}

function telemetryPolicyFromConfig(config: LoadedConfig | undefined, env: NodeJS.ProcessEnv): string {
  if (env.AUTOHAND_SQUAD_TELEMETRY_POLICY) return env.AUTOHAND_SQUAD_TELEMETRY_POLICY;
  return config?.telemetry?.enabled === false ? 'disabled' : 'local-buffered';
}

function numberFromEnv(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : undefined;
}

function stripUndefined<T extends object>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;
}

function entitlementMessage(payload: Record<string, unknown>, fallback: string): string {
  const message = stringField(payload.message) || stringField(payload.error) || fallback;
  return [chalk.red(message), chalk.gray('Squad was not installed.')].join('\n');
}

function readNestedFlag(payload: Record<string, unknown>, flag: string): unknown {
  const featureFlags = payload.featureFlags;
  if (featureFlags && typeof featureFlags === 'object' && !Array.isArray(featureFlags)) {
    return (featureFlags as Record<string, unknown>)[flag];
  }
  const flags = payload.flags;
  if (flags && typeof flags === 'object' && !Array.isArray(flags)) {
    return (flags as Record<string, unknown>)[flag];
  }
  if (Array.isArray(flags)) {
    return flags.some((entry) => {
      return Boolean(entry)
        && typeof entry === 'object'
        && (entry as Record<string, unknown>).key === flag
        && (entry as Record<string, unknown>).enabled === true;
    });
  }
  return undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export async function pathIsExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}
