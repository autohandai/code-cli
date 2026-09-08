/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { writeFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { assertTestEvidenceDirectory, createTestEvidenceDirectory } from './evidenceDirectory.js';

const selector = z.string().min(1).max(1_000);
const stepSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('click'), selector }).strict(),
  z.object({ action: z.literal('fill'), selector, value: z.string().max(10_000) }).strict(),
  z.object({ action: z.literal('press'), selector, key: z.string().min(1).max(80) }).strict(),
  z.object({ action: z.literal('waitFor'), selector }).strict(),
]);

export type VisualEvidenceStep = z.infer<typeof stepSchema>;
export type VisualEvidenceStatus = 'passed' | 'failed' | 'not-run';

export function parseVisualEvidenceSteps(input: unknown): VisualEvidenceStep[] {
  return z.array(stepSchema).max(20, 'A capture supports a maximum of 20 interaction steps.').parse(input);
}

export interface VisualEvidenceOptions {
  workspaceRoot: string;
  url: string;
  signal?: AbortSignal;
  steps?: readonly VisualEvidenceStep[];
  maxFrames?: number;
  timeoutMs?: number;
  outputDirectory?: string;
}

export interface VisualEvidenceManifest {
  status: VisualEvidenceStatus;
  capture: VisualEvidenceStatus;
  visualInspection: 'not-run';
  message: string;
  url: string;
  startedAt: string;
  completedAt: string;
  completedSteps: number;
  screenshotPaths: string[];
  tracePath?: string;
  animationPath?: string;
  outputDirectory: string;
  reportPath: string;
  manifestPath: string;
}

interface BrowserLocator {
  click(): Promise<void>;
  fill(value: string): Promise<void>;
  press(key: string): Promise<void>;
  waitFor(options: { state: 'visible' }): Promise<void>;
}

