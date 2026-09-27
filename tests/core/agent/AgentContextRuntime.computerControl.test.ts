/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { buildAgentUserMessage, type AgentContextRuntimeHost } from '../../../src/core/agent/AgentContextRuntime.js';

const COMPUTER_MARKER = 'COMPUTER-CONTROL-WORKFLOW-MARKER';

describe('buildAgentUserMessage computer control auto-injection', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-computer-intent-'));
  });

  afterEach(async () => {
    await fs.remove(workspaceRoot);
  });

  function host(alreadyMentioned = false): AgentContextRuntimeHost {
    return {
      runtime: { options: {}, workspaceRoot, config: {} },
      ignoreFilter: { isIgnored: () => false },
      mentionResolver: { clear: vi.fn(), flush: vi.fn(() => null) },
      recordExploration: vi.fn(),
      skillsRegistry: {
        getActiveSkills: () => [],
        activateMentionedSkills: () => alreadyMentioned
          ? [{ name: 'computer-control', description: 'Operate native apps.', body: COMPUTER_MARKER }]
          : [],
        getSkill: (name: string) => name === 'computer-control'
          ? { name, description: 'Operate native apps.', body: COMPUTER_MARKER }
          : undefined,
      },
    } as unknown as AgentContextRuntimeHost;
  }

  it('injects the built-in workflow for a native GUI request', async () => {
    const message = await buildAgentUserMessage(host(), 'go to Spotify and play Midnight City');
    expect(message).toContain('Computer control mode');
    expect(message).toContain(COMPUTER_MARKER);
  });

  it('stays silent for source work that mentions a browser', async () => {
    const message = await buildAgentUserMessage(host(), 'build a browser extension');
    expect(message).not.toContain(COMPUTER_MARKER);
  });

  it('does not inject the skill twice when it was explicitly mentioned', async () => {
    const message = await buildAgentUserMessage(host(true), 'open my browser with $computer-control');
    expect(message).toContain('Explicitly requested skill: computer-control');
    expect(message).not.toContain('Computer control mode');
    expect(message.split(COMPUTER_MARKER).length - 1).toBe(1);
  });
});
