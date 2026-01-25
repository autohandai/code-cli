/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * GitHub and GitLab repository browsing capabilities.
 */

export type Platform = 'github' | 'gitlab';

export interface ParsedRepo {
  platform: Platform;
  owner: string;
  repo: string;
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
