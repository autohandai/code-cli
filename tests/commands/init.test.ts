/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { init, metadata } from '../../src/commands/init.js';
import { AGENTS_MD_SECTIONS, buildInitInstruction } from '../../src/onboarding/initInstruction.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.remove(root)));
});

async function workspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-init-'));
  roots.push(root);
  return root;
}

describe('/init', () => {
  it('queues a background turn that reads the repository before writing AGENTS.md', async () => {
    const root = await workspace();
    const queueInstruction = vi.fn();
    const createAgentsFile = vi.fn();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(await init({ createAgentsFile, workspaceRoot: root, queueInstruction })).toBeNull();

    expect(createAgentsFile).not.toHaveBeenCalled();
    expect(queueInstruction).toHaveBeenCalledOnce();
    const [instruction, postTurn, policy] = queueInstruction.mock.calls[0];
    expect(instruction).toBe(buildInitInstruction(root));
    for (const section of AGENTS_MD_SECTIONS) expect(instruction).toContain(`"${section}"`);
    expect(instruction).toContain('Never invent a command');
    expect(postTurn).toBeUndefined();
    expect(policy).toEqual({ environmentBootstrap: 'skip' });
    expect(log.mock.calls.flat().join('\n')).toContain('composer stays free');
  });

  it('writes the static template for --basic and in non-interactive runs', async () => {
    const root = await workspace();
    const queueInstruction = vi.fn();
    const createAgentsFile = vi.fn().mockResolvedValue(undefined);
    await init({ createAgentsFile, workspaceRoot: root, queueInstruction }, ['--basic']);
    await init({ createAgentsFile, workspaceRoot: root, queueInstruction, isNonInteractive: true });
    await init({ createAgentsFile });
    expect(createAgentsFile).toHaveBeenCalledTimes(3);
    expect(queueInstruction).not.toHaveBeenCalled();
  });

  it('does not queue anything when AGENTS.md already exists', async () => {
    const root = await workspace();
    await fs.writeFile(path.join(root, 'AGENTS.md'), '# existing');
    const queueInstruction = vi.fn();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await init({ createAgentsFile: vi.fn(), workspaceRoot: root, queueInstruction });
    expect(queueInstruction).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join('\n')).toContain('already exists');
  });

  it('advertises the basic subcommand', () => {
    expect(metadata.subcommands?.map((entry) => entry.name)).toEqual(['basic']);
  });
});
