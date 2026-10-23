import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectRepositoryReadiness, reviewRepositoryInventory, RepositoryReadiness, type ReadinessReport, type RepositoryInventory } from '../../../src/core/agent/RepositoryReadiness.js';
import type { LLMProvider } from '../../../src/providers/LLMProvider.js';

const roots: string[] = [];
const activeServices: RepositoryReadiness[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(activeServices.splice(0).map(async service => { await service.stop(); await service.start(); await service.flush(); }));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 3 })));
});
function inventoryFixture(root: string, fingerprint = 'one'): RepositoryInventory {
  return { identity: root, fingerprint, paths: ['AGENTS.md'], changedPaths: [], guidance: [], context: '' };
}
function createService(options: ConstructorParameters<typeof RepositoryReadiness>[0]) {
  const service = new RepositoryReadiness({ ...options, collect: options.collect ?? (async () => inventoryFixture(options.workspaceRoot)) });
  activeServices.push(service);
  return service;
}
async function repository() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'readiness-')); roots.push(root);
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await writeFile(path.join(root, 'AGENTS.md'), 'Use bun. Run tests before edits.');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest', lint: 'eslint .' } }));
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'Initial guidance'], { cwd: root });
  return root;
}
async function temporaryWorkspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'readiness-service-')); roots.push(root); return root;
}
const report: ReadinessReport = { fingerprint: 'one', mentalModel: 'TypeScript CLI', findings: [{ kind: 'guidance', paths: ['AGENTS.md'], title: 'Review repository guidance', detail: 'Source changed since guidance was updated.' }] };

