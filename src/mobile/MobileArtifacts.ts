/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  MobileArtifact,
  MobileArtifactKind,
  MobileArtifactMimeType,
  MobileHandoffClientLike,
} from './MobileHandoffClient.js';

const MAX_ARTIFACT_BYTES = 15 * 1024 * 1024;
const MAX_ARTIFACTS = 12;

const supportedExtensions: Record<string, { kind: MobileArtifactKind; mimeType: MobileArtifactMimeType }> = {
  '.png': { kind: 'image', mimeType: 'image/png' },
  '.jpg': { kind: 'image', mimeType: 'image/jpeg' },
  '.jpeg': { kind: 'image', mimeType: 'image/jpeg' },
  '.mp4': { kind: 'video', mimeType: 'video/mp4' },
  '.log': { kind: 'log', mimeType: 'text/plain' },
  '.txt': { kind: 'log', mimeType: 'text/plain' },
  '.json': { kind: 'log', mimeType: 'application/json' },
};

function candidatePaths(text: string): string[] {
  const candidates = new Set<string>();
  const patterns = [
    /\[[^\]]*\]\(([^)]+)\)/g,
    /`([^`\n]+)`/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const candidate = match[1]?.trim().replace(/^file:\/\//, '');
      if (candidate && supportedExtensions[path.extname(candidate).toLowerCase()]) candidates.add(candidate);
    }
  }
  return [...candidates].slice(0, MAX_ARTIFACTS * 2);
}

function isInsideWorkspace(filePath: string, workspaceRoot: string): boolean {
  return filePath === workspaceRoot || filePath.startsWith(`${workspaceRoot}${path.sep}`);
}

export async function collectAndUploadMobileArtifacts(options: {
  text: string;
  workspaceRoot: string;
  client: MobileHandoffClientLike;
  token: string;
  sessionId: string;
  deviceId: string;
}): Promise<MobileArtifact[]> {
  if (!options.client.uploadMobileArtifact) return [];
  const workspaceRoot = await realpath(options.workspaceRoot);
  const artifacts: MobileArtifact[] = [];

  for (const candidate of candidatePaths(options.text)) {
    if (artifacts.length >= MAX_ARTIFACTS) break;
    try {
      const resolved = await realpath(path.resolve(workspaceRoot, candidate));
      if (!isInsideWorkspace(resolved, workspaceRoot)) continue;
      const descriptor = supportedExtensions[path.extname(resolved).toLowerCase()];
      if (!descriptor) continue;
      const fileStat = await stat(resolved);
      if (!fileStat.isFile() || fileStat.size <= 0 || fileStat.size > MAX_ARTIFACT_BYTES) continue;
      const data = await readFile(resolved);
      artifacts.push(await options.client.uploadMobileArtifact(options.token, options.sessionId, {
        deviceId: options.deviceId,
        name: path.basename(resolved),
        kind: descriptor.kind,
        mimeType: descriptor.mimeType,
        data: data.toString('base64'),
      }));
    } catch {
      // Missing, unreadable, or unsafe paths are intentionally ignored.
    }
  }
  return artifacts;
}
