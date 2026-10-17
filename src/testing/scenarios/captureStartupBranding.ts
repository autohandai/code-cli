/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import type { TerminalData } from 'ghostty-opentui';
import { renderTerminalToImage } from 'ghostty-opentui/image';
import type { Session } from 'tuistory';
import sharp from 'sharp';
import { BRAND_FRAME_INTERVAL_MS, BRAND_FRAME_COUNT, formatBrandLogo } from '../../ui/brand.js';
import { renderAutohandLogo } from '../../utils/asciiArt.js';
import { launchTuistorySession } from '../drivers/tuistory-driver.js';
import { returningStartupLogoRows } from './startupReturningBrandingScenario.js';

interface CapturedFrame {
  name: string;
  terminal: TerminalData;
}

interface CaptureServer {
  baseUrl: string;
  close: () => Promise<void>;
}

interface CaptureTempState {
  autohandHome: string;
  configPath: string;
  workspaceRoot: string;
  cleanup: () => Promise<void>;
}

interface ReturningCaptureHelpers {
  createMockAuthServer: () => Promise<CaptureServer>;
  createMockOpenRouterServer: (responseText: string) => Promise<CaptureServer>;
  createTempAutohandHome: (options: { config: Record<string, unknown> }) => Promise<CaptureTempState>;
  launchBuiltAutohand: (args: string[], options: {
    autohandHome: string;
    cwd: string;
    cols: number;
    rows: number;
    waitForData: boolean;
    env: Record<string, string | undefined>;
  }) => Promise<Session>;
  clearComposerInput: (session: Session) => Promise<void>;
  exitInteractive: (session: Session) => Promise<void>;
  expectCleanExit: (session: Session) => void;
}

function viewport(session: Session): TerminalData {
  const data = session.getTerminalData();
  return { ...data, lines: data.lines.slice(-data.rows) };
}

function screenText(data: TerminalData): string {
  return data.lines.map((line) => line.spans.map((span) => span.text).join('').trimEnd()).join('\n');
}

async function waitForScreen(session: Session, predicate: (data: TerminalData) => boolean): Promise<TerminalData> {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    const data = viewport(session);
    if (predicate(data)) return data;
    if (session.exitInfo) throw new Error(`Branding fixture exited early:\n${session.getRawOutput()}`);
    await delay(25);
  }
  throw new Error(`Branding fixture did not show the expected screen:\n${screenText(viewport(session))}`);
}

async function waitForStableScreen(session: Session): Promise<TerminalData> {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    const first = await waitForScreen(session, hasCompleteMenu);
    await delay(BRAND_FRAME_INTERVAL_MS * 2);
    const second = viewport(session);
    if (hasCompleteMenu(second) && identityText(second) === identityText(first)) return second;
  }
  throw new Error(`Branding geometry did not settle:\n${screenText(viewport(session))}`);
}

function hasCompleteMenu(data: TerminalData): boolean {
  const text = screenText(data);
  return text.includes('Sign in to continue.') && text.includes('Login') && text.includes('Exit')
    && text.includes('ESC') && text.match(/(?:^|\n)\s*autohand\s*(?=\n|$)/gu)?.length === 1;
}

function identityText(data: TerminalData): string {
  const text = screenText(data);
  return text.slice(text.indexOf('autohand'));
}

function benchmarkFormatter(): Record<string, number> {
  const art = renderAutohandLogo({ columns: 78, rows: 16 });
  for (let frame = 0; frame < BRAND_FRAME_COUNT; frame++) formatBrandLogo(art, frame, 'truecolor');
  const iterations = 10_000;
  let formattedCharacters = 0;
  const cpuStart = process.cpuUsage();
  const started = performance.now();
  for (let iteration = 0; iteration < iterations; iteration++) {
    formattedCharacters += formatBrandLogo(renderAutohandLogo({ columns: 78, rows: 16, frame: iteration % BRAND_FRAME_COUNT }), 0, 'truecolor').length;
  }
  const elapsedMs = performance.now() - started;
  const cpu = process.cpuUsage(cpuStart);
  return {
    iterations,
    logoColumns: Math.max(...art.split('\n').map((line) => line.length)),
    logoRows: art.split('\n').length,
    elapsedMs,
    microsecondsPerFrame: elapsedMs * 1_000 / iterations,
    cpuMs: (cpu.user + cpu.system) / 1_000,
    formattedCharacters,
  };
}

