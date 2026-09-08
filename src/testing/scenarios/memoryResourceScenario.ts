import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function prepareMemoryDiskFullScenario(workspaceRoot: string): Promise<{
  preload: string;
  attemptsPath: string;
  arm: () => Promise<void>;
}> {
  const memoryDirectory = path.join(workspaceRoot, '.autohand', 'memory');
  await mkdir(memoryDirectory, { recursive: true });
  await writeFile(path.join(memoryDirectory, 'existing.json'), JSON.stringify({
    id: 'existing',
    content: 'Preserve the existing project convention',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  }));
  const armedPath = path.join(workspaceRoot, 'memory-disk-full.armed');
  const attemptsPath = path.join(workspaceRoot, 'memory-disk-full.attempts');
  const preloadPath = path.join(workspaceRoot, 'memory-disk-full.mjs');
  await writeFile(preloadPath, `import { promises as nodeFs, existsSync, appendFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
const originalMkdir = nodeFs.mkdir;
nodeFs.mkdir = async function(target, ...options) {
  const file = String(target);
  if (existsSync(${JSON.stringify(armedPath)})
    && basename(file) === '.LOG.jsonl.lock'
    && basename(dirname(dirname(file))) === 'memory') {
    appendFileSync(${JSON.stringify(attemptsPath)}, file + '\\n');
    throw Object.assign(new Error('ENOSPC: no space left on device, mkdir ' + file), {
      code: 'ENOSPC', syscall: 'mkdir', path: file,
    });
  }
  return originalMkdir.call(this, target, ...options);
};
`);
  return {
    preload: pathToFileURL(preloadPath).href,
    attemptsPath,
    arm: async () => writeFile(armedPath, ''),
  };
}
