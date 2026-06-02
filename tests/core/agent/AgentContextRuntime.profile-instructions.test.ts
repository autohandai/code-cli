/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import {
  loadAgentInstructionFiles,
  type AgentContextRuntimeHost,
} from '../../../src/core/agent/AgentContextRuntime.js';

describe('loadAgentInstructionFiles agent profile instructions', () => {
  let tempDir: string;
  let previousAutohandHome: string | undefined;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-profile-instructions-'));
    previousAutohandHome = process.env.AUTOHAND_HOME;
  });

  afterEach(async () => {
    if (previousAutohandHome === undefined) {
      delete process.env.AUTOHAND_HOME;
    } else {
      process.env.AUTOHAND_HOME = previousAutohandHome;
    }
    await fs.remove(tempDir);
  });

  function hostFor(workspaceRoot: string): AgentContextRuntimeHost {
    return {
      activeProvider: 'openai',
      runtime: {
        options: {},
        workspaceRoot,
        config: {},
      },
      getParallelismLimit: () => 3,
    } as unknown as AgentContextRuntimeHost;
  }

  it('loads workspace AGENTS.md and AUTOHAND_HOME AGENTS.md as separate instruction sections', async () => {
    const workspaceRoot = path.join(tempDir, 'workspace');
    const agentHome = path.join(tempDir, 'agent-home');
    await fs.ensureDir(workspaceRoot);
    await fs.ensureDir(agentHome);
    await fs.writeFile(path.join(workspaceRoot, 'AGENTS.md'), '# Project\n\nUse project rules.');
    await fs.writeFile(path.join(agentHome, 'AGENTS.md'), '# Profile Map\n\nRead profile/PERSONA.md when style matters.');
    process.env.AUTOHAND_HOME = agentHome;

    const instructions = await loadAgentInstructionFiles(hostFor(workspaceRoot));

    expect(instructions).toHaveLength(2);
    expect(instructions[0]).toContain('## Project Instructions (AGENTS.md)');
    expect(instructions[0]).toContain('Use project rules.');
    expect(instructions[1]).toContain('## Agent Profile Instructions ($AUTOHAND_HOME/AGENTS.md)');
    expect(instructions[1]).toContain('profile/PERSONA.md');
  });

  it('does not load default user AGENTS.md unless AUTOHAND_HOME is explicit', async () => {
    const workspaceRoot = path.join(tempDir, 'workspace');
    await fs.ensureDir(workspaceRoot);
    await fs.writeFile(path.join(workspaceRoot, 'AGENTS.md'), '# Project\n\nUse project rules.');
    delete process.env.AUTOHAND_HOME;

    const instructions = await loadAgentInstructionFiles(hostFor(workspaceRoot));

    expect(instructions).toHaveLength(1);
    expect(instructions[0]).toContain('## Project Instructions (AGENTS.md)');
    expect(instructions[0]).not.toContain('Agent Profile Instructions');
  });
});
