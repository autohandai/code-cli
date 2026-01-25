/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * GitHub and GitLab repository browsing capabilities.
 */

import * as https from 'https';

export type Platform = 'github' | 'gitlab';

export interface ParsedRepo {
  platform: Platform;
  owner: string;
  repo: string;
}

export interface RepoInfo {
  platform: Platform;
  name: string;
  fullName: string;
  description: string;
  stars: number;
  language: string | null;
  defaultBranch: string;
  license: string | null;
}

export interface RepoFile {
  name: string;
  type: 'file' | 'dir';
  path: string;
  size?: number;
}

/**
 * Parse a repository URL or shorthand into platform, owner, and repo.
 *
 * Supported formats:
 * - Full URL: https://github.com/owner/repo
 * - Full URL: https://gitlab.com/group/project
 * - Shorthand: github:owner/repo
 * - Shorthand: gitlab:group/project
 */
export function parseRepoUrl(input: string): ParsedRepo {
  // Try shorthand format first: github:owner/repo or gitlab:owner/repo
  const shorthandMatch = input.match(/^(github|gitlab):(.+)$/);
  if (shorthandMatch) {
    const platform = shorthandMatch[1] as Platform;
    const path = shorthandMatch[2];
    const lastSlash = path.lastIndexOf('/');
    if (lastSlash === -1) {
      throw new Error('Could not parse repo URL. Use format: github:owner/repo, gitlab:group/project, or full URL.');
    }
    return {
      platform,
      owner: path.slice(0, lastSlash),
      repo: path.slice(lastSlash + 1)
    };
  }

  // Try full URL format
  try {
    const url = new URL(input);
    const hostname = url.hostname.toLowerCase();

    // Remove trailing slash and split path
    const pathParts = url.pathname.replace(/\/$/, '').split('/').filter(Boolean);

    if (pathParts.length < 2) {
      throw new Error('Could not parse repo URL. Use format: github:owner/repo, gitlab:group/project, or full URL.');
    }

    if (hostname === 'github.com') {
      return {
        platform: 'github',
        owner: pathParts[0],
        repo: pathParts[1]
      };
    }

    if (hostname === 'gitlab.com') {
      // GitLab supports nested groups: group/subgroup/project
      const repo = pathParts[pathParts.length - 1];
      const owner = pathParts.slice(0, -1).join('/');
      return {
        platform: 'gitlab',
        owner,
        repo
      };
    }

    throw new Error('Could not parse repo URL. Use format: github:owner/repo, gitlab:group/project, or full URL.');
  } catch (e) {
    if (e instanceof Error && e.message.includes('Could not parse')) {
      throw e;
    }
    throw new Error('Could not parse repo URL. Use format: github:owner/repo, gitlab:group/project, or full URL.');
  }
}

/**
 * Helper function to perform HTTPS GET with JSON response.
 *
 * @param url - The URL to fetch
 * @param headers - Optional additional headers
 * @returns Parsed JSON response
 * @throws Error on network failure, timeout, rate limit, or 404
 */
async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const TIMEOUT_MS = 15000;

  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: TIMEOUT_MS,
      headers: {
        'User-Agent': 'Autohand-CLI/1.0',
        'Accept': 'application/json',
        ...headers
      }
    }, (res) => {
      // Handle rate limiting
      if (res.statusCode === 403) {
        reject(new Error('Rate limited. Hint: Set GITHUB_TOKEN or GITLAB_TOKEN in env or ~/.autohand/config.json to increase limits.'));
        return;
      }

      // Handle not found
      if (res.statusCode === 404) {
        reject(new Error('Repository not found. Check the URL/shorthand is correct.'));
        return;
      }

      // Handle other HTTP errors
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        return;
      }

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const json = JSON.parse(data) as T;
          resolve(json);
        } catch (parseError) {
          reject(new Error(`Failed to parse JSON response: ${parseError instanceof Error ? parseError.message : String(parseError)}`));
        }
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

/** GitHub API response for repository info */
interface GitHubRepoResponse {
  name: string;
  full_name: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  default_branch: string;
  license: { spdx_id: string } | null;
}

/** GitLab API response for project info */
interface GitLabProjectResponse {
  name: string;
  path_with_namespace: string;
  description: string | null;
  star_count: number;
  default_branch: string;
}

/**
 * Fetch repository info from GitHub API.
 *
 * @param parsed - Parsed repo info with owner and repo
 * @returns Normalized RepoInfo
 */
