import { execFileSync } from 'node:child_process';
import { copyFileSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const cursorState = `
const getActiveCursor = () => (cursorDirty ? cursorPosition : undefined);
const activeCursor = cursorDirty ? cursorPosition : undefined;
`;
const originalSource = `function standard() {${cursorState}}\nfunction incremental() {${cursorState}}\n`;
const overflowGuard = 'if (shouldClearTerminal && !hasStaticOutput && !this.log.willRender(outputToRender)) {\n            return;\n        }\n        if (shouldClearTerminal) {';
const originalInkSource = `class Ink {
    resized = () => {
        const currentWidth = getWindowSize(this.options.stdout).columns;
        if (currentWidth < this.lastTerminalWidth) {
            // We clear the screen when decreasing terminal width to prevent duplicate overlapping re-renders.
            this.log.clear();
            this.lastOutput = '';
            this.lastOutputToRender = '';
        }
        this.calculateLayout();
        dom.emitLayoutListeners(this.rootNode);
        this.onRender();
        this.lastTerminalWidth = currentWidth;
    };
    onRender = () => {
        this.hasPendingThrottledRender = false;
        if (this.isUnmounted) {
            return;
        }
        if (this.isSuspended) {
            if (this.nextRenderCommit) {
                this.nextRenderCommit.resolve();
                this.nextRenderCommit = undefined;
            }
            return;
        }
        this.events.push('render');
        this.throttledLog('frame');
    };
    beginSuspend() {
        this.isSuspended = true;
        this.events.push('suspend');
    }
    unmount(error) {
        if (this.isUnmounted || this.isUnmounting) {
            return;
        }
        this.isUnmounting = true;
    }
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

interface ResizeFixture {
  resized(): void;
  onRender(): void;
  unmount(): void;
  beginSuspend(): void;
  lastTerminalWidth: number;
}

function resizeFixture(source: string) {
  const events: string[] = [];
  const pending = new Map<number, () => void>();
  let nextHandle = 0;
  let frame: string | undefined;
  const stdout = { columns: 80, rows: 24, write: (text: string) => events.push(text) };
  const throttledLog = Object.assign((text: string) => { frame = text; }, {
    flush: () => {
      if (frame !== undefined) events.push(frame);
      frame = undefined;
    },
    cancel: () => { frame = undefined; },
  });
  const Fixture = runInNewContext(`${source}\nInk`, {
    getWindowSize: (stream: typeof stdout) => stream,
    dom: { emitLayoutListeners: () => events.push('layout') },
    bsu: '\x1b[?2026h',
    esu: '\x1b[?2026l',
    setImmediate: (callback: () => void) => {
      const handle = ++nextHandle;
      pending.set(handle, callback);
      return handle;
    },
    clearImmediate: (handle: number) => pending.delete(handle),
    settleThrottle: (throttled: typeof throttledLog, writable: boolean) => writable ? throttled.flush() : throttled.cancel(),
  }) as new () => ResizeFixture;
  const ink = Object.assign(new Fixture(), {
    events,
    options: { stdout },
    lastTerminalWidth: 80,
    rootNode: {},
    log: { clear: () => events.push('clear') },
    shouldSync: () => true,
    calculateLayout: () => events.push(`${stdout.columns}x${stdout.rows}`),
    throttledLog,
    isSuspended: false,
    nextRenderCommit: undefined as { resolve(): void } | undefined,
  });
  const flush = () => {
    for (const [handle, callback] of [...pending]) {
      pending.delete(handle);
      callback();
    }
  };
  return { ink, stdout, events, pending, flush, throttledLog };
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

  it('waits for viewport updates and repaints the latest resize in one transaction', () => {
    const install = createInstall();
    execFileSync(process.execPath, [install.script], { cwd: install.cliRoot });
    const { ink, stdout, events, pending, flush, throttledLog } = resizeFixture(readFileSync(install.inkFile, 'utf8'));
    throttledLog('stale frame');
    stdout.columns = 60;
    ink.resized();
    ink.onRender();
    stdout.columns = 48;
    stdout.rows = 16;
    ink.resized();

    expect(events).toEqual([]);
    expect(pending.size).toBe(1);
    flush();
    expect(events).toEqual(['\x1b[?2026h', 'clear', '48x16', 'layout', 'render', 'frame', '\x1b[?2026l']);
    expect(ink.lastTerminalWidth).toBe(48);
    expect(pending.size).toBe(0);
  });

  it('cancels a deferred resize on unmount', () => {
    const install = createInstall();
    execFileSync(process.execPath, [install.script], { cwd: install.cliRoot });
    const { ink, events, pending, flush } = resizeFixture(readFileSync(install.inkFile, 'utf8'));
    ink.resized();
    expect(pending.size).toBe(1);
    ink.unmount();
    expect(pending.size).toBe(0);
    flush();
    expect(events).toEqual([]);
  });

  it('cancels a pending resize before handing the terminal to a child', () => {
    const install = createInstall();
    execFileSync(process.execPath, [install.script], { cwd: install.cliRoot });
    const { ink, stdout, events, pending, flush } = resizeFixture(readFileSync(install.inkFile, 'utf8'));
    stdout.columns = 48;
    ink.resized();
    expect(pending.size).toBe(1);
    ink.beginSuspend();
    expect(pending.size).toBe(0);
    events.length = 0;
    ink.resized();
    expect(pending.size).toBe(0);
    flush();
    expect(events).toEqual([]);
  });

  it('discards a queued resize while suspended and settles awaited render commits', () => {
    const install = createInstall();
    execFileSync(process.execPath, [install.script], { cwd: install.cliRoot });
    const { ink, stdout, events, flush } = resizeFixture(readFileSync(install.inkFile, 'utf8'));
    stdout.columns = 48;
    ink.resized();
    ink.isSuspended = true;
    ink.nextRenderCommit = { resolve: () => events.push('commit') };
    ink.onRender();
    expect(events).toEqual(['commit']);
    flush();
    expect(events).toEqual(['commit']);
  });

  it('retains inline output on a height-only resize when synchronization is unavailable', () => {
    const install = createInstall();
    execFileSync(process.execPath, [install.script], { cwd: install.cliRoot });
    const { ink, stdout, events, flush } = resizeFixture(readFileSync(install.inkFile, 'utf8'));
    ink.shouldSync = () => false;
    stdout.rows = 12;
    ink.resized();
    expect(events).toEqual([]);
    flush();
    expect(events).toEqual(['80x12', 'layout', 'render', 'frame']);
  });

  it('rejects a partially installed resize repair', () => {
    const install = createInstall();
    execFileSync(process.execPath, [install.script], { cwd: install.cliRoot });
    const partial = readFileSync(install.inkFile, 'utf8').replace('            clearImmediate(this.pendingResize);\n', '');
    writeFileSync(install.inkFile, partial);
    expect(() => execFileSync(process.execPath, [install.script], {
      cwd: install.cliRoot,
      stdio: 'pipe',
    })).toThrow();
    expect(readFileSync(install.inkFile, 'utf8')).toBe(partial);
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
