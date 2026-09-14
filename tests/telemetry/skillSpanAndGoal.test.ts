import { describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { SkillsRegistry } from '../../src/skills/SkillsRegistry.js';

/**
 * A skill activated here is added to the session prompt and stays there, so
 * its body is charged again on every later request. Only the activation was
 * ever reported, which made that cost unknowable — these pin the span that
 * makes it measurable, and the file metadata that lets a skill be aged.
 */
describe('skill spans', () => {
  async function registryWith(body: string) {
    const dir = path.join(os.tmpdir(), `cli3-skill-span-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.ensureDir(path.join(dir, 'measured-skill'));
    await fs.writeFile(
      path.join(dir, 'measured-skill', 'SKILL.md'),
      `---\nname: measured-skill\ndescription: A skill with a body\nmetadata:\n  version: 2.1.0\n---\n\n${body}\n`,
      'utf-8',
    );
    const registry = new SkillsRegistry(dir);
    await registry.initialize();
    const trackSkillUse = vi.fn(async () => {});
    registry.setTelemetryManager({ trackSkillUse } as never);
    return { registry, trackSkillUse, dir };
  }

  it('opens a span carrying the size of what it injected and the file it came from', async () => {
    const { registry, trackSkillUse } = await registryWith('word '.repeat(400));

    expect(registry.activateSkill('measured-skill')).toBe(true);
    expect(trackSkillUse).toHaveBeenCalledTimes(1);

    const [event] = trackSkillUse.mock.calls[0] as [Record<string, unknown>];
    expect(event.action).toBe('activate');
    expect(typeof event.spanId).toBe('string');
    expect(event.tokenSize as number).toBeGreaterThan(0);
    expect(event.sizeBytes as number).toBeGreaterThan(0);
    expect(typeof event.createdAt).toBe('string');
    expect(typeof event.modifiedAt).toBe('string');
  });

  it('closes the span it opened, with the same id and a reason', async () => {
    const { registry, trackSkillUse } = await registryWith('body');

    registry.activateSkill('measured-skill');
    const opened = (trackSkillUse.mock.calls[0] as [Record<string, unknown>])[0];
    registry.deactivateSkill('measured-skill');

    expect(trackSkillUse).toHaveBeenCalledTimes(2);
    const closed = (trackSkillUse.mock.calls[1] as [Record<string, unknown>])[0];
    expect(closed.action).toBe('release');
    expect(closed.spanId).toBe(opened.spanId);
    expect(closed.releaseReason).toBe('deactivated');
  });

  it('does not open a second span for a skill that is already active', async () => {
    const { registry, trackSkillUse } = await registryWith('body');

    registry.activateSkill('measured-skill');
    registry.activateSkill('measured-skill');

    expect(trackSkillUse).toHaveBeenCalledTimes(1);
  });

  it('records that the session, not the user, ended the span', async () => {
    const { registry, trackSkillUse } = await registryWith('body');

    registry.activateSkill('measured-skill');
    trackSkillUse.mockClear();
    registry.deactivateAll('session_end');

    const [event] = trackSkillUse.mock.calls[0] as [Record<string, unknown>];
    expect(event.releaseReason).toBe('session_end');
  });

  it('reports nothing for a skill that was never activated', async () => {
    const { registry, trackSkillUse } = await registryWith('body');

    registry.deactivateSkill('measured-skill');

    expect(trackSkillUse).not.toHaveBeenCalled();
  });
});