async function fetchGitHubInfo(parsed: ParsedRepo): Promise<RepoInfo> {
  const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;

  // Check for token in environment
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const data = await fetchJson<GitHubRepoResponse>(url, headers);

  return {
    platform: 'github',
    name: data.name,
    fullName: data.full_name,
    description: data.description || '',
    stars: data.stargazers_count,
    language: data.language,
    defaultBranch: data.default_branch,
    license: data.license?.spdx_id || null
  };
}

/**
 * Fetch repository info from GitLab API.
 *
 * Note: Language and license require additional API calls, so they are returned as null.
 *
 * @param parsed - Parsed repo info with owner and repo
 * @returns Normalized RepoInfo
 */
async function fetchGitLabInfo(parsed: ParsedRepo): Promise<RepoInfo> {
  // GitLab requires URL-encoded project path
  const projectPath = encodeURIComponent(`${parsed.owner}/${parsed.repo}`);
  const url = `https://gitlab.com/api/v4/projects/${projectPath}`;

  // Check for token in environment
  const token = process.env.GITLAB_TOKEN;
  const headers: Record<string, string> = {};
  if (token) {
    headers['PRIVATE-TOKEN'] = token;
  }

  const data = await fetchJson<GitLabProjectResponse>(url, headers);

  return {
    platform: 'gitlab',
    name: data.name,
    fullName: data.path_with_namespace,
    description: data.description || '',
    stars: data.star_count,
    language: null, // Would require additional API call to /languages
    defaultBranch: data.default_branch,
    license: null // Would require additional API call
  };
}

/**
 * Fetch repository information from GitHub or GitLab.
 *
 * Routes to platform-specific fetcher based on parsed.platform.
 *
 * @param parsed - Parsed repo info from parseRepoUrl
 * @returns Normalized repository info
 * @throws Error on network failure, rate limiting, or repo not found
 */
export async function fetchRepoInfo(parsed: ParsedRepo): Promise<RepoInfo> {
  switch (parsed.platform) {
    case 'github':
      return fetchGitHubInfo(parsed);
    case 'gitlab':
      return fetchGitLabInfo(parsed);
    default:
      throw new Error(`Unsupported platform: ${parsed.platform}`);
  }
}

/** GitHub API response for directory contents */
interface GitHubContentItem {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  size: number;
}

/** GitLab API response for repository tree */
interface GitLabTreeItem {
  name: string;
  path: string;
  type: 'blob' | 'tree';
}

/**
 * List directory contents from GitHub API.
 *
 * @param parsed - Parsed repo info with owner and repo
 * @param path - Path within the repository (empty string for root)
 * @param branch - Optional branch/ref to list (defaults to default branch)
 * @returns Array of files and directories
 */
async function listGitHubDir(parsed: ParsedRepo, path: string, branch?: string): Promise<RepoFile[]> {
  const encodedPath = path ? encodeURIComponent(path).replace(/%2F/g, '/') : '';
  let url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/contents/${encodedPath}`;

  if (branch) {
    url += `?ref=${encodeURIComponent(branch)}`;
  }

  // Check for token in environment
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const data = await fetchJson<GitHubContentItem[]>(url, headers);

  return data.map((item) => ({
    name: item.name,
    type: item.type === 'dir' ? 'dir' : 'file',
    path: item.path,
    size: item.type === 'file' ? item.size : undefined
  }));
}

/**
 * List directory contents from GitLab API.
 *
 * Note: GitLab's tree API does not return file sizes.
 *
 * @param parsed - Parsed repo info with owner and repo
 * @param path - Path within the repository (empty string for root)
 * @param branch - Optional branch/ref to list (defaults to default branch)
 * @returns Array of files and directories
 */
async function listGitLabDir(parsed: ParsedRepo, path: string, branch?: string): Promise<RepoFile[]> {
  // GitLab requires URL-encoded project path
  const projectPath = encodeURIComponent(`${parsed.owner}/${parsed.repo}`);
  let url = `https://gitlab.com/api/v4/projects/${projectPath}/repository/tree?per_page=100`;

  if (path) {
    url += `&path=${encodeURIComponent(path)}`;
  }

  if (branch) {
    url += `&ref=${encodeURIComponent(branch)}`;
  }

  // Check for token in environment
  const token = process.env.GITLAB_TOKEN;
  const headers: Record<string, string> = {};
  if (token) {
    headers['PRIVATE-TOKEN'] = token;
  }

  const data = await fetchJson<GitLabTreeItem[]>(url, headers);

  return data.map((item) => ({
    name: item.name,
    type: item.type === 'tree' ? 'dir' : 'file',
    path: item.path
    // GitLab tree API does not return file sizes
  }));
}

