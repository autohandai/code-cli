/**
 * Project Session Permissions
 * Stores project-shared temporary permission decisions in
 * .autohand/session-permissions.json.
 */
import fs from 'fs-extra';
import path from 'node:path';
import { PROJECT_DIR_NAME } from '../constants.js';

const SESSION_PERMISSIONS_FILE = 'session-permissions.json';

export interface SessionProjectPermissions {
  allowList?: string[];
  denyList?: string[];
  version?: number;
}

export function getSessionPermissionsPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, PROJECT_DIR_NAME, SESSION_PERMISSIONS_FILE);
}

export async function loadSessionProjectPermissions(
  workspaceRoot: string
): Promise<SessionProjectPermissions | null> {
  const filePath = getSessionPermissionsPath(workspaceRoot);
  if (!(await fs.pathExists(filePath))) {
    return null;
  }

  const contents = await fs.readFile(filePath, 'utf8');
  return JSON.parse(contents) as SessionProjectPermissions;
}

export async function saveSessionProjectPermissions(
  workspaceRoot: string,
  permissions: SessionProjectPermissions
): Promise<void> {
  const filePath = getSessionPermissionsPath(workspaceRoot);
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeJson(filePath, { ...permissions, version: 1 }, { spaces: 2 });
}

export async function addToSessionAllowList(workspaceRoot: string, pattern: string): Promise<void> {
  const current = (await loadSessionProjectPermissions(workspaceRoot)) ?? {};
  const allowList = current.allowList ?? [];
  if (!allowList.includes(pattern)) {
    allowList.push(pattern);
  }
  await saveSessionProjectPermissions(workspaceRoot, {
    ...current,
    allowList,
  });
}

export async function addToSessionDenyList(workspaceRoot: string, pattern: string): Promise<void> {
  const current = (await loadSessionProjectPermissions(workspaceRoot)) ?? {};
  const denyList = current.denyList ?? [];
  if (!denyList.includes(pattern)) {
    denyList.push(pattern);
  }
  await saveSessionProjectPermissions(workspaceRoot, {
    ...current,
    denyList,
  });
}
