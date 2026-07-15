/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertResearchPublicationDraftUnchanged,
  buildResearchPublicationDraft,
  derivePublicationIdempotencyKey,
} from '../../src/research/ResearchManifestBuilder.js';

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('ResearchManifestBuilder', () => {
  let workspaceRoot: string;
  let reportPath: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-publication-manifest-'));
    reportPath = path.join(workspaceRoot, '.autohand', 'research', 'topic-agent-testing.md');
    await fs.outputFile(path.join(workspaceRoot, '.autohand', 'research', 'images', 'pixel.png'), PIXEL);
  });

  afterEach(async () => {
    await fs.remove(workspaceRoot);
  });

  it('parses metadata and local raster assets through a contract-compatible Markdown AST', async () => {
    const markdown = [
      '# Agent testing',
      '',
      '## Summary',
      'A practical report about testing stateful agents.',
      '',
      '![One-pixel fixture](./images/pixel.png)',
    ].join('\n');
    await fs.outputFile(reportPath, markdown);

    const draft = await buildResearchPublicationDraft({
      workspaceRoot,
      markdownPath: reportPath,
      visibility: 'private',
      apiBaseUrl: 'https://openresearch.autohand.ai/',
    });

    expect(draft.title).toBe('Agent testing');
    expect(draft.summary).toBe('A practical report about testing stateful agents.');
    expect(draft.visibility).toBe('private');
    expect(draft.apiOrigin).toBe('https://openresearch.autohand.ai');
    expect(draft.workspaceRelativeMarkdownPath).toBe('.autohand/research/topic-agent-testing.md');
    expect(draft.assets).toEqual([
      expect.objectContaining({
        logicalReference: 'images/pixel.png',
        filename: 'pixel.png',
        mediaType: 'image/png',
        byteCount: PIXEL.byteLength,
        alternativeText: 'One-pixel fixture',
      }),
    ]);
    expect(draft.totalUploadBytes).toBe(Buffer.byteLength(markdown) + PIXEL.byteLength);
    expect(draft.receiptPath).toBe(`${draft.markdownAbsolutePath}.publication.json`);
  });

  it.each([
    ['remote image', '![Remote](https://example.com/image.png)'],
    ['data image', '![Inline](data:image/png;base64,AAAA)'],
    ['raw HTML', '<img src="images/pixel.png">'],
    ['Mermaid source', '~~~mermaid\ngraph TD\n~~~'],
  ])('rejects %s before a network request', async (_label, body) => {
    await fs.outputFile(
      reportPath,
      `# Agent testing\n\nA safe summary.\n\n${body}\n`,
    );

    await expect(buildResearchPublicationDraft({
      workspaceRoot,
      markdownPath: reportPath,
      visibility: 'public',
      apiBaseUrl: 'https://openresearch.autohand.ai',
    })).rejects.toThrow();
  });

  it('rejects a symlinked image that resolves outside the active workspace', async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-publication-outside-'));
    try {
      const outsideImage = path.join(outsideRoot, 'outside.png');
      const linkedImage = path.join(workspaceRoot, '.autohand', 'research', 'images', 'escape.png');
      await fs.outputFile(outsideImage, PIXEL);
      await fs.symlink(outsideImage, linkedImage);
      await fs.outputFile(
        reportPath,
        '# Agent testing\n\nA safe summary.\n\n![Escape](images/escape.png)\n',
      );

      await expect(buildResearchPublicationDraft({
        workspaceRoot,
        markdownPath: reportPath,
        visibility: 'public',
        apiBaseUrl: 'https://openresearch.autohand.ai',
      })).rejects.toThrow(/workspace/i);
    } finally {
      await fs.remove(outsideRoot);
    }
  });

  it('rejects a report symlink that resolves outside the active workspace', async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-publication-report-outside-'));
    try {
      const outsideReport = path.join(outsideRoot, 'report.md');
      await fs.outputFile(outsideReport, '# Agent testing\n\nA safe summary.\n');
      await fs.ensureDir(path.dirname(reportPath));
      await fs.symlink(outsideReport, reportPath);

      await expect(buildResearchPublicationDraft({
        workspaceRoot,
        markdownPath: reportPath,
        visibility: 'public',
        apiBaseUrl: 'https://openresearch.autohand.ai',
      })).rejects.toThrow(/workspace/i);
    } finally {
      await fs.remove(outsideRoot);
    }
  });

  it('rejects a file with an image extension but unsupported bytes', async () => {
    await fs.outputFile(
      path.join(workspaceRoot, '.autohand', 'research', 'images', 'fake.png'),
      'not a raster image',
    );
    await fs.outputFile(
      reportPath,
      '# Agent testing\n\nA safe summary.\n\n![Fake](images/fake.png)\n',
    );

    await expect(buildResearchPublicationDraft({
      workspaceRoot,
      markdownPath: reportPath,
      visibility: 'public',
      apiBaseUrl: 'https://openresearch.autohand.ai',
    })).rejects.toThrow(/supported PNG, JPEG, WebP, or GIF/i);
  });

  it('detects report changes made after preview and before commit', async () => {
    await fs.outputFile(reportPath, '# Agent testing\n\nA safe summary.\n');
    const draft = await buildResearchPublicationDraft({
      workspaceRoot,
      markdownPath: reportPath,
      visibility: 'public',
      apiBaseUrl: 'https://openresearch.autohand.ai',
    });

    await fs.appendFile(reportPath, '\nChanged after confirmation.\n');

    await expect(assertResearchPublicationDraftUnchanged(draft)).rejects.toThrow(/changed/i);
  });

  it('derives the documented deterministic idempotency key', async () => {
    await fs.outputFile(reportPath, '# Agent testing\n\nA safe summary.\n');
    const draft = await buildResearchPublicationDraft({
      workspaceRoot,
      markdownPath: reportPath,
      visibility: 'public',
      apiBaseUrl: 'https://openresearch.autohand.ai',
    });
    const expectedDigest = createHash('sha256')
      .update([
        draft.apiOrigin,
        draft.workspaceRelativeMarkdownPath,
        draft.markdownSha256,
        draft.visibility,
        '',
      ].join('\0'))
      .digest('hex')
      .slice(0, 48);

    expect(derivePublicationIdempotencyKey(draft)).toBe(`deep-research-v1:${expectedDigest}`);
  });
});
