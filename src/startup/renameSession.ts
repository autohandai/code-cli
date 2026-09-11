/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import { SessionManager } from '../session/SessionManager.js';
import type { SessionMetadata } from '../session/types.js';

export interface RenameLastSessionOptions {
  workspacePath: string;
  name: string;
  sessionsDir?: string;
}

/**
 * `autohand --rename <name>` names the most recent session of the workspace
 * so a session can be labelled from a script or another terminal.
 */
export async function renameLastSession(options: RenameLastSessionOptions): Promise<SessionMetadata> {
  const manager = new SessionManager(options.sessionsDir);
  await manager.initialize();
  const workspacePath = path.resolve(options.workspacePath);
  const last = await manager.getLastSession(workspacePath);
  if (!last) {
    throw new Error(`No session found for ${workspacePath}. Start one with autohand first.`);
  }
  return manager.renameSession(last.sessionId, options.name);
}
