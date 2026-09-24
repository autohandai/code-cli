#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_RELEASE_BASE_URL = 'https://github.com/autohandai/code-cli/releases/download';
const MAX_CHECKSUM_BYTES = 16 * 1024;
const MAX_BINARY_BYTES = 128 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120_000;

const RELEASE_ARTIFACTS = new Map([
  ['darwin/arm64', { assetName: 'ahtraces-macos-arm64', binaryName: 'ahtraces' }],
  ['darwin/x64', { assetName: 'ahtraces-macos-x64', binaryName: 'ahtraces' }],
  ['linux/arm64', { assetName: 'ahtraces-linux-arm64', binaryName: 'ahtraces' }],
  ['linux/x64', { assetName: 'ahtraces-linux-x64', binaryName: 'ahtraces' }],
  ['win32/x64', { assetName: 'ahtraces-windows-x64.exe', binaryName: 'ahtraces.exe' }],
]);

export function resolveAhTracesArtifact(platform = process.platform, architecture = process.arch) {
  const artifact = RELEASE_ARTIFACTS.get(`${platform}/${architecture}`);
  if (!artifact) {
    throw new Error(`ahtraces is not available for ${platform}/${architecture}.`);
  }
  return artifact;
}

export function resolveInstalledAhTracesPath(
  packageRoot,
  platform = process.platform,
  architecture = process.arch,
) {
  return path.join(packageRoot, 'vendor', resolveAhTracesArtifact(platform, architecture).binaryName);
}

export function parseAhTracesChecksum(document, assetName) {
  const lines = document.trim().split(/\r?\n/u).filter(Boolean);
  for (const line of lines) {
    const match = /^([0-9a-f]{64})\s+\*?([^\s]+)$/iu.exec(line.trim());
    if (!match) continue;
    if (path.basename(match[2]) === assetName) return match[1].toLowerCase();
  }
  if (lines.some((line) => /^[0-9a-f]{64}\s+/iu.test(line.trim()))) {
    throw new Error(`The release checksum does not describe ${assetName}.`);
  }
  throw new Error('The release returned an invalid ahtraces checksum.');
}

async function readBoundedResponse(response, maximumBytes) {
  if (!response.body) throw new Error('The ahtraces release returned an empty response.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new Error('The ahtraces release response exceeded its size limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size);
}

async function fetchReleaseAsset(fetchImpl, url, maximumBytes) {
  const response = await fetchImpl(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Could not download ahtraces release asset (HTTP ${response.status}).`);
  }
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error('The ahtraces release asset exceeded its size limit.');
  }
  return readBoundedResponse(response, maximumBytes);
}

async function replaceInstalledBinary(temporaryPath, destinationPath) {
  try {
    await rename(temporaryPath, destinationPath);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
    await rm(destinationPath, { force: true });
    await rename(temporaryPath, destinationPath);
  }
}

export async function installAhTraces(options = {}) {
  const packageRoot = options.packageRoot
    ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (options.skip === true || process.env.AUTOHAND_SKIP_AHTRACES_INSTALL === '1') {
    return { status: 'skipped' };
  }
  if (options.force !== true && existsSync(path.join(packageRoot, '.git'))) {
    return { status: 'skipped-development' };
  }

  const packageManifest = options.version
    ? undefined
    : JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  const version = options.version ?? packageManifest?.version;
  if (typeof version !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z.+-]*$/u.test(version)) {
    throw new Error('The Autohand package has an invalid release version.');
  }

  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  const artifact = resolveAhTracesArtifact(platform, architecture);
  const releaseBaseUrl = options.releaseBaseUrl ?? DEFAULT_RELEASE_BASE_URL;
  const releaseUrl = `${releaseBaseUrl}/v${encodeURIComponent(version)}`;
  const checksumUrl = `${releaseUrl}/${encodeURIComponent(artifact.assetName)}.sha256`;
  const assetUrl = `${releaseUrl}/${encodeURIComponent(artifact.assetName)}`;
  const fetchImpl = options.fetchImpl ?? fetch;

  const checksumDocument = await fetchReleaseAsset(fetchImpl, checksumUrl, MAX_CHECKSUM_BYTES);
  const expectedDigest = parseAhTracesChecksum(checksumDocument.toString('utf8'), artifact.assetName);
  const binary = await fetchReleaseAsset(fetchImpl, assetUrl, MAX_BINARY_BYTES);
  const actualDigest = createHash('sha256').update(binary).digest('hex');
  if (actualDigest !== expectedDigest) {
    throw new Error('The downloaded ahtraces binary checksum verification failed.');
  }

  const vendorDirectory = path.join(packageRoot, 'vendor');
  const destinationPath = path.join(vendorDirectory, artifact.binaryName);
  const temporaryPath = path.join(vendorDirectory, `.ahtraces-${randomUUID()}.tmp`);
  await mkdir(vendorDirectory, { recursive: true, mode: 0o755 });
  await rm(temporaryPath, { force: true });
  let handle;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(binary);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temporaryPath, 0o755);
    await replaceInstalledBinary(temporaryPath, destinationPath);
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(temporaryPath, { force: true });
    throw error;
  }

  return {
    status: 'installed',
    path: destinationPath,
    assetName: artifact.assetName,
  };
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  const direct = pathToFileURL(path.resolve(entry)).href;
  if (import.meta.url === direct) return true;
  try {
    return import.meta.url === pathToFileURL(path.resolve(fileURLToPath(direct))).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  installAhTraces().then((result) => {
    if (result.status === 'installed') {
      console.log(`Installed ahtraces from the verified ${result.assetName} release asset.`);
    }
  }).catch((error) => {
    console.error(`Could not install ahtraces: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
