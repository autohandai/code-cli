import fs from 'fs-extra';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { minimatch } from 'minimatch';
import { AUTOHAND_HOME } from '../constants.js';
import type { ProjectMemoryAdapter } from '../memory/MemoryManager.js';
import { MemoryEventLog, mergeMemoryEventLogContents } from '../memory/MemoryEventLog.js';
import { materializeMemoryProjection } from '../memory/MemoryProjection.js';
import { atomicWriteFile, atomicWriteJson, withFileLock } from '../utils/atomicFile.js';
import { assertCommunityPathSymlinkSafe } from '../skills/communitySkillPaths.js';
import { discardResponseBody } from '../utils/responseBody.js';

const execute = promisify(execFile);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const MAX_LOG_BYTES = 10 * 1024 * 1024;
const configSchema = z.object({
  auth: z.object({ token: z.string().optional() }).optional(),
  api: z.object({ accountId: z.string().optional(), baseUrl: z.string().optional() }).optional(),
  sync: z.object({ enabled: z.boolean().optional(), exclude: z.array(z.string()).optional() }).optional(),
});
const scopeSchema = z.object({ accountId: z.string(), projectId: z.string(), tokenHash: z.string(), canWrite: z.boolean(), seeded: z.boolean(), revoked: z.boolean().optional() });
const snapshotSchema = z.object({ success: z.literal(true), accountId: z.string(), projectId: z.string(), canWrite: z.boolean(), log: z.string() });
type Identity = { accountId: string; token: string; tokenHash: string; base: URL; fingerprint: string };
type Binding = z.infer<typeof scopeSchema> & { directory: string; workspaceRoot: string; identity: Identity; generation: number };
type Snapshot = z.infer<typeof snapshotSchema>;

