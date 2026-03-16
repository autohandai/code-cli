import { describe, it, expect } from 'vitest';
import {
  parseToolPattern,
  parseToolPatternList,
  matchesToolPattern,
} from '../../src/permissions/toolPatterns.js';

describe('parseToolPattern', () => {
  it('parses kind-only pattern', () => {
    expect(parseToolPattern('read_file')).toEqual({ kind: 'read_file' });
  });

  it('parses kind with argument', () => {
    expect(parseToolPattern('read_file(/tmp/foo.ts)')).toEqual({
      kind: 'read_file',
      argument: '/tmp/foo.ts',
    });
  });

  it('parses glob argument', () => {
    expect(parseToolPattern('read_file(src/**/*.ts)')).toEqual({
      kind: 'read_file',
      argument: 'src/**/*.ts',
    });
  });

  it('parses stem wildcard argument', () => {
    expect(parseToolPattern('run_command(git:*)')).toEqual({
      kind: 'run_command',
      argument: 'git:*',
    });
  });

  it('parses url pattern', () => {
    expect(parseToolPattern('url(example.com)')).toEqual({
      kind: 'url',
      argument: 'example.com',
    });
  });

  it('parses url wildcard domain', () => {
    expect(parseToolPattern('url(*.example.com)')).toEqual({
      kind: 'url',
      argument: '*.example.com',
    });
  });

  it('parses MCP tool pattern', () => {
    expect(parseToolPattern('mcp__github__list_prs')).toEqual({
      kind: 'mcp__github__list_prs',
    });
  });

  it('parses MCP tool pattern with argument', () => {
    expect(parseToolPattern('mcp__github__list_prs(repo:*)')).toEqual({
      kind: 'mcp__github__list_prs',
      argument: 'repo:*',
    });
  });

  it('trims whitespace from kind', () => {
    expect(parseToolPattern('  read_file  ')).toEqual({ kind: 'read_file' });
  });

  it('trims whitespace from kind and argument', () => {
    expect(parseToolPattern('  read_file ( /tmp/foo.ts ) ')).toEqual({
      kind: 'read_file',
      argument: '/tmp/foo.ts',
    });
  });
});

describe('parseToolPatternList', () => {
  it('parses single pattern', () => {
    expect(parseToolPatternList('read_file')).toEqual([{ kind: 'read_file' }]);
  });

  it('parses comma-separated patterns', () => {
    expect(parseToolPatternList('read_file, write_file, run_command')).toEqual([
      { kind: 'read_file' },
      { kind: 'write_file' },
      { kind: 'run_command' },
    ]);
  });

  it('handles whitespace trimming', () => {
    expect(parseToolPatternList('  read_file  ,  write_file  ')).toEqual([
      { kind: 'read_file' },
      { kind: 'write_file' },
    ]);
  });

  it('parses mixed patterns with and without arguments', () => {
    const result = parseToolPatternList('read_file(src/**), run_command(git:*), write_file');
    expect(result).toEqual([
      { kind: 'read_file', argument: 'src/**' },
      { kind: 'run_command', argument: 'git:*' },
      { kind: 'write_file' },
    ]);
  });

  it('filters out empty entries', () => {
    expect(parseToolPatternList('read_file,  ,write_file')).toEqual([
      { kind: 'read_file' },
      { kind: 'write_file' },
    ]);
  });
});

