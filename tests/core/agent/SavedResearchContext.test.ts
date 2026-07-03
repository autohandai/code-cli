/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAgentUserMessage } from '../../../src/core/agent/AgentContextRuntime.js';
import { listSavedResearchReports } from '../../../src/core/agent/SavedResearchContext.js';
import { buildSessionBootstrap } from '../../../src/core/agent/SessionBootstrapBuilder.js';

describe('saved research context', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-saved-research-'));
    await fs.outputFile(
      path.join(workspaceRoot, '.autohand', 'research', 'topic-dspy.md'),
      [
        '# DSPy Research',
        '',
        '## Summary',
        'DSPy optimizes language model programs through declarative modules.',
        '',
        '## Sources',
        '- [1] https://dspy.ai',
      ].join('\n')
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.remove(workspaceRoot);
  });

  it('lists saved research reports with titles, excerpts, and project-relative paths', async () => {
    const reports = await listSavedResearchReports(workspaceRoot);

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      relativePath: '.autohand/research/topic-dspy.md',
      title: 'DSPy Research',
      excerpt: 'DSPy optimizes language model programs through declarative modules.',
    });
  });

  it('adds saved research to the session bootstrap', async () => {
    const bootstrap = await buildSessionBootstrap({
      workspaceRoot,
      getContextMemories: async () => '',
      getActiveSkills: () => [],
    });

    expect(bootstrap).toContain('## Saved Research');
    expect(bootstrap).toContain('.autohand/research/topic-dspy.md');
    expect(bootstrap).toContain('DSPy Research');
  });

  it('surfaces saved research in the next user prompt context', async () => {
    const message = await buildAgentUserMessage({
      runtime: {
        workspaceRoot,
        options: {},
      },
      ignoreFilter: {
        isIgnored: () => false,
      },
      mentionResolver: {
        flush: () => null,
      },
      recordExploration: vi.fn(),
    } as any, 'Use the previous research');

    expect(message).toContain('Saved research reports');
    expect(message).toContain('.autohand/research/topic-dspy.md');
    expect(message).toContain('DSPy Research');
    expect(message).toContain('Instruction: Use the previous research');
  });
});
