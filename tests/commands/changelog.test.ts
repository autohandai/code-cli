/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  changelog,
  formatChangelog,
  metadata,
  type ChangelogRelease,
} from '../../src/commands/changelog.js';
import { SLASH_COMMANDS } from '../../src/core/slashCommands.js';

const releases: ChangelogRelease[] = [
  {
    tagName: 'v0.8.3',
    name: 'Terminal polish',
    body: '## Highlights\n\n- Added `--changelog` support.\n- Fixed **release** rendering.',
    publishedAt: '2026-03-01T10:00:00Z',
    url: 'https://github.com/autohandai/code-cli/releases/tag/v0.8.3',
    prerelease: false,
  },
  {
    tagName: 'v0.8.2-alpha.1',
    name: '',
    body: '',
    publishedAt: null,
    url: 'https://github.com/autohandai/code-cli/releases/tag/v0.8.2-alpha.1',
    prerelease: true,
  },
];

describe('/changelog command', () => {
  it('formats GitHub releases as a readable terminal changelog', () => {
    const output = formatChangelog(releases, { terminalColumns: 44 });

    expect(output).toContain('Autohand Changelog');
    expect(output).toContain('v0.8.3 — Terminal polish');
    expect(output).toContain('Published Mar 1, 2026');
    expect(output).toContain('• Added --changelog support.');
    expect(output).toContain('• Fixed release rendering.');
    expect(output).toContain('v0.8.2-alpha.1 [pre-release]');
    expect(output).toContain('No release notes provided.');
    expect(output).toMatch(/github\.com\/autohandai\/code-cli\/releases\/tag\/\nv0\.8\.3/);
    expect(output.split('\n').every((line) => line.length <= 44)).toBe(true);
  });

  it('loads and formats releases through the shared command entry point', async () => {
    const output = await changelog({
      terminalColumns: 100,
      loadReleases: async () => releases,
    });

    expect(output).toContain('v0.8.3 — Terminal polish');
    expect(output).toContain('v0.8.2-alpha.1 [pre-release]');
  });

  it('reports when release history cannot be loaded', async () => {
    const output = await changelog({
      loadReleases: async () => null,
    });

    expect(output).toBe('Unable to load the release changelog. Check your internet connection and try again.');
  });

  it('registers the command in the slash-command palette', () => {
    expect(metadata).toMatchObject({
      command: '/changelog',
      description: 'view recent GitHub release notes',
      implemented: true,
    });
    expect(SLASH_COMMANDS).toContainEqual(expect.objectContaining({ command: '/changelog' }));
  });
});
