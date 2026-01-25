/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { parseRepoUrl, fetchRepoInfo, listRepoDir, fetchRepoFile, webRepo, formatRepoInfo, formatRepoDir, formatBytes, type RepoInfo, type RepoFile, type WebRepoResult } from '../src/actions/webRepo.js';

describe('webRepo', () => {
  describe('parseRepoUrl', () => {
    it('parses GitHub full URL', () => {
      const result = parseRepoUrl('https://github.com/openai/codex');
      expect(result).toEqual({ platform: 'github', owner: 'openai', repo: 'codex' });
    });

    it('parses GitHub full URL with trailing slash', () => {
      const result = parseRepoUrl('https://github.com/openai/codex/');
      expect(result).toEqual({ platform: 'github', owner: 'openai', repo: 'codex' });
    });

    it('parses GitLab full URL', () => {
      const result = parseRepoUrl('https://gitlab.com/inkscape/inkscape');
      expect(result).toEqual({ platform: 'gitlab', owner: 'inkscape', repo: 'inkscape' });
    });

    it('parses GitLab nested group URL', () => {
      const result = parseRepoUrl('https://gitlab.com/group/subgroup/project');
      expect(result).toEqual({ platform: 'gitlab', owner: 'group/subgroup', repo: 'project' });
    });

    it('parses GitHub shorthand', () => {
      const result = parseRepoUrl('github:openai/codex');
      expect(result).toEqual({ platform: 'github', owner: 'openai', repo: 'codex' });
    });

    it('parses GitLab shorthand', () => {
      const result = parseRepoUrl('gitlab:inkscape/inkscape');
      expect(result).toEqual({ platform: 'gitlab', owner: 'inkscape', repo: 'inkscape' });
    });

    it('throws on invalid URL', () => {
      expect(() => parseRepoUrl('invalid')).toThrow('Could not parse repo URL');
    });

    it('throws on unsupported platform', () => {
      expect(() => parseRepoUrl('https://bitbucket.org/owner/repo')).toThrow('Could not parse repo URL');
    });
  });

  describe('fetchRepoInfo', () => {
    it('fetches GitHub repo info', async () => {
      // This is an integration test - will hit real API
      const info = await fetchRepoInfo({ platform: 'github', owner: 'octocat', repo: 'Hello-World' });
      expect(info.platform).toBe('github');
      expect(info.name).toBe('Hello-World');
      expect(info.fullName).toBe('octocat/Hello-World');
      expect(typeof info.stars).toBe('number');
    });

    it('fetches GitLab repo info', async () => {
      const info = await fetchRepoInfo({ platform: 'gitlab', owner: 'gitlab-org', repo: 'gitlab' });
      expect(info.platform).toBe('gitlab');
      // GitLab API returns 'GitLab' (capitalized) as the display name
      expect(info.name).toBe('GitLab');
      expect(typeof info.stars).toBe('number');
    });

    it('throws on non-existent repo', async () => {
      await expect(fetchRepoInfo({ platform: 'github', owner: 'nonexistent-user-12345', repo: 'nonexistent-repo-67890' }))
        .rejects.toThrow('Repository not found');
    });
  });

  describe('listRepoDir', () => {
    it('lists GitHub repository root', async () => {
      const files = await listRepoDir({ platform: 'github', owner: 'octocat', repo: 'Hello-World' }, '');
      expect(Array.isArray(files)).toBe(true);
      expect(files.length).toBeGreaterThan(0);
      const readme = files.find(f => f.name === 'README');
      expect(readme).toBeDefined();
      expect(readme?.type).toBe('file');
    });

    it('lists GitLab repository root', async () => {
      const files = await listRepoDir({ platform: 'gitlab', owner: 'gitlab-org', repo: 'gitlab' }, '');
      expect(Array.isArray(files)).toBe(true);
      expect(files.length).toBeGreaterThan(0);
    });

    it('lists subdirectory', async () => {
      // gitlab-org/gitlab has an 'app' directory
      const files = await listRepoDir({ platform: 'gitlab', owner: 'gitlab-org', repo: 'gitlab' }, 'app');
      expect(Array.isArray(files)).toBe(true);
      expect(files.length).toBeGreaterThan(0);
    });

    it('throws on non-existent path', async () => {
      await expect(listRepoDir({ platform: 'github', owner: 'octocat', repo: 'Hello-World' }, 'nonexistent-path-12345'))
        .rejects.toThrow('Repository not found');
    });
  });

  describe('fetchRepoFile', () => {
    it('fetches GitHub file content', async () => {
      const content = await fetchRepoFile({ platform: 'github', owner: 'octocat', repo: 'Hello-World' }, 'README');
      expect(content).toContain('Hello World');
    });

    it('fetches GitLab file content', async () => {
      const content = await fetchRepoFile({ platform: 'gitlab', owner: 'gitlab-org', repo: 'gitlab' }, 'README.md');
      expect(content.length).toBeGreaterThan(0);
      expect(content).toContain('GitLab');
    });

    it('throws on non-existent file', async () => {
      await expect(fetchRepoFile({ platform: 'github', owner: 'octocat', repo: 'Hello-World' }, 'nonexistent-file.txt'))
        .rejects.toThrow('File not found');
    });
  });

  describe('webRepo (main entry point)', () => {
    it('routes to info operation', async () => {
      const result = await webRepo({ repo: 'github:octocat/Hello-World', operation: 'info' });
      expect(result.type).toBe('info');
      if (result.type === 'info') {
        expect(result.data.name).toBe('Hello-World');
      }
    });

    it('routes to list operation', async () => {
      const result = await webRepo({ repo: 'github:octocat/Hello-World', operation: 'list' });
      expect(result.type).toBe('list');
      if (result.type === 'list') {
        expect(Array.isArray(result.data)).toBe(true);
        expect(result.path).toBe('');
      }
    });

    it('routes to list operation with custom path', async () => {
      const result = await webRepo({ repo: 'gitlab:gitlab-org/gitlab', operation: 'list', path: 'app' });
      expect(result.type).toBe('list');
      if (result.type === 'list') {
        expect(Array.isArray(result.data)).toBe(true);
        expect(result.path).toBe('app');
        expect(result.data.length).toBeGreaterThan(0);
      }
    });

    it('routes to fetch operation with default path', async () => {
      // Use gitlab-org/gitlab which has a README.md file
      const result = await webRepo({ repo: 'gitlab:gitlab-org/gitlab', operation: 'fetch' });
      expect(result.type).toBe('fetch');
      if (result.type === 'fetch') {
        expect(result.path).toBe('README.md');
        expect(result.data.length).toBeGreaterThan(0);
      }
    });

    it('routes to fetch operation with custom path', async () => {
      const result = await webRepo({ repo: 'github:octocat/Hello-World', operation: 'fetch', path: 'README' });
      expect(result.type).toBe('fetch');
      if (result.type === 'fetch') {
        expect(result.path).toBe('README');
        expect(result.data).toContain('Hello World');
      }
    });

    it('throws on invalid repo format', async () => {
      await expect(webRepo({ repo: 'invalid', operation: 'info' })).rejects.toThrow('Could not parse repo URL');
    });

    it('throws on invalid operation', async () => {
      // @ts-expect-error Testing invalid operation at runtime
      await expect(webRepo({ repo: 'github:octocat/Hello-World', operation: 'invalid' })).rejects.toThrow('Invalid operation');
    });
  });

  describe('formatBytes', () => {
    it('formats bytes', () => {
      expect(formatBytes(100)).toBe('100 B');
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(999)).toBe('999 B');
    });

    it('formats kilobytes', () => {
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(2048)).toBe('2.0 KB');
      expect(formatBytes(1536)).toBe('1.5 KB');
    });

    it('formats megabytes', () => {
      expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
      expect(formatBytes(1500000)).toBe('1.4 MB');
      expect(formatBytes(2621440)).toBe('2.5 MB');
    });
  });

  describe('formatRepoInfo', () => {
    it('formats repo info for display', () => {
      const info: RepoInfo = {
        platform: 'github',
        name: 'codex',
        fullName: 'openai/codex',
        description: 'Lightweight coding agent',
        stars: 1000,
        language: 'TypeScript',
        defaultBranch: 'main',
        license: 'Apache-2.0'
      };
      const formatted = formatRepoInfo(info);
      expect(formatted).toContain('**openai/codex**');
      expect(formatted).toContain('(github)');
      expect(formatted).toContain('Lightweight coding agent');
      expect(formatted).toContain('Stars: 1000');
      expect(formatted).toContain('Language: TypeScript');
      expect(formatted).toContain('License: Apache-2.0');
    });

    it('handles missing optional fields', () => {
      const info: RepoInfo = {
        platform: 'gitlab',
        name: 'project',
        fullName: 'group/project',
        description: '',
        stars: 0,
        language: null,
        defaultBranch: 'main',
        license: null
      };
      const formatted = formatRepoInfo(info);
      expect(formatted).toContain('**group/project**');
      expect(formatted).not.toContain('Language:');
      expect(formatted).not.toContain('License:');
    });
  });

  describe('formatRepoDir', () => {
    it('formats directory listing', () => {
      const files: RepoFile[] = [
        { name: 'README.md', type: 'file', path: 'README.md', size: 1234 },
        { name: 'src', type: 'dir', path: 'src' },
        { name: 'package.json', type: 'file', path: 'package.json', size: 456 }
      ];
      const formatted = formatRepoDir(files, '');
      expect(formatted).toContain('Repository root:');
      expect(formatted).toContain('📁 src/');
      expect(formatted).toContain('📄 README.md');
      expect(formatted).toContain('📄 package.json');
      // Directories should come before files
      const srcIndex = formatted.indexOf('📁 src/');
      const readmeIndex = formatted.indexOf('📄 README.md');
      expect(srcIndex).toBeLessThan(readmeIndex);
    });

    it('formats with path header', () => {
      const files: RepoFile[] = [
        { name: 'index.ts', type: 'file', path: 'src/index.ts' }
      ];
      const formatted = formatRepoDir(files, 'src');
      expect(formatted).toContain('Contents of src/');
    });

    it('formats file sizes', () => {
      const files: RepoFile[] = [
        { name: 'small.txt', type: 'file', path: 'small.txt', size: 100 },
        { name: 'medium.txt', type: 'file', path: 'medium.txt', size: 2048 },
        { name: 'large.txt', type: 'file', path: 'large.txt', size: 1500000 }
      ];
      const formatted = formatRepoDir(files, '');
      expect(formatted).toContain('100 B');
      expect(formatted).toContain('2.0 KB');
      expect(formatted).toContain('1.4 MB');
    });

    it('handles files without size', () => {
      const files: RepoFile[] = [
        { name: 'file.txt', type: 'file', path: 'file.txt' }
      ];
      const formatted = formatRepoDir(files, '');
      expect(formatted).toContain('📄 file.txt');
      expect(formatted).not.toContain('(');
    });

    it('sorts directories and files alphabetically', () => {
      const files: RepoFile[] = [
        { name: 'zebra', type: 'dir', path: 'zebra' },
        { name: 'alpha', type: 'dir', path: 'alpha' },
        { name: 'zoo.txt', type: 'file', path: 'zoo.txt' },
        { name: 'apple.txt', type: 'file', path: 'apple.txt' }
      ];
      const formatted = formatRepoDir(files, '');
      const alphaIndex = formatted.indexOf('📁 alpha/');
      const zebraIndex = formatted.indexOf('📁 zebra/');
      const appleIndex = formatted.indexOf('📄 apple.txt');
      const zooIndex = formatted.indexOf('📄 zoo.txt');

      // Directories sorted alphabetically
      expect(alphaIndex).toBeLessThan(zebraIndex);
      // Files sorted alphabetically
      expect(appleIndex).toBeLessThan(zooIndex);
      // All directories before all files
      expect(zebraIndex).toBeLessThan(appleIndex);
    });
  });
});