async function writeFrames(outputRoot: string, frames: readonly CapturedFrame[]): Promise<string[]> {
  await mkdir(outputRoot, { recursive: true });
  const images: string[] = [];
  for (const frame of frames) {
    await writeFile(path.join(outputRoot, `${frame.name}.json`), `${JSON.stringify(frame.terminal, null, 2)}\n`);
    for (const appearance of ['dark', 'light'] as const) {
      const theme = appearance === 'dark'
        ? { background: '#101216', text: '#e6e8eb' }
        : { background: '#f5f6f7', text: '#202329' };
      const image = await renderTerminalToImage(frame.terminal, {
        fontSize: 16,
        lineHeight: 1.2,
        paddingX: 18,
        paddingY: 18,
        height: frame.terminal.rows * Math.round(16 * 1.2) + 36,
        theme,
        frameColor: theme.background,
      });
      const name = `${frame.name}-${appearance}.png`;
      await writeFile(path.join(outputRoot, name), image);
      images.push(name);
    }
  }
  return images;
}

async function writeAnimation(outputRoot: string, frames: readonly TerminalData[]): Promise<void> {
  const pages: Buffer[] = [];
  let width = 0;
  let height = 0;
  for (const terminal of frames) {
    const png = await renderTerminalToImage(terminal, {
      fontSize: 16, lineHeight: 1.2, paddingX: 18, paddingY: 18,
      height: terminal.rows * Math.round(16 * 1.2) + 36,
      theme: { background: '#101216', text: '#e6e8eb' }, frameColor: '#101216',
    });
    const raw = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (pages.length) assert(raw.info.width === width && raw.info.height === height, 'Animation canvas must remain fixed');
    width = raw.info.width;
    height = raw.info.height;
    pages.push(raw.data);
  }
  const destination = path.join(outputRoot, 'startup-motion.gif');
  await sharp(Buffer.concat(pages), {
    raw: { width, height: height * pages.length, channels: 4, pageHeight: height },
  }).gif({ delay: pages.map(() => 100), loop: 0, effort: 1 }).toFile(destination);
  const metadata = await sharp(destination, { animated: true }).metadata();
  assert.equal(metadata.pages, pages.length, 'Preview must retain the captured animation frames');
  assert.equal(metadata.delay?.reduce((total, delay) => total + delay, 0), pages.length * 100, 'Preview must play at its captured speed');
}