interface BrowserPage {
  goto(url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<{ status(): number } | null>;
  screenshot(options: { type: 'png'; fullPage: false; timeout: number }): Promise<Buffer>;
  url(): string;
  locator(selector: string): BrowserLocator;
}

interface BrowserRoute {
  request(): { url(): string };
  abort(): Promise<void>;
  fetch(options: { maxRedirects: 0; timeout: number }): Promise<{ status(): number }>;
  fulfill(options: { response: { status(): number } }): Promise<void>;
}

interface BrowserContext {
  route(pattern: string, handler: (route: BrowserRoute) => Promise<void>): Promise<void>;
  routeWebSocket(pattern: string, handler: (socket: { close(): Promise<void> }) => Promise<void>): Promise<void>;
  addInitScript(script: () => void): Promise<void>;
  setDefaultTimeout(timeout: number): void;
  newPage(): Promise<BrowserPage>;
  tracing: {
    start(options: { screenshots: true; snapshots: true; sources: false }): Promise<void>;
    stop(options: { path: string }): Promise<void>;
  };
  close(): Promise<void>;
}

interface EvidenceBrowser {
  newContext(options: { viewport: { width: number; height: number }; acceptDownloads: false; serviceWorkers: 'block' }): Promise<BrowserContext>;
  close(): Promise<void>;
}

interface ProjectPlaywright {
  chromium: { launch(options: { headless: true; timeout: number }): Promise<EvidenceBrowser> };
}

function validateLocalUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Visual evidence requires a local HTTP(S) URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Visual evidence requires an explicit localhost, 127.0.0.1, or [::1] HTTP(S) URL.');
  }
  if (url.username || url.password) throw new Error('Visual evidence URLs must not contain credentials.');
  return url;
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function loadProjectPlaywright(workspaceRoot: string): ProjectPlaywright {
  const projectRequire = createRequire(path.join(workspaceRoot, 'package.json'));
  const loadFailures: string[] = [];
  for (const name of ['playwright', '@playwright/test', 'playwright-core']) {
    let entry: string;
    try {
      entry = projectRequire.resolve(name);
    } catch {
      continue;
    }
    try {
      const installed: unknown = projectRequire(entry);
      if (typeof installed === 'object' && installed !== null && 'chromium' in installed) {
        const chromium = installed.chromium;
        if (typeof chromium === 'object' && chromium !== null && 'launch' in chromium && typeof chromium.launch === 'function') {
          return installed as ProjectPlaywright;
        }
      }
      loadFailures.push(`${name}: does not export chromium.launch`);
    } catch (error) {
      loadFailures.push(`${name}: ${errorMessage(error).split(/[\r\n]/, 1)[0].slice(0, 240)}`);
    }
  }
  if (loadFailures.length > 0) {
    throw new Error(`Installed Playwright package could not be loaded (${loadFailures.join('; ')}). Verify the installed package and its dependencies for this Node runtime. Capture was not run; no packages or browsers were installed.`);
  }
  throw new Error('No existing Playwright installation could be loaded from this workspace. Capture was not run; no packages or browsers were installed.');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function settleWithin(operation: Promise<unknown>, timeoutMs = 2_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([operation, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Browser cleanup exceeded its deadline.')), timeoutMs); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function captureVisualEvidence(options: VisualEvidenceOptions): Promise<VisualEvidenceManifest> {
  const url = validateLocalUrl(options.url);
  const maxFrames = boundedInteger(options.maxFrames ?? 6, 2, 24, 'Maximum frames');
  const timeoutMs = boundedInteger(options.timeoutMs ?? 30_000, 1_000, 60_000, 'Capture duration');
  const steps = parseVisualEvidenceSteps(options.steps ?? []);
  const workspaceRoot = await realpath(options.workspaceRoot);
  const outputDirectory = await createTestEvidenceDirectory(workspaceRoot, options.outputDirectory);
  const startedAt = new Date().toISOString();
  const manifest: VisualEvidenceManifest = {
    status: 'not-run', capture: 'not-run', visualInspection: 'not-run', message: '',
    url: url.href, startedAt, completedAt: startedAt, completedSteps: 0, screenshotPaths: [],
    outputDirectory, reportPath: path.join(outputDirectory, 'report.md'), manifestPath: path.join(outputDirectory, 'manifest.json'),
  };
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error('Visual evidence capture was cancelled.'));
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const timer = setTimeout(() => controller.abort(new Error(`Visual evidence capture exceeded ${timeoutMs}ms.`)), timeoutMs);
  const { signal } = controller;
  let rejectInterrupted: ((reason: unknown) => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => { rejectInterrupted = reject; });
  const interrupt = () => rejectInterrupted?.(signal.reason);
  signal.addEventListener('abort', interrupt, { once: true });
  void interrupted.catch(() => undefined);
  const run = <T>(operation: Promise<T>): Promise<T> => Promise.race([operation, interrupted]);
  let browser: EvidenceBrowser | undefined;
  let context: BrowserContext | undefined;
  let traceStarted = false;
  const frames: Buffer[] = [];

  async function writeArtifact(filename: string, content: string | Buffer): Promise<string> {
    await assertTestEvidenceDirectory(outputDirectory);
    const artifactPath = path.join(outputDirectory, filename);
    await writeFile(artifactPath, content, { flag: 'wx', mode: 0o600 });
    return artifactPath;
  }

  async function captureFrame(page: BrowserPage): Promise<void> {
    signal.throwIfAborted();
    if (frames.length >= maxFrames) return;
    if (validateLocalUrl(page.url()).origin !== url.origin) throw new Error('Page navigated outside the requested local origin.');
    const frame = await run(page.screenshot({ type: 'png', fullPage: false, timeout: Math.min(timeoutMs, 10_000) }));
    signal.throwIfAborted();
    const screenshotPath = await writeArtifact(`frame-${String(frames.length + 1).padStart(3, '0')}.png`, frame);
    frames.push(frame);
    manifest.screenshotPaths.push(screenshotPath);
  }

  try {
    signal.throwIfAborted();
    const playwright = loadProjectPlaywright(workspaceRoot);
    const launchedBrowser = await run(playwright.chromium.launch({ headless: true, timeout: Math.min(timeoutMs, 15_000) }).then(async launched => {
      if (signal.aborted) {
        await settleWithin(launched.close());
        signal.throwIfAborted();
      }
      return launched;
    }));
    browser = launchedBrowser;
    context = await run(launchedBrowser.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: false, serviceWorkers: 'block' }));
    if (typeof context.routeWebSocket !== 'function' || typeof context.addInitScript !== 'function') {
      throw new Error('Installed Playwright must support BrowserContext.routeWebSocket and addInitScript. Capture was not run; no packages or browsers were installed.');
    }
    manifest.status = manifest.capture = 'failed';
    context.setDefaultTimeout(Math.min(timeoutMs, 5_000));
    await run(context.routeWebSocket('**/*', socket => socket.close()));
    await run(context.addInitScript(() => {
      for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport']) {
        Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false });
      }
    }));
    await run(context.route('**/*', async route => {
      try {
        if (validateLocalUrl(route.request().url()).origin === url.origin) {
          const response = await route.fetch({ maxRedirects: 0, timeout: Math.min(timeoutMs, 5_000) });
          const status = response.status();
          if (status < 300 || status >= 400 || status === 304) {
            await route.fulfill({ response });
            return;
          }
        }
      } catch { /* Failed requests and redirects must not bypass the local origin boundary. */ }
      try { await route.abort(); } catch { /* The context may already be closed by cancellation. */ }
    }));
    await run(context.tracing.start({ screenshots: true, snapshots: true, sources: false }));
    traceStarted = true;
    const page = await run(context.newPage());
    const response = await run(page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: Math.min(timeoutMs, 15_000) }));
    await captureFrame(page);
    if (response && response.status() >= 400) throw new Error(`Capture target returned HTTP ${response.status()}.`);
    for (const step of steps) {
      signal.throwIfAborted();
      const target = page.locator(step.selector);
      switch (step.action) {
        case 'click': await run(target.click()); break;
        case 'fill': await run(target.fill(step.value)); break;
        case 'press': await run(target.press(step.key)); break;
        case 'waitFor': await run(target.waitFor({ state: 'visible' })); break;
      }
      manifest.completedSteps += 1;
      if (frames.length < maxFrames - 1 || manifest.completedSteps === steps.length) await captureFrame(page);
    }
    while (frames.length < maxFrames) {
      await delay(200, undefined, { signal });
      await captureFrame(page);
    }
    manifest.status = manifest.capture = 'passed';
    manifest.message = 'Browser capture and requested interactions completed. Visual inspection has not been run.';
  } catch (error) {
    manifest.message = errorMessage(signal.aborted ? signal.reason : error);
  } finally {
    if (context && traceStarted && !signal.aborted) {
      try {
        const tracePath = await writeArtifact('trace.zip', Buffer.alloc(0));
        await run(context.tracing.stop({ path: tracePath }));
        manifest.tracePath = tracePath;
      } catch (error) {
        manifest.status = manifest.capture = 'failed';
        manifest.message += ` Trace capture failed: ${errorMessage(error)}`;
      }
    }
    if (browser) {
      try { await settleWithin(browser.close()); } catch (error) {
        manifest.status = manifest.capture = 'failed';
        manifest.message += ` Browser cleanup failed: ${errorMessage(error)}`;
      }
    }
  }
  try {
    if (signal.aborted && manifest.status === 'passed') {
      manifest.status = manifest.capture = 'failed';
      manifest.message = errorMessage(signal.reason);
    }
    if (frames.length >= 2 && !signal.aborted) {
      const { default: sharp } = await import('sharp');
      const animation = await run(sharp(frames, { join: { animated: true } }).webp({ loop: 0, delay: 200, quality: 80 }).timeout({ seconds: 5 }).toBuffer());
      signal.throwIfAborted();
      manifest.animationPath = await writeArtifact('capture.webp', animation);
    }
  } catch (error) {
    manifest.status = manifest.capture = 'failed';
    manifest.message += ` Animation capture failed: ${errorMessage(error)}`;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
    signal.removeEventListener('abort', interrupt);
  }
  manifest.completedAt = new Date().toISOString();
  const report = [
    '# Browser evidence', '', `Capture: ${manifest.capture}`, 'Visual inspection: not-run', '', manifest.message, '',
    'The animated WebP is a bounded clip assembled from the retained real browser PNG frames, not a full session video.',
    'Capture success does not certify visual correctness. Open the screenshots and clip for visual review.',
    'HTTP(S) requests are intercepted at the browser context and restricted to the explicitly requested local origin, including popup requests.',
    'HTTP redirects are blocked: use the final local URL. Responses must complete within five seconds, so streaming responses are unsupported.',
    'All page WebSockets are blocked. WebRTC and WebTransport APIs are disabled in pages and frames; downloads and service workers are disabled.',
    'This disposable context is for local capture, not general development debugging: WebSocket HMR is disabled. These browser controls are not an OS network sandbox.', '',
    'Optional scenario JSON is an array of click, fill, press, or waitFor steps, each with a selector; fill includes value and press includes key.', '',
    `URL: ${manifest.url}`, `Completed steps: ${manifest.completedSteps}/${steps.length}`, '',
    ...manifest.screenshotPaths.map(filename => `- [${path.basename(filename)}](${path.basename(filename)})`),
    ...(manifest.tracePath ? ['- [Playwright trace](trace.zip)'] : []),
    ...(manifest.animationPath ? ['- [Animated WebP clip](capture.webp)'] : []), '',
  ].join('\n');
  await writeArtifact('report.md', report);
  await writeArtifact('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