describe('repository readiness inventory', () => {
  it('reviews repositories before their first commit', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'readiness-unborn-')); roots.push(root);
    execFileSync('git', ['init', '-q', root]);
    await writeFile(path.join(root, 'CLAUDE.md'), 'Use the current package scripts.');
    const inventory = await collectRepositoryReadiness(root, AbortSignal.timeout(10_000));
    expect(inventory.guidance[0]).toMatchObject({ path: 'CLAUDE.md', lastCommit: '', changedSinceUpdate: [] });
    expect(inventory.changedPaths).toContain('CLAUDE.md');
  });
  it('compares instruction history with committed and uncommitted source changes without executing scripts', async () => {
    const root = await repository();
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src/main.ts'), 'export const main = 1;');
    execFileSync('git', ['add', 'src'], { cwd: root });
    execFileSync('git', ['commit', '-qm', 'Add source'], { cwd: root });
    await writeFile(path.join(root, 'src/main.ts'), 'export const main = 2;');
    await mkdir(path.join(root, 'fresh'));
    await writeFile(path.join(root, 'fresh/feature.ts'), 'export const untrackedFeature = true;');
    await writeFile(path.join(root, '.env'), 'SECRET=must-not-be-read');
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'touch SHOULD_NOT_EXIST' } }));
    const result = await collectRepositoryReadiness(root, AbortSignal.timeout(10_000));
    expect(result.guidance[0]).toMatchObject({ path: 'AGENTS.md', changedSinceUpdate: ['src/main.ts'] });
    expect(result.changedPaths).toContain('src/main.ts');
    expect(result.changedPaths).toContain('fresh/feature.ts');
    expect(result.context).toContain('export const main = 2');
    expect(result.context).toContain('export const untrackedFeature = true');
    expect(result.context).not.toContain('must-not-be-read');
    expect(result.paths).not.toContain('.env');
    await expect(readFile(path.join(root, 'SHOULD_NOT_EXIST'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('does not equate old instructions with stale instructions and refuses source symlinks', async () => {
    const root = await repository();
    const outside = await mkdtemp(path.join(os.tmpdir(), 'readiness-secret-')); roots.push(outside);
    await writeFile(path.join(outside, 'secret.ts'), 'outside-secret');
    await symlink(path.join(outside, 'secret.ts'), path.join(root, 'linked.ts'));
    const result = await collectRepositoryReadiness(root, AbortSignal.timeout(10_000));
    expect(result.guidance[0]?.changedSinceUpdate).toEqual([]);
    expect(result.context).not.toContain('outside-secret');
    expect(result.context.length).toBeLessThanOrEqual(28_000);
  });
  it('honors cancellation', async () => {
    await expect(collectRepositoryReadiness(await repository(), AbortSignal.abort())).rejects.toThrow();
  });
  it('preserves leading spaces in Git paths and leaves watchdog timers at baseline', async () => {
    const root = await repository();
    await writeFile(path.join(root, ' leading.ts'), 'export const leading = true;');
    execFileSync('git', ['add', ' leading.ts'], { cwd: root });
    vi.useFakeTimers(); const timers = vi.getTimerCount();
    const result = await collectRepositoryReadiness(root, AbortSignal.timeout(10_000));
    expect(result.paths).toContain(' leading.ts'); expect(result.changedPaths).toContain(' leading.ts');
    expect(vi.getTimerCount()).toBe(timers);
  });
});

describe('background repository readiness', () => {
  it('does not start a review when the owning runtime already shut down', async () => {
    const root = await temporaryWorkspace(); const analyze = vi.fn(async () => report);
    const service = createService({ workspaceRoot: root, signal: AbortSignal.abort(), cacheDir: path.join(root, 'cache'), analyze, notify: vi.fn(), isIdle: () => true });
    await service.start(); expect(analyze).not.toHaveBeenCalled();
  });
  it('deduplicates notifications when two sessions finish together in the same repository', async () => {
    const root = await temporaryWorkspace(); const notify = vi.fn();
    const options = { workspaceRoot: root, cacheDir: path.join(root, 'cache'), analyze: async () => report, notify, isIdle: () => true };
    const services = [createService(options), createService(options)];
    await Promise.all(services.map(service => service.start()));
    services.forEach(service => service.markTurnCompleted());
    await Promise.all(services.map(service => service.flush()));
    expect(notify).toHaveBeenCalledTimes(1);
    services.forEach(service => service.stop());
  });
  it.each([true, false])('notifies only after a completed turn whether analysis finishes first: %s', async first => {
    const root = await temporaryWorkspace(); const notify = vi.fn();
    let resolve!: (value: ReadinessReport) => void;
    const analyze = vi.fn(() => new Promise<ReadinessReport>(done => { resolve = done; }));
    const service = createService({ workspaceRoot: root, cacheDir: path.join(root, 'cache'), analyze, notify, isIdle: () => true });
    const pending = service.start();
    await vi.waitFor(() => expect(analyze).toHaveBeenCalled(), { timeout: 10_000 });
    if (!first) service.markTurnCompleted();
    expect(notify).not.toHaveBeenCalled(); resolve(report); await pending;
    if (first) { expect(notify).not.toHaveBeenCalled(); service.markTurnCompleted(); }
    await service.flush();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0]).toContain('/readiness');
    service.markTurnCompleted(); await service.flush(); expect(notify).toHaveBeenCalledTimes(1);
    service.stop();
  });
  it('shows the automatic reminder only once per repository even when findings change', async () => {
    const root = await temporaryWorkspace(); const notify = vi.fn(); let current = report;
    const options = { workspaceRoot: root, cacheDir: path.join(root, 'cache'), collect: async () => inventoryFixture(root, current.fingerprint), analyze: async () => current, notify, isIdle: () => true };
    for (let i = 0; i < 3; i++) {
      if (i === 1) { await writeFile(path.join(root, 'new.ts'), 'changed'); current = { ...report, fingerprint: 'two', findings: [{ ...report.findings[0]!, title: 'Different wording' }] }; }
      if (i === 2) { await writeFile(path.join(root, 'other.ts'), 'changed'); current = { ...report, fingerprint: 'three', findings: [{ kind: 'tests', paths: ['other.ts'], title: 'Add coverage', detail: 'New source has no related tests.' }] }; }
      const service = createService(options); await service.start(); service.markTurnCompleted(); await service.flush(); service.stop();
    }
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0]).not.toContain(report.findings[0]!.title);
  });
  it('persists dismissal while keeping new reports available for manual review', async () => {
    const root = await temporaryWorkspace(); const notify = vi.fn();
    const options = { workspaceRoot: root, cacheDir: path.join(root, 'cache'), analyze: async () => report, notify, isIdle: () => true };
    const first = createService(options); await first.start(); await first.dismiss(); await first.stop();
    const current: ReadinessReport = { ...report, fingerprint: 'new', findings: [{ kind: 'tests', paths: ['new.ts'], title: 'New coverage', detail: 'Review this manually.' }] };
    const next = createService({ ...options, collect: async () => inventoryFixture(root, current.fingerprint), analyze: async () => current });
    await next.start(); next.markTurnCompleted(); await next.flush();
    expect(notify).not.toHaveBeenCalled(); expect(next.getReport()).toEqual(current);
  });
  it('honors previously shown reminders from caches written before the once-per-repository setting', async () => {
    const root = await temporaryWorkspace(); const cacheDir = path.join(root, 'cache'); const notify = vi.fn();
    await mkdir(cacheDir);
    await writeFile(path.join(cacheDir, `${createHash('sha256').update(root).digest('hex')}.json`), JSON.stringify({ version: 1, report, seen: ['legacy-finding-key'] }));
    const current = { ...report, fingerprint: 'new' };
    const service = createService({ workspaceRoot: root, cacheDir, collect: async () => inventoryFixture(root, 'new'), analyze: async () => current, notify, isIdle: () => true });
    await service.start(); service.markTurnCompleted(); await service.flush();
    expect(notify).not.toHaveBeenCalled(); expect(service.getReport()).toEqual(current);
  });
  it('does not notify while a new turn is active, or after shutdown; releases cancellation listeners', async () => {
    const root = await temporaryWorkspace(); const notify = vi.fn(); let idle = false;
    const service = createService({ workspaceRoot: root, cacheDir: path.join(root, 'cache'), analyze: async () => report, notify, isIdle: () => idle });
    await service.start(); service.markTurnCompleted(); await service.flush(); expect(notify).not.toHaveBeenCalled();
    idle = true; service.stop(); service.markTurnCompleted(); await service.flush(); expect(notify).not.toHaveBeenCalled();
  });
  it('settles shutdown even when an analyzer ignores cancellation', async () => {
    const root = await temporaryWorkspace();
    const analyze = vi.fn(() => new Promise<ReadinessReport>(() => {}));
    const service = createService({ workspaceRoot: root, cacheDir: path.join(root, 'cache'), analyze, notify: vi.fn(), isIdle: () => true });
    let settled = false;
    const pending = service.start().then(() => { settled = true; });
    await vi.waitFor(() => expect(analyze).toHaveBeenCalled(), { timeout: 30_000 });
    await service.stop(); expect(settled).toBe(true); await pending;
    expect(service.getReport()).toBeUndefined();
  });
});

