import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { promises as nodeFs } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as atomic from '../../src/utils/atomicFile.js';
import { SkillLearningStore, type SkillLearningStoreOptions } from '../../src/skills/SkillLearningStore.js';

const roots: string[] = [];
const source = { id: 'outcome', taskId: 'task', scope: 'project:one', kind: 'work' as const, evidenceRefs: ['check'] };
const files = new Map([['SKILL.md', Buffer.from('---\nname: checked-work\ndescription: Check reusable work\n---\nRequire observable checks.\n')]]);
async function setup(options: SkillLearningStoreOptions = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-learning-store-'));
  roots.push(root);
  const store = new SkillLearningStore(root, options);
  await store.commitOutcome(source);
  const enqueue = (outcomeId = source.id, extractorVersion = 'fixture-v1') => store.enqueue(outcomeId,
    { extractorVersion, mode: 'explicit', provider: 'fixture-local', policyEpoch: 'one' });
  return { root, store, enqueue };
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => fs.remove(root))); });

describe('SkillLearningStore', () => {
  it('requires committed outcomes and bounds jobs without dropping pending work or duplicate guards', async () => {
    const { store, enqueue } = await setup({ maxJobs: 1 });
    await expect(enqueue('missing')).rejects.toThrow(/commit/i);
    const first = await enqueue();
    expect(await enqueue()).toEqual(first);
    await store.commitOutcome({ ...source, id: 'other' });
    expect(await enqueue('other')).toBeNull();
    const claimed = await store.claimNext();
    await store.finishJob(claimed!, 'cancelled');
    await enqueue('other');
    expect(await enqueue()).toBeNull();
    expect((await store.snapshot()).jobs).toHaveLength(1);
  });

  it('claims each job once across concurrent store instances and releases no timers', async () => {
    const { root, store, enqueue } = await setup();
    await enqueue();
    const other = new SkillLearningStore(root);
    const claims = await Promise.all([store.claimNext(), other.claimNext()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    vi.useFakeTimers();
    const baseline = vi.getTimerCount();
    await store.finishJob(claims.find(Boolean)!, 'failed');
    expect(vi.getTimerCount()).toBe(baseline);
    vi.useRealTimers();
  });

  it('recovers one atomic publication after a crash before the job-state commit', async () => {
    let now = Date.now();
    const { root, store, enqueue } = await setup({ now: () => now, leaseMs: 10 });
    await enqueue();
    const job = (await store.claimNext())!;
    const originalWrite = atomic.atomicWriteJson;
    vi.spyOn(atomic, 'atomicWriteJson').mockImplementation(async (filePath, value, options) => {
      if (filePath === path.join(root, 'learning.json')) throw new Error('simulated crash after package rename');
      return originalWrite(filePath, value, options);
    });
    await expect(store.publishDraft(job, { files }, async () => {})).rejects.toThrow(/simulated crash/);
    vi.restoreAllMocks();
    now += 11;
    const restarted = new SkillLearningStore(root, { now: () => now, leaseMs: 10 });
    const retry = (await restarted.claimNext())!;
    const [publishedDirectory] = (await fs.readdir(path.join(root, 'candidates'))).filter(name => !name.startsWith('.'));
    const metadataPath = path.join(root, 'candidates', publishedDirectory!, 'candidate.json');
    const metadata = await fs.readJson(metadataPath);
    await fs.writeJson(metadataPath, { ...metadata, reference: { ...metadata.reference, authority: 'changed-authority' } });
    await expect(restarted.recoverPublished(retry)).rejects.toThrow(/lineage|identity|conflict/i);
    await fs.writeJson(metadataPath, metadata);
    const recovered = await restarted.recoverPublished(retry);
    expect(recovered?.reference.revision).toMatch(/^sha256:/);
    expect((await restarted.snapshot()).candidates).toHaveLength(1);
    expect((await restarted.snapshot()).jobs[0]?.state).toBe('published');
    expect((await fs.readdir(path.join(root, 'candidates'))).filter(name => !name.startsWith('.'))).toEqual([recovered!.id]);
  });

  it('rejects resource traversal and preserves an existing user package', async () => {
    const { root, store, enqueue } = await setup();
    await enqueue();
    const job = (await store.claimNext())!;
    const traversal = new Map(files);
    traversal.set('../outside.txt', Buffer.from('unsafe'));
    await expect(store.publishDraft(job, { files: traversal }, async () => {})).rejects.toThrow(/unsafe/i);
    expect(await fs.pathExists(path.join(root, 'outside.txt'))).toBe(false);
    const candidate = await store.publishDraft(job, { files }, async () => {});
    await fs.appendFile(path.join(candidate.packagePath, 'SKILL.md'), '\nUser correction.\n');
    await expect(store.updateCandidate(candidate.id, candidate.reference.revision, { status: 'superseded' })).rejects.toThrow(/changed/i);
    expect(await fs.readFile(path.join(candidate.packagePath, 'SKILL.md'), 'utf8')).toContain('User correction.');
  });

  it('publishes on platforms that do not support synchronizing directory handles', async () => {
    const { root, store, enqueue } = await setup();
    await enqueue();
    const job = (await store.claimNext())!;
    const originalOpen = nodeFs.open;
    vi.spyOn(nodeFs, 'open').mockImplementation(async (...args: Parameters<typeof nodeFs.open>) => {
      if (args[0] === path.join(root, 'candidates')) throw Object.assign(new Error('directory handles unsupported'), { code: 'EISDIR' });
      return originalOpen(...args);
    });
    const candidate = await store.publishDraft(job, { files }, async () => {});
    expect(candidate.status).toBe('draft');
    expect((await store.snapshot()).jobs[0]?.state).toBe('published');
  });

  it('does not resurrect deleted evidence from a replayed outcome or published candidate', async () => {
    const { store, enqueue } = await setup();
    await enqueue();
    const job = (await store.claimNext())!;
    const candidate = await store.publishDraft(job, { files }, async () => {});
    await store.exclude(candidate.reference, candidate.scope, true);
    await expect(store.commitOutcome(source)).rejects.toThrow(/removed|deleted|excluded/i);
    expect(await fs.pathExists(path.join(candidate.packagePath, 'SKILL.md'))).toBe(true);
    expect((await store.snapshot()).jobs).toEqual([]);
  });

  it('rejects candidate-parent symlinks before reading or mutating a managed package', async () => {
    const { root, store, enqueue } = await setup();
    await enqueue();
    const job = (await store.claimNext())!;
    const candidate = await store.publishDraft(job, { files }, async () => {});
    const container = path.dirname(candidate.packagePath);
    const saved = path.join(root, 'user-preserved-container');
    await fs.move(container, saved);
    await fs.symlink(saved, container);
    await expect(store.getCandidate(candidate.id)).rejects.toThrow(/symbolic|unsafe|changed/i);
  });
});
