import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { launchAdaptiveSkillsFixture, type AdaptiveSkillsFixture } from './helpers/adaptiveSkillsFixture.js';
import { exitInteractive } from './helpers/autohandTuistory.js';

const fixtures: AdaptiveSkillsFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.cleanup(); });

describe('skill learning controls in the built CLI', () => {
  it('keeps learning opt-in, exposes local management, and avoids dispatch for command-only interaction', async () => {
    const fixture = await launchAdaptiveSkillsFixture({ adaptiveSkills: true, localSkills: 0, turns: [{ content: 'UNEXPECTED_LEARNING_DISPATCH' }] });
    fixtures.push(fixture);
    try {
      await fixture.session.waitForText('❯', { timeout: 20_000 });
      const command = async (input: string, output: string) => {
        await fixture.session.type(input);
        await fixture.session.press('enter');
        await fixture.session.waitForText(output, { timeout: 10_000 });
      };
      await command('/skills learning status', 'Automatic skill learning: off.');
      await command('/skills learning on', 'Automatic skill learning: on.');
      const enabled = async () => z.object({ skills: z.object({ learning: z.object({ enabled: z.boolean() }) }) })
        .parse(JSON.parse(await readFile(fixture.state.configPath, 'utf8'))).skills.learning.enabled;
      await vi.waitFor(async () => expect(await enabled()).toBe(true));
      await command('/skills learning off', 'Automatic skill learning: off.');
      await vi.waitFor(async () => expect(await enabled()).toBe(false));
      await command('/skills learning list', 'No learned drafts yet.');
      await command('/skills learn missing-fixture-outcome', 'No prior work outcome is available');
      expect(fixture.server.requests).toEqual([]);
      expect(fixture.session.readAll()).not.toContain('UNEXPECTED_LEARNING_DISPATCH');
    } finally { await exitInteractive(fixture.session); }
  }, 60_000);
});
