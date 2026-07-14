import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateReleaseNotes } from '../.github/generate-release-notes.mjs';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function createRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'autohand-release-notes-'));
  git(cwd, ['init']);
  git(cwd, ['config', 'user.name', 'Test User']);
  git(cwd, ['config', 'user.email', 'test@example.com']);
  return cwd;
}

function commitFile(cwd: string, fileName: string, contents: string, message: string): void {
  writeFileSync(join(cwd, fileName), contents, 'utf8');
  git(cwd, ['add', fileName]);
  git(cwd, ['commit', '-m', message]);
}

describe('generate release notes', () => {
  it('compares stable releases against the previous stable tag, not a same-commit alpha tag', () => {
    const cwd = createRepo();
    commitFile(cwd, 'README.md', 'initial\n', 'Initial release');
    git(cwd, ['tag', 'v0.9.1']);

    commitFile(cwd, 'feature.txt', 'dashboard\n', 'Add active Autohand agents dashboard');
    git(cwd, ['tag', 'v0.9.2-alpha.67f5501']);
    git(cwd, ['tag', 'v0.9.2']);

    const result = generateReleaseNotes({
      version: '0.9.2',
      channel: 'release',
      repo: 'autohandai/code-cli',
      cwd,
    });

    expect(result.previousTag).toBe('v0.9.1');
    expect(result.markdown).toContain("Here's what's new since v0.9.1");
    expect(result.markdown).toContain('- Add active Autohand agents dashboard');
    expect(result.markdown).toContain('https://github.com/autohandai/code-cli/compare/v0.9.1...v0.9.2');
    expect(result.markdown).toContain('brew install autohandai/code/autohand-code');
    expect(result.markdown).not.toContain('No code changes were found');
  });

  it('compares alpha releases against the previous reachable release tag', () => {
    const cwd = createRepo();
    commitFile(cwd, 'README.md', 'stable\n', 'Release baseline');
    git(cwd, ['tag', 'v0.9.2']);

    commitFile(cwd, 'fix.txt', 'fixed\n', 'fix: repair installer release notes');
    git(cwd, ['tag', 'v0.9.3-alpha.a97cfcf']);

    const result = generateReleaseNotes({
      version: '0.9.3-alpha.a97cfcf',
      channel: 'alpha',
      repo: 'autohandai/code-cli',
      cwd,
    });

    expect(result.previousTag).toBe('v0.9.2');
    expect(result.markdown).toContain('> **Alpha Release**');
    expect(result.markdown).toContain("Here's what's new since v0.9.2");
    expect(result.markdown).toContain('### Bug Fixes');
    expect(result.markdown).toContain('- Repair installer release notes');
  });
});
