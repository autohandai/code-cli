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

export async function prepareSessionDiskFullScenario(
  workspaceRoot: string,
  autohandHome: string,
  responseMarker: string,
): Promise<{ preload: string; attemptsPath: string; recover: () => Promise<void> }> {
  const attemptsPath = path.join(workspaceRoot, 'session-disk-full.attempts');
  const recoveredPath = path.join(workspaceRoot, 'session-disk-full.recovered');
  const preloadPath = path.join(workspaceRoot, 'session-disk-full.mjs');
  await writeFile(preloadPath, `import { promises as nodeFs, existsSync, readFileSync, appendFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
const originalOpen = nodeFs.open;
nodeFs.open = async function(target, ...options) {
  const file = String(target);
  const conversation = join(dirname(file), 'conversation.jsonl');
  if (!existsSync(${JSON.stringify(recoveredPath)}) && file.startsWith(${JSON.stringify(autohandHome + path.sep)})
    && basename(file).startsWith('.metadata.json.') && existsSync(conversation)) {
    const lines = readFileSync(conversation, 'utf8').trim().split('\\n');
    const last = JSON.parse(lines[lines.length - 1] || '{}');
    if (last.role === 'assistant' && String(last.content).includes(${JSON.stringify(responseMarker)})) {
      appendFileSync(${JSON.stringify(attemptsPath)}, 'session metadata blocked\\n');
      throw Object.assign(new Error('ENOSPC: no space left on device, open ' + file), {
        code: 'ENOSPC', syscall: 'open', path: file,
      });
    }
  }
  return originalOpen.call(this, target, ...options);
};
`);
  return { preload: pathToFileURL(preloadPath).href, attemptsPath, recover: () => writeFile(recoveredPath, '') };
}
