/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import { z } from 'zod';
import { AgentConfigSchema, BUILTIN_AGENT_NAMES } from '../core/agents/AgentRegistry.js';
import { DEFAULT_TOOL_DEFINITIONS, GOAL_TOOL_DEFINITIONS } from '../core/toolManager.js';
import {
  normalizeMetaToolDefinition,
  type MetaToolDefinition,
} from '../core/metaTools/schema.js';
import { assertSafeMetaToolHandler } from '../core/metaTools/safety.js';
import {
  parseExtensionJson,
  readExtensionContributionText,
  readExtensionPackage,
} from './manifest.js';
import { ExtensionStateSchema } from './schema.js';
import { SkillParser } from '../skills/SkillParser.js';
import type {
  ExtensionAgentContribution,
  ExtensionDiagnostic,
  ExtensionPackage,
  ExtensionProvenance,
  ExtensionScope,
  ExtensionSkillContribution,
  ExtensionRuntimeContribution,
  ExtensionSnapshot,
  ExtensionToolContribution,
  LoadedExtension,
} from './types.js';

export interface ExtensionRegistryOptions {
  userRoot?: string;
  projectRoot?: string;
}

export interface ExtensionLoadOptions {
  reservedToolNames?: Iterable<string>;
  reservedAgentNames?: Iterable<string>;
  reservedSkillNames?: Iterable<string>;
}

interface CandidatePackage extends ExtensionPackage {
  scope: ExtensionScope;
  installationPath?: string;
}

interface ParsedCandidate {
  extension: LoadedExtension;
  tools: ExtensionToolContribution[];
  agents: ExtensionAgentContribution[];
  skills: ExtensionSkillContribution[];
  runtimes: ExtensionRuntimeContribution[];
}

export interface ValidatedExtensionPackage extends ParsedCandidate {}

const MarkdownAgentFrontmatterSchema = z.object({
  description: z.string().optional(),
  tools: z.string().optional(),
  model: z.string().optional(),
});

function extractMarkdownTitle(content: string): string | null {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    return trimmed.startsWith('#') ? trimmed.replace(/^#+\s*/, '').trim() || null : trimmed;
  }
  return null;
}

function parseMarkdownAgent(content: string): {
  description: string;
  systemPrompt: string;
  tools: string[];
  model?: string;
} {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!frontmatterMatch) {
    const title = extractMarkdownTitle(content);
    if (!title || content.trim().length === 0) {
      throw new Error('Markdown agent must contain a title or prompt');
    }
    return { description: title, systemPrompt: content, tools: ['*'] };
  }

  const rawMetadata: Record<string, string> = {};
  for (const line of frontmatterMatch[1].split(/\r?\n/)) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      rawMetadata[match[1]] = match[2].trim();
    }
  }
  const metadata = MarkdownAgentFrontmatterSchema.parse(rawMetadata);
  const body = frontmatterMatch[2].trim();
  const description = metadata.description ?? extractMarkdownTitle(body);
  if (!description || body.length === 0) {
    throw new Error('Markdown agent must contain a description and prompt');
  }
  const tools = metadata.tools
    ? metadata.tools.split(',').map((tool) => tool.trim()).filter(Boolean)
    : ['*'];
  return { description, systemPrompt: body, tools: tools.length > 0 ? tools : ['*'], model: metadata.model };
}

