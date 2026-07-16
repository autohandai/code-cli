/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import {
  ResearchPublicationService,
  type ResearchPublicationPrompts,
} from '../../src/research/ResearchPublicationService.js';
import type { ResearchPublicationDraft } from '../../src/research/ResearchManifestBuilder.js';

function draft(): ResearchPublicationDraft {
  return {
    apiOrigin: 'https://openresearch.autohand.ai',
    workspaceRootRealPath: '/workspace',
    markdownAbsolutePath: '/workspace/.autohand/research/topic.md',
    workspaceRelativeMarkdownPath: '.autohand/research/topic.md',
    receiptPath: '/workspace/.autohand/research/topic.md.publication.json',
    title: 'Agent testing',
    summary: 'A saved report.',
    visibility: 'private',
    markdown: '# Agent testing\n\nA saved report.\n',
    markdownBytes: Buffer.from('# Agent testing\n\nA saved report.\n'),
    markdownSha256: 'a'.repeat(64),
    assets: [],
    topics: [],
    totalUploadBytes: 38,
  };
}

function prompts(overrides: Partial<ResearchPublicationPrompts> = {}): ResearchPublicationPrompts {
  return {
    confirmPublish: vi.fn(async () => true),
    selectVisibility: vi.fn(async () => 'private'),
    confirmFinal: vi.fn(async () => true),
    showPrivateResult: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('ResearchPublicationService', () => {
  it('does nothing in a non-interactive environment, including global yes mode', async () => {
    const publicationPrompts = prompts();
    const publish = vi.fn();
    const service = new ResearchPublicationService({
      buildDraft: vi.fn(),
      verifyUnchanged: vi.fn(),
      validateSession: vi.fn(),
      publish,
      prompts: publicationPrompts,
    });

    const result = await service.offer({
      workspaceRoot: '/workspace',
      reportPath: '.autohand/research/topic.md',
      token: 'token',
      interactive: false,
      yesMode: true,
    });

    expect(result.status).toBe('skipped');
    expect(publicationPrompts.confirmPublish).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('requires explicit consent even when global yes mode is enabled', async () => {
    const publicationPrompts = prompts({
      confirmPublish: vi.fn(async () => false),
    });
    const publish = vi.fn();
    const service = new ResearchPublicationService({
      buildDraft: vi.fn(),
      verifyUnchanged: vi.fn(),
      validateSession: vi.fn(),
      publish,
      prompts: publicationPrompts,
    });

    const result = await service.offer({
      workspaceRoot: '/workspace',
      reportPath: '.autohand/research/topic.md',
      token: 'token',
      interactive: true,
      yesMode: true,
    });

    expect(result.status).toBe('cancelled');
    expect(publicationPrompts.confirmPublish).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
  });

  it('validates and previews before the default-cancel final confirmation', async () => {
    const value = draft();
    const publicationPrompts = prompts({
      confirmFinal: vi.fn(async () => false),
    });
    const buildDraft = vi.fn(async () => value);
    const publish = vi.fn();
    const service = new ResearchPublicationService({
      buildDraft,
      verifyUnchanged: vi.fn(),
      validateSession: vi.fn(),
      publish,
      prompts: publicationPrompts,
    });

    const result = await service.offer({
      workspaceRoot: '/workspace',
      reportPath: '.autohand/research/topic.md',
      token: 'token',
      interactive: true,
    });

    expect(result.status).toBe('cancelled');
    expect(buildDraft).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'private' }));
    expect(publicationPrompts.confirmFinal).toHaveBeenCalledWith(value);
    expect(publish).not.toHaveBeenCalled();
  });

  it('shows a private code only through the ephemeral prompt and omits it from the outcome', async () => {
    const value = draft();
    const publicationPrompts = prompts();
    const resultWithCode = {
      reportId: `or_${'b'.repeat(26)}`,
      visibility: 'private' as const,
      revision: 1,
      url: 'https://openresearch.autohand.ai/research/private-report/',
      accessCode: 'PRIVATE-CODE-MUST-NOT-PERSIST',
      accessCodeAvailable: true as const,
      idempotentReplay: false as const,
    };
    const service = new ResearchPublicationService({
      buildDraft: vi.fn(async () => value),
      verifyUnchanged: vi.fn(async () => {}),
      validateSession: vi.fn(async () => ({ authenticated: true })),
      publish: vi.fn(async () => resultWithCode),
      prompts: publicationPrompts,
    });

    const result = await service.offer({
      workspaceRoot: '/workspace',
      reportPath: '.autohand/research/topic.md',
      token: 'token',
      interactive: true,
    });

    expect(publicationPrompts.showPrivateResult).toHaveBeenCalledWith({
      url: resultWithCode.url,
      accessCode: 'PRIVATE-CODE-MUST-NOT-PERSIST',
    });
    expect(result).toEqual({
      status: 'published',
      visibility: 'private',
      url: resultWithCode.url,
      accessCodeWasAvailable: true,
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE-CODE-MUST-NOT-PERSIST');
    expect(resultWithCode.accessCode).toBeNull();
  });

  it('uses the current login and leaves the report local when authentication is invalid', async () => {
    const service = new ResearchPublicationService({
      buildDraft: vi.fn(async () => draft()),
      verifyUnchanged: vi.fn(),
      validateSession: vi.fn(async () => ({ authenticated: false })),
      publish: vi.fn(),
      prompts: prompts(),
    });

    const result = await service.offer({
      workspaceRoot: '/workspace',
      reportPath: '.autohand/research/topic.md',
      token: 'expired-token',
      interactive: true,
    });

    expect(result).toMatchObject({ status: 'failed' });
    expect(result.message).toContain('/login');
    expect(result.message).toContain('.autohand/research/topic.md');
  });
});
