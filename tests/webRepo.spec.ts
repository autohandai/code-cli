/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { parseRepoUrl, fetchRepoInfo, listRepoDir, fetchRepoFile, webRepo, formatRepoInfo, formatRepoDir, formatBytes, type RepoInfo, type RepoFile } from '../src/actions/webRepo.js';
import { get as httpsGet } from 'node:https';

vi.mock('node:https', () => ({
  get: vi.fn(),
}));

function installHttpsFixture(): void {
  vi.mocked(httpsGet).mockImplementation(((url: string | URL, options: unknown, callback?: (res: any) => void) => {
    const request = new EventEmitter() as EventEmitter & { destroy: () => void };
    request.destroy = () => {};

    const target = typeof url === 'string' ? url : url.toString();
    const onResponse = typeof options === 'function' ? options : callback;

    process.nextTick(() => {
      const response = new EventEmitter() as EventEmitter & {
        statusCode?: number;
        statusMessage?: string;
        headers: Record<string, string>;
      };
      response.headers = {};

      const send = (statusCode: number, body: string, statusMessage = 'OK') => {
        response.statusCode = statusCode;
        response.statusMessage = statusMessage;
        onResponse?.(response);
        if (statusCode < 400) {
          response.emit('data', Buffer.from(body));
        }
        response.emit('end');
      };

      if (target === 'https://api.github.com/repos/octocat/Hello-World') {
        send(200, JSON.stringify({
          name: 'Hello-World',
          full_name: 'octocat/Hello-World',
          description: 'Mock GitHub repo',
          stargazers_count: 42,
          language: 'Ruby',
          default_branch: 'main',
          license: { spdx_id: 'MIT' }
        }));
        return;
      }

      if (target === 'https://api.github.com/repos/nonexistent-user-12345/nonexistent-repo-67890') {
        send(404, '', 'Not Found');
        return;
      }

      if (target === 'https://api.github.com/repos/octocat/Hello-World/contents/') {
        send(200, JSON.stringify([
          { name: 'README', path: 'README', type: 'file', size: 13 },
          { name: 'src', path: 'src', type: 'dir', size: 0 }
        ]));
        return;
      }

      if (target === 'https://api.github.com/repos/octocat/Hello-World/contents/nonexistent-path-12345') {
        send(404, '', 'Not Found');
        return;
      }

      if (target === 'https://gitlab.com/api/v4/projects/gitlab-org%2Fgitlab-runner') {
        send(200, JSON.stringify({
          name: 'gitlab-runner',
          path_with_namespace: 'gitlab-org/gitlab-runner',
          description: 'Mock GitLab repo',
          star_count: 101,
          default_branch: 'main'
        }));
        return;
      }

      if (target === 'https://gitlab.com/api/v4/projects/gitlab-org%2Fgitlab-runner/repository/tree?per_page=100') {
        send(200, JSON.stringify([
          { name: 'README.md', path: 'README.md', type: 'blob' },
          { name: 'docs', path: 'docs', type: 'tree' }
        ]));
        return;
      }

      if (target === 'https://gitlab.com/api/v4/projects/gitlab-org%2Fgitlab-runner/repository/tree?per_page=100&path=docs') {
        send(200, JSON.stringify([
          { name: 'index.md', path: 'docs/index.md', type: 'blob' }
        ]));
        return;
      }

      if (target === 'https://raw.githubusercontent.com/octocat/Hello-World/HEAD/README') {
        send(200, 'Hello World\n');
        return;
      }

      if (target === 'https://raw.githubusercontent.com/octocat/Hello-World/HEAD/nonexistent-file.txt') {
        send(404, '', 'Not Found');
        return;
      }

      if (target === 'https://gitlab.com/api/v4/projects/gitlab-org%2Fgitlab-runner/repository/files/README.md/raw?ref=HEAD') {
        send(200, '# GitLab Runner\n');
        return;
      }

      send(500, '', `Unhandled fixture URL: ${target}`);
    });

    return request as any;
  }) as typeof httpsGet);
}

describe('webRepo', () => {
  beforeEach(() => {
    installHttpsFixture();
  });

  afterEach(() => {
    vi.mocked(httpsGet).mockReset();
  });

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

    it('parses implicit GitHub format (owner/repo)', () => {
      const result = parseRepoUrl('autohandai/code-cli');
      expect(result).toEqual({ platform: 'github', owner: 'autohandai', repo: 'code-cli' });
    });

    it('parses implicit GitHub format with common names', () => {
      const result = parseRepoUrl('facebook/react');
      expect(result).toEqual({ platform: 'github', owner: 'facebook', repo: 'react' });
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
      const info = await fetchRepoInfo({ platform: 'github', owner: 'octocat', repo: 'Hello-World' });
      expect(info.platform).toBe('github');
      expect(info.name).toBe('Hello-World');
      expect(info.fullName).toBe('octocat/Hello-World');
      expect(typeof info.stars).toBe('number');
    });

    it('fetches GitLab repo info', async () => {
      const info = await fetchRepoInfo({ platform: 'gitlab', owner: 'gitlab-org', repo: 'gitlab-runner' });
      expect(info.platform).toBe('gitlab');
      expect(info.name).toBe('gitlab-runner');
      expect(typeof info.stars).toBe('number');
    }, 15_000);

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
      const files = await listRepoDir({ platform: 'gitlab', owner: 'gitlab-org', repo: 'gitlab-runner' }, '');
      expect(Array.isArray(files)).toBe(true);
      expect(files.length).toBeGreaterThan(0);
    }, 15_000);

    it('lists subdirectory', async () => {
      // gitlab-org/gitlab-runner has a 'docs' directory
      const files = await listRepoDir({ platform: 'gitlab', owner: 'gitlab-org', repo: 'gitlab-runner' }, 'docs');
      expect(Array.isArray(files)).toBe(true);
      expect(files.length).toBeGreaterThan(0);
    }, 15_000);

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
      const content = await fetchRepoFile({ platform: 'gitlab', owner: 'gitlab-org', repo: 'gitlab-runner' }, 'README.md');
      expect(content.length).toBeGreaterThan(0);
      expect(content).toContain('GitLab Runner');
    }, 15_000);

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
      const result = await webRepo({ repo: 'gitlab:gitlab-org/gitlab-runner', operation: 'list', path: 'docs' });
      expect(result.type).toBe('list');
      if (result.type === 'list') {
        expect(Array.isArray(result.data)).toBe(true);
        expect(result.path).toBe('docs');
        expect(result.data.length).toBeGreaterThan(0);
      }
    }, 15_000);

    it('routes to fetch operation with default path', async () => {
      // Use gitlab-org/gitlab-runner which has a README.md file
      const result = await webRepo({ repo: 'gitlab:gitlab-org/gitlab-runner', operation: 'fetch' });
      expect(result.type).toBe('fetch');
      if (result.type === 'fetch') {
        expect(result.path).toBe('README.md');
        expect(result.data.length).toBeGreaterThan(0);
      }
    }, 15_000);

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
