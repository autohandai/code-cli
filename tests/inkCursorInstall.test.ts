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
const overflowGuard = 'if (shouldClearTerminal && !hasStaticOutput && !this.log.willRender(outputToRender)) {\n            return;\n        }\n        if (shouldClearTerminal) {';
const originalInkSource = `class Ink {
    renderInteractiveFrame(output, outputHeight, staticOutput) {
        const hasStaticOutput = staticOutput !== '';
        const shouldClearTerminal = shouldClearTerminalForFrame({ isTty });
        if (shouldClearTerminal) {
            const sync = this.shouldSync();
        }
    }
}
`;

function createInstall(version = '7.1.1', source = originalSource, inkSource = originalInkSource) {
  const root = mkdtempSync(join(tmpdir(), 'autohand-ink-install-'));
  roots.push(root);
  const cliRoot = join(root, 'node_modules', 'autohand-cli');
  const inkRoot = join(root, 'node_modules', 'ink');
  const script = join(cliRoot, 'scripts', 'ensure-ink-cursor-intent.mjs');
  const logUpdate = join(inkRoot, 'build', 'log-update.js');
  const inkFile = join(inkRoot, 'build', 'ink.js');
  mkdirSync(dirname(script), { recursive: true });
  mkdirSync(dirname(logUpdate), { recursive: true });
  copyFileSync(resolve('scripts/ensure-ink-cursor-intent.mjs'), script);
  writeFileSync(join(inkRoot, 'package.json'), JSON.stringify({ name: 'ink', version, main: 'build/index.js' }));
  writeFileSync(join(inkRoot, 'build', 'index.js'), '');
  writeFileSync(logUpdate, source);
  writeFileSync(inkFile, inkSource);
  return { root, cliRoot, script, logUpdate, inkFile };
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

  it('skips the overflow clear-and-rewrite when the frame is unchanged', () => {
    // Ink 7.1.1 clears the screen and scrollback on every React commit once
    // the frame is taller than the viewport, even when nothing changed, which
    // throws away the reader's scroll position while idle.
    const install = createInstall();
    execFileSync(process.execPath, [install.script], { cwd: install.cliRoot });

    const patched = readFileSync(install.inkFile, 'utf8');
    expect(patched).toContain(overflowGuard);
    expect(patched.split('if (shouldClearTerminal) {')).toHaveLength(2);
    const firstWrite = statSync(install.inkFile);
    execFileSync(process.execPath, [install.script], { cwd: install.cliRoot });
    expect(readFileSync(install.inkFile, 'utf8')).toBe(patched);
    expect(statSync(install.inkFile).mtimeMs).toBe(firstWrite.mtimeMs);
  });

  it('rejects an Ink renderer whose overflow branch is not the expected one', () => {
    const install = createInstall('7.1.1', originalSource, 'class Ink { renderInteractiveFrame() {} }\n');
    expect(() => execFileSync(process.execPath, [install.script], {
      cwd: install.cliRoot,
      stdio: 'pipe',
    })).toThrow();
    expect(readFileSync(install.logUpdate, 'utf8')).toBe(originalSource);
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