export function normalizeProjectRepository(raw: string): string | null {
  if (!raw || raw.length > 4096 || /[\s\u0000-\u001f\u007f\\?#]/u.test(raw)) return null;
  const scp = /^(?:[^@/:]+@)?([^/:]+):([^/].*)$/u.exec(raw);
  const value = !raw.includes('://') && scp ? `ssh://${scp[1]}/${scp[2]}` : raw;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (!['https:', 'ssh:'].includes(url.protocol) || !url.hostname) return null;
  let repository = url.pathname.replace(/^\/+|\/+$/gu, '').replace(/\.git$/u, '');
  if (!repository || repository.split('/').some(part => !part || part === '.' || part === '..')) return null;
  const host = url.hostname.toLowerCase();
  if (host === 'github.com' || host === 'gitlab.com') repository = repository.toLowerCase();
  const port = url.port && !['22', '443'].includes(url.port) ? `:${url.port}` : '';
  return `${host}${port}/${repository}`;
}

function validateProjectLog(log: string): string {
  if (Buffer.byteLength(log) > MAX_LOG_BYTES) throw new Error('Team project memory log exceeds 10 MiB.');
  mergeMemoryEventLogContents('', log);
  if (log.split('\n').some(line => line.trim() && (JSON.parse(line) as { level?: unknown }).level !== 'project')) {
    throw new Error('Team project memory must contain project entries only.');
  }
  return log;
}

export class ProjectMemorySync implements ProjectMemoryAdapter {
  private readonly root: string;
  private readonly configPath: string;
  private readonly getRepository: (workspaceRoot: string) => Promise<string | null>;
  private binding: Binding | undefined;
  private generation = 0;
  private workspaceRoot = '';
  private fingerprint = '';
  private refreshing: { key: string; promise: Promise<void> } | undefined;

  constructor(options: { configPath: string; root?: string; getRepository?: (workspaceRoot: string) => Promise<string | null> }) {
    this.root = options.root ?? AUTOHAND_HOME;
    this.configPath = options.configPath;
    this.getRepository = options.getRepository ?? (async workspaceRoot => {
      try {
        const result = await execute('git', ['remote', 'get-url', 'origin'], { cwd: workspaceRoot, encoding: 'utf8', timeout: 3000, maxBuffer: 16_384 });
        return result.stdout.trim();
      } catch { return null; }
    });
  }

  directory(workspaceRoot: string): string | undefined {
    const identity = this.identity();
    this.select(workspaceRoot, identity);
    return this.binding?.identity.fingerprint === identity?.fingerprint ? this.binding?.directory : undefined;
  }

  scope(workspaceRoot: string): string {
    const directory = this.directory(workspaceRoot);
    return digest(JSON.stringify([path.resolve(workspaceRoot), this.fingerprint, this.binding?.projectId ?? '', directory ?? '']));
  }

  assertWritable(workspaceRoot: string): void {
    if (this.directory(workspaceRoot) && !this.binding?.canWrite) throw new Error('This team is read-only. Project memories cannot be changed.');
  }

  refresh(workspaceRoot: string, localDirectory: string): Promise<void> {
    const identity = this.identity();
    this.select(workspaceRoot, identity);
    if (!identity) return Promise.resolve();
    const key = `${path.resolve(workspaceRoot)}:${identity.fingerprint}`;
    if (this.refreshing?.key === key) return this.refreshing.promise;
    const generation = this.generation;
    const promise = this.performRefresh(workspaceRoot, localDirectory, identity, generation).finally(() => {
      if (this.refreshing?.promise === promise) this.refreshing = undefined;
    });
    this.refreshing = { key, promise };
    return promise;
  }

  async publish(workspaceRoot: string, _localDirectory: string, expectedDirectory?: string): Promise<void> {
    if (!this.directory(workspaceRoot) || !this.binding) return;
    const binding = this.binding;
    if (expectedDirectory && path.resolve(expectedDirectory) !== path.resolve(binding.directory)) throw new Error('The team project memory scope changed.');
    this.assertWritable(workspaceRoot);
    const log = await withFileLock(path.join(binding.directory, 'events', '.view.lock'), () => this.readLog(binding.directory));
    this.assertCurrent(binding);
    const snapshot = await this.request(binding, log);
    if (!snapshot) return;
    await this.apply(binding, snapshot.log);
  }

  private identity(): Identity | undefined {
    try {
      const config = configSchema.parse(fs.readJsonSync(this.configPath));
      const accountId = process.env.AUTOHAND_ACCOUNT_ID?.trim() || config.api?.accountId?.trim();
      const token = config.auth?.token;
      if (!token || !accountId || config.sync?.enabled === false) return;
      if (config.sync?.exclude?.some(pattern => minimatch('memory/events/LOG.jsonl', pattern) || minimatch('memory/', pattern))) return;
      const base = new URL(process.env.AUTOHAND_API_URL?.trim() || config.api?.baseUrl?.trim() || 'https://api.autohand.ai');
      if (base.username || base.password || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) return;
      const tokenHash = digest(token);
      return { accountId, token, tokenHash, base, fingerprint: digest(JSON.stringify([accountId, tokenHash, base.href])) };
    } catch { return; }
  }

  private select(workspaceRoot: string, identity: Identity | undefined): void {
    const workspace = path.resolve(workspaceRoot);
    if (this.workspaceRoot !== workspace || this.fingerprint !== (identity?.fingerprint ?? '')) {
      this.generation++;
      this.binding = undefined;
      this.workspaceRoot = workspace;
      this.fingerprint = identity?.fingerprint ?? '';
    }
  }

  private assertCurrent(binding: Binding): void {
    if (binding.generation !== this.generation || binding.workspaceRoot !== this.workspaceRoot || this.identity()?.fingerprint !== binding.identity.fingerprint) {
      throw new Error('The team project memory scope changed. Retry in the current account/project.');
    }
  }

  private async assertRepositoryCurrent(binding: Binding): Promise<void> {
    this.assertCurrent(binding);
    const repository = normalizeProjectRepository(await this.getRepository(binding.workspaceRoot) ?? '');
    this.assertCurrent(binding);
    if (!repository || digest(repository) !== binding.projectId) {
      this.binding = undefined;
      this.generation++;
      throw new Error('The project memory repository changed. Retry in the current project.');
    }
  }

  private async performRefresh(workspaceRoot: string, localDirectory: string, identity: Identity, generation: number): Promise<void> {
    const repository = normalizeProjectRepository(await this.getRepository(workspaceRoot) ?? '');
    if (!repository) { if (generation === this.generation) this.binding = undefined; return; }
    const projectId = digest(repository);
    if (this.binding?.projectId !== projectId) this.binding = undefined;
    const directory = path.join(this.root, '.project-memories', digest(path.resolve(this.configPath)), digest(identity.base.origin), digest(identity.accountId), projectId, 'memory');
    const scopeFile = path.join(path.dirname(directory), 'scope.json');
    await assertCommunityPathSymlinkSafe(this.root, path.join(directory, 'events', 'LOG.jsonl'), 'team project memory cache');
    await assertCommunityPathSymlinkSafe(this.root, scopeFile, 'team project memory scope');
    const previous = scopeSchema.safeParse(await fs.readJson(scopeFile).catch(() => null));
    const matching = previous.success && !previous.data.revoked && previous.data.accountId === identity.accountId && previous.data.projectId === projectId && previous.data.tokenHash === identity.tokenHash;
    const binding: Binding = { accountId: identity.accountId, projectId, tokenHash: identity.tokenHash,
      canWrite: matching ? previous.data.canWrite : false, seeded: matching ? previous.data.seeded : false,
      directory, workspaceRoot: path.resolve(workspaceRoot), identity, generation };
    this.assertCurrent(binding);
    if (matching) this.binding = binding;
    const snapshot = await this.request(binding);
    if (!snapshot) return;
    binding.canWrite = snapshot.canWrite;
    let incoming = snapshot.log;
    if (!binding.seeded && binding.canWrite) incoming = mergeMemoryEventLogContents(incoming, await this.seedLog(workspaceRoot, localDirectory));
    binding.seeded = true;
    await this.apply(binding, incoming);
    this.binding = binding;
    const local = await this.readLog(directory);
    if (binding.canWrite && mergeMemoryEventLogContents(snapshot.log, local) !== snapshot.log) await this.publish(workspaceRoot, localDirectory, directory);
  }

  private async request(binding: Binding, log?: string): Promise<Snapshot | undefined> {
    await this.assertRepositoryCurrent(binding);
    const response = await fetch(new URL(`/v1/project-memories/${binding.projectId}`, binding.identity.base), {
      method: log === undefined ? 'GET' : 'PUT', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${binding.identity.token}`, 'X-Autohand-Account-Id': binding.accountId, ...(log === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(log === undefined ? {} : { body: JSON.stringify({ log: validateProjectLog(log) }) }),
    });
    if (!response.ok) {
      discardResponseBody(response);
      if ([401, 403, 404].includes(response.status) && binding.generation === this.generation) {
        this.binding = undefined;
        this.assertCurrent(binding);
        const scopeFile = path.join(path.dirname(binding.directory), 'scope.json');
        await assertCommunityPathSymlinkSafe(this.root, scopeFile, 'revoked team project memory scope');
        await fs.ensureDir(path.dirname(scopeFile));
        await atomicWriteJson(scopeFile, { accountId: binding.accountId, projectId: binding.projectId,
          tokenHash: binding.tokenHash, canWrite: false, seeded: true, revoked: true }, { beforeCommit: () => this.assertCurrent(binding) });
      }
      if (response.status === 404) return;
      throw new Error(`Team project memory sync failed (${response.status}). Check your selected account and connection.`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Team project memory response was empty.');
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_LOG_BYTES * 3) throw new Error('Team project memory response exceeds the size limit.');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    await this.assertRepositoryCurrent(binding);
    const snapshot = snapshotSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (snapshot.accountId !== binding.accountId || snapshot.projectId !== binding.projectId) throw new Error('Team project memory response belongs to a different account/project scope.');
    validateProjectLog(snapshot.log);
    return snapshot;
  }

  private async readLog(directory: string): Promise<string> {
    const file = path.join(directory, 'events', 'LOG.jsonl');
    const stat = await fs.stat(file).catch(() => null);
    if (stat && stat.size > MAX_LOG_BYTES) throw new Error('Team project memory log exceeds 10 MiB.');
    return validateProjectLog(await fs.readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return ''; throw error;
    }));
  }

  private async seedLog(workspaceRoot: string, directory: string): Promise<string> {
    await assertCommunityPathSymlinkSafe(workspaceRoot, path.join(directory, 'events', 'LOG.jsonl'), 'local project memory');
    const log = await this.readLog(directory);
    if (log) return log;
    const events: string[] = [];
    for (const name of await fs.readdir(directory).catch(() => [] as string[])) {
      if (!name.endsWith('.json') || name === 'index.json') continue;
      const file = path.join(directory, name);
      await assertCommunityPathSymlinkSafe(workspaceRoot, file, 'local project memory entry');
      const stat = await fs.stat(file);
      if (stat.size > MAX_LOG_BYTES) throw new Error('Local project memory entry exceeds the size limit.');
      const entry: unknown = await fs.readJson(file);
      const fields = z.object({ id: z.string(), updatedAt: z.string() }).parse(entry);
      events.push(JSON.stringify({ version: 1, eventId: `seed-${digest(JSON.stringify(entry))}`, operation: 'snapshot', level: 'project', memoryId: fields.id, occurredAt: fields.updatedAt, entry }));
    }
    return validateProjectLog(events.length ? `${events.join('\n')}\n` : '');
  }

  private async apply(binding: Binding, incoming: string): Promise<void> {
    this.assertCurrent(binding);
    const file = path.join(binding.directory, 'events', 'LOG.jsonl');
    await assertCommunityPathSymlinkSafe(this.root, file, 'team project memory cache');
    await fs.ensureDir(path.dirname(file));
    await withFileLock(path.join(binding.directory, 'events', '.view.lock'), async () => {
      this.assertCurrent(binding);
      await withFileLock(path.join(binding.directory, 'events', '.LOG.jsonl.lock'), async () => {
        const merged = validateProjectLog(mergeMemoryEventLogContents(await this.readLog(binding.directory), incoming));
        await atomicWriteFile(file, merged, { beforeCommit: () => this.assertCurrent(binding) });
      });
      this.assertCurrent(binding);
      await materializeMemoryProjection(binding.directory, await new MemoryEventLog(binding.directory).replay());
      this.assertCurrent(binding);
      await atomicWriteJson(path.join(path.dirname(binding.directory), 'scope.json'), {
        accountId: binding.accountId, projectId: binding.projectId, tokenHash: binding.tokenHash, canWrite: binding.canWrite, seeded: binding.seeded,
      }, { beforeCommit: () => this.assertCurrent(binding) });
    });
  }
}
