/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const GUIDE_PATH = path.resolve('docs/guides/building-autohand-extensions.md');
const AGENT_SKILLS_PATH = path.resolve('docs/agent-skills.md');
const RECORDER_PATH = path.resolve('src/testing/scenarios/recordExtensionBuilderDemo.ts');
const GIF_PATH = path.resolve('docs/gif/extension-builder-demo.gif');
const MP4_PATH = path.resolve('docs/video/extension-builder-demo.mp4');
const CAST_PATH = path.resolve('docs/video/extension-builder-demo.cast');

describe('extension-builder user guide and recorded demo', () => {
  it('documents installation, authoring, validation, and the workspace brief demo', async () => {
    const guide = await fs.readFile(GUIDE_PATH, 'utf8');

    expect(guide).toContain('npx skills add https://github.com/autohandai/community-skills');
    expect(guide).toContain('$extension-builder');
    expect(guide).toContain('examples/extensions/autohand.workspace-brief');
    expect(guide).toContain('autohand extensions validate');
    expect(guide).toContain('extensions install');
    expect(guide).toContain('extensions show');
    expect(guide).toContain('../gif/extension-builder-demo.gif');
    expect(guide).toContain('../video/extension-builder-demo.mp4');
  });

  it('targets Autohand when installing the public extension-builder skill', async () => {
    const [guide, agentSkills, recorder] = await Promise.all([
      fs.readFile(GUIDE_PATH, 'utf8'),
      fs.readFile(AGENT_SKILLS_PATH, 'utf8'),
      fs.readFile(RECORDER_PATH, 'utf8'),
    ]);

    for (const content of [guide, agentSkills, recorder]) {
      expect(content).toContain('--skill extension-builder -a autohand-code -y');
      expect(content).not.toContain('--skill extension-builder -a codex -y');
    }
  });

  it('ships a reproducible Tuistory recording command and packaged media', async () => {
    const packageJson = await fs.readJson('package.json') as {
      files?: string[];
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['demo:extension-builder'])
      .toBe('tsx scripts/record-extension-builder-demo.ts');
    expect(packageJson.files).toEqual(expect.arrayContaining([
      'docs/guides/building-autohand-extensions.md',
      'docs/gif/extension-builder-demo.gif',
      'docs/video/extension-builder-demo.mp4',
      'docs/video/extension-builder-demo.cast',
    ]));

    const gif = await fs.readFile(GIF_PATH);
    expect(gif.subarray(0, 6).toString('ascii')).toMatch(/^GIF8[79]a$/);
    expect(gif.length).toBeGreaterThan(10_000);
    expect(gif.readUInt16LE(6)).toBeGreaterThanOrEqual(1_000);
    expect(gif.readUInt16LE(8)).toBeGreaterThanOrEqual(600);

    const mp4 = await fs.readFile(MP4_PATH);
    expect(mp4.subarray(4, 8).toString('ascii')).toBe('ftyp');
    expect(mp4.length).toBeGreaterThan(10_000);

    const castLines = (await fs.readFile(CAST_PATH, 'utf8')).trim().split('\n');
    const header = JSON.parse(castLines[0] ?? '{}') as Record<string, unknown>;
    expect(header).toMatchObject({ version: 2, width: 120, height: 36 });
    const terminalOutput = castLines.slice(1)
      .map((line) => JSON.parse(line) as [number, 'o', string])
      .map((event) => event[2])
      .join('');
    expect(terminalOutput).toContain('npx skills add');
    expect(terminalOutput).toContain('--skill extension-builder -a autohand-code -y');
    expect(terminalOutput).not.toContain('--skill extension-builder -a codex -y');
    expect(terminalOutput).not.toMatch(/\bcodex\b/i);
    expect(terminalOutput).toContain('$extension-builder');
    expect(terminalOutput).toContain('extensions validate');
  });
});
