/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { spawn, spawnSync } from 'node:child_process';
import open from 'open';
import { execSync } from 'node:child_process';
import type { LoadedConfig } from '../types.js';
import { AUTOHAND_HOME } from '../constants.js';

const { chmod, ensureDir, pathExists, readFile, readJson, remove, writeFile, writeJson } = fs;

export const CHROME_NATIVE_HOST_NAME = 'ai.autohand.rpc';
export const DEFAULT_CHROME_INSTALL_URL = 'https://autohand.ai/chrome/installed';
export const DEFAULT_HANDOFF_TTL_MS = 10 * 60 * 1000;

export type ChromiumBrowser = 'chrome' | 'chromium' | 'brave' | 'edge';
export type BrowserPreference = ChromiumBrowser | 'auto';
type BrowserProbe = (probe: string) => Promise<boolean>;

export interface ChromeSettings {
  extensionId?: string;
  browser?: BrowserPreference;
  userDataDir?: string;
  profileDirectory?: string;
  installUrl?: string;
}

export interface NativeHostInstallOptions {
  homeDir?: string;
  cliCommand?: string;
  cliArgPrefix?: string[];
  extensionIds: string[];
  browsers?: ChromiumBrowser[];
  hostName?: string;
}

export interface NativeHostInstallResult {
  hostScriptPath: string;
  targets: Array<{
    browser: ChromiumBrowser;
    manifestPath: string;
    registryKey?: string;
  }>;
}

export interface BrowserHandoffRecord {
  token: string;
  sessionId: string;
  workspaceRoot: string;
  createdAt: string;
  expiresAt: string;
  socketPath?: string;
}

export interface BrowserHandoffResult extends BrowserHandoffRecord {
  url: string;
}

export type ChromeLaunchTarget = 'extension' | 'web';

const ALL_BROWSERS: ChromiumBrowser[] = ['chrome', 'chromium', 'brave', 'edge'];

interface BrowserLaunchTarget {
  probe: string;
  appName: string;
  command: string;
}

export interface BrowserProfileLocation {
  browser: ChromiumBrowser;
  userDataDir: string;
  profileDirectory: string;
}

function getChromeHome(homeDir = AUTOHAND_HOME): string {
  return path.join(homeDir, 'chrome');
}

function getBrowserDataRoot(homeDir = AUTOHAND_HOME): string {
  return path.join(getChromeHome(homeDir), 'native-host');
}

function getHandoffDir(homeDir = AUTOHAND_HOME): string {
  return path.join(getChromeHome(homeDir), 'handoffs');
}

function jsString(value: string): string {
  return JSON.stringify(value);
}

function jsArray(value: string[]): string {
  return JSON.stringify(value);
}

export function normalizeBrowsers(browser?: string): ChromiumBrowser[] {
  if (!browser || browser === 'all') {
    return [...ALL_BROWSERS];
  }

  const value = browser.toLowerCase();
  if (ALL_BROWSERS.includes(value as ChromiumBrowser)) {
    return [value as ChromiumBrowser];
  }

  throw new Error(`Unsupported browser: ${browser}`);
}

