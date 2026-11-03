import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SkillRuntime, formatSkillReference } from '../../src/skills/SkillRuntime.js';
import { ADAPTIVE_AUTHORIZED_SCOPES, ADAPTIVE_CATALOG_SIZES, createAdaptiveCatalog, loadAdaptiveSkillsCorpus } from './helpers/adaptiveSkillsCorpus.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('adaptive skills deterministic catalog contract', () => {
  it.each(ADAPTIVE_CATALOG_SIZES)('keeps exact authorized invocation independent of the top K at %i entries', async size => {
    const corpus = await loadAdaptiveSkillsCorpus();
    const entries = createAdaptiveCatalog(corpus, size);
    const runtime = new SkillRuntime({ catalog: () => entries, authorizedScopes: () => ADAPTIVE_AUTHORIZED_SCOPES });
    for (const entry of entries) {
      const expected = entry.enabled && entry.compatible !== false && ADAPTIVE_AUTHORIZED_SCOPES.has(entry.scope) ? entry : null;
      expect(runtime.resolve(formatSkillReference(entry.reference))).toBe(expected);
    }
    if (size > corpus.entries.length) {
      const target = entries.at(-1)!;
      expect(runtime.search('catalog', 1)).toHaveLength(1);
      expect(runtime.resolve(target.reference)).toBe(target);
    }
    expect(runtime.receipts()).toEqual([]);
  });

  it.each(ADAPTIVE_CATALOG_SIZES)('preserves fixture discovery, lexical multilingual support, and abstention at %i entries', async size => {
    const corpus = await loadAdaptiveSkillsCorpus();
    const runtime = new SkillRuntime({ catalog: () => createAdaptiveCatalog(corpus, size), authorizedScopes: () => ADAPTIVE_AUTHORIZED_SCOPES });
    for (const fixture of corpus.queries) {
      const references = runtime.search(fixture.query, 32).map(result => formatSkillReference(result.entry.reference)).sort();
      expect(references, fixture.query).toEqual(size === 0 ? [] : fixture.expected.slice().sort());
    }
    expect(runtime.resolve('systematic-debugging')?.reference.authority).toBe(size === 0 ? undefined : 'project');
    expect(runtime.resolve('skill://team%3Aother/private-diagnostics')).toBeNull();
  });

  it('rechecks mutable authorization and refreshes changed metadata after a warm lookup', async () => {
    const entries = createAdaptiveCatalog(await loadAdaptiveSkillsCorpus(), 14);
    const scopes = new Set(ADAPTIVE_AUTHORIZED_SCOPES);
    const runtime = new SkillRuntime({ catalog: () => entries, authorizedScopes: () => scopes });
    expect(runtime.search('deep-research')).toHaveLength(1);
    entries[1].name = 'archived';
    entries[1].description = 'Retired catalog entry';
    expect(runtime.search('deep-research')).toEqual([]);
    scopes.delete('personal');
    expect(runtime.search('latency')).toEqual([]);
    expect(runtime.resolve({ authority: 'personal', packageId: 'performance' })).toBeNull();
    expect(runtime.receipts()).toEqual([]);
  });

  it('retains complete required resources and refuses stale pins or absent request evidence', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'adaptive-catalog-'));
    roots.push(root);
    await mkdir(path.join(root, 'references'));
    const skill = `---\nname: systematic-debugging\ndescription: Diagnose errors\n---\n${'Required instruction.\n'.repeat(500)}END_OF_FULL_INSTRUCTIONS`;
    await writeFile(path.join(root, 'SKILL.md'), skill);
    await writeFile(path.join(root, 'references/checks.md'), 'CHECK_ALL_ACCEPTANCE_CRITERIA');
    const entries = createAdaptiveCatalog(await loadAdaptiveSkillsCorpus(), 14, root);
    entries[0].requiredResources = ['references/checks.md'];
    const runtime = new SkillRuntime({ catalog: () => entries, authorizedScopes: () => ADAPTIVE_AUTHORIZED_SCOPES });
    const packet = await runtime.prepare(entries[0].reference, { taskId: 'fixture-task', reason: 'explicit', maxTokens: 100_000 });
    expect(packet.content).toContain(skill);
    expect(packet.content).toContain('CHECK_ALL_ACCEPTANCE_CRITERIA');
    expect(packet.manifest).toHaveLength(2);
    expect(runtime.receipts()).toEqual([]);
    const observation = { taskId: 'fixture-task', sessionId: 'fixture-session', requestId: 'fixture-request', adapter: 'autohand' as const, content: [packet.content], policyEpoch: 7 };
    await expect(runtime.acknowledgeDispatch([packet], { ...observation, taskId: 'wrong-task' })).rejects.toThrow(/task|content/i);
    await expect(runtime.acknowledgeDispatch([packet], { ...observation, content: [skill] })).rejects.toThrow(/content|packet/i);
    expect(runtime.receipts()).toEqual([]);
    await runtime.acknowledgeDispatch([packet], observation);
    expect(runtime.receipts()).toEqual([expect.objectContaining({ taskId: 'fixture-task', requestId: 'fixture-request', sessionId: 'fixture-session', state: 'submitted', policyEpoch: 7 })]);
    await writeFile(path.join(root, 'references/checks.md'), 'MUTATED_AFTER_REQUEST');
    await expect(runtime.prepare(packet.reference, { taskId: 'next-task', reason: 'restored', maxTokens: 100_000 })).rejects.toThrow(/revision/i);
    await expect(runtime.prepare(entries[0].reference, { taskId: 'next-task', reason: 'explicit', maxTokens: 10 })).rejects.toThrow(/No instructions were truncated/);
    expect(runtime.receipts()).toHaveLength(1);
  });
});
