import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SyncService } from '../../src/sync/SyncService.js';
import type { SyncManifest } from '../../src/sync/types.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.remove(root))); });
describe('learning evidence sync isolation', () => {
  it('keeps private learning, coordination and revision stores out of actual manifests while retaining user skills', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-learning-sync-'));
    roots.push(root);
    for (const file of ['learning/learning.json', 'resources/state.json', 'skills/.revisions/archive.json', 'skills/.resources/state.json', 'skills/.learning/evidence.json', 'projects/example/.autohand/learning/learning.json', 'skills/user-authored/SKILL.md']) {
      await fs.outputFile(path.join(root, file), 'fixture-private-data');
    }
    const service = new SyncService({ authToken: 'fixture', userId: 'fixture', config: { enabled: true, interval: 60_000 } });
    const internals = service as unknown as { basePath: string; buildLocalManifest(): Promise<SyncManifest> };
    internals.basePath = root;
    const manifest = await internals.buildLocalManifest();
    expect(manifest.files.map(file => file.path)).toEqual(['skills/user-authored/SKILL.md']);
  });
});
