import { execFileSync } from 'node:child_process';
import { copyFileSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const cursorState = `
const getActiveCursor = () => (cursorDirty ? cursorPosition : undefined);
const activeCursor = cursorDirty ? cursorPosition : undefined;
`;
const originalSource = `function standard() {${cursorState}}\nfunction incremental() {${cursorState}}\n`;

function createInstall(version = '7.1.1', source = originalSource) {
  const root = mkdtempSync(join(tmpdir(), 'autohand-ink-install-'));
  roots.push(root);
  const cliRoot = join(root, 'node_modules', 'autohand-cli');
  const inkRoot = join(root, 'node_modules', 'ink');
  const script = join(cliRoot, 'scripts', 'ensure-ink-cursor-intent.mjs');
  const logUpdate = join(inkRoot, 'build', 'log-update.js');
  mkdirSync(dirname(script), { recursive: true });
  mkdirSync(dirname(logUpdate), { recursive: true });
  copyFileSync(resolve('scripts/ensure-ink-cursor-intent.mjs'), script);
  writeFileSync(join(inkRoot, 'package.json'), JSON.stringify({ name: 'ink', version, main: 'build/index.js' }));
  writeFileSync(join(inkRoot, 'build', 'index.js'), '');
  writeFileSync(logUpdate, source);
  return { root, cliRoot, script, logUpdate };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Ink cursor repair installation', () => {
  it('ships and runs the repair for the pinned Ink version', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(manifest.dependencies.ink).toBe('7.1.1');
    expect(manifest.files).toContain('scripts/ensure-ink-cursor-intent.mjs');
    expect(manifest.scripts.postinstall).toContain('node scripts/ensure-ink-cursor-intent.mjs');
  });

  it('repairs an npm-style install atomically without changing a shared cache hardlink', () => {
    const install = createInstall();
    const cachedFile = join(install.root, 'cached-log-update.js');
    linkSync(install.logUpdate, cachedFile);
    execFileSync(process.execPath, [install.script], { cwd: install.cliRoot });

    expect(readFileSync(cachedFile, 'utf8')).toBe(originalSource);
    expect(readFileSync(install.logUpdate, 'utf8')).not.toContain('cursorDirty ? cursorPosition : undefined');
    const firstWrite = statSync(install.logUpdate);
    execFileSync(process.execPath, [install.script], { cwd: install.cliRoot });
    expect(statSync(install.logUpdate).ino).toBe(firstWrite.ino);
    expect(statSync(install.logUpdate).mtimeMs).toBe(firstWrite.mtimeMs);
  });

  it.each([
    ['8.0.0', originalSource],
    ['7.1.1', `${originalSource}\n${cursorState}`],
    ['7.1.1', 'unexpected renderer'],
  ])('rejects unsupported Ink %s source without rewriting it', (version, source) => {
    const install = createInstall(version, source);
    expect(() => execFileSync(process.execPath, [install.script], {
      cwd: install.cliRoot,
      stdio: 'pipe',
    })).toThrow();
    expect(readFileSync(install.logUpdate, 'utf8')).toBe(source);
  });
});
