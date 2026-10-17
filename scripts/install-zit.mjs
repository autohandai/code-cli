#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants, existsSync } from 'node:fs';
import { access, chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const ZIT_VERSION = '0.1.2';
const RELEASE_BASE_URL = 'https://github.com/autohandai/getzit/releases/download';
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_BINARY_BYTES = 64 * 1024 * 1024;
const BINARIES = ['zit', 'git-zit'];
const TARGETS = new Map([
  ['darwin-arm64', 'aarch64-apple-darwin'],
  ['darwin-x64', 'x86_64-apple-darwin'],
  ['linux-arm64', 'aarch64-unknown-linux-gnu'],
  ['linux-x64', 'x86_64-unknown-linux-gnu'],
]);
const executeFile = promisify(execFile);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** @typedef {{packageRoot?: string, platform?: string, architecture?: string, environment?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, releaseBaseUrl?: string, force?: boolean}} ZitInstallOptions */

export function resolveZitArtifact(platform = process.platform, architecture = process.arch) {
  const directory = `${platform}-${architecture}`;
  const target = TARGETS.get(directory);
  return target ? { name: `zit-v${ZIT_VERSION}-${target}`, directory } : null;
}

async function download(fetchImpl, url, maximumBytes) {
  const response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
  if (!response.ok || Number(response.headers.get('content-length')) > maximumBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error(!response.ok ? `Zit download failed (HTTP ${response.status}).` : 'Zit download exceeded its size limit.');
  }
  if (!response.body) throw new Error('Zit download returned an empty response.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { complete = true; break; }
      size += value.byteLength;
      if (size > maximumBytes) throw new Error('Zit download exceeded its size limit.');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function parseChecksum(document, archiveName) {
  for (const line of document.trim().split(/\r?\n/u)) {
    const match = /^([0-9a-f]{64})\s+\*?(\S+)$/iu.exec(line.trim());
    if (match?.[2] === archiveName) return match[1].toLowerCase();
  }
  throw new Error(`Zit checksum does not describe ${archiveName}.`);
}

async function binaryDigest(filename) {
  const info = await lstat(filename);
  if (!info.isFile() || info.size === 0 || info.size > MAX_BINARY_BYTES) {
    throw new Error('The Zit archive must contain each binary as a bounded, nonempty regular file.');
  }
  return digest(await readFile(filename));
}

async function hasVerifiedBundle(directory) {
  try {
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
    if (manifest.version !== ZIT_VERSION) return false;
    for (const binary of BINARIES) {
      const filename = path.join(directory, binary);
      if (await binaryDigest(filename) !== manifest.checksums?.[binary]) return false;
      await access(filename, constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

async function replaceBundle(staged, destination) {
  try {
    await rename(staged, destination);
    return;
  } catch (error) {
    if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error?.code)) throw error;
  }
  const backup = `${destination}.previous-${randomUUID()}`;
  await rename(destination, backup);
  try {
    await rename(staged, destination);
  } catch (error) {
    await rename(backup, destination);
    throw error;
  }
  await rm(backup, { recursive: true, force: true });
}

/** @param {ZitInstallOptions} options */
export async function installZit(options = {}) {
  const packageRoot = options.packageRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const environment = options.environment ?? process.env;
  if (environment.AUTOHAND_SKIP_ZIT_INSTALL === '1') return { status: 'skipped' };
  if (!options.force && existsSync(path.join(packageRoot, '.git'))) return { status: 'skipped-development' };
  const artifact = resolveZitArtifact(options.platform ?? process.platform, options.architecture ?? process.arch);
  if (!artifact) return { status: 'unsupported' };
  const vendorDirectory = path.join(packageRoot, 'vendor', 'zit');
  const destination = path.join(vendorDirectory, artifact.directory);
  const binaryPath = path.join(destination, 'zit');
  if (await hasVerifiedBundle(destination)) return { status: 'existing', path: binaryPath };

  const archiveName = `${artifact.name}.tar.gz`;
  const url = `${options.releaseBaseUrl ?? RELEASE_BASE_URL}/v${ZIT_VERSION}/${archiveName}`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const checksum = await download(fetchImpl, `${url}.sha256`, 16 * 1024);
  const expected = parseChecksum(checksum.toString('utf8'), archiveName);
  const archive = await download(fetchImpl, url, MAX_ARCHIVE_BYTES);
  if (digest(archive) !== expected) throw new Error('Zit archive checksum verification failed.');

  await mkdir(vendorDirectory, { recursive: true });
  const staging = await mkdtemp(path.join(vendorDirectory, '.zit-'));
  try {
    const archivePath = path.join(staging, 'archive.tar.gz');
    await writeFile(archivePath, archive);
    await executeFile('tar', ['-xzf', archivePath, '-C', staging, ...BINARIES.map(binary => `${artifact.name}/${binary}`)], {
      timeout: 30_000, maxBuffer: 64 * 1024, windowsHide: true,
    });
    const extracted = path.join(staging, artifact.name);
    const checksums = {};
    for (const binary of BINARIES) {
      const filename = path.join(extracted, binary);
      checksums[binary] = await binaryDigest(filename);
      await chmod(filename, 0o755);
    }
    await writeFile(path.join(extracted, 'manifest.json'), `${JSON.stringify({ version: ZIT_VERSION, checksums })}\n`);
    await replaceBundle(extracted, destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return { status: 'installed', path: binaryPath };
}

/** @param {ZitInstallOptions} options */
export async function bundleZit(options = {}) {
  const results = [];
  for (const directory of TARGETS.keys()) {
    const [platform, architecture] = directory.split('-');
    results.push(await installZit({
      ...options, platform, architecture, force: true,
      environment: { ...options.environment, AUTOHAND_SKIP_ZIT_INSTALL: '0' },
    }));
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  (process.argv.includes('--all') ? bundleZit() : installZit()).then((result) => {
    if (Array.isArray(result)) console.log(`Prepared verified Zit ${ZIT_VERSION} binaries for all ${result.length} supported npm/Bun platforms.`);
    else if (result.status === 'installed' || result.status === 'existing') console.log(`Zit ${ZIT_VERSION} is available for autohand --zit.`);
    else if (result.status === 'unsupported') console.warn('Zit has no native binary for this platform. See https://getzit.org.');
  }).catch((error) => {
    console.error(`Could not prepare Zit: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
