/**
 * Workspace Safety Checker
 *
 * Prevents autohand from running in dangerous directories that could lead to
 * accidental modification of system files, home directories, or other sensitive areas.
 */

import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';

export interface WorkspaceSafetyResult {
  safe: boolean;
  reason?: string;
  suggestion?: string;
}

/**
 * Dangerous paths that should never be used as workspace roots
 */
const DANGEROUS_PATHS = {
  // Filesystem roots (Unix and Windows)
  roots: ['/', 'C:\\', 'D:\\', 'E:\\', 'F:\\', 'G:\\'],

  // System directories (Unix/Linux)
  unix: [
    '/etc',
    '/var',
    '/usr',
    '/opt',
    '/bin',
    '/sbin',
    '/lib',
    '/lib64',
    '/root',
    '/sys',
    '/proc',
    '/dev',
    '/boot',
    '/run',
    '/snap',
  ],

  // System directories (macOS)
  macos: [
    '/System',
    '/Library',
    '/Applications',
    '/private',
    '/cores',
    '/Volumes',
  ],

  // System directories (Windows)
  windows: [
    'C:\\Windows',
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    'C:\\ProgramData',
    'C:\\Recovery',
    'C:\\$Recycle.Bin',
  ],

  // WSL mount points (Windows drives mounted in WSL)
  wsl: ['/mnt/c', '/mnt/d', '/mnt/e', '/mnt/f'],
};

/**
 * Normalize a path for comparison:
 * - Resolve to absolute path
 * - Resolve symlinks
 * - Remove trailing slashes
 * - Normalize separators
 */
