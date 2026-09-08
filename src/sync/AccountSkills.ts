/** Account-managed skills. This cache is intentionally outside ordinary file sync. */
import fs from 'fs-extra';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AUTOHAND_HOME } from '../constants.js';
import { atomicRemoveFile, atomicWriteFile, atomicWriteJson, withFileLock } from '../utils/atomicFile.js';
import { assertCommunityPathSymlinkSafe } from '../skills/communitySkillPaths.js';
import type { SkillDefinition } from '../skills/types.js';
import type { LoadedConfig } from '../types.js';

const identifier = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/);
const snapshotSchema = z.object({
  accountId: z.string().min(1).max(200), revision: z.number().int().nonnegative(),
  skills: z.array(z.object({ id: identifier, name: identifier, description: z.string().min(1).max(1024),
    instructions: z.string().min(1).max(100_000), enabled: z.boolean(), source: z.enum(['custom', 'registry']) })).max(500),
}).refine(value => new Set(value.skills.map(skill => skill.name)).size === value.skills.length
  && new Set(value.skills.map(skill => skill.id)).size === value.skills.length
  && value.skills.reduce((size, skill) => size + skill.instructions.length, 0) <= 4_000_000, 'Invalid account skill snapshot');
const cacheSchema = snapshotSchema.and(z.object({ tokenHash: z.string(), requestedAccountId: z.string(), configPath: z.string() }));
const authConfigSchema = z.object({ auth: z.object({ token: z.string().optional() }).optional(), api: z.object({ accountId: z.string().optional() }).optional() });
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const cachePath = (root: string, configPath = path.join(root, 'config.json')) => path.resolve(configPath) === path.resolve(root, 'config.json')
  ? path.join(root, '.account-skills', 'snapshot.json')
  : path.join(root, '.account-skills', 'profiles', digest(path.resolve(configPath)), 'snapshot.json');
const skillPath = (root: string, accountId: string, id: string, configPath?: string) => path.join(path.dirname(cachePath(root, configPath)), digest(accountId), id, 'SKILL.md');
type ManagedView = { names: Set<string>; enabled: SkillDefinition[] };
type CachedSnapshot = z.infer<typeof cacheSchema>;
const memo = new Map<string, { fingerprint: string; raw: CachedSnapshot; view: ManagedView }>();
const authMemo = new Map<string, { fingerprint: string; tokenHash: string; requestedAccountId: string }>();

