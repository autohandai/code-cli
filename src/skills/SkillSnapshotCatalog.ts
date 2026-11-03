import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { readSkillPackage, type SkillReference, type SkillResourceDigest } from './SkillRuntime.js';
import { computeSkillRevision, createSkillRevisionManifest } from './SkillRevisionStore.js';

interface SnapshotEnrollment { reference: SkillReference; scope: string }
interface SnapshotCatalogOptions { managed?: boolean }

const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const REVISION = /^sha256:[a-f0-9]{64}$/;
const PROJECT_AUTHORITY = /^local:workspace:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):(.+)$/i;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const code = (error: unknown): string => record(error) ? String(error.code ?? '') : '';

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 4096
    && !/[\u0000-\u001f\u007f]/u.test(value) && !value.split(/[\\/]/u).some(part => part === '.' || part === '..');
}

function contained(root: string, filename: string): boolean {
  const relative = path.relative(root, filename);
  return relative !== '' && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

async function readHostManifest(filename: string): Promise<unknown> {
  const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_MANIFEST_BYTES || (before.mode & 0o022) !== 0
      || (typeof process.getuid === 'function' && before.uid !== process.getuid())) throw new Error('Unsafe host skill snapshot manifest ownership, permissions or size.');
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const buffer = Buffer.allocUnsafe(64 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > MAX_MANIFEST_BYTES) throw new Error('Host skill snapshot manifest exceeds its byte budget.');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    const current = await lstat(filename);
    if (current.isSymbolicLink() || current.ino !== before.ino || current.size !== before.size || current.mtimeMs !== before.mtimeMs || total !== before.size) throw new Error('Host skill snapshot manifest changed during retrieval.');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { await handle.close(); }
}

async function rejectSymbolicResources(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || ['.git', '.hg'].includes(entry.name)) throw new Error('Unsafe symbolic or VCS snapshot resource.');
    if (entry.isDirectory()) await rejectSymbolicResources(path.join(directory, entry.name));
  }
}

function referenceFrom(value: unknown): SkillReference & { revision: string } {
  if (!record(value) || !identifier(value.authority) || !identifier(value.packageId) || typeof value.revision !== 'string' || !REVISION.test(value.revision)
    || (value.resource !== undefined && !identifier(value.resource))) throw new Error('Invalid exact snapshot reference.');
  return { authority: value.authority, packageId: value.packageId, revision: value.revision, ...(typeof value.resource === 'string' ? { resource: value.resource } : {}) };
}

function resourcesFrom(value: unknown): SkillResourceDigest[] {
  if (!Array.isArray(value)) throw new Error('Invalid snapshot resource manifest.');
  return value.map((resource: unknown) => {
    if (!record(resource) || typeof resource.path !== 'string' || typeof resource.sha256 !== 'string' || typeof resource.bytes !== 'number') throw new Error('Invalid snapshot resource digest.');
    return { path: resource.path, sha256: resource.sha256, bytes: resource.bytes };
  });
}

export class SkillSnapshotCatalog {
  private enrolled = new Map<string, SnapshotEnrollment>();
  private managedState: boolean;
  private refreshEpoch = 0;

  constructor(private readonly userSkillsDir: string, options: SnapshotCatalogOptions = {}) {
    this.managedState = options.managed === true;
  }

  get managed(): boolean { return this.managedState; }

  async refresh(): Promise<void> {
    const epoch = ++this.refreshEpoch;
    this.enrolled.clear();
    const filename = path.join(this.userSkillsDir, 'installed-skills.json');
    let info;
    try { info = await lstat(filename); }
    catch (error) { if (code(error) === 'ENOENT') return; throw new Error('Cannot read the host skill snapshot manifest.', { cause: error }); }
    this.managedState = true;
    try {
      if (!info.isFile() || info.isSymbolicLink() || (await lstat(this.userSkillsDir)).isSymbolicLink()) throw new Error('Unsafe host skill snapshot manifest location.');
      const saved = await readHostManifest(filename);
      if (!record(saved) || saved.version !== 1 || !Array.isArray(saved.installed)) throw new Error('Invalid host skill snapshot metadata.');
      const root = await realpath(this.userSkillsDir);
      const ownerId = path.basename(path.dirname(path.resolve(this.userSkillsDir)));
      const next = new Map<string, SnapshotEnrollment>();
      const conflicted = new Set<string>();
      for (const row of saved.installed) {
        try {
          if (!record(row) || row.ownerId !== ownerId || !/^[a-z0-9_-]{1,128}$/i.test(ownerId) || row.enabled === false
            || (row.status !== undefined && row.status !== 'installed' && row.status !== 'present')
            || typeof row.dir !== 'string' || !path.isAbsolute(row.dir) || typeof row.path !== 'string'
            || path.resolve(row.path) !== path.join(path.resolve(row.dir), 'SKILL.md')) continue;
          const declaredDir = path.resolve(row.dir);
          if ((await lstat(declaredDir)).isSymbolicLink()) continue;
          const directory = await realpath(declaredDir);
          if (!contained(root, directory) || (await lstat(row.path)).isSymbolicLink()) continue;
          const reference = referenceFrom(row.reference);
          let scope: string;
          if (row.scope === 'member') scope = `member:${ownerId}`;
          else if (row.scope === 'team') scope = 'team';
          else if (row.scope === 'project') {
            const authority = PROJECT_AUTHORITY.exec(reference.authority);
            if (!authority || !identifier(authority[2]) || authority[2].includes('\\') || authority[2].split('/').some(part => !part)) continue;
            scope = `project:${authority[1]}`;
          } else continue;
          if (!record(row.manifest) || row.manifest.version !== 1 || row.manifest.revision !== reference.revision
            || computeSkillRevision(resourcesFrom(row.manifest.resources)) !== reference.revision) continue;
          await rejectSymbolicResources(directory);
          const files = await readSkillPackage(directory);
          if (computeSkillRevision(createSkillRevisionManifest(files)) !== reference.revision || !files.has(reference.resource || 'SKILL.md')) continue;
          const enrollment = { reference, scope };
          const keys = [...new Set([path.resolve(row.path), path.join(directory, 'SKILL.md')])];
          if (keys.some(key => next.has(key) || conflicted.has(key))) {
            const previous = new Set(keys.map(key => next.get(key)).filter(entry => entry !== undefined));
            for (const [key, entry] of next) if (previous.has(entry)) { next.delete(key); conflicted.add(key); }
            for (const key of keys) { next.delete(key); conflicted.add(key); }
            continue;
          }
          for (const key of keys) next.set(key, enrollment);
        } catch { continue; }
      }
      if (epoch === this.refreshEpoch) this.enrolled = next;
    } catch (error) { throw new Error('Host skill snapshot manifest is unavailable or invalid; managed discovery remains restricted.', { cause: error }); }
  }

  referenceFor(skillPath: string): SkillReference | null {
    const entry = this.enrolled.get(path.resolve(skillPath));
    return entry ? { ...entry.reference } : null;
  }

  scopeFor(skillPath: string): string | null { return this.enrolled.get(path.resolve(skillPath))?.scope ?? null; }

  authorizedScopes(workspaceId: string): ReadonlySet<string> {
    return new Set([...this.enrolled.values()].map(entry => entry.scope).filter(scope => !scope.startsWith('project:') || scope === `project:${workspaceId}`));
  }

  isEnrolled(skillPath: string): boolean { return this.enrolled.has(path.resolve(skillPath)); }
}