async function capture(): Promise<void> {
  const outputRoot = path.resolve('.artifacts/startup-branding');
  const session = await launchTuistorySession({
    command: process.execPath,
    args: ['--import', 'tsx', path.resolve('src/testing/scenarios/startupBrandingScenario.tsx'),
      '--TERM=xterm-ghostty', '--COLORTERM=truecolor'],
    cols: 80,
    rows: 24,
    waitForData: false,
    env: {
      ...process.env,
      CI: 'false',
      TERM: 'xterm-256color',
      TERM_PROGRAM: 'ghostty',
      COLORTERM: 'truecolor',
      WT_SESSION: undefined,
      NO_COLOR: undefined,
      FORCE_COLOR: undefined,
      AUTOHAND_REDUCED_MOTION: undefined,
    },
  });
  const frames: CapturedFrame[] = [];
  const animationFrames: TerminalData[] = [];
  let bytes = 0;
  let chunks = 0;
  let elapsedMs = 0;
  let unsubscribe: (() => void) | undefined;
  try {
    const first = await waitForStableScreen(session);
    frames.push({ name: 'wide-phase-1', terminal: first });
    const started = performance.now();
    unsubscribe = session.subscribe((data) => {
      bytes += Buffer.byteLength(data, 'utf8');
      chunks++;
    });
    for (let sample = 0; sample < 80; sample++) {
      const terminal = await waitForScreen(session, hasCompleteMenu);
      assert.equal(identityText(terminal), identityText(first), 'Motion must not move the menu');
      animationFrames.push(terminal);
      await delay(100);
    }
    const second = animationFrames[15];
    assert.equal(identityText(second), identityText(first), 'Motion must keep the identity and menu stationary');
    assert.notEqual(screenText(second), screenText(first), 'Two phases must contain moving logo geometry');
    frames.push({ name: 'wide-phase-2', terminal: second });
    elapsedMs = performance.now() - started;
    unsubscribe();
    unsubscribe = undefined;

    for (const rows of [18, 12]) {
      session.resize({ cols: 32, rows });
      const terminal = await waitForStableScreen(session);
      assert.equal(terminal.cols, 32);
      assert.equal(terminal.rows, rows);
      assert(terminal.lines.every((line) => line.spans.reduce((width, span) => width + span.width, 0) <= 32));
      frames.push({ name: `narrow-32x${rows}`, terminal });
    }
    assert(!session.getRawOutput().includes('\x1b[3J'), 'Animation must preserve terminal scrollback');
    session.sendKey('escape');
    const deadline = performance.now() + 5_000;
    while (!session.exitInfo && performance.now() < deadline) await delay(25);
    assert.equal(session.exitInfo?.exitCode, 0, 'Fixture must exit cleanly');
    assert.equal(session.getTerminalData().cursorVisible, true, 'Fixture must restore the cursor');
  } finally {
    unsubscribe?.();
    session.close();
  }

  const images = await writeFrames(outputRoot, frames);
  await writeAnimation(outputRoot, animationFrames);
  const report = {
    generatedAt: new Date().toISOString(),
    command: 'node --import tsx src/testing/scenarios/captureStartupBranding.ts',
    verification: 'Actual startup branding fixture output from a PTY, parsed by Ghostty terminal emulation and rasterized from captured cells. Dark and light previews use identical terminal data.',
    nativeApplications: { Ghostty: 'unverified', iTerm2: 'unverified', WindowsTerminal: 'unverified' },
    animation: { framesPerSecond: 1_000 / BRAND_FRAME_INTERVAL_MS, motionFrames: BRAND_FRAME_COUNT },
    ptyOutput: {
      elapsedMs,
      bytes,
      bytesPerSecond: bytes * 1_000 / elapsedMs,
      chunks,
      chunksPerSecond: chunks * 1_000 / elapsedMs,
      note: 'PTY chunks are observed output, not guaranteed one-to-one stdout writes. Startup and resize output are excluded.',
    },
    formatter: benchmarkFormatter(),
    captures: frames.map(({ name, terminal }) => ({ name, cols: terminal.cols, rows: terminal.rows })),
    images,
    animationPreview: { file: 'startup-motion.gif', frames: animationFrames.length, framesPerSecond: 10, source: 'Captured PTY terminal cells' },
  };
  await writeFile(path.join(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

async function captureReturning(): Promise<void> {
  const outputRoot = path.resolve('.artifacts/startup-branding');
  const builtPath = path.resolve('dist/index.js');
  const [builtSource, builtStat] = await Promise.all([readFile(builtPath), stat(builtPath)]);
  const builtHash = createHash('sha256').update(builtSource).digest('hex');
  const helperUrl = pathToFileURL(path.resolve('tests/tuistory/helpers/autohandTuistory.ts')).href;
  const helpers = await import(helperUrl) as ReturningCaptureHelpers;
  const frames: CapturedFrame[] = [];
  let auth: CaptureServer | undefined;
  let provider: CaptureServer | undefined;
  let state: CaptureTempState | undefined;
  let session: Session | undefined;
  try {
    auth = await helpers.createMockAuthServer();
    provider = await helpers.createMockOpenRouterServer('Returning startup is ready.');
    state = await helpers.createTempAutohandHome({
      config: {
        openrouter: { baseUrl: provider.baseUrl },
        agent: { autoMemory: false, maxIterations: 2, sessionRetryLimit: 0 },
        network: { maxRetries: 0, retryDelay: 0 },
        ui: { mouseComposerCursor: false, promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
      },
    });
    for (const size of [{ cols: 80, rows: 24, logoRows: 9 }, { cols: 120, rows: 32, logoRows: 11 }]) {
      session = await helpers.launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        cols: size.cols,
        rows: size.rows,
        waitForData: false,
        env: {
          AUTOHAND_NO_BANNER: undefined,
          NO_COLOR: undefined,
          FORCE_COLOR: '3',
          COLORTERM: 'truecolor',
          COLUMNS: String(size.cols),
          LINES: String(size.rows),
          AUTOHAND_API_URL: auth.baseUrl,
          AUTOHAND_AUTH_URL: auth.baseUrl,
          AUTOHAND_AUTH_API_URL: `${auth.baseUrl}/v1/auth`,
        },
      });
      const current = session;
      const terminal = await waitForScreen(current, (data) => {
        const text = screenText(data);
        return text.includes('❯') && text.includes('/help') && text.includes('Autohand')
          && text.includes('openai/gpt-4o-mini') && returningStartupLogoRows(text).length === size.logoRows;
      });
      const printedLogo = returningStartupLogoRows(current.getRawOutput());
      assert.equal(printedLogo.length, size.logoRows, 'Built CLI must print the logo once at its selected size');
      assert.deepEqual(returningStartupLogoRows(screenText(terminal)), printedLogo, 'Every printed logo row must be visible');
      await current.type('startup draft');
      await current.press('left');
      await current.type('X');
      const edited = await waitForScreen(current, (data) => screenText(data).includes('❯ startup drafXt'));
      assert.deepEqual(returningStartupLogoRows(screenText(edited)), printedLogo, 'Editing must retain the complete logo');
      assert.deepEqual(returningStartupLogoRows(current.getRawOutput()), printedLogo, 'Editing must not print the logo again');
      assert.equal(edited.cols, size.cols);
      assert.equal(edited.rows, size.rows);
      frames.push({ name: `returning-${size.cols}x${size.rows}`, terminal: edited });
      await helpers.clearComposerInput(current);
      await helpers.exitInteractive(current);
      helpers.expectCleanExit(current);
      assert.equal(current.getTerminalData().cursorVisible, true, 'Built CLI must restore the cursor');
      current.close();
      session = undefined;
    }
  } finally {
    session?.close();
    const cleanup = await Promise.allSettled([auth?.close(), provider?.close(), state?.cleanup()]);
    const failures = cleanup.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
    if (failures.length) throw new AggregateError(failures, 'Returning capture fixture cleanup failed');
  }

  assert.equal(createHash('sha256').update(await readFile(builtPath)).digest('hex'), builtHash,
    'Built CLI must remain unchanged during returning-user capture');
  const images = await writeFrames(outputRoot, frames);
  const report = {
    generatedAt: new Date().toISOString(),
    command: 'node --import tsx src/testing/scenarios/captureStartupBranding.ts --returning-only',
    verification: 'Actual built CLI with authenticated temporary config and local mock auth/provider servers. Every occupied logo row remains visible while editing the composer; both sessions exit cleanly and restore the cursor.',
    builtCli: { path: 'dist/index.js', sha256: builtHash, bytes: builtStat.size, modifiedAt: builtStat.mtime.toISOString() },
    nativeApplications: { Ghostty: 'unverified', iTerm2: 'unverified', WindowsTerminal: 'unverified' },
    captures: frames.map(({ name, terminal }) => ({ name, cols: terminal.cols, rows: terminal.rows, visibleLogoRows: returningStartupLogoRows(screenText(terminal)).length })),
    images,
  };
  await writeFile(path.join(outputRoot, 'returning-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

if (!process.argv.includes('--returning-only')) await capture();
if (process.argv.includes('--returning') || process.argv.includes('--returning-only')) await captureReturning();