function normalizePath(inputPath: string): string {
  // Resolve to absolute path
  let normalized = path.resolve(inputPath);

  // Try to resolve symlinks (ignore errors for non-existent paths)
  try {
    normalized = fs.realpathSync(normalized);
  } catch {
    // Path doesn't exist or can't be resolved, use as-is
  }

  // Remove trailing slash (except for root)
  if (normalized.length > 1 && normalized.endsWith(path.sep)) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

/**
 * Check if two paths are equal (case-insensitive on Windows/macOS)
 */
function pathsEqual(path1: string, path2: string): boolean {
  const normalized1 = normalizePath(path1);
  const normalized2 = normalizePath(path2);

  // macOS and Windows are case-insensitive
  if (process.platform === 'darwin' || process.platform === 'win32') {
    return normalized1.toLowerCase() === normalized2.toLowerCase();
  }

  return normalized1 === normalized2;
}

/**
 * Check if a path starts with a prefix (case-insensitive on Windows/macOS)
 */
function pathStartsWith(testPath: string, prefix: string): boolean {
  const normalizedPath = normalizePath(testPath);
  const normalizedPrefix = normalizePath(prefix);

  // Ensure prefix ends with separator for proper matching
  const prefixWithSep = normalizedPrefix.endsWith(path.sep)
    ? normalizedPrefix
    : normalizedPrefix + path.sep;

  if (process.platform === 'darwin' || process.platform === 'win32') {
    return (
      normalizedPath.toLowerCase() === normalizedPrefix.toLowerCase() ||
      normalizedPath.toLowerCase().startsWith(prefixWithSep.toLowerCase())
    );
  }

  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(prefixWithSep);
}

/**
 * Check if path is a filesystem root
 */
function isFilesystemRoot(workspacePath: string): boolean {
  const normalized = normalizePath(workspacePath);

  // Unix root
  if (normalized === '/') {
    return true;
  }

  // Windows drive roots (C:\, D:\, etc.)
  if (process.platform === 'win32') {
    // Match patterns like "C:" or "C:\"
    if (/^[A-Za-z]:[\\/]?$/.test(normalized)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if path is the user's home directory
 */
function isHomeDirectory(workspacePath: string): boolean {
  const homeDir = os.homedir();
  return pathsEqual(workspacePath, homeDir);
}

/**
 * Check if path is a parent of the home directory
 * (e.g., /Users on macOS, /home on Linux, C:\Users on Windows)
 */
function isParentOfHome(workspacePath: string): boolean {
  const homeDir = os.homedir();
  const normalized = normalizePath(workspacePath);
  const normalizedHome = normalizePath(homeDir);

  // Check if workspace is a parent of home
  if (process.platform === 'darwin' || process.platform === 'win32') {
    return normalizedHome.toLowerCase().startsWith(normalized.toLowerCase() + path.sep);
  }

  return normalizedHome.startsWith(normalized + path.sep);
}

/**
 * Check if path is a system directory
 */
function isSystemDirectory(workspacePath: string): boolean {
  const normalized = normalizePath(workspacePath);

  // Always check all dangerous paths regardless of platform
  // This ensures Windows paths are rejected even when testing on Unix
  // and vice versa, providing consistent security behavior
  const dangerousPaths: string[] = [
    ...DANGEROUS_PATHS.roots,
    ...DANGEROUS_PATHS.unix,
    ...DANGEROUS_PATHS.macos,
    ...DANGEROUS_PATHS.windows,
    ...DANGEROUS_PATHS.wsl,
  ];

  // Check exact matches and path prefixes
  for (const dangerous of dangerousPaths) {
    if (pathsEqual(normalized, dangerous)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if path is a Windows user home directory (C:\Users\username)
 * Always check on all platforms for consistent security behavior
 * Note: We check the RAW input path because on non-Windows platforms,
 * path.resolve would treat Windows paths as relative paths
 */
function isWindowsUserHome(workspacePath: string): boolean {
  // Check the original input for Windows patterns
  // This works on all platforms because we're just doing string matching
  const windowsUsersPattern = /^[A-Za-z]:[/\\]Users([/\\][^/\\]+)?$/i;
  if (windowsUsersPattern.test(workspacePath)) {
    return true;
  }

  return false;
}

/**
 * Check if path is a WSL Windows mount (like /mnt/c/Users/...)
 * Always check on all platforms for consistent security behavior
 */
function isWslWindowsHome(workspacePath: string): boolean {
  const normalized = normalizePath(workspacePath);

  // Check for /mnt/c, /mnt/d, etc. (Windows drive roots in WSL)
  for (const wslMount of DANGEROUS_PATHS.wsl) {
    if (pathsEqual(normalized, wslMount)) {
      return true;
    }
  }

  // Check for Windows Users directory in WSL
  // /mnt/c/Users or /mnt/c/Users/username
  const wslUsersPattern = /^\/mnt\/[a-z]\/users(\/[^/]+)?$/i;
  if (wslUsersPattern.test(normalized)) {
    return true;
  }

  // Check for /mnt/c/Windows
  const wslWindowsPattern = /^\/mnt\/[a-z]\/windows$/i;
  if (wslWindowsPattern.test(normalized)) {
    return true;
  }

  return false;
}

/**
 * Get a friendly name for why the workspace is dangerous
 */
function getDangerReason(workspacePath: string): string {
  const normalized = normalizePath(workspacePath);

  if (isFilesystemRoot(workspacePath)) {
    return 'This is the filesystem root directory.';
  }

  if (isHomeDirectory(workspacePath)) {
    return 'This is your home directory.';
  }

  if (isParentOfHome(workspacePath)) {
    return 'This directory contains user home directories.';
  }

  if (isWslWindowsHome(workspacePath)) {
    return 'This is a Windows system directory accessed via WSL.';
  }

  // Identify specific system directories
  if (normalized.startsWith('/etc') || normalized.match(/^[A-Za-z]:\\Windows/i)) {
    return 'This is a system configuration directory.';
  }

  if (normalized.startsWith('/var') || normalized.match(/^[A-Za-z]:\\ProgramData/i)) {
    return 'This is a system data directory.';
  }

  if (normalized.startsWith('/usr') || normalized.match(/^[A-Za-z]:\\Program Files/i)) {
    return 'This is a system programs directory.';
  }

  if (normalized.startsWith('/System') || normalized.startsWith('/Library')) {
    return 'This is a macOS system directory.';
  }

  return 'This directory is too broad for safe AI agent operation.';
}

/**
 * Check if a workspace path is safe to use
 *
 * @param workspacePath - The path to check
 * @returns Safety result with reason if unsafe
 */
export function checkWorkspaceSafety(workspacePath: string): WorkspaceSafetyResult {
  try {
    // Normalize the path first
    const normalized = normalizePath(workspacePath);

    // Check for filesystem root
    if (isFilesystemRoot(normalized)) {
      return {
        safe: false,
        reason: 'This is the filesystem root directory. Running an AI agent here could modify critical system files.',
        suggestion: 'Navigate to a specific project folder and try again.',
      };
    }

    // Check for home directory
    if (isHomeDirectory(normalized)) {
      return {
        safe: false,
        reason: 'This is your home directory. Running an AI agent here could modify files across your entire user account.',
        suggestion: 'Navigate to a specific project folder (e.g., ~/projects/my-app) and try again.',
      };
    }

    // Check for parent of home (like /Users or /home)
    if (isParentOfHome(normalized)) {
      return {
        safe: false,
        reason: 'This directory contains user home directories. Running an AI agent here is too broad.',
        suggestion: 'Navigate to a specific project folder and try again.',
      };
    }

    // Check for system directories
    if (isSystemDirectory(normalized)) {
      return {
        safe: false,
        reason: getDangerReason(normalized),
        suggestion: 'Navigate to a specific project folder and try again.',
      };
    }

    // Check for WSL Windows paths
    if (isWslWindowsHome(normalized)) {
      return {
        safe: false,
        reason: getDangerReason(normalized),
        suggestion: 'Navigate to a specific project folder and try again.',
      };
    }

    // Check for Windows user home directories (C:\Users\username)
    // Use original path because path.resolve on non-Windows treats Windows paths as relative
    if (isWindowsUserHome(workspacePath)) {
      return {
        safe: false,
        reason: 'This is a Windows user home directory. Running an AI agent here could modify files across the user account.',
        suggestion: 'Navigate to a specific project folder and try again.',
      };
    }

    // Path is safe
    return { safe: true };
  } catch (error) {
    // If we can't determine safety, allow but log warning
    console.warn(`Warning: Could not verify workspace safety for "${workspacePath}": ${error}`);
    return { safe: true };
  }
}

/**
 * Print a warning box for dangerous workspace detection
 */
export function printDangerousWorkspaceWarning(
  workspacePath: string,
  result: WorkspaceSafetyResult
): void {
  const boxWidth = 65;
  const horizontalLine = '─'.repeat(boxWidth - 2);

  console.log();
  console.log(chalk.red(`┌${horizontalLine}┐`));
  console.log(chalk.red(`│`) + chalk.yellow.bold('  ⚠️  Unsafe Workspace Directory') + ' '.repeat(boxWidth - 35) + chalk.red('│'));
  console.log(chalk.red(`├${horizontalLine}┤`));
  console.log(chalk.red(`│`) + ' '.repeat(boxWidth - 2) + chalk.red('│'));

  // Show the path
  console.log(chalk.red(`│`) + chalk.white('  You\'re trying to run autohand in:') + ' '.repeat(boxWidth - 38) + chalk.red('│'));
  const pathLine = `  ${workspacePath}`;
  const truncatedPath = pathLine.length > boxWidth - 4 ? pathLine.slice(0, boxWidth - 7) + '...' : pathLine;
  console.log(chalk.red(`│`) + chalk.cyan(truncatedPath) + ' '.repeat(Math.max(0, boxWidth - 2 - truncatedPath.length)) + chalk.red('│'));
  console.log(chalk.red(`│`) + ' '.repeat(boxWidth - 2) + chalk.red('│'));

  // Show the reason (word wrap)
  if (result.reason) {
    const reasonWords = result.reason.split(' ');
    let currentLine = '  ';
    for (const word of reasonWords) {
      if (currentLine.length + word.length + 1 > boxWidth - 4) {
        const paddedLine = currentLine + ' '.repeat(Math.max(0, boxWidth - 2 - currentLine.length));
        console.log(chalk.red(`│`) + chalk.white(paddedLine) + chalk.red('│'));
        currentLine = '  ';
      }
      currentLine += (currentLine === '  ' ? '' : ' ') + word;
    }
    if (currentLine.length > 2) {
      const paddedLine = currentLine + ' '.repeat(Math.max(0, boxWidth - 2 - currentLine.length));
      console.log(chalk.red(`│`) + chalk.white(paddedLine) + chalk.red('│'));
    }
  }

  console.log(chalk.red(`│`) + ' '.repeat(boxWidth - 2) + chalk.red('│'));

  // Show suggestion
  console.log(chalk.red(`│`) + chalk.white('  Please navigate to a specific project folder:') + ' '.repeat(boxWidth - 50) + chalk.red('│'));
  console.log(chalk.red(`│`) + ' '.repeat(boxWidth - 2) + chalk.red('│'));
  console.log(chalk.red(`│`) + chalk.cyan('    cd ~/projects/my-app') + ' '.repeat(boxWidth - 27) + chalk.red('│'));
  console.log(chalk.red(`│`) + chalk.cyan('    autohand') + ' '.repeat(boxWidth - 15) + chalk.red('│'));
  console.log(chalk.red(`│`) + ' '.repeat(boxWidth - 2) + chalk.red('│'));
  console.log(chalk.red(`│`) + chalk.white('  Or specify a path directly:') + ' '.repeat(boxWidth - 32) + chalk.red('│'));
  console.log(chalk.red(`│`) + ' '.repeat(boxWidth - 2) + chalk.red('│'));
  console.log(chalk.red(`│`) + chalk.cyan('    autohand --path ~/projects/my-app') + ' '.repeat(boxWidth - 40) + chalk.red('│'));
  console.log(chalk.red(`│`) + ' '.repeat(boxWidth - 2) + chalk.red('│'));
  console.log(chalk.red(`└${horizontalLine}┘`));
  console.log();
}
