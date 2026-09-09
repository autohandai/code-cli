import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { minimatch } from 'minimatch';
import { z } from 'zod';
import { getUserSkillLocations } from '../constants.js';
import { SkillParser } from '../skills/SkillParser.js';
import { assertCommunityPathSymlinkSafe } from '../skills/communitySkillPaths.js';
import { atomicWriteJson } from '../utils/atomicFile.js';
import type { AccountSkillSnapshot } from './AccountSkills.js';

const localSkillSchema = z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/), description: z.string().trim().min(1).max(1024), instructions: z.string().trim().min(1).max(32_000) });
type LocalSkill = z.infer<typeof localSkillSchema> & { origin: string };
const recordsSchema = z.record(z.string(), z.object({ id: z.string(), hash: z.string(), origin: z.string() }));
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const fingerprint = (skill: { name: string; description: string; instructions: string }) => digest(JSON.stringify([skill.name, skill.description, skill.instructions]));

async function discover(root: string, homeDir: string, exclude: string[], signal: AbortSignal) {
  const found = new Map<string, LocalSkill>();
  const parser = new SkillParser();
  let visited = 0;
  for (const location of getUserSkillLocations(homeDir, path.join(root, 'skills'))) {
    const rootStat = await fs.lstat(location.basePath).catch(() => null);
    if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) continue;
    const pending = [{ directory: location.basePath, depth: 0 }];
    while (pending.length && visited < 5000) {
      signal.throwIfAborted();
      const entry = pending.shift()!;
      visited++;
      for (const file of await fs.readdir(entry.directory, { withFileTypes: true }).catch(() => [])) {
        if (file.isSymbolicLink() || file.name.startsWith('.')) continue;
        const fullPath = path.join(entry.directory, file.name);
        const relative = path.relative(location.basePath, fullPath).split(path.sep).join('/');
        if (exclude.some(pattern => [`skills/${relative}`, path.relative(homeDir, fullPath).split(path.sep).join('/')].some(value => value.startsWith(pattern) || minimatch(value, pattern, { dot: true })))) continue;
        if (file.isDirectory() && entry.depth < (location.recursive ? 6 : 1)) { pending.push({ directory: fullPath, depth: entry.depth + 1 }); continue; }
        if (!file.isFile() || file.name !== 'SKILL.md' || found.size >= 500) continue;
        await assertCommunityPathSymlinkSafe(location.basePath, fullPath, 'local skill upload');
        const handle = await fs.open(fullPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => null);
        if (handle === null) continue;
        try {
          const stat = await fs.fstat(handle);
          if (!stat.isFile() || stat.size > 40_000) continue;
          const buffer = Buffer.alloc(40_001);
          const { bytesRead } = await fs.read(handle, buffer, 0, buffer.length, 0);
          if (bytesRead > 40_000) continue;
          const parsed = parser.parseContent(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)), fullPath, location.source);
          if (!parsed.success || !parsed.skill) continue;
          const skill = localSkillSchema.safeParse({ ...parsed.skill, instructions: parsed.skill.body });
          if (skill.success && Buffer.byteLength(skill.data.instructions) <= 32_000) found.set(skill.data.name, { ...skill.data, origin: digest(fullPath) });
        } catch { /* Invalid or concurrently replaced local files do not break account downloads. */ }
        finally { await fs.close(handle); }
      }
    }
  }
  return [...found.values()];
}

export async function syncLocalSkillLibrary(options: {
  root: string; cacheDirectory: string; homeDir?: string; exclude?: string[]; snapshot: AccountSkillSnapshot;
  base: URL; headers: Record<string, string>; signal: AbortSignal; refresh: () => Promise<AccountSkillSnapshot>;
}): Promise<AccountSkillSnapshot> {
  const { root, cacheDirectory, base, signal } = options;
  const file = path.join(cacheDirectory, digest(options.snapshot.accountId), 'local-uploads.json');
  await assertCommunityPathSymlinkSafe(root, file, 'local skill upload state');
  const previous = recordsSchema.safeParse(await fs.readJson(file).catch(() => null));
  const records = previous.success ? previous.data : {};
  const locals = await discover(root, options.homeDir ?? os.homedir(), options.exclude ?? [], signal);
  let snapshot = options.snapshot;
  const headers = { ...options.headers, 'X-Autohand-Account-Id': snapshot.accountId };
  for (const local of locals) {
    signal.throwIfAborted();
    const existing = snapshot.skills.find(skill => skill.name === local.name);
    const record = records[local.name];
    const hash = fingerprint(local);
    // Only this device's last unchanged upload may be updated. Cloud edits,
    // disable/removal and independently created names remain authoritative.
    if (existing && (!record || existing.id !== record.id || record.origin !== local.origin || !existing.enabled || fingerprint(existing) !== record.hash || record.hash === hash)) continue;
    if (!existing && record) continue;
    const { origin, ...input } = local;
    const response = await fetch(new URL('/v1/skill-library' + (existing ? `/${encodeURIComponent(existing.id)}` : ''), base), {
      method: existing ? 'PATCH' : 'POST', headers, signal, redirect: 'error',
      body: JSON.stringify({ ...input, source: 'custom', enabled: true, ...(existing ? { expectedRevision: snapshot.revision } : {}) }),
    });
    if (response.status === 409) { snapshot = await options.refresh(); continue; }
    if (response.status === 403) return snapshot;
    if (!response.ok) throw new Error(`Local skill upload failed (${response.status})`);
    const saved = z.object({ skill: localSkillSchema.extend({ id: z.string().min(1), enabled: z.boolean() }) }).parse(await response.json()).skill;
    if (fingerprint(saved) !== hash || !saved.enabled) throw new Error('The saved skill differs from the local upload');
    records[local.name] = { id: saved.id, hash, origin };
    await fs.ensureDir(path.dirname(file));
    await atomicWriteJson(file, records, { beforeCommit: () => signal.throwIfAborted() });
    snapshot = await options.refresh();
  }
  return snapshot;
}
