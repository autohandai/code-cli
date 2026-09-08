import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { captureVisualEvidence } from '../../src/testing/visualEvidence.js';

const installedPlaywrightProject = process.env.AUTOHAND_VISUAL_TEST_PROJECT;

describe.skipIf(!installedPlaywrightProject)('visual evidence with an existing real browser', () => {
  let workspaceRoot: string | undefined;
  let server: Server | undefined;
  let foreignServer: Server | undefined;

  afterEach(async () => {
    if (server?.listening) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    if (foreignServer?.listening) await new Promise<void>((resolve, reject) => foreignServer!.close(error => error ? reject(error) : resolve()));
    if (workspaceRoot) await rm(workspaceRoot, { recursive: true, force: true });
  });

  it('captures a changed fixture, trace, and decodable animated WebP from real browser frames', async () => {
    workspaceRoot = await mkdtemp(path.join(tmpdir(), 'visual-evidence-browser-'));
    const projectRequire = createRequire(path.join(installedPlaywrightProject!, 'package.json'));
    const packagePath = path.dirname(projectRequire.resolve('playwright/package.json'));
    await mkdir(path.join(workspaceRoot, 'node_modules'));
    await symlink(packagePath, path.join(workspaceRoot, 'node_modules/playwright'), 'dir');
    server = createServer((_request, response) => {
      response.setHeader('content-type', 'text/html');
      response.end('<!doctype html><html><body style="background:#fff"><h1>Real browser fixture</h1><input aria-label="Name" id="name"><button id="save" onclick="document.body.style.background=\'#225588\';document.querySelector(\'h1\').textContent=\'Saved \'+document.querySelector(\'#name\').value">Save</button></body></html>');
    });
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture server has no TCP address');
    const result = await captureVisualEvidence({
      workspaceRoot,
      url: `http://127.0.0.1:${address.port}/`,
      maxFrames: 4,
      steps: [
        { action: 'fill', selector: '#name', value: 'Autohand' },
        { action: 'click', selector: '#save' },
        { action: 'waitFor', selector: 'h1:has-text("Saved Autohand")' },
      ],
    });
    expect(result.status, result.message).toBe('passed');
    expect(result.visualInspection).toBe('not-run');
    expect(result.completedSteps).toBe(3);
    expect(result.screenshotPaths).toHaveLength(4);
    const first = await readFile(result.screenshotPaths[0]);
    const last = await readFile(result.screenshotPaths.at(-1)!);
    expect(first.equals(last)).toBe(false);
    expect(await sharp(first).metadata()).toMatchObject({ format: 'png', width: 1280, height: 720 });
    const animation = await sharp(result.animationPath!, { animated: true }).metadata();
    expect(animation.format).toBe('webp');
    expect(animation.pages).toBeGreaterThanOrEqual(2);
    expect(animation.pageHeight).toBe(720);
    expect((await readFile(result.tracePath!)).subarray(0, 2).toString()).toBe('PK');
    expect(JSON.parse(await readFile(result.manifestPath, 'utf8'))).toEqual(result);
  });

  it('blocks off-origin HTTP, popups, and sockets while disabling page and iframe peer APIs', async () => {
    workspaceRoot = await mkdtemp(path.join(tmpdir(), 'visual-evidence-network-'));
    const projectRequire = createRequire(path.join(installedPlaywrightProject!, 'package.json'));
    await mkdir(path.join(workspaceRoot, 'node_modules'));
    await symlink(path.dirname(projectRequire.resolve('playwright/package.json')), path.join(workspaceRoot, 'node_modules/playwright'), 'dir');
    let foreignHttpRequests = 0;
    let foreignSocketRequests = 0;
    foreignServer = createServer((_request, response) => {
      foreignHttpRequests += 1;
      response.end('This origin must not receive capture requests');
    });
    foreignServer.on('upgrade', (_request, socket) => {
      foreignSocketRequests += 1;
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    });
    await new Promise<void>((resolve, reject) => {
      foreignServer!.once('error', reject);
      foreignServer!.listen(0, '127.0.0.1', resolve);
    });
    const foreignAddress = foreignServer.address();
    if (!foreignAddress || typeof foreignAddress === 'string') throw new Error('Foreign fixture server has no TCP address');
    const foreignUrl = `http://127.0.0.1:${foreignAddress.port}`;
    let allowedRequests = 0;
    server = createServer((request, response) => {
      response.setHeader('content-type', 'text/html');
      if (request.url === '/allowed') {
        allowedRequests += 1;
        response.end('Allowed local response');
        return;
      }
      if (request.url === '/redirect') {
        response.statusCode = 302;
        response.setHeader('location', `${foreignUrl}/redirected`);
        response.end();
        return;
      }
      if (request.url === '/child') {
        response.end('<!doctype html><p>Child frame</p>');
        return;
      }
      response.end(`<!doctype html><html><body><iframe id="child" src="/child"></iframe><button id="probe">Probe boundary</button><p id="result">Waiting</p><script>
        document.querySelector('#probe').onclick = async () => {
          const child = document.querySelector('#child').contentWindow;
          const peerApisDisabled = [window, child].every(realm => ['RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport'].every(name => typeof realm[name] === 'undefined'));
          window.open('${foreignUrl}/popup');
          const socketClosed = new Promise(resolve => {
            const socket = new WebSocket('${foreignUrl.replace('http:', 'ws:')}/socket');
            socket.onclose = () => resolve();
            socket.onerror = () => resolve();
          });
          await Promise.all([fetch('${foreignUrl}/fetch').catch(() => undefined), fetch('/redirect').catch(() => undefined), socketClosed, fetch('/allowed')]);
          document.querySelector('#result').textContent = peerApisDisabled ? 'Boundary controls verified' : 'Peer APIs remain available';
        };
      </script></body></html>`);
    });
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture server has no TCP address');
    const result = await captureVisualEvidence({
      workspaceRoot,
      url: `http://127.0.0.1:${address.port}/`,
      maxFrames: 3,
      steps: [{ action: 'click', selector: '#probe' }, { action: 'waitFor', selector: '#result:has-text("Boundary controls verified")' }],
    });
    expect(result.status, result.message).toBe('passed');
    expect(allowedRequests).toBe(1);
    expect(foreignHttpRequests).toBe(0);
    expect(foreignSocketRequests).toBe(0);
  });

  it('cancels an in-flight real request and closes its connection promptly', async () => {
    workspaceRoot = await mkdtemp(path.join(tmpdir(), 'visual-evidence-cancel-'));
    const projectRequire = createRequire(path.join(installedPlaywrightProject!, 'package.json'));
    await mkdir(path.join(workspaceRoot, 'node_modules'));
    await symlink(path.dirname(projectRequire.resolve('playwright/package.json')), path.join(workspaceRoot, 'node_modules/playwright'), 'dir');
    const controller = new AbortController();
    let requestClosed = false;
    let cancelledAt = 0;
    server = createServer((_request, response) => {
      response.once('close', () => { requestClosed = true; });
      response.writeHead(200, { 'content-type': 'text/html' });
      response.write('<!doctype html><p>Response has not finished');
      cancelledAt = Date.now();
      controller.abort();
    });
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture server has no TCP address');
    const result = await captureVisualEvidence({ workspaceRoot, url: `http://127.0.0.1:${address.port}/`, signal: controller.signal });
    expect(result.status).toBe('failed');
    expect(result.message).toMatch(/cancel/i);
    expect(Date.now() - cancelledAt).toBeLessThan(2_000);
    expect(requestClosed).toBe(true);
  });
});
