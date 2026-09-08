import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureVisualEvidence, parseVisualEvidenceSteps } from '../../src/testing/visualEvidence.js';
import { assertTestEvidenceDirectory, createTestEvidenceDirectory } from '../../src/testing/evidenceDirectory.js';

vi.mock('node:module', () => ({ createRequire: vi.fn() }));

describe('visual evidence capture', () => {
  let workspaceRoot: string;
  let screenshot: Buffer;
  let browser: ReturnType<typeof browserFixture>;

  function browserFixture() {
    const page = {
      goto: vi.fn().mockResolvedValue({ status: () => 200 }),
      screenshot: vi.fn(async () => screenshot),
      url: vi.fn(() => 'http://127.0.0.1:3000/'),
      locator: vi.fn(() => ({
        click: vi.fn().mockResolvedValue(undefined),
        fill: vi.fn().mockResolvedValue(undefined),
        press: vi.fn().mockResolvedValue(undefined),
        waitFor: vi.fn().mockResolvedValue(undefined),
      })),
    };
    const context = {
      route: vi.fn().mockResolvedValue(undefined),
      routeWebSocket: vi.fn().mockResolvedValue(undefined),
      addInitScript: vi.fn().mockResolvedValue(undefined),
      setDefaultTimeout: vi.fn(),
      newPage: vi.fn().mockResolvedValue(page),
      tracing: {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn(async ({ path: tracePath }: { path: string }) => {
          await writeFile(tracePath, Buffer.from('PK trace fixture'));
        }),
      },
      close: vi.fn().mockResolvedValue(undefined),
    };
    return {
      page,
      context,
      newContext: vi.fn().mockResolvedValue(context),
      close: vi.fn().mockResolvedValue(undefined),
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    workspaceRoot = await realpath(await mkdtemp(path.join(tmpdir(), 'visual-evidence-test-')));
    screenshot = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#336699' } }).png().toBuffer();
    browser = browserFixture();
    vi.mocked(createRequire).mockReturnValue(Object.assign(
      vi.fn(() => ({ chromium: { launch: vi.fn().mockResolvedValue(browser) } })),
      { resolve: vi.fn(() => path.join(workspaceRoot, 'node_modules/playwright/index.js')) },
    ) as unknown as NodeJS.Require);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it.each(['file:///etc/passwd', 'https://example.com', 'http://user:secret@localhost', 'ftp://localhost', 'http://127.0.0.1.evil.test'])('rejects unsafe URL %s before loading project code', async (url) => {
    await expect(captureVisualEvidence({ workspaceRoot, url })).rejects.toThrow(/local|HTTP|credential/i);
    expect(createRequire).not.toHaveBeenCalled();
    expect(await readdir(workspaceRoot)).toEqual([]);
  });

  it.each(['../escape', '/tmp/escape', 'nested/../../escape'])('rejects unsafe output path %s', async (outputDirectory) => {
    await expect(captureVisualEvidence({ workspaceRoot, url: 'http://localhost', outputDirectory })).rejects.toThrow(/relative|traversal/i);
  });

  it('rejects a symlink in the evidence directory ancestry', async () => {
    await mkdir(path.join(workspaceRoot, 'elsewhere'));
    await symlink(path.join(workspaceRoot, 'elsewhere'), path.join(workspaceRoot, '.autohand'));
    await expect(captureVisualEvidence({ workspaceRoot, url: 'http://localhost' })).rejects.toThrow(/symbolic|symlink/i);
    expect(await readdir(path.join(workspaceRoot, 'elsewhere'))).toEqual([]);
  });

  it('validates evidence directories before artifact writes and rejects symlinks or files', async () => {
    const directory = await createTestEvidenceDirectory(workspaceRoot);
    await expect(assertTestEvidenceDirectory(directory)).resolves.toBeUndefined();
    const linked = path.join(workspaceRoot, 'linked-run');
    await symlink(directory, linked);
    await expect(assertTestEvidenceDirectory(linked)).rejects.toThrow(/symbolic|changed|directory/);
    const file = path.join(workspaceRoot, 'not-a-directory');
    await writeFile(file, 'existing file');
    await expect(assertTestEvidenceDirectory(file)).rejects.toThrow(/directory/);
  });

  it('enforces bounded frames, steps, and duration', async () => {
    for (const options of [{ maxFrames: 100 }, { timeoutMs: 120_000 }, { maxFrames: 1 }, { timeoutMs: NaN }, { steps: Array.from({ length: 21 }, () => ({ action: 'click' as const, selector: 'button' })) }]) {
      await expect(captureVisualEvidence({ workspaceRoot, url: 'http://localhost', ...options })).rejects.toThrow(/between|maximum/i);
    }
  });

  it('validates untrusted scenario arrays without accepting executable actions or unknown fields', () => {
    expect(parseVisualEvidenceSteps([{ action: 'fill', selector: '#name', value: 'Autohand' }])).toEqual([{ action: 'fill', selector: '#name', value: 'Autohand' }]);
    for (const scenario of [{ steps: [] }, [{ action: 'evaluate', script: 'process.exit()' }], [{ action: 'click', selector: 'button', extra: true }], [{ action: 'press', selector: '', key: 'Enter' }]]) {
      expect(() => parseVisualEvidenceSteps(scenario)).toThrow();
    }
  });

  it('reports missing project Playwright as not run with durable evidence metadata', async () => {
    vi.mocked(createRequire).mockReturnValue(Object.assign(vi.fn(() => { throw new Error('Cannot find module playwright'); }), {
      resolve: vi.fn(() => { throw new Error('Cannot find module playwright'); }),
    }) as unknown as NodeJS.Require);
    const result = await captureVisualEvidence({ workspaceRoot, url: 'http://localhost' });
    expect(result.status).toBe('not-run');
    expect(result.capture).toBe('not-run');
    expect(result.visualInspection).toBe('not-run');
    expect(result.message).toMatch(/existing|installed|Playwright/i);
    expect(JSON.parse(await readFile(result.manifestPath, 'utf8'))).toEqual(result);
    expect(await readFile(result.reportPath, 'utf8')).toContain('Visual inspection: not-run');
    expect(createRequire).toHaveBeenCalledWith(path.join(workspaceRoot, 'package.json'));
  });

  it('distinguishes an installed Playwright package load failure from a missing package', async () => {
    vi.mocked(createRequire).mockReturnValue(Object.assign(vi.fn(() => {
      throw new Error('Cannot load native dependency browser-fixture\nRequire stack: internal details');
    }), {
      resolve: vi.fn((name: string) => {
        if (name === 'playwright') return path.join(workspaceRoot, 'node_modules/playwright/index.js');
        throw new Error(`Cannot find module ${name}`);
      }),
    }) as unknown as NodeJS.Require);
    const result = await captureVisualEvidence({ workspaceRoot, url: 'http://localhost' });
    expect(result.status).toBe('not-run');
    expect(result.message).toContain('Installed Playwright package could not be loaded');
    expect(result.message).toContain('playwright: Cannot load native dependency browser-fixture');
    expect(result.message).not.toContain('Require stack');
    expect(result.message).not.toContain('No existing Playwright');
    expect(browser.newContext).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(result.manifestPath, 'utf8')).message).toBe(result.message);
  });

  it('reports an incompatible installed Playwright export instead of claiming the package is missing', async () => {
    vi.mocked(createRequire).mockReturnValue(Object.assign(vi.fn(() => ({ chromium: {} })), {
      resolve: vi.fn((name: string) => {
        if (name === 'playwright') return path.join(workspaceRoot, 'node_modules/playwright/index.js');
        throw new Error(`Cannot find module ${name}`);
      }),
    }) as unknown as NodeJS.Require);
    const result = await captureVisualEvidence({ workspaceRoot, url: 'http://localhost' });
    expect(result.status).toBe('not-run');
    expect(result.message).toContain('does not export chromium.launch');
  });

  it('reports a missing browser as not run without installing it', async () => {
    vi.mocked(createRequire).mockReturnValue(Object.assign(vi.fn(() => ({ chromium: { launch: vi.fn().mockRejectedValue(new Error('Executable does not exist. Please run playwright install')) } })), {
      resolve: vi.fn(() => path.join(workspaceRoot, 'node_modules/playwright/index.js')),
    }) as unknown as NodeJS.Require);
    const result = await captureVisualEvidence({ workspaceRoot, url: 'http://localhost' });
    expect(result.status).toBe('not-run');
    expect(result.message).toMatch(/browser|Executable/i);
    expect(result.screenshotPaths).toEqual([]);
  });

  it('captures artifacts without claiming a visual inspection and never overwrites runs', async () => {
    const first = await captureVisualEvidence({ workspaceRoot, url: 'http://127.0.0.1:3000/', maxFrames: 2 });
    const second = await captureVisualEvidence({ workspaceRoot, url: 'http://127.0.0.1:3000/', maxFrames: 2 });
    expect(first.status).toBe('passed');
    expect(first.visualInspection).toBe('not-run');
    expect(first.screenshotPaths).toHaveLength(2);
    expect(first.animationPath).toMatch(/\.webp$/);
    expect(first.tracePath).toMatch(/\.zip$/);
    expect(first.outputDirectory).not.toBe(second.outputDirectory);
    expect(await readFile(first.screenshotPaths[0])).toEqual(screenshot);
    expect(browser.close).toHaveBeenCalledTimes(2);
    expect(browser.newContext).toHaveBeenCalledWith(expect.objectContaining({ acceptDownloads: false, serviceWorkers: 'block' }));
  });

  it('retains the screenshot and trace with a failed interaction manifest', async () => {
    browser.page.locator.mockReturnValue({ click: vi.fn().mockRejectedValue(new Error('No button matched')), fill: vi.fn(), press: vi.fn(), waitFor: vi.fn() });
    const result = await captureVisualEvidence({ workspaceRoot, url: 'http://127.0.0.1:3000/', steps: [{ action: 'click', selector: '#missing' }] });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('No button matched');
    expect(result.completedSteps).toBe(0);
    expect(result.screenshotPaths.length).toBeGreaterThanOrEqual(1);
    expect(result.tracePath).toBeDefined();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('rejects error HTTP responses as capture failures', async () => {
    browser.page.goto.mockResolvedValue({ status: () => 500 });
    const result = await captureVisualEvidence({ workspaceRoot, url: 'http://127.0.0.1:3000/' });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('500');
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('does not launch a browser for an already aborted request', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await captureVisualEvidence({ workspaceRoot, url: 'http://localhost', signal: controller.signal });
    expect(result.status).toBe('not-run');
    expect(result.message).toMatch(/cancel|abort/i);
    expect(createRequire).not.toHaveBeenCalled();
  });

  it('closes the browser promptly when capture is cancelled', async () => {
    const controller = new AbortController();
    browser.page.goto.mockImplementation(async () => {
      controller.abort();
      return new Promise(() => undefined);
    });
    const result = await captureVisualEvidence({ workspaceRoot, url: 'http://127.0.0.1:3000/', signal: controller.signal });
    expect(result.status).toBe('failed');
    expect(result.message).toMatch(/cancel|abort/i);
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('blocks HTTP requests outside the explicit local origin', async () => {
    await captureVisualEvidence({ workspaceRoot, url: 'http://127.0.0.1:3000/', maxFrames: 2 });
    const handler = browser.context.route.mock.calls[0][1];
    const route = { request: () => ({ url: () => 'https://example.com/track' }), abort: vi.fn(), continue: vi.fn() };
    await handler(route);
    expect(route.abort).toHaveBeenCalledOnce();
    expect(route.continue).not.toHaveBeenCalled();
  });

  it('rejects redirects before the browser can follow an un-intercepted URL', async () => {
    await captureVisualEvidence({ workspaceRoot, url: 'http://127.0.0.1:3000/', maxFrames: 2 });
    const handler = browser.context.route.mock.calls[0][1];
    const route = {
      request: () => ({ url: () => 'http://127.0.0.1:3000/redirect' }),
      fetch: vi.fn().mockResolvedValue({ status: () => 302 }),
      fulfill: vi.fn(), abort: vi.fn(), continue: vi.fn(),
    };
    await handler(route);
    expect(route.fetch).toHaveBeenCalledWith({ maxRedirects: 0, timeout: 5_000 });
    expect(route.abort).toHaveBeenCalledOnce();
    expect(route.continue).not.toHaveBeenCalled();
    expect(route.fulfill).not.toHaveBeenCalled();
  });

  it('fulfills a non-redirect local response from a bounded fetch', async () => {
    await captureVisualEvidence({ workspaceRoot, url: 'http://127.0.0.1:3000/', maxFrames: 2 });
    const handler = browser.context.route.mock.calls[0][1];
    const response = { status: () => 200 };
    const route = {
      request: () => ({ url: () => 'http://127.0.0.1:3000/resource' }),
      fetch: vi.fn().mockResolvedValue(response),
      fulfill: vi.fn(), abort: vi.fn(), continue: vi.fn(),
    };
    await handler(route);
    expect(route.fulfill).toHaveBeenCalledWith({ response });
    expect(route.continue).not.toHaveBeenCalled();
    expect(route.abort).not.toHaveBeenCalled();
  });

  it('blocks every WebSocket and disables page peer-to-peer APIs before opening pages', async () => {
    const result = await captureVisualEvidence({ workspaceRoot, url: 'http://127.0.0.1:3000/', maxFrames: 2 });
    expect(browser.context.routeWebSocket).toHaveBeenCalledWith('**/*', expect.any(Function));
    const socket = { close: vi.fn().mockResolvedValue(undefined), connectToServer: vi.fn() };
    await browser.context.routeWebSocket.mock.calls[0][1](socket);
    expect(socket.close).toHaveBeenCalledOnce();
    expect(socket.connectToServer).not.toHaveBeenCalled();
    expect(browser.context.addInitScript).toHaveBeenCalledWith(expect.any(Function));
    expect(browser.context.addInitScript.mock.invocationCallOrder[0]).toBeLessThan(browser.context.newPage.mock.invocationCallOrder[0]);
    expect(browser.context.routeWebSocket.mock.invocationCallOrder[0]).toBeLessThan(browser.context.newPage.mock.invocationCallOrder[0]);
    const report = await readFile(result.reportPath, 'utf8');
    expect(report).toContain('HTTP(S) requests');
    expect(report).toContain('HMR');
    expect(report).toContain('not an OS network sandbox');
  });

  it('reports unsupported browser interception as a prerequisite failure without navigating', async () => {
    Object.defineProperty(browser.context, 'routeWebSocket', { value: undefined });
    const result = await captureVisualEvidence({ workspaceRoot, url: 'http://127.0.0.1:3000/' });
    expect(result.status).toBe('not-run');
    expect(result.message).toContain('routeWebSocket');
    expect(browser.context.newPage).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('reserves the final frame for the last interaction when the frame budget is small', async () => {
    const finalFrame = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ff0000' } }).png().toBuffer();
    const click = vi.fn().mockImplementation(async () => { if (click.mock.calls.length === 3) screenshot = finalFrame; });
    browser.page.locator.mockReturnValue({ click, fill: vi.fn(), press: vi.fn(), waitFor: vi.fn() });
    const result = await captureVisualEvidence({ workspaceRoot, url: 'http://127.0.0.1:3000/', maxFrames: 2, steps: Array.from({ length: 3 }, () => ({ action: 'click', selector: 'button' })) });
    expect(result.completedSteps).toBe(3);
    expect(result.screenshotPaths).toHaveLength(2);
    expect(await readFile(result.screenshotPaths[1])).toEqual(finalFrame);
  });

  it('reports the deadline and closes the browser when navigation never finishes', async () => {
    browser.page.goto.mockImplementation(() => new Promise(() => undefined));
    const result = await captureVisualEvidence({ workspaceRoot, url: 'http://127.0.0.1:3000/', timeoutMs: 1_000 });
    expect(result.status).toBe('failed');
    expect(result.message).toMatch(/exceeded 1000ms/);
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('closes a browser that completes launching after cancellation', async () => {
    const controller = new AbortController();
    vi.mocked(createRequire).mockReturnValue(Object.assign(vi.fn(() => ({ chromium: { launch: vi.fn(async () => { controller.abort(); return browser; }) } })), {
      resolve: vi.fn(() => path.join(workspaceRoot, 'node_modules/playwright/index.js')),
    }) as unknown as NodeJS.Require);
    const result = await captureVisualEvidence({ workspaceRoot, url: 'http://localhost', signal: controller.signal });
    expect(result.status).toBe('not-run');
    expect(browser.close).toHaveBeenCalledOnce();
    expect(browser.newContext).not.toHaveBeenCalled();
  });

  it('reports failed trace persistence even when browser interactions pass', async () => {
    browser.context.tracing.stop.mockRejectedValue(new Error('Trace storage unavailable'));
    const result = await captureVisualEvidence({ workspaceRoot, url: 'http://127.0.0.1:3000/', maxFrames: 2 });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('Trace storage unavailable');
    expect(result.tracePath).toBeUndefined();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it.each(['file', 'symlink'])('preserves an existing trace artifact %s instead of overwriting it', async (kind) => {
    let preservedPath = '';
    browser.page.screenshot.mockImplementationOnce(async () => {
      const output = path.join(workspaceRoot, '.autohand/test-evidence');
      const [run] = await readdir(output);
      const tracePath = path.join(output, run, 'trace.zip');
      preservedPath = kind === 'file' ? tracePath : path.join(workspaceRoot, 'existing-trace.zip');
      await writeFile(preservedPath, 'existing trace evidence');
      if (kind === 'symlink') await symlink(preservedPath, tracePath);
      return screenshot;
    });
    const result = await captureVisualEvidence({ workspaceRoot, url: 'http://127.0.0.1:3000/', maxFrames: 2 });
    expect(result.status).toBe('failed');
    expect(result.tracePath).toBeUndefined();
    expect(result.message).toMatch(/Trace capture failed/);
    expect(browser.context.tracing.stop).not.toHaveBeenCalled();
    expect(await readFile(preservedPath, 'utf8')).toBe('existing trace evidence');
  });
});