describe('matchesToolPattern', () => {
  describe('kind matching', () => {
    it('matches when kind and no argument (wildcard)', () => {
      expect(
        matchesToolPattern({ kind: 'read_file' }, { kind: 'read_file', target: '/anything' }),
      ).toBe(true);
    });

    it('does not match when kinds differ', () => {
      expect(
        matchesToolPattern({ kind: 'read_file' }, { kind: 'write_file', target: '/foo' }),
      ).toBe(false);
    });
  });

  describe('exact match', () => {
    it('matches exact target', () => {
      expect(
        matchesToolPattern(
          { kind: 'read_file', argument: '/tmp/foo.ts' },
          { kind: 'read_file', target: '/tmp/foo.ts' },
        ),
      ).toBe(true);
    });

    it('does not match different target', () => {
      expect(
        matchesToolPattern(
          { kind: 'read_file', argument: '/tmp/foo.ts' },
          { kind: 'read_file', target: '/tmp/bar.ts' },
        ),
      ).toBe(false);
    });
  });

  describe('stem wildcard (git:*)', () => {
    it('matches exact stem', () => {
      expect(
        matchesToolPattern(
          { kind: 'run_command', argument: 'git:*' },
          { kind: 'run_command', target: 'git' },
        ),
      ).toBe(true);
    });

    it('matches stem with space-separated subcommand', () => {
      expect(
        matchesToolPattern(
          { kind: 'run_command', argument: 'git:*' },
          { kind: 'run_command', target: 'git push' },
        ),
      ).toBe(true);
    });

    it('matches stem with multi-word subcommand', () => {
      expect(
        matchesToolPattern(
          { kind: 'run_command', argument: 'git:*' },
          { kind: 'run_command', target: 'git commit -m "foo"' },
        ),
      ).toBe(true);
    });

    it('does not match stem that is a prefix but not a word boundary', () => {
      expect(
        matchesToolPattern(
          { kind: 'run_command', argument: 'git:*' },
          { kind: 'run_command', target: 'gitea push' },
        ),
      ).toBe(false);
    });

    it('does not match unrelated command', () => {
      expect(
        matchesToolPattern(
          { kind: 'run_command', argument: 'git:*' },
          { kind: 'run_command', target: 'npm install' },
        ),
      ).toBe(false);
    });
  });

  describe('glob matching', () => {
    it('matches glob with *', () => {
      expect(
        matchesToolPattern(
          { kind: 'read_file', argument: 'src/**/*.ts' },
          { kind: 'read_file', target: 'src/permissions/toolPatterns.ts' },
        ),
      ).toBe(true);
    });

    it('does not match glob outside pattern', () => {
      expect(
        matchesToolPattern(
          { kind: 'read_file', argument: 'src/**/*.ts' },
          { kind: 'read_file', target: 'tests/permissions/toolPatterns.spec.ts' },
        ),
      ).toBe(false);
    });

    it('matches single-level glob', () => {
      expect(
        matchesToolPattern(
          { kind: 'write_file', argument: '/tmp/*' },
          { kind: 'write_file', target: '/tmp/output.json' },
        ),
      ).toBe(true);
    });

    it('matches ? wildcard for single character', () => {
      expect(
        matchesToolPattern(
          { kind: 'read_file', argument: 'file?.ts' },
          { kind: 'read_file', target: 'fileA.ts' },
        ),
      ).toBe(true);
    });
  });

  describe('url domain matching', () => {
    it('matches exact domain', () => {
      expect(
        matchesToolPattern(
          { kind: 'url', argument: 'example.com' },
          { kind: 'url', target: 'https://example.com/path' },
        ),
      ).toBe(true);
    });

    it('matches subdomain of allowed domain', () => {
      expect(
        matchesToolPattern(
          { kind: 'url', argument: 'example.com' },
          { kind: 'url', target: 'https://api.example.com/v1' },
        ),
      ).toBe(true);
    });

    it('does not match different domain', () => {
      expect(
        matchesToolPattern(
          { kind: 'url', argument: 'example.com' },
          { kind: 'url', target: 'https://evil.com/path' },
        ),
      ).toBe(false);
    });

    it('matches wildcard domain *.example.com', () => {
      expect(
        matchesToolPattern(
          { kind: 'url', argument: '*.example.com' },
          { kind: 'url', target: 'https://api.example.com/v1' },
        ),
      ).toBe(true);
    });

    it('does not match apex with *.example.com pattern', () => {
      expect(
        matchesToolPattern(
          { kind: 'url', argument: '*.example.com' },
          { kind: 'url', target: 'https://example.com/path' },
        ),
      ).toBe(false);
    });

    it('does not match domain-prefix collision', () => {
      expect(
        matchesToolPattern(
          { kind: 'url', argument: 'example.com' },
          { kind: 'url', target: 'https://notexample.com/path' },
        ),
      ).toBe(false);
    });
  });

  describe('MCP tool matching', () => {
    it('matches MCP tool by kind', () => {
      expect(
        matchesToolPattern(
          { kind: 'mcp__github__list_prs' },
          { kind: 'mcp__github__list_prs', target: '' },
        ),
      ).toBe(true);
    });

    it('does not match different MCP tool', () => {
      expect(
        matchesToolPattern(
          { kind: 'mcp__github__list_prs' },
          { kind: 'mcp__github__create_pr', target: '' },
        ),
      ).toBe(false);
    });

    it('matches MCP tool with stem wildcard argument', () => {
      expect(
        matchesToolPattern(
          { kind: 'mcp__github__list_prs', argument: 'repo:*' },
          { kind: 'mcp__github__list_prs', target: 'repo myorg/myrepo' },
        ),
      ).toBe(true);
    });
  });
});
