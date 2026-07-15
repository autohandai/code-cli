/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentRegistry } from '../../../src/core/agents/AgentRegistry.js';
import type { ExtensionAgentContribution } from '../../../src/extensions/types.js';

function extensionAgent(name: string, extensionId = 'autohand.test-triage'): ExtensionAgentContribution {
  return {
    name,
    description: 'Triage failing tests',
    systemPrompt: 'Inspect failures and propose the smallest correction.',
    tools: ['run_focused_test'],
    provenance: {
      extensionId,
      extensionVersion: '1.0.0',
      scope: 'user',
      packageRoot: `/tmp/${extensionId}`,
      file: `/tmp/${extensionId}/agents/${name}.md`,
    },
  };
}

describe('AgentRegistry extension agents', () => {
  const tempRoots: string[] = [];

  beforeEach(() => {
    (AgentRegistry as unknown as { instance?: AgentRegistry }).instance = undefined;
  });

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it('registers extension agents with provenance and replaces stale snapshots', () => {
    const registry = AgentRegistry.getInstance();
    registry.setExtensionAgents([extensionAgent('failure-triage')]);

    expect(registry.getAgent('failure-triage')).toMatchObject({
      source: 'extension',
      description: 'Triage failing tests',
      extensionId: 'autohand.test-triage',
      extensionVersion: '1.0.0',
    });
    expect(registry.getAgentsBySource('extension')).toHaveLength(1);

    registry.setExtensionAgents([extensionAgent('replacement', 'autohand.replacement')]);
    expect(registry.getAgent('failure-triage')).toBeUndefined();
    expect(registry.getAgent('replacement')).toMatchObject({ source: 'extension' });
  });

  it('keeps existing file agents ahead of extension agents with the same name', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-extension-agent-'));
    tempRoots.push(root);
    await fs.writeFile(path.join(root, 'reviewer.md'), '# User Reviewer\n\nUser-owned prompt.\n');
    const registry = AgentRegistry.getInstance();
    (registry as unknown as { agentsDir: string }).agentsDir = root;
    registry.setExtensionAgents([extensionAgent('reviewer')]);

    await registry.loadAgents();

    expect(registry.getAgent('reviewer')).toMatchObject({
      source: 'user',
      description: 'User Reviewer',
    });
    expect(registry.getAllAgents().filter((agent) => agent.name === 'reviewer')).toHaveLength(1);
  });

  it('keeps inline session agents ahead of extension agents', () => {
    const registry = AgentRegistry.getInstance();
    registry.setExtensionAgents([extensionAgent('reviewer')]);
    registry.setSessionAgents([{
      name: 'reviewer',
      description: 'Session reviewer',
      systemPrompt: 'Session prompt',
      tools: ['*'],
    }]);

    expect(registry.getAgent('reviewer')).toMatchObject({ source: 'session' });
  });
});