describe('staff review output', () => {
  it('bounds the model request even when the repository has many long paths', async () => {
    const inventory = await collectRepositoryReadiness(await repository(), AbortSignal.timeout(10_000));
    inventory.paths = Array.from({ length: 2_000 }, (_, index) => `${'long/'.repeat(50)}${index}.ts`);
    inventory.context = 'x'.repeat(28_000);
    const complete = vi.fn().mockResolvedValue({ content: '{"mentalModel":"","findings":[]}' });
    await reviewRepositoryInventory(inventory, { complete } as unknown as LLMProvider, AbortSignal.timeout(10_000));
    expect(complete.mock.calls[0]?.[0].messages[1].content.length).toBeLessThanOrEqual(60_000);
  });
  it('accepts only grounded findings, bounds text, and strips terminal control characters', async () => {
    const inventory = await collectRepositoryReadiness(await repository(), AbortSignal.timeout(10_000));
    const complete = vi.fn().mockResolvedValue({ content: JSON.stringify({ mentalModel: 'A CLI\u001b[31m', findings: [
      { kind: 'tests', paths: ['missing.ts'], title: 'Made up', detail: 'No evidence' },
      { kind: 'simplify', paths: ['package.json'], title: 'Review scripts', detail: 'x'.repeat(1_000) },
      { kind: 'execute', paths: ['AGENTS.md'], title: 'Invalid category', detail: 'No' },
    ] }) });
    const provider = { complete } as unknown as LLMProvider;
    const result = await reviewRepositoryInventory(inventory, provider, AbortSignal.timeout(10_000));
    expect(result.findings).toHaveLength(1); expect(result.findings[0]?.detail.length).toBe(600);
    expect(result.mentalModel).not.toContain('\u001b'); expect(complete.mock.calls[0]?.[0]).not.toHaveProperty('tools');
  });
  it('settles cancellation without leaking listeners or timers when the provider ignores abort', async () => {
    const inventory = await collectRepositoryReadiness(await repository(), AbortSignal.timeout(10_000));
    vi.useFakeTimers(); const baseline = vi.getTimerCount();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = reviewRepositoryInventory(inventory, { complete: () => new Promise(() => {}) } as unknown as LLMProvider, controller.signal);
    controller.abort(); await expect(pending).rejects.toThrow('cancelled');
    expect(remove).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(baseline);
  });
});
