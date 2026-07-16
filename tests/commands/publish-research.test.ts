/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { metadata, publishResearch } from '../../src/commands/publish-research.js';
import type { SlashCommandContext } from '../../src/core/slashCommandTypes.js';

describe('/publish-research', () => {
  it('is registered as an interactive recovery command', () => {
    expect(metadata).toMatchObject({
      command: '/publish-research',
      implemented: true,
    });
  });

  it('requires a path and never infers one from the transcript', async () => {
    const requestResearchPublication = vi.fn();
    const result = await publishResearch({
      workspaceRoot: '/workspace',
      requestResearchPublication,
    } as SlashCommandContext, []);

    expect(result).toContain('Usage: /publish-research <path>');
    expect(requestResearchPublication).not.toHaveBeenCalled();
  });

  it('delegates to the same publication flow with the literal path', async () => {
    const requestResearchPublication = vi.fn(async () => 'Published: https://example.test/research/id/');
    const result = await publishResearch({
      workspaceRoot: '/workspace',
      requestResearchPublication,
    } as SlashCommandContext, ['.autohand/research/topic.md']);

    expect(requestResearchPublication).toHaveBeenCalledWith('.autohand/research/topic.md');
    expect(result).toContain('Published');
  });
});
