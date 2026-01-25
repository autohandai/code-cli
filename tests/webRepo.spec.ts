/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { parseRepoUrl } from '../src/actions/webRepo.js';

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
});
