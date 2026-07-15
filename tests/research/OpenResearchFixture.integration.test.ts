/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpenResearchClient } from '../../src/research/OpenResearchClient.js';
import { buildResearchPublicationDraft } from '../../src/research/ResearchManifestBuilder.js';

const contractOrigin = process.env.OPEN_RESEARCH_CONTRACT_ORIGIN;
const contractToken = process.env.OPEN_RESEARCH_CONTRACT_TOKEN;
const contractTest = contractOrigin && contractToken ? it : it.skip;
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('Goal 02 Open Research loopback contract', () => {
  let workspaceRoot: string;

  beforeAll(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-open-research-contract-'));
  });

  afterAll(async () => {
    await fs.remove(workspaceRoot);
  });

  contractTest('publishes assets, replays public commits, and redacts private retry codes', async () => {
    const origin = contractOrigin!;
    const token = contractToken!;
    const researchDir = path.join(workspaceRoot, '.autohand', 'research');
    await fs.outputFile(path.join(researchDir, 'images', 'pixel.png'), PIXEL);
    const publicPath = path.join(researchDir, 'topic-public.md');
    await fs.outputFile(
      publicPath,
      '# Public agent test posture\n\nA loopback report with one local image.\n\n![Fixture pixel](images/pixel.png)\n',
    );
    const publicDraft = await buildResearchPublicationDraft({
      workspaceRoot,
      markdownPath: publicPath,
      visibility: 'public',
      apiBaseUrl: origin,
    });
    const client = new OpenResearchClient();

    const published = await client.publish(publicDraft, token);
    const replayed = await client.publish(publicDraft, token);

    expect(published.visibility).toBe('public');
    expect(published.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/research\//);
    expect(replayed.reportId).toBe(published.reportId);
    expect(replayed.idempotentReplay).toBe(true);

    const privatePath = path.join(researchDir, 'topic-private.md');
    await fs.outputFile(
      privatePath,
      '# Private agent test posture\n\nA private loopback report.\n',
    );
    const privateDraft = await buildResearchPublicationDraft({
      workspaceRoot,
      markdownPath: privatePath,
      visibility: 'private',
      apiBaseUrl: origin,
    });
    const privatePublished = await client.publish(privateDraft, token);
    const capturedCode = privatePublished.accessCode;
    privatePublished.accessCode = null;
    const privateReplay = await client.publish(privateDraft, token);

    expect(capturedCode).toMatch(/^[0-9A-Z-]{24,80}$/);
    expect(privateReplay.reportId).toBe(privatePublished.reportId);
    expect(privateReplay.accessCode).toBeNull();
    const receipt = await fs.readFile(privateDraft.receiptPath, 'utf8');
    expect(receipt).not.toContain(capturedCode!);
  });
});