/** Re-check local auth/account and the cache on use, so a running agent sees revocations. */
export function readAccountSkills(root: string, configPath = path.join(root, 'config.json')): ManagedView {
  const empty = { names: new Set<string>(), enabled: [] };
  try {
    const file = cachePath(root, configPath);
    const stat = fs.statSync(file);
    if (stat.size > 20_000_000) return empty;
    const fingerprint = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}:${stat.size}`;
    const previous = memo.get(file);
    const raw = previous?.fingerprint === fingerprint ? previous.raw : cacheSchema.parse(fs.readJsonSync(file));
    if (path.resolve(raw.configPath) !== path.resolve(configPath)) return empty;
    const configStat = fs.statSync(raw.configPath);
    const configFingerprint = `${configStat.mtimeMs}:${configStat.ctimeMs}:${configStat.ino}:${configStat.size}:${process.env.AUTOHAND_ACCOUNT_ID ?? ''}`;
    let auth = authMemo.get(raw.configPath);
    if (auth?.fingerprint !== configFingerprint) {
      const config = authConfigSchema.parse(fs.readJsonSync(raw.configPath));
      auth = { fingerprint: configFingerprint, tokenHash: config.auth?.token ? digest(config.auth.token) : '',
        requestedAccountId: config.api?.accountId?.trim() || process.env.AUTOHAND_ACCOUNT_ID?.trim() || '' };
      authMemo.set(raw.configPath, auth);
    }
    if (!auth.tokenHash || auth.tokenHash !== raw.tokenHash || auth.requestedAccountId !== raw.requestedAccountId) return empty;
    if (previous?.fingerprint === fingerprint) return previous.view;
    const view = { names: new Set(raw.skills.map(skill => skill.name)), enabled: raw.skills.filter(skill => skill.enabled).map(skill => ({
      name: skill.name, description: skill.description, body: skill.instructions,
      source: 'autohand-user' as const, path: skillPath(root, raw.accountId, skill.id, configPath),
      isActive: previous?.view.enabled.find(old => old.name === skill.name && old.body === skill.instructions)?.isActive ?? false,
    })) };
    memo.set(file, { fingerprint, raw, view }); return view;
  } catch { return empty; }
}

export async function syncAccountSkills(config: LoadedConfig, token: string, deviceId: string, options: { root?: string; signal?: AbortSignal } = {}): Promise<void> {
  if (config.sync?.enabled === false) return;
  const root = options.root ?? AUTOHAND_HOME;
  const base = new URL(config.api?.baseUrl?.trim() || process.env.AUTOHAND_API_URL?.trim() || 'https://api.autohand.ai');
  if (base.username || base.password || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) throw new Error('Invalid account skills API URL');
  const requestedAccountId = config.api?.accountId?.trim() || process.env.AUTOHAND_ACCOUNT_ID?.trim() || '';
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(requestedAccountId ? { 'X-Autohand-Account-Id': requestedAccountId } : {}) };
  const timeout = AbortSignal.timeout(20_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await fetch(new URL('/v1/skill-library', base), { headers, signal, redirect: 'error' });
  // A pre-rollout API must not break existing connector and file synchronization.
  if (response.status === 404) return;
  if (!response.ok) throw new Error(`Account skill sync failed (${response.status})`);
  if (!response.body) throw new Error('Account skill sync response was empty');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > 20_000_000) throw new Error('Account skill snapshot exceeded the size limit'); chunks.push(value); }
  } finally { await reader.cancel(); }
  const snapshot = snapshotSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  if (requestedAccountId && requestedAccountId !== snapshot.accountId) throw new Error('Account skill snapshot belongs to a different account');
  const destination = cachePath(root, config.configPath);
  const cacheRoot = await fs.lstat(path.dirname(destination)).catch(() => null);
  if (cacheRoot?.isSymbolicLink()) throw new Error('Account skill cache root must not be a symlink');
  await assertCommunityPathSymlinkSafe(root, destination, 'account skill cache');
  await fs.ensureDir(path.dirname(destination));
  await withFileLock(`${destination}.lock`, async () => {
    signal.throwIfAborted();
    const previous = cacheSchema.safeParse(await fs.readJson(destination).catch(() => null));
    if (previous.success && previous.data.accountId === snapshot.accountId && previous.data.revision > snapshot.revision) throw new Error('Account skill revision is older than the local cache');
    for (const skill of snapshot.skills) {
      if (!skill.enabled) continue;
      const file = skillPath(root, snapshot.accountId, skill.id, config.configPath);
      await assertCommunityPathSymlinkSafe(root, file, 'account skill file');
      await fs.ensureDir(path.dirname(file));
      // Quoted JSON scalars are valid YAML and cannot inject extra frontmatter fields.
      await atomicWriteFile(file, `---\nname: ${JSON.stringify(skill.name)}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n${skill.instructions}\n`, { beforeCommit: () => signal.throwIfAborted() });
    }
    await atomicWriteJson(destination, { ...snapshot, tokenHash: digest(token), requestedAccountId, configPath: config.configPath }, { beforeCommit: () => signal.throwIfAborted() });
    if (previous.success) {
      for (const skill of previous.data.skills) {
        if (previous.data.accountId === snapshot.accountId && snapshot.skills.some(next => next.id === skill.id && next.enabled)) continue;
        const file = skillPath(root, previous.data.accountId, skill.id, config.configPath);
        await assertCommunityPathSymlinkSafe(root, file, 'removed account skill file');
        await atomicRemoveFile(file);
      }
    }
  });
  // Only acknowledge after the complete local snapshot commits. Missing records revoke
  // account-managed skills; independently installed/project skills are never deleted.
  const acknowledged = await fetch(new URL('/v1/skill-library/ack', base), { method: 'POST', headers, signal, redirect: 'error', body: JSON.stringify({ deviceId, revision: snapshot.revision }) });
  if (!acknowledged.ok) throw new Error(`Account skill acknowledgement failed (${acknowledged.status})`);
}
