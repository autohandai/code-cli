/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { buildAgentUserMessage, type AgentContextRuntimeHost } from '../../../src/core/agent/AgentContextRuntime.js';
import { getPlanModeManager } from '../../../src/commands/plan.js';

const ARCHITECT_MARKER = 'ARCHITECT-LENS-BODY-MARKER';

describe('buildAgentUserMessage brainstorm auto-injection', () => {
  let workspaceRoot: string;

  function hostFor(overrides: {
    activateMentionedSkills?: () => Array<{ name: string; description: string; body: string }>;
    getSkill?: (name: string) => { name: string; description: string; body: string } | undefined;
  } = {}): AgentContextRuntimeHost {
    return {
      runtime: { options: {}, workspaceRoot, config: {} },
      ignoreFilter: { isIgnored: () => false },
      mentionResolver: { clear: vi.fn(), flush: vi.fn(() => null) },
      recordExploration: vi.fn(),
      skillsRegistry: {
        getActiveSkills: () => [],
        activateMentionedSkills: overrides.activateMentionedSkills ?? (() => []),
        getSkill:
          overrides.getSkill ??
          ((name: string) =>
            name === 'brainstorm'
              ? { name: 'brainstorm', description: 'Design with three lenses.', body: ARCHITECT_MARKER }
              : undefined),
      },
    } as unknown as AgentContextRuntimeHost;
  }

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-brainstorm-'));
    getPlanModeManager().disable();
  });

  afterEach(async () => {
    getPlanModeManager().disable();
    await fs.remove(workspaceRoot);
  });

  it('injects the brainstorm playbook in plan mode even for an execution-shaped instruction', async () => {
    getPlanModeManager().enable();

    const message = await buildAgentUserMessage(hostFor(), 'fix the bug in auth.ts');

    expect(message).toContain('Brainstorming mode');
    expect(message).toContain('Plan mode is active');
    expect(message).toContain(ARCHITECT_MARKER);
  });

  it('stops injecting once plan mode leaves the planning phase for execution', async () => {
    const manager = getPlanModeManager();
    manager.enable();
    manager.setPlan({ id: 'p1', steps: [], rawText: 'do the work', createdAt: Date.now() });
    manager.startExecution();
    expect(manager.getPhase()).toBe('executing');

    const message = await buildAgentUserMessage(hostFor(), 'fix the bug in auth.ts');

    expect(message).not.toContain('Brainstorming mode');
    expect(message).not.toContain(ARCHITECT_MARKER);
  });

  it('injects the brainstorm playbook in normal mode when the instruction is design-shaped', async () => {
    const message = await buildAgentUserMessage(hostFor(), "let's design the auth flow");

    expect(message).toContain('Brainstorming mode');
    expect(message).toContain(ARCHITECT_MARKER);
  });

  it('does not inject in normal mode for an ordinary instruction', async () => {
    const message = await buildAgentUserMessage(hostFor(), 'run the tests');

    expect(message).not.toContain('Brainstorming mode');
    expect(message).not.toContain(ARCHITECT_MARKER);
  });

  it('does not double-inject when the user explicitly mentions $brainstorm', async () => {
    const message = await buildAgentUserMessage(
      hostFor({
        activateMentionedSkills: () => [
          { name: 'brainstorm', description: 'Design with three lenses.', body: ARCHITECT_MARKER },
        ],
      }),
      "let's design the auth flow",
    );

    expect(message).toContain('Explicitly requested skill: brainstorm');
    expect(message).not.toContain('Brainstorming mode');
    expect(message.split(ARCHITECT_MARKER).length - 1).toBe(1);
  });
});
