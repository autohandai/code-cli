/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const modalMocks = vi.hoisted(() => ({
  showConfirm: vi.fn(),
  showModal: vi.fn(),
}));

vi.mock('../../src/ui/ink/components/Modal.js', () => modalMocks);

import { TerminalResearchPublicationPrompts } from '../../src/research/TerminalResearchPublicationPrompts.js';
import type { ResearchPublicationDraft } from '../../src/research/ResearchManifestBuilder.js';

describe('TerminalResearchPublicationPrompts', () => {
  beforeEach(() => {
    modalMocks.showConfirm.mockReset();
    modalMocks.showModal.mockReset();
  });

  it('defaults the initial publication question to No', async () => {
    modalMocks.showConfirm.mockResolvedValue(false);

    await new TerminalResearchPublicationPrompts().confirmPublish();

    expect(modalMocks.showConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Would you like to publish this research?',
      defaultValue: false,
    }));
  });

  it('preselects Cancel rather than Public in the visibility picker', async () => {
    modalMocks.showModal.mockResolvedValue({ label: 'Cancel', value: 'cancel' });

    await expect(new TerminalResearchPublicationPrompts().selectVisibility()).resolves.toBeNull();
    expect(modalMocks.showModal).toHaveBeenCalledWith(expect.objectContaining({
      initialIndex: 0,
      options: [
        expect.objectContaining({ value: 'cancel' }),
        expect.objectContaining({ value: 'private' }),
        expect.objectContaining({ value: 'public' }),
      ],
    }));
  });

  it('shows the complete redacted preview and defaults final confirmation to Cancel', async () => {
    modalMocks.showConfirm.mockResolvedValue(false);
    const value = draft();

    await new TerminalResearchPublicationPrompts().confirmFinal(value);

    expect(modalMocks.showConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringMatching(
        /Title: Agent testing[\s\S]*File: \/workspace\/.autohand\/research\/topic.md[\s\S]*Visibility: Private[\s\S]*Images: 0[\s\S]*Upload: 38 B[\s\S]*Host: https:\/\/openresearch.autohand.ai[\s\S]*shown once/,
      ),
      defaultValue: false,
    }));
  });

  it('keeps a private code inside the ephemeral modal result', async () => {
    modalMocks.showModal.mockResolvedValue({ label: 'Close', value: 'close' });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await new TerminalResearchPublicationPrompts().showPrivateResult({
        url: 'https://openresearch.autohand.ai/research/or_private/',
        accessCode: 'PRIVATE-CODE-ONLY-IN-MODAL',
      });

      expect(modalMocks.showModal).toHaveBeenCalledWith(expect.objectContaining({
        title: expect.stringContaining('PRIVATE-CODE-ONLY-IN-MODAL'),
        options: [expect.objectContaining({ value: 'close' })],
      }));
      expect(consoleSpy).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

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