/**
 * List directory contents from a GitHub or GitLab repository.
 *
 * Routes to platform-specific lister based on parsed.platform.
 *
 * @param parsed - Parsed repo info from parseRepoUrl
 * @param path - Path within the repository (empty string for root)
 * @param branch - Optional branch/ref to list (defaults to default branch)
 * @returns Array of files and directories
 * @throws Error on network failure, rate limiting, or path not found
 */
export async function listRepoDir(parsed: ParsedRepo, path: string, branch?: string): Promise<RepoFile[]> {
  switch (parsed.platform) {
    case 'github':
      return listGitHubDir(parsed, path, branch);
    case 'gitlab':
      return listGitLabDir(parsed, path, branch);
    default:
      throw new Error(`Unsupported platform: ${parsed.platform}`);
  }
}

/**
 * Helper function to perform HTTPS GET with text response.
 * Handles redirects (GitHub raw URLs redirect), rate limits, and 404s.
 *
 * @param url - The URL to fetch
 * @param headers - Optional additional headers
 * @param maxRedirects - Maximum number of redirects to follow (default 5)
 * @returns Raw text response
 * @throws Error on network failure, timeout, rate limit, or 404
 */
async function fetchText(
  url: string,
  headers: Record<string, string> = {},
  maxRedirects = 5
): Promise<string> {
  const TIMEOUT_MS = 15000;

  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: TIMEOUT_MS,
      headers: {
        'User-Agent': 'Autohand-CLI/1.0',
        ...headers
      }
    }, (res) => {
      // Handle redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (maxRedirects <= 0) {
          reject(new Error('Too many redirects'));
          return;
        }
        // Resolve relative URLs
        const redirectUrl = new URL(res.headers.location, url).toString();
        fetchText(redirectUrl, headers, maxRedirects - 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      // Handle rate limiting
      if (res.statusCode === 403) {
        reject(new Error('Rate limited. Hint: Set GITHUB_TOKEN or GITLAB_TOKEN in env or ~/.autohand/config.json to increase limits.'));
        return;
      }

      // Handle not found
      if (res.statusCode === 404) {
        reject(new Error("File not found. Use operation 'list' to see available files."));
        return;
      }

      // Handle other HTTP errors
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        return;
      }

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve(data);
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

/**
 * Fetch raw file content from GitHub.
 *
 * Uses raw.githubusercontent.com which serves raw file content directly.
 *
 * @param parsed - Parsed repo info with owner and repo
 * @param path - Path to the file within the repository
 * @param branch - Optional branch/ref (defaults to 'HEAD')
 * @returns Raw file content as string
 */
async function fetchGitHubFile(parsed: ParsedRepo, path: string, branch = 'HEAD'): Promise<string> {
  // Construct raw content URL
  const url = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${branch}/${path}`;

  // Check for token in environment (optional for raw content but helps with rate limits)
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return fetchText(url, headers);
}

/**
 * Fetch raw file content from GitLab.
 *
 * Uses the GitLab repository files API with /raw endpoint.
 *
 * @param parsed - Parsed repo info with owner and repo
 * @param path - Path to the file within the repository
 * @param branch - Optional branch/ref (defaults to 'HEAD')
 * @returns Raw file content as string
 */
async function fetchGitLabFile(parsed: ParsedRepo, path: string, branch = 'HEAD'): Promise<string> {
  // GitLab requires URL-encoded project path and file path
  const projectPath = encodeURIComponent(`${parsed.owner}/${parsed.repo}`);
  const encodedFilePath = encodeURIComponent(path);
  const url = `https://gitlab.com/api/v4/projects/${projectPath}/repository/files/${encodedFilePath}/raw?ref=${encodeURIComponent(branch)}`;

  // Check for token in environment
  const token = process.env.GITLAB_TOKEN;
  const headers: Record<string, string> = {};
  if (token) {
    headers['PRIVATE-TOKEN'] = token;
  }

  return fetchText(url, headers);
}