function getBrowserLaunchTargets(browser: ChromiumBrowser, platform = process.platform): BrowserLaunchTarget[] {
  if (platform === 'darwin') {
    const targets: Record<ChromiumBrowser, BrowserLaunchTarget[]> = {
      chrome: [
        { probe: '/Applications/Google Chrome.app', appName: 'Google Chrome', command: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
        { probe: path.join(os.homedir(), 'Applications', 'Google Chrome.app'), appName: 'Google Chrome', command: path.join(os.homedir(), 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome') },
      ],
      chromium: [
        { probe: '/Applications/Chromium.app', appName: 'Chromium', command: '/Applications/Chromium.app/Contents/MacOS/Chromium' },
        { probe: path.join(os.homedir(), 'Applications', 'Chromium.app'), appName: 'Chromium', command: path.join(os.homedir(), 'Applications', 'Chromium.app', 'Contents', 'MacOS', 'Chromium') },
      ],
      brave: [
        { probe: '/Applications/Brave Browser.app', appName: 'Brave Browser', command: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' },
        { probe: path.join(os.homedir(), 'Applications', 'Brave Browser.app'), appName: 'Brave Browser', command: path.join(os.homedir(), 'Applications', 'Brave Browser.app', 'Contents', 'MacOS', 'Brave Browser') },
      ],
      edge: [
        { probe: '/Applications/Microsoft Edge.app', appName: 'Microsoft Edge', command: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
        { probe: path.join(os.homedir(), 'Applications', 'Microsoft Edge.app'), appName: 'Microsoft Edge', command: path.join(os.homedir(), 'Applications', 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge') },
      ],
    };
    return targets[browser];
  }

  if (platform === 'linux') {
    const targets: Record<ChromiumBrowser, BrowserLaunchTarget[]> = {
      chrome: [
        { probe: 'google-chrome', appName: 'google-chrome', command: 'google-chrome' },
        { probe: 'google-chrome-stable', appName: 'google-chrome', command: 'google-chrome-stable' },
      ],
      chromium: [
        { probe: 'chromium', appName: 'chromium', command: 'chromium' },
        { probe: 'chromium-browser', appName: 'chromium-browser', command: 'chromium-browser' },
      ],
      brave: [
        { probe: 'brave-browser', appName: 'brave-browser', command: 'brave-browser' },
        { probe: 'brave', appName: 'brave', command: 'brave' },
      ],
      edge: [
        { probe: 'microsoft-edge', appName: 'microsoft-edge', command: 'microsoft-edge' },
        { probe: 'microsoft-edge-stable', appName: 'microsoft-edge', command: 'microsoft-edge-stable' },
        { probe: 'msedge', appName: 'msedge', command: 'msedge' },
      ],
    };
    return targets[browser];
  }

  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? '';
    const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const targets: Record<ChromiumBrowser, BrowserLaunchTarget[]> = {
      chrome: [
        { probe: path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'), appName: 'chrome', command: path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe') },
        { probe: path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'), appName: 'chrome', command: path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe') },
        { probe: path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'), appName: 'chrome', command: path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') },
      ],
      chromium: [
        { probe: path.join(programFiles, 'Chromium', 'Application', 'chrome.exe'), appName: 'chromium', command: path.join(programFiles, 'Chromium', 'Application', 'chrome.exe') },
        { probe: path.join(localAppData, 'Chromium', 'Application', 'chrome.exe'), appName: 'chromium', command: path.join(localAppData, 'Chromium', 'Application', 'chrome.exe') },
      ],
      brave: [
        { probe: path.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), appName: 'brave', command: path.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe') },
        { probe: path.join(programFilesX86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), appName: 'brave', command: path.join(programFilesX86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe') },
        { probe: path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), appName: 'brave', command: path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe') },
      ],
      edge: [
        { probe: path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), appName: 'msedge', command: path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
        { probe: path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), appName: 'msedge', command: path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
        { probe: path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), appName: 'msedge', command: path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
      ],
    };
    return targets[browser];
  }

  return [];
}

async function defaultBrowserProbe(probe: string): Promise<boolean> {
  if (probe.includes(path.sep) || /^[A-Za-z]:\\/.test(probe)) {
    return pathExists(probe);
  }

  const command = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(command, [probe], { stdio: 'pipe' });
  return result.status === 0;
}

export async function resolveBrowserLaunchTarget(
  browser: BrowserPreference,
  platform = process.platform,
  probe: BrowserProbe = defaultBrowserProbe,
): Promise<string | null> {
  const order = browser === 'auto' ? ['chrome', 'edge', 'brave', 'chromium'] : [browser];
  for (const candidateBrowser of order) {
    const targets = getBrowserLaunchTargets(candidateBrowser as ChromiumBrowser, platform);
    for (const target of targets) {
      if (await probe(target.probe)) {
        return target.appName;
      }
    }
  }
  return null;
}

export async function resolveBrowserCommand(
  browser: BrowserPreference,
  platform = process.platform,
  probe: BrowserProbe = defaultBrowserProbe,
): Promise<string | null> {
  const order = browser === 'auto' ? ['chrome', 'edge', 'brave', 'chromium'] : [browser];
  for (const candidateBrowser of order) {
    const targets = getBrowserLaunchTargets(candidateBrowser as ChromiumBrowser, platform);
    for (const target of targets) {
      if (await probe(target.probe)) {
        return target.command;
      }
    }
  }
  return null;
}

function getBrowserUserDataRoots(platform = process.platform, homeDir = os.homedir()): Record<ChromiumBrowser, string> {
  if (platform === 'darwin') {
    return {
      chrome: path.join(homeDir, 'Library', 'Application Support', 'Google', 'Chrome'),
      chromium: path.join(homeDir, 'Library', 'Application Support', 'Chromium'),
      brave: path.join(homeDir, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser'),
      edge: path.join(homeDir, 'Library', 'Application Support', 'Microsoft Edge'),
    };
  }

  if (platform === 'linux') {
    return {
      chrome: path.join(homeDir, '.config', 'google-chrome'),
      chromium: path.join(homeDir, '.config', 'chromium'),
      brave: path.join(homeDir, '.config', 'BraveSoftware', 'Brave-Browser'),
      edge: path.join(homeDir, '.config', 'microsoft-edge'),
    };
  }

  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? '';
    return {
      chrome: path.join(localAppData, 'Google', 'Chrome', 'User Data'),
      chromium: path.join(localAppData, 'Chromium', 'User Data'),
      brave: path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data'),
      edge: path.join(localAppData, 'Microsoft', 'Edge', 'User Data'),
    };
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

export async function detectExtensionProfile(
  extensionId: string,
  browsers: ChromiumBrowser[] = [...ALL_BROWSERS],
  platform = process.platform,
  homeDir = os.homedir(),
): Promise<BrowserProfileLocation | null> {
  const roots = getBrowserUserDataRoots(platform, homeDir);

  for (const browser of browsers) {
    const userDataDir = roots[browser];
    if (!(await pathExists(userDataDir))) {
      continue;
    }

    const entries = await fs.readdir(userDataDir);
    const candidates = entries.filter((entry) => entry === 'Default' || entry.startsWith('Profile '));

    for (const profileDirectory of candidates) {
      const packedExtensionPath = path.join(userDataDir, profileDirectory, 'Extensions', extensionId);
      const unpackedExtensionPath = path.join(userDataDir, profileDirectory, 'Local Extension Settings', extensionId);
      if (await pathExists(packedExtensionPath) || await pathExists(unpackedExtensionPath)) {
        return {
          browser,
          userDataDir,
          profileDirectory,
        };
      }
    }
  }

  return null;
}

export function resolveCliLaunchSpec(cliPath?: string): { command: string; args: string[] } {
  if (cliPath && cliPath.trim()) {
    return { command: cliPath.trim(), args: [] };
  }

  const argv1 = process.argv[1];
  // Filter out Bun virtual filesystem paths (e.g. /$bunfs/root/...)
  // These are not real filesystem paths and will break the native host.
  if (argv1 && path.isAbsolute(argv1) && !argv1.includes("$bunfs")) {
    return {
      command: process.execPath,
      args: [argv1],
    };
  }

  const execBase = path.basename(process.execPath).toLowerCase();
  if (execBase.includes('autohand')) {
    return { command: process.execPath, args: [] };
  }

  return { command: 'autohand', args: [] };
}

export function getManifestTarget(browser: ChromiumBrowser, platform = process.platform, homeDir = AUTOHAND_HOME) {
  const hostName = CHROME_NATIVE_HOST_NAME;
  const manifestPath = path.join(getBrowserDataRoot(homeDir), `${browser}.json`);

  if (platform === 'darwin') {
    const roots: Record<ChromiumBrowser, string> = {
      chrome: path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts'),
      chromium: path.join(os.homedir(), 'Library', 'Application Support', 'Chromium', 'NativeMessagingHosts'),
      brave: path.join(os.homedir(), 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts'),
      edge: path.join(os.homedir(), 'Library', 'Application Support', 'Microsoft Edge', 'NativeMessagingHosts'),
    };
    return {
      browser,
      manifestPath: path.join(roots[browser], `${hostName}.json`),
      registryKey: undefined,
    };
  }

  if (platform === 'linux') {
    const roots: Record<ChromiumBrowser, string> = {
      chrome: path.join(os.homedir(), '.config', 'google-chrome', 'NativeMessagingHosts'),
      chromium: path.join(os.homedir(), '.config', 'chromium', 'NativeMessagingHosts'),
      brave: path.join(os.homedir(), '.config', 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts'),
      edge: path.join(os.homedir(), '.config', 'microsoft-edge', 'NativeMessagingHosts'),
    };
    return {
      browser,
      manifestPath: path.join(roots[browser], `${hostName}.json`),
      registryKey: undefined,
    };
  }

  if (platform === 'win32') {
    const registryRoots: Record<ChromiumBrowser, string> = {
      chrome: 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts',
      chromium: 'HKCU\\Software\\Chromium\\NativeMessagingHosts',
      brave: 'HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts',
      edge: 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts',
    };

    return {
      browser,
      manifestPath,
      registryKey: `${registryRoots[browser]}\\${hostName}`,
    };
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

export function buildNativeHostManifest(options: {
  hostName?: string;
  extensionIds: string[];
  hostScriptPath: string;
}) {
  const hostName = options.hostName ?? CHROME_NATIVE_HOST_NAME;
  const allowedOrigins = Array.from(new Set(options.extensionIds.filter(Boolean))).map(
    (extensionId) => `chrome-extension://${extensionId}/`
  );

  return {
    name: hostName,
    description: 'Autohand Code native messaging bridge',
    path: options.hostScriptPath,
    type: 'stdio',
    allowed_origins: allowedOrigins,
  };
}

function resolveNodePath(): string {
  // Don't use bun or the compiled autohand binary as the shebang —
  // Chrome native messaging host scripts must use Node.js because they
  // use require("node:child_process") and other Node APIs.
  const execPath = process.execPath;
  const execBase = path.basename(execPath).toLowerCase();
  if (!execBase.includes('bun') && !execBase.includes('autohand')) {
    return execPath;
  }
  // Find node in common locations
  const candidates = [
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
    path.join(os.homedir(), '.nvm/versions/node'),
    path.join(os.homedir(), '.local/bin/node'),
  ];
  for (const candidate of candidates) {
    if (candidate.includes('.nvm')) {
      // Find latest nvm node
      try {
        const versions = fs.readdirSync(candidate);
        if (versions.length) {
          const latest = versions.sort().pop()!;
          const nodeBin = path.join(candidate, latest, 'bin/node');
          if (fs.existsSync(nodeBin)) return nodeBin;
        }
      } catch { /* ignore */ }
      continue;
    }
    try { if (fs.existsSync(candidate)) return candidate; } catch { /* ignore */ }
  }
  return '/usr/bin/env node'; // fallback
}

export function buildNativeHostScript(options: { cliCommand: string; cliArgPrefix?: string[]; nodePath?: string }) {
  const cliCommand = options.cliCommand;
  const cliArgPrefix = options.cliArgPrefix ?? [];
  const shebang = options.nodePath ?? resolveNodePath();

  return `#!${shebang}
const { spawn } = require("node:child_process");
let child = null;
let stdinBuffer = Buffer.alloc(0);
let stdoutBuffer = "";
let stderrBuffer = "";
let launchSettings = null;
const DEFAULT_CLI_COMMAND = ${jsString(cliCommand)};
const DEFAULT_CLI_ARG_PREFIX = ${jsArray(cliArgPrefix)};
process.stdin.on("data", handleNativeData);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
function handleNativeData(chunk) {
  stdinBuffer = Buffer.concat([stdinBuffer, chunk]);
  while (stdinBuffer.length >= 4) {
    const length = stdinBuffer.readUInt32LE(0);
    if (stdinBuffer.length < 4 + length) {
      return;
    }
    const body = stdinBuffer.subarray(4, 4 + length);
    stdinBuffer = stdinBuffer.subarray(4 + length);
    handleNativeMessage(JSON.parse(body.toString("utf8")));
  }
}
function handleNativeMessage(message) {
  if (message.type === "connect") {
    launchSettings = message.settings || {};
    ensureChild();
    return;
  }
  if (message.type === "shutdown") {
    shutdown();
    return;
  }
  if (message.type === "request") {
    ensureChild();
    child.stdin.write(JSON.stringify(message.payload) + "\\n");
  }
}
function ensureChild() {
  if (child) return;
  const cliCommand = launchSettings?.cliPath || DEFAULT_CLI_COMMAND;
  const args = [...DEFAULT_CLI_ARG_PREFIX, "--mode", "rpc"];
  if (launchSettings?.workspacePath) args.push("--path", launchSettings.workspacePath);
  if (launchSettings?.modelOverride) args.push("--model", launchSettings.modelOverride);
  if (launchSettings?.thinkingLevel) args.push("--thinking", launchSettings.thinkingLevel);
  if (launchSettings?.debug) args.push("--debug");
  if (launchSettings?.unrestricted) args.push("--unrestricted");
  if (launchSettings?.restricted) args.push("--restricted");
  if (launchSettings?.autoCommit) args.push("--auto-commit");
  if (launchSettings?.syncSettings === false) args.push("--sync-settings", "false");
  if (launchSettings?.searchEngine) args.push("--search-engine", launchSettings.searchEngine);
  if (launchSettings?.displayLanguage) args.push("--display-language", launchSettings.displayLanguage);
  if (launchSettings?.teammateMode) args.push("--teammate-mode", launchSettings.teammateMode);
  if (launchSettings?.yoloPattern) args.push("--yolo", launchSettings.yoloPattern);
  if (launchSettings?.timeoutSeconds) args.push("--timeout", String(launchSettings.timeoutSeconds));
  if (launchSettings?.contextCompact === false) args.push("--no-context-compact");
  for (const dir of launchSettings?.extraDirs || []) args.push("--add-dir", dir);
  child = spawn(cliCommand, args, { env: process.env, stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => handleCliStdout(chunk.toString("utf8")));
  child.stderr.on("data", (chunk) => handleCliStderr(chunk.toString("utf8")));
  child.on("exit", (code, signal) => {
    sendNativeMessage({ type: "status", status: "exited", code, signal });
    child = null;
  });
}
function handleCliStdout(text) { stdoutBuffer += text; flushLines("stdout"); }
function handleCliStderr(text) { stderrBuffer += text; flushLines("stderr"); }
function flushLines(stream) {
  let buffer = stream === "stdout" ? stdoutBuffer : stderrBuffer;
  const lines = buffer.split(/\\r?\\n/);
  buffer = lines.pop() || "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        sendNativeMessage({ type: "rpc", payload: JSON.parse(trimmed) });
        continue;
      } catch {}
    }
    sendNativeMessage({ type: "log", stream, line: trimmed });
  }
  if (stream === "stdout") stdoutBuffer = buffer;
  else stderrBuffer = buffer;
}
function sendNativeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(header);
  process.stdout.write(body);
}
function shutdown() {
  if (child) {
    child.kill("SIGTERM");
    child = null;
  }
  process.exit(0);
}
`;
}

export async function installNativeHost(options: NativeHostInstallOptions): Promise<NativeHostInstallResult> {
  const homeDir = options.homeDir ?? AUTOHAND_HOME;
  const browsers = options.browsers?.length ? options.browsers : [...ALL_BROWSERS];
  const hostScriptPath = path.join(getBrowserDataRoot(homeDir), 'host.js');
  await ensureDir(path.dirname(hostScriptPath));

  const script = buildNativeHostScript({
    cliCommand: options.cliCommand ?? 'autohand',
    cliArgPrefix: options.cliArgPrefix ?? [],
  });
  await writeFile(hostScriptPath, script, 'utf8');
  if (process.platform !== 'win32') {
    await chmod(hostScriptPath, 0o755);
  }

  const targets: NativeHostInstallResult['targets'] = [];
  for (const browser of browsers) {
    const target = getManifestTarget(browser, process.platform, homeDir);
    const manifest = buildNativeHostManifest({
      hostName: options.hostName,
      extensionIds: options.extensionIds,
      hostScriptPath,
    });

    await ensureDir(path.dirname(target.manifestPath));
    await writeJson(target.manifestPath, manifest, { spaces: 2 });

    if (target.registryKey) {
      const result = spawnSync('reg', ['add', target.registryKey, '/ve', '/t', 'REG_SZ', '/d', target.manifestPath, '/f'], {
        stdio: 'pipe',
      });
      if (result.status !== 0) {
        const stderr = result.stderr?.toString('utf8') || '';
        throw new Error(`Failed to register native host for ${browser}: ${stderr.trim()}`);
      }
    }

    targets.push({ browser, manifestPath: target.manifestPath, registryKey: target.registryKey });
  }

  return { hostScriptPath, targets };
}

/**
 * Ensure the native messaging host is installed. Called automatically by
 * `/chrome` so users never have to run a separate install step.
 * Re-installs if the host script is missing or the shebang points to a
 * node binary that no longer exists.
 */
export async function ensureNativeHostInstalled(options?: {
  extensionId?: string;
}): Promise<void> {
  const homeDir = AUTOHAND_HOME;
  const chromeManifest = getManifestTarget('chrome', process.platform, homeDir);

  // If the Chrome manifest already exists and its host script is reachable
  // with a valid shebang, don't overwrite.
  if (await pathExists(chromeManifest.manifestPath)) {
    try {
      const manifest = await readJson(chromeManifest.manifestPath) as { path?: string };
      if (manifest.path && await pathExists(manifest.path)) {
        // Check shebang is a valid Node.js interpreter (not bun, not the autohand binary itself)
        const firstLine = (await readFile(manifest.path, 'utf8')).split('\n')[0] ?? '';
        const shebangPath = firstLine.replace(/^#!/, '').trim();
        const shebangParts = shebangPath.split(/\s+/).filter(Boolean);
        const commandBase = shebangParts[0]?.split('/').pop()?.toLowerCase() ?? '';
        const envTarget = commandBase === 'env'
          ? shebangParts.slice(1).find((part) => !part.startsWith('-'))?.split('/').pop()?.toLowerCase() ?? ''
          : commandBase;
        const isValidShebang = envTarget === 'node';
        if (isValidShebang) {
          return; // Already installed with valid host
        }
      }
    } catch {
      // Corrupt — fall through to reinstall
    }
  }

  // No valid manifest found — install fresh
  const { command, args } = resolveCliLaunchSpec();

  const extensionIds = [options?.extensionId].filter((id): id is string => Boolean(id));
  await installNativeHost({
    extensionIds,
    cliCommand: command,
    cliArgPrefix: args.length ? args : undefined,
  });
}

export async function createBrowserHandoff(options: {
  sessionId: string;
  workspaceRoot: string;
  homeDir?: string;
  extensionId?: string;
  installUrl?: string;
  launchTarget?: ChromeLaunchTarget;
  socketPath?: string;
}): Promise<BrowserHandoffResult> {
  const homeDir = options.homeDir ?? AUTOHAND_HOME;
  const token = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + DEFAULT_HANDOFF_TTL_MS).toISOString();
  const record: BrowserHandoffRecord = {
    token,
    sessionId: options.sessionId,
    workspaceRoot: options.workspaceRoot,
    createdAt,
    expiresAt,
    ...(options.socketPath ? { socketPath: options.socketPath } : {}),
  };

  await ensureDir(getHandoffDir(homeDir));
  await writeJson(path.join(getHandoffDir(homeDir), `${token}.json`), record, { spaces: 2 });

  return {
    ...record,
    url: buildChromeLaunchUrl({
      token,
      extensionId: options.extensionId,
      installUrl: options.installUrl,
      launchTarget: options.launchTarget,
    }),
  };
}

/**
 * Check if any non-expired handoff token exists (read-only, does not consume).
 */
export async function hasActiveHandoff(homeDir = AUTOHAND_HOME): Promise<boolean> {
  const handoffDir = getHandoffDir(homeDir);
  if (!(await pathExists(handoffDir))) return false;
  const entries = await fs.readdir(handoffDir);
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const record = await readJson(path.join(handoffDir, entry)) as BrowserHandoffRecord;
      if (new Date(record.expiresAt).getTime() > Date.now()) return true;
    } catch { /* skip malformed */ }
  }
  return false;
}

export async function attachBrowserHandoff(token: string, homeDir = AUTOHAND_HOME): Promise<BrowserHandoffRecord | null> {
  const handoffPath = path.join(getHandoffDir(homeDir), `${token}.json`);
  if (!(await pathExists(handoffPath))) {
    return null;
  }

  const record = await readJson(handoffPath) as BrowserHandoffRecord;
  if (new Date(record.expiresAt).getTime() < Date.now()) {
    await remove(handoffPath);
    return null;
  }

  await remove(handoffPath);
  return record;
}

export async function attachLatestBrowserHandoff(homeDir = AUTOHAND_HOME): Promise<BrowserHandoffRecord | null> {
  const handoffDir = getHandoffDir(homeDir);
  if (!(await pathExists(handoffDir))) {
    return null;
  }

  const entries = await fs.readdir(handoffDir);
  const records: Array<{ path: string; record: BrowserHandoffRecord }> = [];

  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue;
    }

    const recordPath = path.join(handoffDir, entry);
    const record = await readJson(recordPath) as BrowserHandoffRecord;
    if (new Date(record.expiresAt).getTime() < Date.now()) {
      await remove(recordPath);
      continue;
    }
    records.push({ path: recordPath, record });
  }

  records.sort((left, right) => {
    return new Date(right.record.createdAt).getTime() - new Date(left.record.createdAt).getTime();
  });

  const latest = records[0];
  if (!latest) {
    return null;
  }

  await remove(latest.path);
  return latest.record;
}

export function buildChromeOpenUrl(options: { extensionId?: string; installUrl?: string }): string {
  if (options.extensionId) {
    return `chrome-extension://${options.extensionId}/sidepanel.html`;
  }
  return options.installUrl || DEFAULT_CHROME_INSTALL_URL;
}

export function buildChromeLaunchUrl(options: {
  token: string;
  extensionId?: string;
  installUrl?: string;
  launchTarget?: ChromeLaunchTarget;
}): string {
  if (options.launchTarget !== 'web' && options.extensionId) {
    return `chrome-extension://${options.extensionId}/sidepanel.html?handoff=${encodeURIComponent(options.token)}`;
  }

  const baseUrl = options.installUrl || DEFAULT_CHROME_INSTALL_URL;
  if (!/^https?:\/\//.test(baseUrl)) {
    return baseUrl;
  }
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}handoff=${encodeURIComponent(options.token)}`;
}

/**
 * Open a URL with graceful fallbacks.
 * On Linux, `xdg-open` may be missing (headless servers, minimal distros).
 * Tries multiple strategies before printing the URL for manual opening.
 */
export async function openUrl(url: string): Promise<void> {
  try {
    await open(url);
    return;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('xdg-open') && !message.includes('Executable not found') && !message.includes('ENOENT')) {
      throw err;
    }
  }

  // Fallback: try common Linux openers directly
  const openers = ['xdg-open', 'sensible-browser', 'x-www-browser', 'firefox', 'chromium', 'google-chrome'];
  for (const opener of openers) {
    try {
      execSync(`which ${opener}`, { stdio: 'pipe' });
      spawn(opener, [url], { detached: true, stdio: 'ignore' }).unref();
      return;
    } catch {
      // opener not found, try next
    }
  }

  // Last resort: print URL for manual opening
  console.log(`\nUnable to open a browser automatically. Please open this URL manually:\n${url}\n`);
}

export async function openChromeContinuation(
  url: string,
  browser: BrowserPreference = 'auto',
  options: { userDataDir?: string; profileDirectory?: string } = {},
): Promise<void> {
  if (options.userDataDir || options.profileDirectory) {
    const command = await resolveBrowserCommand(browser);
    if (command) {
      const args = [
        ...(options.userDataDir ? [`--user-data-dir=${options.userDataDir}`] : []),
        ...(options.profileDirectory ? [`--profile-directory=${options.profileDirectory}`] : []),
        url,
      ];
      const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return;
    }
  }

  const appName = await resolveBrowserLaunchTarget(browser);
  if (!appName) {
    await open(url);
    return;
  }

  try {
    await open(url, { app: { name: appName } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('xdg-open') || message.includes('Executable not found') || message.includes('ENOENT')) {
      await open(url);
    } else {
      throw err;
    }
  }
}

export function applyChromeSettings(config: LoadedConfig, updates: Partial<ChromeSettings>): LoadedConfig {
  config.chrome = {
    ...(config.chrome ?? {}),
    ...updates,
  };
  return config;
}
