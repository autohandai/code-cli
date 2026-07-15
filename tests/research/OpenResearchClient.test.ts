/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenResearchClient } from '../../src/research/OpenResearchClient.js';
import type { ResearchPublicationDraft } from '../../src/research/ResearchManifestBuilder.js';

const ATTEMPT_ID = `pa_${'a'.repeat(26)}`;
const REPORT_ID = `or_${'b'.repeat(26)}`;
const REPORT_URL = 'https://openresearch.autohand.ai/research/agent-testing/';

describe('OpenResearchClient', () => {
  let workspaceRoot: string;
  let value: ResearchPublicationDraft;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-publication-client-'));
    const markdownAbsolutePath = path.join(workspaceRoot, '.autohand', 'research', 'topic.md');
    await fs.outputFile(markdownAbsolutePath, '# Agent testing\n\nA saved report.\n');
    value = {
      apiOrigin: 'https://openresearch.autohand.ai',
      workspaceRootRealPath: workspaceRoot,
      markdownAbsolutePath,
      workspaceRelativeMarkdownPath: '.autohand/research/topic.md',
      receiptPath: `${markdownAbsolutePath}.publication.json`,
      title: 'Agent testing',
      summary: 'A saved report.',
      visibility: 'public',
      markdown: '# Agent testing\n\nA saved report.\n',
      markdownBytes: Buffer.from('# Agent testing\n\nA saved report.\n'),
      markdownSha256: 'a'.repeat(64),
      assets: [],
      topics: [],
      totalUploadBytes: 38,
    };
  });

  afterEach(async () => {
    await fs.remove(workspaceRoot);
  });

  it('creates and commits with bearer auth and a deterministic key without persisting secrets', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json(createResponse(), { status: 201 }))
      .mockResolvedValueOnce(Response.json(commitResponse()));
    const verifyUnchanged = vi.fn(async () => {});
    const client = new OpenResearchClient({ fetchImpl, verifyUnchanged });

    const result = await client.publish(value, 'fixture-token');

    expect(result.url).toBe(REPORT_URL);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const createRequest = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(new Headers(createRequest.headers).get('Authorization')).toBe('Bearer fixture-token');
    expect(new Headers(createRequest.headers).get('Idempotency-Key')).toMatch(/^deep-research-v1:[a-f0-9]{48}$/);
    expect(verifyUnchanged).toHaveBeenCalledOnce();

    const receipt = await fs.readFile(value.receiptPath, 'utf8');
    expect(receipt).toContain(ATTEMPT_ID);
    expect(receipt).toContain(REPORT_URL);
    expect(receipt).not.toContain('fixture-token');
    expect(receipt).not.toContain('PRIVATE-CODE');
  });

  it('recovers an uncertain commit through the saved attempt instead of creating a duplicate', async () => {
    const firstFetch = vi.fn()
      .mockResolvedValueOnce(Response.json(createResponse(), { status: 201 }))
      .mockRejectedValueOnce(new TypeError('connection closed after commit'));
    const firstClient = new OpenResearchClient({
      fetchImpl: firstFetch,
      verifyUnchanged: vi.fn(async () => {}),
    });

    await expect(firstClient.publish(value, 'fixture-token')).rejects.toThrow(/network/i);

    const recoveryFetch = vi.fn().mockResolvedValueOnce(Response.json({
      attemptId: ATTEMPT_ID,
      state: 'committed',
      visibility: 'public',
      slug: null,
      expiresAt: '2099-01-01T00:00:00.000Z',
      failureCode: null,
      missingAssets: [],
      reportId: REPORT_ID,
      reportUrl: REPORT_URL,
    }));
    const recoveryClient = new OpenResearchClient({
      fetchImpl: recoveryFetch,
      verifyUnchanged: vi.fn(async () => {}),
    });

    const recovered = await recoveryClient.publish(value, 'fixture-token');

    expect(recovered).toMatchObject({
      reportId: REPORT_ID,
      url: REPORT_URL,
      idempotentReplay: true,
      accessCode: null,
    });
    expect(recoveryFetch).toHaveBeenCalledOnce();
    expect(recoveryFetch.mock.calls[0][0]).toContain(`/api/v1/publication-attempts/${ATTEMPT_ID}`);
  });

  it('uploads only assigned assets with exact media, length, and digest', async () => {
    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    const assetId = `ra_${'c'.repeat(26)}`;
    const assetPath = path.join(workspaceRoot, '.autohand', 'research', 'images', 'pixel.png');
    await fs.outputFile(assetPath, bytes);
    value.assets = [{
      logicalReference: 'images/pixel.png',
      filename: 'pixel.png',
      mediaType: 'image/png',
      byteCount: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      alternativeText: 'One pixel',
      absolutePath: await fs.realpath(assetPath),
      bytes,
    }];
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({
        ...createResponse(),
        state: 'staging',
        assets: [{
          assetId,
          logicalReference: 'images/pixel.png',
          state: 'declared',
          uploadUrl: `/api/v1/publication-attempts/${ATTEMPT_ID}/assets/${assetId}`,
        }],
      }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({
        attemptId: ATTEMPT_ID,
        assetId,
        state: 'uploaded',
        byteCount: bytes.byteLength,
        sha256: value.assets[0].sha256,
        width: 1,
        height: 1,
      }))
      .mockResolvedValueOnce(Response.json(commitResponse()));
    const client = new OpenResearchClient({
      fetchImpl,
      verifyUnchanged: vi.fn(async () => {}),
    });

    await client.publish(value, 'fixture-token');

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const upload = fetchImpl.mock.calls[1][1] as RequestInit;
    expect(upload.method).toBe('PUT');
    expect(new Headers(upload.headers).get('Content-Type')).toBe('image/png');
    expect(new Headers(upload.headers).get('Content-Length')).toBe(String(bytes.byteLength));
    expect(Buffer.from(upload.body as Buffer)).toEqual(bytes);
  });

  it('records only that a private code was captured, never the code itself', async () => {
    value.visibility = 'private';
    const accessCode = 'ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345';
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({
        ...createResponse(),
        visibility: 'private',
      }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({
        reportId: REPORT_ID,
        visibility: 'private',
        revision: 1,
        url: 'https://openresearch.autohand.ai/research/or_private/',
        accessCode,
        accessCodeAvailable: true,
        idempotentReplay: false,
      }));
    const client = new OpenResearchClient({
      fetchImpl,
      verifyUnchanged: vi.fn(async () => {}),
    });

    const result = await client.publish(value, 'fixture-token');

    expect(result.accessCode).toBe(accessCode);
    const receipt = await fs.readFile(value.receiptPath, 'utf8');
    expect(receipt).toContain('"accessCodeCaptured": true');
    expect(receipt).not.toContain(accessCode);
  });
});

function createResponse() {
  return {
    attemptId: ATTEMPT_ID,
    state: 'ready',
    visibility: 'public',
    slug: null,
    expiresAt: '2099-01-01T00:00:00.000Z',
    idempotentReplay: false,
    assets: [],
    statusUrl: `/api/v1/publication-attempts/${ATTEMPT_ID}`,
    commitUrl: `/api/v1/publication-attempts/${ATTEMPT_ID}/commit`,
  };
}

function commitResponse() {
  return {
    reportId: REPORT_ID,
    visibility: 'public',
    revision: 1,
    url: REPORT_URL,
    accessCode: null,
    accessCodeAvailable: false,
    idempotentReplay: false,
  };
}
