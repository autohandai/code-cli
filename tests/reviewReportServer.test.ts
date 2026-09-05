/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_REVIEW_REPORT_BYTES,
  startReviewReportServer,
  type ReviewReportServerHandle,
} from '../src/review/reviewReportServer.js';

const handles: ReviewReportServerHandle[] = [];

async function fixture(): Promise<{ assetRoot: string; workspace: string }> {
  const workspace = await mkdtemp(path.join(tmpdir(), 'autohand-review-server-'));
  const assetRoot = path.join(workspace, 'assets');
  await mkdir(path.join(assetRoot, 'fonts'), { recursive: true });
  await Promise.all([
    writeFile(path.join(assetRoot, 'index.html'), '<!doctype html><title>Autohand Review</title><main id="report"></main>'),
    writeFile(path.join(assetRoot, 'styles.css'), 'body { color: #171714; }'),
    writeFile(path.join(assetRoot, 'app.js'), 'document.querySelector("#report");'),
    writeFile(path.join(assetRoot, 'fonts', 'AutohandSans-Regular.woff2'), 'sans-font'),
    writeFile(path.join(assetRoot, 'fonts', 'AutohandMono-Regular.woff2'), 'mono-font'),
  ]);
  return { assetRoot, workspace };
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
});

describe('review report server', () => {
  it('ships the approved Autohand Sans and Mono webfont artifacts', async () => {
    const fontRoot = path.resolve('assets/review/fonts');
    const [sans, mono, sansLicense, monoLicense] = await Promise.all([
      readFile(path.join(fontRoot, 'AutohandSans-Regular.woff2')),
      readFile(path.join(fontRoot, 'AutohandMono-Regular.woff2')),
      readFile(path.join(fontRoot, 'OFL-Autohand-Sans.txt'), 'utf8'),
      readFile(path.join(fontRoot, 'OFL-Autohand-Mono.txt'), 'utf8'),
    ]);

    expect(createHash('sha256').update(sans).digest('hex')).toBe(
      '00acde8ad8fb4d7dcdeb371cbb97729a5dbb8d203faca3c987281128b63893a2',
    );
    expect(createHash('sha256').update(mono).digest('hex')).toBe(
      'f282ee6bf3139cf8a35cabe0b9998adf0b0a7b49af8d29ce31fce436479f4a75',
    );
    expect(sansLicense).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(monoLicense).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });

  it('serves a report only over loopback with restrictive browser headers', async () => {
    const { assetRoot, workspace } = await fixture();
    const reportPath = path.join(workspace, 'security.md');
    await writeFile(reportPath, '# Security review\n\n<script>steal()</script>');

    const handle = await startReviewReportServer({
      assetRoot,
      reportPath,
      port: 0,
      open: false,
    });
    handles.push(handle);

    expect(handle.host).toBe('127.0.0.1');
    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);

    const page = await fetch(handle.url);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    expect(page.headers.get('referrer-policy')).toBe('no-referrer');
    expect(page.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(page.headers.get('permissions-policy')).toContain('camera=()');
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(await page.text()).not.toContain('steal()');

    const report = await fetch(new URL('/report', handle.url));
    expect(report.headers.get('content-type')).toContain('application/json');
    await expect(report.json()).resolves.toEqual({
      format: 'markdown',
      name: 'security.md',
      content: '# Security review\n\n<script>steal()</script>',
    });
  });

  it('serves only a fixed allowlist of assets and supports HEAD', async () => {
    const { assetRoot } = await fixture();
    const handle = await startReviewReportServer({ assetRoot, port: 0, open: false });
    handles.push(handle);

    const stylesheet = await fetch(new URL('/styles.css', handle.url));
    expect(stylesheet.headers.get('content-type')).toContain('text/css');

    const font = await fetch(new URL('/fonts/AutohandMono-Regular.woff2', handle.url));
    expect(font.status).toBe(200);
    expect(font.headers.get('content-type')).toBe('font/woff2');

    const head = await fetch(new URL('/app.js', handle.url), { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');

    expect((await fetch(new URL('/../package.json', handle.url))).status).toBe(404);
    expect((await fetch(new URL('/missing', handle.url))).status).toBe(404);
    expect((await fetch(new URL('/report', handle.url), { method: 'POST' })).status).toBe(405);
  });

  it('opens the exact loopback URL only when requested', async () => {
    const { assetRoot } = await fixture();
    const openUrl = vi.fn().mockResolvedValue(undefined);
    const handle = await startReviewReportServer({
      assetRoot,
      port: 0,
      open: true,
      openUrl,
    });
    handles.push(handle);

    expect(openUrl).toHaveBeenCalledOnce();
    expect(openUrl).toHaveBeenCalledWith(handle.url);
  });

  it('rejects non-files and oversized reports before listening', async () => {
    const { assetRoot, workspace } = await fixture();

    await expect(startReviewReportServer({
      assetRoot,
      reportPath: workspace,
      port: 0,
      open: false,
    })).rejects.toThrow('regular file');

    const reportPath = path.join(workspace, 'oversized.md');
    await writeFile(reportPath, Buffer.alloc(MAX_REVIEW_REPORT_BYTES + 1));
    await expect(startReviewReportServer({
      assetRoot,
      reportPath,
      port: 0,
      open: false,
    })).rejects.toThrow('too large');
  });
});