function provenance(candidate: CandidatePackage, file: string): ExtensionProvenance {
  return {
    extensionId: candidate.manifest.id,
    extensionVersion: candidate.manifest.version,
    scope: candidate.scope,
    packageRoot: candidate.root,
    file,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readJsonContribution(file: string): Promise<unknown> {
  const text = await readExtensionContributionText(file);
  return parseExtensionJson(text, 'extension contribution');
}

async function readState(candidate: CandidatePackage): Promise<{
  disabled: boolean;
  linked: boolean;
  trusted: boolean;
}> {
  const installationPath = candidate.installationPath;
  if (!installationPath) {
    return { disabled: false, linked: false, trusted: false };
  }
  const linked = (await fs.lstat(installationPath).catch(() => null))?.isSymbolicLink() === true;
  const statePath = path.join(path.dirname(installationPath), '.state', `${candidate.manifest.id}.json`);
  if (!fs.existsSync(statePath)) {
    return { disabled: false, linked, trusted: false };
  }
  const parsed = ExtensionStateSchema.safeParse(await readJsonContribution(statePath));
  if (!parsed.success) {
    throw new Error(`Invalid extension state: ${parsed.error.issues[0]?.message ?? 'unknown validation error'}`);
  }
  return {
    disabled: parsed.data.disabled === true,
    linked: linked || parsed.data.linked === true,
    trusted: parsed.data.trusted === true,
  };
}

async function parseTool(candidate: CandidatePackage, file: string): Promise<ExtensionToolContribution> {
  const input = await readJsonContribution(file);
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const definition = normalizeMetaToolDefinition({
    ...value,
    source: 'user',
    scope: candidate.scope,
  });
  if (!definition) {
    throw new Error('Invalid meta-tool definition');
  }
  assertSafeMetaToolHandler(definition.handler);
  return { definition, provenance: provenance(candidate, file) };
}

async function parseAgent(candidate: CandidatePackage, file: string): Promise<ExtensionAgentContribution> {
  const extension = path.extname(file).toLowerCase();
  const name = path.basename(file, extension);
  let definition: Pick<ExtensionAgentContribution, 'description' | 'systemPrompt' | 'tools' | 'model'>;

  if (extension === '.json') {
    const parsed = AgentConfigSchema.safeParse(await readJsonContribution(file));
    if (!parsed.success) {
      throw new Error(`Invalid JSON agent definition: ${parsed.error.issues[0]?.message ?? 'unknown validation error'}`);
    }
    definition = parsed.data;
  } else if (extension === '.md' || extension === '.markdown') {
    const content = await readExtensionContributionText(file);
    definition = parseMarkdownAgent(content);
  } else {
    throw new Error(`Unsupported agent file extension "${extension || '<none>'}"`);
  }

  return { name, ...definition, provenance: provenance(candidate, file) };
}

async function parseSkill(candidate: CandidatePackage, file: string): Promise<ExtensionSkillContribution> {
  const content = await readExtensionContributionText(file);
  const parsed = new SkillParser().parseContent(content, file, 'extension');
  if (!parsed.success || !parsed.skill) {
    throw new Error(`Invalid Agent Skill: ${parsed.error ?? 'unknown validation error'}`);
  }
  return { definition: parsed.skill, provenance: provenance(candidate, file) };
}

function parseRuntime(candidate: CandidatePackage, file: string): ExtensionRuntimeContribution {
  const extension = path.extname(file).toLowerCase();
  if (!['.js', '.mjs', '.cjs'].includes(extension)) {
    throw new Error(`Runtime entrypoint must be compiled JavaScript (.js, .mjs, or .cjs): ${file}`);
  }
  return { file, provenance: provenance(candidate, file) };
}

function duplicateName(values: string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
  }
  return undefined;
}

function reservedNames(options: ExtensionLoadOptions): {
  tools: Set<string>;
  agents: Set<string>;
  skills: Set<string>;
} {
  return {
    tools: new Set([
      ...DEFAULT_TOOL_DEFINITIONS.map((definition) => definition.name),
      ...GOAL_TOOL_DEFINITIONS.map((definition) => definition.name),
      ...(options.reservedToolNames ?? []),
    ]),
    agents: new Set([...BUILTIN_AGENT_NAMES, ...(options.reservedAgentNames ?? [])]),
    skills: new Set(options.reservedSkillNames ?? []),
  };
}

async function parseCandidateOrThrow(
  candidate: CandidatePackage,
  loadOptions: ExtensionLoadOptions = {},
): Promise<ParsedCandidate> {
  const state = await readState(candidate);
  const extension: LoadedExtension = { ...candidate, ...state };
  if (state.disabled) {
    return { extension, tools: [], agents: [], skills: [], runtimes: [] };
  }

  const tools = await Promise.all(candidate.contributionFiles.tools.map((file) => parseTool(candidate, file)));
  const agents = await Promise.all(candidate.contributionFiles.agents.map((file) => parseAgent(candidate, file)));
  const skills = await Promise.all(candidate.contributionFiles.skills.map((file) => parseSkill(candidate, file)));
  const runtimes = candidate.contributionFiles.runtime.map((file) => parseRuntime(candidate, file));
  const duplicateTool = duplicateName(tools.map((tool) => tool.definition.name));
  const duplicateAgent = duplicateName(agents.map((agent) => agent.name));
  const duplicateSkill = duplicateName(skills.map((skill) => skill.definition.name));
  if (duplicateTool || duplicateAgent || duplicateSkill) {
    throw new Error(`Duplicate contribution name "${duplicateTool ?? duplicateAgent ?? duplicateSkill}" within extension`);
  }
  const reserved = reservedNames(loadOptions);
  const reservedTool = tools.find((tool) =>
    reserved.tools.has(tool.definition.name) || tool.definition.name.startsWith('mcp__'));
  if (reservedTool) {
    throw new Error(`Contribution "${reservedTool.definition.name}" conflicts with a reserved runtime tool`);
  }
  const reservedAgent = agents.find((agent) => reserved.agents.has(agent.name));
  if (reservedAgent) {
    throw new Error(`Contribution "${reservedAgent.name}" conflicts with a reserved runtime agent`);
  }
  const reservedSkill = skills.find((skill) => reserved.skills.has(skill.definition.name));
  if (reservedSkill) {
    throw new Error(`Contribution "${reservedSkill.definition.name}" conflicts with a reserved runtime skill`);
  }
  return { extension, tools, agents, skills, runtimes };
}

export async function validateExtensionPackage(
  packageRoot: string,
  scope: ExtensionScope = 'user',
  loadOptions: ExtensionLoadOptions = {},
): Promise<ValidatedExtensionPackage> {
  const extensionPackage = await readExtensionPackage(packageRoot);
  return parseCandidateOrThrow({ ...extensionPackage, scope }, loadOptions);
}

export class ExtensionRegistry {
  constructor(private readonly options: ExtensionRegistryOptions) {}

  async load(loadOptions: ExtensionLoadOptions = {}): Promise<ExtensionSnapshot> {
    const diagnostics: ExtensionDiagnostic[] = [];
    const selected = new Map<string, CandidatePackage>();

    for (const scope of ['user', 'project'] as const) {
      const root = scope === 'user' ? this.options.userRoot : this.options.projectRoot;
      if (!root) {
        continue;
      }
      for (const candidate of await this.discoverRoot(root, scope, diagnostics)) {
        selected.set(candidate.manifest.id, candidate);
      }
    }

    const extensions: LoadedExtension[] = [];
    const tools: ExtensionToolContribution[] = [];
    const agents: ExtensionAgentContribution[] = [];
    const skills: ExtensionSkillContribution[] = [];
    const runtimes: ExtensionRuntimeContribution[] = [];
    const toolOwners = new Map<string, string>();
    const agentOwners = new Map<string, string>();
    const skillOwners = new Map<string, string>();

    for (const candidate of [...selected.values()].sort((left, right) =>
      left.manifest.id.localeCompare(right.manifest.id))) {
      const parsed = await this.parseCandidate(candidate, diagnostics, loadOptions);
      if (!parsed) {
        continue;
      }

      if (!parsed.extension.disabled) {
        const conflictingTool = parsed.tools.find((tool) => toolOwners.has(tool.definition.name));
        const conflictingAgent = parsed.agents.find((agent) => agentOwners.has(agent.name));
        const conflictingSkill = parsed.skills.find((skill) => skillOwners.has(skill.definition.name));
        if (conflictingTool || conflictingAgent || conflictingSkill) {
          const name = conflictingTool?.definition.name
            ?? conflictingAgent?.name
            ?? conflictingSkill?.definition.name
            ?? '<unknown>';
          const owner = toolOwners.get(name)
            ?? agentOwners.get(name)
            ?? skillOwners.get(name)
            ?? '<unknown>';
          diagnostics.push({
            code: 'contribution_conflict',
            extensionId: candidate.manifest.id,
            scope: candidate.scope,
            file: candidate.manifestPath,
            message: `Contribution "${name}" conflicts with extension "${owner}"`,
          });
          continue;
        }
      }

      extensions.push(parsed.extension);
      if (parsed.extension.disabled) {
        continue;
      }
      for (const tool of parsed.tools) {
        toolOwners.set(tool.definition.name, candidate.manifest.id);
        tools.push(tool);
      }
      for (const agent of parsed.agents) {
        agentOwners.set(agent.name, candidate.manifest.id);
        agents.push(agent);
      }
      for (const skill of parsed.skills) {
        skillOwners.set(skill.definition.name, candidate.manifest.id);
        skills.push(skill);
      }
      runtimes.push(...parsed.runtimes);
    }

    return { extensions, tools, agents, skills, runtimes, diagnostics };
  }

  private async discoverRoot(
    root: string,
    scope: ExtensionScope,
    diagnostics: ExtensionDiagnostic[],
  ): Promise<CandidatePackage[]> {
    if (!await fs.pathExists(root)) {
      return [];
    }

    let entries: string[];
    try {
      entries = (await fs.readdir(root)).sort((left, right) => left.localeCompare(right));
    } catch (error) {
      diagnostics.push({
        code: 'unreadable_root',
        scope,
        file: root,
        message: `Could not read extension root: ${errorMessage(error)}`,
      });
      return [];
    }

    const candidates: CandidatePackage[] = [];
    for (const entry of entries) {
      if (
        entry === '.state'
        || entry === '.locks'
        || entry.startsWith('.tmp-')
        || entry.startsWith('.backup-')
        || entry.startsWith('.removed-')
      ) {
        continue;
      }
      const packageRoot = path.join(root, entry);
      const stat = await fs.lstat(packageRoot).catch(() => null);
      if (!stat?.isDirectory() && !stat?.isSymbolicLink()) {
        continue;
      }
      try {
        const extensionPackage = await readExtensionPackage(packageRoot);
        if (path.basename(packageRoot) !== extensionPackage.manifest.id) {
          throw new Error(
            `Package directory "${path.basename(packageRoot)}" must match extension id "${extensionPackage.manifest.id}"`,
          );
        }
        candidates.push({ ...extensionPackage, scope, installationPath: packageRoot });
      } catch (error) {
        diagnostics.push({
          code: 'invalid_manifest',
          scope,
          file: path.join(packageRoot, 'autohand.extension.json'),
          message: errorMessage(error),
        });
      }
    }
    return candidates;
  }

  private async parseCandidate(
    candidate: CandidatePackage,
    diagnostics: ExtensionDiagnostic[],
    loadOptions: ExtensionLoadOptions,
  ): Promise<ParsedCandidate | null> {
    try {
      return await parseCandidateOrThrow(candidate, loadOptions);
    } catch (error) {
      const message = errorMessage(error);
      const invalidState = message.toLowerCase().includes('extension state');
      diagnostics.push({
        code: message.includes('reserved runtime')
          ? 'contribution_conflict'
          : invalidState
          ? 'invalid_state'
          : message.toLowerCase().includes('agent skill')
            ? 'invalid_skill'
            : message.toLowerCase().includes('runtime entrypoint')
            ? 'invalid_runtime'
            : message.toLowerCase().includes('agent')
            ? 'invalid_agent'
            : 'invalid_tool',
        extensionId: candidate.manifest.id,
        scope: candidate.scope,
        file: invalidState
          ? path.join(path.dirname(candidate.installationPath ?? candidate.root), '.state', `${candidate.manifest.id}.json`)
          : candidate.manifestPath,
        message,
      });
      return null;
    }
  }
}

export type {
  ExtensionSnapshot,
  ExtensionToolContribution,
  ExtensionAgentContribution,
  ExtensionSkillContribution,
  ExtensionRuntimeContribution,
  MetaToolDefinition,
};
