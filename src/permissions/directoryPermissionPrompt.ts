/**
 * Directory Permission Prompt
 * Detects when user mentions directories outside workspace and prompts to add them to permissions
 * @license Apache-2.0
 */

import * as path from 'node:path';
import { showModal, type ModalOption } from '../ui/ink/components/Modal.js';
import { t } from '../i18n/index.js';
import { addToLocalAllowList } from './localProjectPermissions.js';
import { addToSessionAllowList } from './sessionProjectPermissions.js';
import type { PermissionManager } from './PermissionManager.js';

export interface DirectoryPermissionOptions {
  workspaceRoot: string;
  permissionManager: PermissionManager;
  autoApprove?: boolean;
}

/**
 * Extract directory paths from user instruction text
 * Matches absolute paths in various formats
 */
export function extractDirectoryPaths(instruction: string): string[] {
  const paths: string[] = [];
  
  // Match Unix absolute paths: /Users/foo/bar, /home/foo/bar
  const unixPathRegex = /(?:^|\s)(\/(?:Users|home|root)[\/\w\.\-_]+)/g;
  let match;
  while ((match = unixPathRegex.exec(instruction)) !== null) {
    const extracted = match[1];
    if (!paths.includes(extracted)) {
      paths.push(extracted);
    }
  }
  
  // Match Windows absolute paths: C:\Users\foo\bar
  const windowsPathRegex = /(?:^|\s)([A-Za-z]:\\[^\s]+)/g;
  while ((match = windowsPathRegex.exec(instruction)) !== null) {
    const extracted = match[1];
    if (!paths.includes(extracted)) {
      paths.push(extracted);
    }
  }
  
  // Match paths with @ prefix: @/Users/foo/bar or @C:\Users\foo\bar
  const atPathRegex = /@([A-Za-z]:\\[^\s]+|\/[^\s]+)/g;
  while ((match = atPathRegex.exec(instruction)) !== null) {
    const extracted = match[1];
    if (!paths.includes(extracted)) {
      paths.push(extracted);
    }
  }
  
  return paths;
}

/**
 * Check if a path is outside the workspace
 */
export function isPathOutsideWorkspace(targetPath: string, workspaceRoot: string): boolean {
  // Normalize paths for comparison
  const normalizedTarget = targetPath.replace(/\\/g, '/');
  const normalizedWorkspace = workspaceRoot.replace(/\\/g, '/');
  
  // Check if target path is not within workspace
  // A path is outside if:
  // 1. The relative path starts with '..'
  // 2. The target is on a different drive (Windows)
  // 3. The target doesn't start with the workspace path
  
  // Check for different drives on Windows
  const targetDrive = normalizedTarget.match(/^([A-Za-z]):/);
  const workspaceDrive = normalizedWorkspace.match(/^([A-Za-z]):/);
  if (targetDrive && workspaceDrive && targetDrive[1] !== workspaceDrive[1]) {
    return true;
  }
  
  // Check if target starts with workspace
  if (normalizedTarget.startsWith(normalizedWorkspace + '/') || 
      normalizedTarget === normalizedWorkspace) {
    return false;
  }
  
  // Use path.relative for proper comparison on the current platform
  try {
    const relative = path.relative(normalizedWorkspace, normalizedTarget);
    return relative.startsWith('..') || path.isAbsolute(relative);
  } catch {
    // Fallback: if path.relative fails, assume outside
    return true;
  }
}

/**
 * Check if a path is actually a directory
 */
async function isDirectory(pathToCheck: string): Promise<boolean> {
  try {
    const { stat } = await import('fs-extra');
    const stats = await stat(pathToCheck);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Prompt user to add directory to permissions
 */
async function promptToAddDirectory(directoryPath: string): Promise<boolean> {
  const options: ModalOption[] = [
    { label: t('permissions.directoryPrompt.allow'), value: 'allow' },
    { label: t('permissions.directoryPrompt.deny'), value: 'deny' },
  ];

  const result = await showModal({
    title: t('permissions.directoryPrompt.title', { directory: directoryPath }),
    options,
    initialIndex: 0
  });

  return result?.value === 'allow';
}

/**
 * Add directory to all permission systems
 */
async function addDirectoryToPermissions(
  directoryPath: string,
  options: DirectoryPermissionOptions
): Promise<void> {
  const { workspaceRoot, permissionManager } = options;
  
  // Add to local project permissions (persistent)
  const filePattern = `read_file:${directoryPath}/*`;
  const writePattern = `write_file:${directoryPath}/*`;
  const listPattern = `list_dir:${directoryPath}/*`;
  
  await addToLocalAllowList(workspaceRoot, filePattern);
  await addToLocalAllowList(workspaceRoot, writePattern);
  await addToLocalAllowList(workspaceRoot, listPattern);
  
  // Add to session permissions
  await addToSessionAllowList(workspaceRoot, filePattern);
  await addToSessionAllowList(workspaceRoot, writePattern);
  await addToSessionAllowList(workspaceRoot, listPattern);
  
  // Add to global permission manager
  permissionManager.addToAllowList(filePattern);
  permissionManager.addToAllowList(writePattern);
  permissionManager.addToAllowList(listPattern);
  
  // Persist global settings
  if (permissionManager['onPersist']) {
    await permissionManager['onPersist'](permissionManager.getSettings());
  }
}

/**
 * Main function to check and prompt for directory permissions
 * Call this before processing user instruction
 */
export async function checkAndPromptForDirectoryPermissions(
  instruction: string,
  options: DirectoryPermissionOptions
): Promise<void> {
  const { workspaceRoot, autoApprove } = options;
  
  // Extract directory paths from instruction
  const directoryPaths = extractDirectoryPaths(instruction);
  
  if (directoryPaths.length === 0) {
    return;
  }
  
  // Check each directory
  for (const dirPath of directoryPaths) {
    // Skip if it's the workspace itself
    const resolvedDir = path.resolve(dirPath);
    const resolvedWorkspace = path.resolve(workspaceRoot);
    
    if (resolvedDir === resolvedWorkspace) {
      continue;
    }
    
    // Check if outside workspace
    if (!isPathOutsideWorkspace(dirPath, workspaceRoot)) {
      continue;
    }
    
    // Check if it's actually a directory
    const isDir = await isDirectory(dirPath);
    if (!isDir) {
      continue;
    }
    
    if (autoApprove) {
      // Auto-grant access without prompting
      await addDirectoryToPermissions(dirPath, options);
      console.log(t('permissions.directoryPrompt.added', { directory: dirPath }));
      continue;
    }
    
    // Prompt user
    const shouldAdd = await promptToAddDirectory(dirPath);
    
    if (shouldAdd) {
      await addDirectoryToPermissions(dirPath, options);
      console.log(t('permissions.directoryPrompt.added', { directory: dirPath }));
    }
  }
}