/**
 * Fetch raw file content from a GitHub or GitLab repository.
 *
 * Routes to platform-specific fetcher based on parsed.platform.
 *
 * @param parsed - Parsed repo info from parseRepoUrl
 * @param path - Path to the file within the repository
 * @param branch - Optional branch/ref (defaults to 'HEAD')
 * @returns Raw file content as string
 * @throws Error on network failure, rate limiting, or file not found
 */
export async function fetchRepoFile(parsed: ParsedRepo, path: string, branch?: string): Promise<string> {
  switch (parsed.platform) {
    case 'github':
      return fetchGitHubFile(parsed, path, branch);
    case 'gitlab':
      return fetchGitLabFile(parsed, path, branch);
    default:
      throw new Error(`Unsupported platform: ${parsed.platform}`);
  }
}

// ============================================================================
// Formatting Helpers
// ============================================================================

/**
 * Format bytes into human-readable size string.
 *
 * @param bytes - Number of bytes
 * @returns Formatted string like "100 B", "2.0 KB", "1.4 MB"
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format repository info for display.
 *
 * @param info - Repository info object
 * @returns Formatted string with repo details
 */
export function formatRepoInfo(info: RepoInfo): string {
  const lines: string[] = [];

  // Header: **fullName** (platform)
  lines.push(`**${info.fullName}** (${info.platform})`);
  lines.push('');

  // Description (if present)
  if (info.description) {
    lines.push(info.description);
    lines.push('');
  }

  // Stats
  lines.push(`Stars: ${info.stars}`);
  lines.push(`Default branch: ${info.defaultBranch}`);

  // Optional fields
  if (info.language) {
    lines.push(`Language: ${info.language}`);
  }
  if (info.license) {
    lines.push(`License: ${info.license}`);
  }

  return lines.join('\n');
}

/**
 * Format repository directory listing for display.
 *
 * @param files - Array of files and directories
 * @param path - Current path within the repository (empty string for root)
 * @returns Formatted string with directory listing
 */
export function formatRepoDir(files: RepoFile[], path: string): string {
  const lines: string[] = [];

  // Header
  if (path === '') {
    lines.push('Repository root:');
  } else {
    lines.push(`Contents of ${path}/`);
  }
  lines.push('');

  // Separate and sort directories and files
  const dirs = files.filter(f => f.type === 'dir').sort((a, b) => a.name.localeCompare(b.name));
  const fileItems = files.filter(f => f.type === 'file').sort((a, b) => a.name.localeCompare(b.name));

  // Directories first (with trailing /)
  for (const dir of dirs) {
    lines.push(`📁 ${dir.name}/`);
  }

  // Then files (with size if available)
  for (const file of fileItems) {
    if (file.size !== undefined) {
      lines.push(`📄 ${file.name} (${formatBytes(file.size)})`);
    } else {
      lines.push(`📄 ${file.name}`);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Main Entry Point
// ============================================================================

export type WebRepoOperation = 'info' | 'list' | 'fetch';

export interface WebRepoOptions {
  repo: string;
  operation: WebRepoOperation;
  path?: string;
  branch?: string;
}

export type WebRepoResult =
  | { type: 'info'; data: RepoInfo }
  | { type: 'list'; data: RepoFile[]; path: string }
  | { type: 'fetch'; data: string; path: string };

/**
 * Main entry point for web repository operations.
 *
 * Routes to the correct operation based on the options provided:
 * - 'info': Fetches repository metadata (name, description, stars, etc.)
 * - 'list': Lists files and directories at a given path
 * - 'fetch': Fetches raw file content
 *
 * @param options - Options specifying the repo, operation, and optional path/branch
 * @returns WebRepoResult with type discriminator and data
 * @throws Error on invalid repo format or unsupported operation
 */
export async function webRepo(options: WebRepoOptions): Promise<WebRepoResult> {
  const parsed = parseRepoUrl(options.repo);

  switch (options.operation) {
    case 'info': {
      const data = await fetchRepoInfo(parsed);
      return { type: 'info', data };
    }
    case 'list': {
      const path = options.path ?? '';
      const data = await listRepoDir(parsed, path, options.branch);
      return { type: 'list', data, path };
    }
    case 'fetch': {
      const path = options.path ?? 'README.md';
      const data = await fetchRepoFile(parsed, path, options.branch);
      return { type: 'fetch', data, path };
    }
    default:
      throw new Error(`Invalid operation: ${options.operation}. Valid operations are: info, list, fetch`);
  }
}
