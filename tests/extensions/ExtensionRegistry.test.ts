/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExtensionRegistry } from '../../src/extensions/ExtensionRegistry.js';

interface PackageOptions {
  id: string;
  version?: string;
  toolName?: string;
  agentName?: string;
  invalidTool?: boolean;
  skillName?: string;
  invalidSkill?: boolean;
}

describe('ExtensionRegistry', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
  });

  async function makeRoot(name: string): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `autohand-${name}-`));
    tempRoots.push(root);
    return root;
  }

  async function writePackage(extensionsRoot: string, options: PackageOptions): Promise<string> {
    const packageRoot = path.join(extensionsRoot, options.id);
    const toolName = options.toolName ?? 'inspect_code';
    const agentName = options.agentName ?? 'code-reviewer';
    const skillName = options.skillName ?? `${options.id.split('.').at(-1)}-skill`;
    await fs.ensureDir(path.join(packageRoot, 'tools'));
    await fs.ensureDir(path.join(packageRoot, 'agents'));
    await fs.ensureDir(path.join(packageRoot, 'skills', skillName));
    await fs.writeJson(path.join(packageRoot, 'autohand.extension.json'), {
      schemaVersion: 1,
      extensionApi: 1,
      id: options.id,
      name: options.id,
      version: options.version ?? '1.0.0',
      description: `Extension ${options.id}`,
      contributes: {
        tools: [`tools/${toolName}.json`],
        agents: [`agents/${agentName}.md`],
        skills: [`skills/${skillName}/SKILL.md`],
      },
    });
    await fs.writeJson(path.join(packageRoot, 'tools', `${toolName}.json`), options.invalidTool
      ? { name: toolName, description: '', handler: 'echo invalid' }
      : {
          name: toolName,
          description: `Tool from ${options.id}`,
          parameters: { type: 'object', properties: {} },
          handler: `echo ${options.id}`,
          source: 'user',
        });
    await fs.writeFile(
      path.join(packageRoot, 'agents', `${agentName}.md`),
      `# ${agentName}\n\nAgent from ${options.id}.\n`,
    );
    await fs.writeFile(
      path.join(packageRoot, 'skills', skillName, 'SKILL.md'),
      options.invalidSkill
        ? '# Missing frontmatter\n'
        : `---\nname: ${skillName}\ndescription: Skill from ${options.id}\n---\n\nUse ${skillName}.\n`,
    );
    return packageRoot;
  }

  it('discovers extensions and contributions in deterministic id order', async () => {
    const userRoot = await makeRoot('user-extensions');
    await writePackage(userRoot, { id: 'autohand.zeta', toolName: 'zeta_tool', agentName: 'zeta-agent' });
    await writePackage(userRoot, { id: 'autohand.alpha', toolName: 'alpha_tool', agentName: 'alpha-agent' });

    const snapshot = await new ExtensionRegistry({ userRoot }).load();

    expect(snapshot.extensions.map((extension) => extension.manifest.id)).toEqual([
      'autohand.alpha',
      'autohand.zeta',
    ]);
    expect(snapshot.tools.map((tool) => tool.definition.name)).toEqual(['alpha_tool', 'zeta_tool']);
    expect(snapshot.agents.map((agent) => agent.name)).toEqual(['alpha-agent', 'zeta-agent']);
    expect(snapshot.skills.map((skill) => skill.definition.name)).toEqual(['alpha-skill', 'zeta-skill']);
    expect(snapshot.tools[0]?.provenance).toMatchObject({
      extensionId: 'autohand.alpha',
      extensionVersion: '1.0.0',
      scope: 'user',
    });
    expect(snapshot.diagnostics).toEqual([]);
  });

  it('lets one project package replace the same user extension id as a whole package', async () => {
    const userRoot = await makeRoot('user-extensions');
    const projectRoot = await makeRoot('project-extensions');
    await writePackage(userRoot, {
      id: 'autohand.shared',
      version: '1.0.0',
      toolName: 'user_tool',
      agentName: 'user-agent',
    });
    await writePackage(projectRoot, {
      id: 'autohand.shared',
      version: '2.0.0',
      toolName: 'project_tool',
      agentName: 'project-agent',
    });

    const snapshot = await new ExtensionRegistry({ userRoot, projectRoot }).load();

    expect(snapshot.extensions).toHaveLength(1);
    expect(snapshot.extensions[0]).toMatchObject({
      scope: 'project',
      manifest: { id: 'autohand.shared', version: '2.0.0' },
    });
    expect(snapshot.tools.map((tool) => tool.definition.name)).toEqual(['project_tool']);
    expect(snapshot.agents.map((agent) => agent.name)).toEqual(['project-agent']);
    expect(snapshot.skills).toEqual([
      expect.objectContaining({
        definition: expect.objectContaining({ name: 'shared-skill', source: 'extension' }),
        provenance: expect.objectContaining({ extensionId: 'autohand.shared', scope: 'project' }),
      }),
    ]);
  });

  it('excludes an invalid package without preventing other packages from loading', async () => {
    const userRoot = await makeRoot('user-extensions');
    await writePackage(userRoot, { id: 'autohand.valid', toolName: 'valid_tool' });
    await writePackage(userRoot, { id: 'autohand.invalid', toolName: 'invalid_tool', invalidTool: true });

    const snapshot = await new ExtensionRegistry({ userRoot }).load();

    expect(snapshot.extensions.map((extension) => extension.manifest.id)).toEqual(['autohand.valid']);
    expect(snapshot.tools.map((tool) => tool.definition.name)).toEqual(['valid_tool']);
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({
        code: 'invalid_tool',
        extensionId: 'autohand.invalid',
        message: expect.stringMatching(/invalid meta-tool definition/i),
      }),
    ]);
  });

  it('rejects contribution name conflicts instead of depending on discovery order', async () => {
    const userRoot = await makeRoot('user-extensions');
    await writePackage(userRoot, { id: 'autohand.alpha', toolName: 'shared_tool', agentName: 'shared-agent' });
    await writePackage(userRoot, { id: 'autohand.beta', toolName: 'shared_tool', agentName: 'shared-agent' });

    const snapshot = await new ExtensionRegistry({ userRoot }).load();

    expect(snapshot.extensions.map((extension) => extension.manifest.id)).toEqual(['autohand.alpha']);
    expect(snapshot.tools.map((tool) => tool.definition.name)).toEqual(['shared_tool']);
    expect(snapshot.agents.map((agent) => agent.name)).toEqual(['shared-agent']);
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({ code: 'contribution_conflict', extensionId: 'autohand.beta' }),
    ]);
  });

  it('indexes disabled packages but contributes no tools or agents', async () => {
    const userRoot = await makeRoot('user-extensions');
    await writePackage(userRoot, { id: 'autohand.disabled' });
    await fs.ensureDir(path.join(userRoot, '.state'));
    await fs.writeJson(path.join(userRoot, '.state', 'autohand.disabled.json'), { disabled: true });

    const snapshot = await new ExtensionRegistry({ userRoot }).load();

    expect(snapshot.extensions).toEqual([
      expect.objectContaining({ disabled: true, manifest: expect.objectContaining({ id: 'autohand.disabled' }) }),
    ]);
    expect(snapshot.tools).toEqual([]);
    expect(snapshot.agents).toEqual([]);
    expect(snapshot.skills).toEqual([]);
  });

  it('rejects a whole package when a contribution conflicts with reserved runtime names', async () => {
    const userRoot = await makeRoot('user-extensions');
    await writePackage(userRoot, {
      id: 'autohand.conflicting',
      toolName: 'read_file',
      agentName: 'reviewer',
    });

    const snapshot = await new ExtensionRegistry({ userRoot }).load({
      reservedToolNames: ['read_file'],
      reservedAgentNames: ['reviewer'],
      reservedSkillNames: ['conflicting-skill'],
    });

    expect(snapshot.extensions).toEqual([]);
    expect(snapshot.tools).toEqual([]);
    expect(snapshot.agents).toEqual([]);
    expect(snapshot.skills).toEqual([]);
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({
        code: 'contribution_conflict',
        extensionId: 'autohand.conflicting',
        message: expect.stringMatching(/read_file.*reserved runtime tool/i),
      }),
    ]);
  });

  it('rejects invalid extension skills without hiding healthy packages', async () => {
    const userRoot = await makeRoot('user-extension-skills');
    await writePackage(userRoot, {
      id: 'autohand.invalid-skill',
      skillName: 'invalid-skill',
      invalidSkill: true,
    });
    await writePackage(userRoot, {
      id: 'autohand.valid-skill',
      skillName: 'valid-skill',
    });

    const snapshot = await new ExtensionRegistry({ userRoot }).load();

    expect(snapshot.extensions.map((extension) => extension.manifest.id)).toEqual([
      'autohand.valid-skill',
    ]);
    expect(snapshot.skills.map((skill) => skill.definition.name)).toEqual(['valid-skill']);
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({
        code: 'invalid_skill',
        extensionId: 'autohand.invalid-skill',
        message: expect.stringMatching(/frontmatter/i),
      }),
    ]);
  });

  it('rejects skill name conflicts across extensions deterministically', async () => {
    const userRoot = await makeRoot('user-extension-skill-conflicts');
    await writePackage(userRoot, { id: 'autohand.alpha', skillName: 'shared-skill' });
    await writePackage(userRoot, { id: 'autohand.beta', skillName: 'shared-skill' });

    const snapshot = await new ExtensionRegistry({ userRoot }).load();

    expect(snapshot.extensions.map((extension) => extension.manifest.id)).toEqual(['autohand.alpha']);
    expect(snapshot.skills.map((skill) => skill.definition.name)).toEqual(['shared-skill']);
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({ code: 'contribution_conflict', extensionId: 'autohand.beta' }),
    ]);
  });

  it('reserves the MCP namespace for connector-owned tools', async () => {
    const userRoot = await makeRoot('user-extensions');
    await writePackage(userRoot, {
      id: 'autohand.mcp-conflict',
      toolName: 'mcp__server__tool',
      agentName: 'extension-agent',
    });

    const snapshot = await new ExtensionRegistry({ userRoot }).load();

    expect(snapshot.extensions).toEqual([]);
    expect(snapshot.tools).toEqual([]);
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({
        code: 'contribution_conflict',
        extensionId: 'autohand.mcp-conflict',
        message: expect.stringMatching(/mcp__server__tool.*reserved runtime tool/i),
      }),
    ]);
  });
});
