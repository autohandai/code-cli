/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Compaction is the only point in a session where the context shrinks without
 * anyone asking. A skill is priced as size x requests carried, so a span left
 * open across one keeps accruing rent for text that may no longer be sent.
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SkillsRegistry } from '../../src/skills/SkillsRegistry.js';
import { TelemetryManager } from '../../src/telemetry/TelemetryManager.js';
import type { ContextCompactionData, TelemetryEventType } from '../../src/telemetry/types.js';

describe('ContextCompactionData', () => {
  it('admits context_compaction as an event type', () => {
    const eventType: TelemetryEventType = 'context_compaction';
    expect(eventType).toBe('context_compaction');
  });

  it('carries the before and after sizes and the spans that survived', () => {
    const data: ContextCompactionData = {
      tokensBefore: 180_000,
      tokensAfter: 60_000,
      survivingSpanIds: ['span-a', 'span-b'],
    };
    expect(data.tokensAfter).toBeLessThan(data.tokensBefore);
    expect(data.survivingSpanIds).toHaveLength(2);
  });
});

describe('TelemetryManager.trackContextCompaction', () => {
  function managerWithCapturedEvents() {
    const manager = new TelemetryManager({ enabled: true, clientType: 'cli' } as never);
    const sent: Array<{ eventType: string; eventData?: Record<string, unknown> }> = [];
    (manager as unknown as { client: unknown }).client = {
      track: async (event: { eventType: string; eventData?: Record<string, unknown> }) => {
        sent.push(event);
      },
      syncAll: async () => {},
    };
    return { manager, sent };
  }

  it('emits a context_compaction event with the compaction figures', async () => {
    const { manager, sent } = managerWithCapturedEvents();

    await manager.trackContextCompaction({
      tokensBefore: 180_000,
      tokensAfter: 60_000,
      survivingSpanIds: ['span-a'],
      reason: 'tiered-compaction',
      croppedCount: 12,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].eventType).toBe('context_compaction');
    expect(sent[0].eventData).toMatchObject({
      tokensBefore: 180_000,
      tokensAfter: 60_000,
      survivingSpanIds: ['span-a'],
      reason: 'tiered-compaction',
      croppedCount: 12,
    });
  });

  it('emits an empty survivor list rather than omitting it when no skill was open', async () => {
    const { manager, sent } = managerWithCapturedEvents();

    await manager.trackContextCompaction({
      tokensBefore: 100,
      tokensAfter: 40,
      survivingSpanIds: [],
    });

    // An empty list says "no skill was being carried"; a missing field would
    // be indistinguishable from a CLI too old to report survivors at all.
    expect(sent[0].eventData?.survivingSpanIds).toEqual([]);
  });
});

describe('SkillsRegistry.noteContextCompaction', () => {
  async function registryWith(names: string[]) {
    const dir = path.join(os.tmpdir(), `cli3-compaction-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    for (const name of names) {
      await fs.ensureDir(path.join(dir, name));
      await fs.writeFile(
        path.join(dir, name, 'SKILL.md'),
        `---\nname: ${name}\ndescription: ${name} skill\n---\n\nbody\n`,
        'utf-8',
      );
    }
    await fs.ensureDir(dir);
    const registry = new SkillsRegistry(dir);
    await registry.initialize();
    const trackSkillUse = vi.fn(async () => {});
    registry.setTelemetryManager({ trackSkillUse } as never);
    return { registry, trackSkillUse };
  }

  function eventsOf(trackSkillUse: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
    return trackSkillUse.mock.calls.map((call) => call[0] as Record<string, unknown>);
  }

  it('reports an active skill as surviving, because its body is re-rendered into a system prompt compaction never crops', async () => {
    const { registry, trackSkillUse } = await registryWith(['alpha', 'beta']);
    registry.activateSkill('alpha');
    registry.activateSkill('beta');
    const opened = eventsOf(trackSkillUse)
      .filter((event) => event.action === 'activate')
      .map((event) => event.spanId);

    const surviving = registry.noteContextCompaction();

    expect(new Set(surviving)).toEqual(new Set(opened));
    expect(eventsOf(trackSkillUse).some((event) => event.action === 'release')).toBe(false);
  });

  it('reports no survivors and releases nothing when no skill is active', async () => {
    const { registry, trackSkillUse } = await registryWith(['gamma']);
    expect(registry.noteContextCompaction()).toEqual([]);
    expect(trackSkillUse).not.toHaveBeenCalled();
  });

  it('closes the span of a skill that stopped being injected, and leaves it out of the survivors', async () => {
    const { registry, trackSkillUse } = await registryWith([]);
    registry.setExtensionSkills([
      {
        definition: { name: 'ext-skill', description: 'from an extension', source: 'extension', body: 'body' },
        provenance: { extensionId: 'ext', extensionVersion: '1.0.0' },
      } as never,
    ]);
    registry.activateSkill('ext-skill');
    const opened = eventsOf(trackSkillUse).find((event) => event.action === 'activate');
    expect(opened?.spanId).toBeDefined();

    // The extension drops out of the snapshot: the skill leaves the prompt,
    // but nothing closed the span it opened.
    registry.setExtensionSkills([]);

    const surviving = registry.noteContextCompaction();

    expect(surviving).toEqual([]);
    const release = eventsOf(trackSkillUse).find((event) => event.action === 'release');
    expect(release?.spanId).toBe(opened?.spanId);
    expect(release?.releaseReason).toBe('compacted_out');
  });

  it('does not release the same span twice across repeated compactions', async () => {
    const { registry, trackSkillUse } = await registryWith([]);
    registry.setExtensionSkills([
      {
        definition: { name: 'ext-twice', description: 'from an extension', source: 'extension', body: 'body' },
        provenance: { extensionId: 'ext', extensionVersion: '1.0.0' },
      } as never,
    ]);
    registry.activateSkill('ext-twice');
    registry.setExtensionSkills([]);

    registry.noteContextCompaction();
    registry.noteContextCompaction();

    expect(eventsOf(trackSkillUse).filter((event) => event.action === 'release')).toHaveLength(1);
  });

  it('keeps the survivor and drops only the evicted one when both are open', async () => {
    const { registry, trackSkillUse } = await registryWith(['stays']);
    registry.setExtensionSkills([
      {
        definition: { name: 'goes', description: 'from an extension', source: 'extension', body: 'body' },
        provenance: { extensionId: 'ext', extensionVersion: '1.0.0' },
      } as never,
    ]);
    registry.activateSkill('stays');
    registry.activateSkill('goes');
    const staysSpan = eventsOf(trackSkillUse)
      .find((event) => event.action === 'activate' && event.skillName === 'stays')?.spanId;
    registry.setExtensionSkills([]);

    expect(registry.noteContextCompaction()).toEqual([staysSpan]);
  });
});
