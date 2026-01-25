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
