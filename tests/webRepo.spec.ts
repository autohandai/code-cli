/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { parseRepoUrl, fetchRepoInfo, type RepoInfo } from '../src/actions/webRepo.js';

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
});
