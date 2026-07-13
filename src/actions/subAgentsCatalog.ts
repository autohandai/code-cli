/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Default sub-agent catalog backed by autohandai/awesome-sub-agents.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { AUTOHAND_PATHS } from '../constants.js';

export const DEFAULT_SUB_AGENT_REGISTRY_URL =
  'https://raw.githubusercontent.com/autohandai/awesome-sub-agents/main/registry.json';
export const DEFAULT_SUB_AGENT_RAW_BASE_URL =
  'https://raw.githubusercontent.com/autohandai/awesome-sub-agents/main';

export interface CatalogSubAgent {
  name: string;
  description: string;
  category: string;
  path: string;
  tools: string[];
  model?: string;
}

export interface CatalogRegistry {
  schemaVersion: number;
  repository: string;
  agents: CatalogSubAgent[];
}

export interface SearchSubAgentsOptions {
  category?: string;
  limit?: number;
  fetchImpl?: typeof fetch;
  registryUrl?: string;
}

export interface InstallSubAgentOptions {
  destinationDir?: string;
  overwrite?: boolean;
  fetchImpl?: typeof fetch;
  registryUrl?: string;
  rawBaseUrl?: string;
}

function getFetch(fetchImpl?: typeof fetch): typeof fetch {
  if (fetchImpl) return fetchImpl;
  if (typeof fetch === 'function') return fetch;
  throw new Error('fetch is unavailable in this runtime');
}

async function fetchText(url: string, fetchImpl?: typeof fetch): Promise<string> {
  const response = await getFetch(fetchImpl)(url);
  if (!response.ok) {
    throw new Error(`request failed for ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry));
  return strings.length > 0 ? strings : undefined;
}

function parseRegistry(raw: string): CatalogRegistry {
  const parsed = JSON.parse(raw) as { schemaVersion?: unknown; repository?: unknown; agents?: unknown };
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.agents)) {
    throw new Error('unsupported sub-agent registry schema');
  }

  const agents: CatalogSubAgent[] = parsed.agents.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`invalid sub-agent registry entry at index ${index}`);
    }
    const record = entry as Record<string, unknown>;
    const name = asString(record.name);
    const description = asString(record.description);
    const category = asString(record.category);
    const agentPath = asString(record.path);
    const tools = asStringArray(record.tools);
    if (!name || !description || !category || !agentPath || !tools) {
      throw new Error(`invalid sub-agent registry entry at index ${index}`);
    }
    return {
      name,
      description,
      category,
      path: agentPath,
      tools,
      model: asString(record.model),
    };
  });

  return {
    schemaVersion: 1,
    repository: asString(parsed.repository) ?? 'https://github.com/autohandai/awesome-sub-agents',
    agents,
  };
}

async function fetchRegistry(options: {
  fetchImpl?: typeof fetch;
  registryUrl?: string;
} = {}): Promise<CatalogRegistry> {
  const raw = await fetchText(options.registryUrl ?? DEFAULT_SUB_AGENT_REGISTRY_URL, options.fetchImpl);
  return parseRegistry(raw);
}

function normalizeLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return 10;
  return Math.max(1, Math.min(Math.floor(limit ?? 10), 20));
}

function agentSearchText(agent: CatalogSubAgent): string {
  return [
    agent.name,
    agent.description,
    agent.category,
    agent.path,
    agent.model,
    ...agent.tools,
  ].filter(Boolean).join(' ').toLowerCase();
}

function matchesQuery(agent: CatalogSubAgent, query: string): boolean {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const searchText = agentSearchText(agent);
  return tokens.every((token) => searchText.includes(token));
}

function formatAgentResults(agents: CatalogSubAgent[]): string {
  return agents.map((agent, index) => {
    const lines = [
      `${index + 1}. **${agent.name}** [${agent.category}]`,
      `   ${agent.description}`,
      `   Tools: ${agent.tools.join(', ')}`,
      `   Install: install_sub_agent name="${agent.name}"`,
    ];
    if (agent.model) {
      lines.splice(3, 0, `   Model: ${agent.model}`);
    }
    return lines.join('\n');
  }).join('\n\n');
}

export async function searchSubAgentsCatalog(
  query: string,
  options: SearchSubAgentsOptions = {},
): Promise<string> {
  const registry = await fetchRegistry(options);
  const category = options.category?.toLowerCase();
  const limit = normalizeLimit(options.limit);

  const matches = registry.agents
    .filter((agent) => !category || agent.category.toLowerCase() === category)
    .filter((agent) => matchesQuery(agent, query))
    .slice(0, limit);

  if (matches.length === 0) {
    return `No sub-agents found matching "${query}".`;
  }

  return formatAgentResults(matches);
}

function findAgent(agents: CatalogSubAgent[], name: string): CatalogSubAgent | undefined {
  const normalized = name.toLowerCase().trim();
  return agents.find((agent) => agent.name.toLowerCase() === normalized)
    ?? agents.find((agent) => path.basename(agent.path, path.extname(agent.path)).toLowerCase() === normalized);
}

function findSimilarAgents(agents: CatalogSubAgent[], name: string): CatalogSubAgent[] {
  const normalized = name.toLowerCase().trim();
  if (!normalized) return [];
  return agents
    .filter((agent) => agentSearchText(agent).includes(normalized))
    .slice(0, 5);
}

function safeAgentFilename(name: string): string {
  const safe = name.trim().replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'sub-agent';
}

export async function installSubAgentFromCatalog(
  name: string,
  options: InstallSubAgentOptions = {},
): Promise<string> {
  const registry = await fetchRegistry(options);
  const agent = findAgent(registry.agents, name);
  if (!agent) {
    const similar = findSimilarAgents(registry.agents, name);
    const suffix = similar.length > 0
      ? `\nSimilar sub-agents: ${similar.map((entry) => entry.name).join(', ')}`
      : '';
    return `Sub-agent not found: "${name}".${suffix}`;
  }

  const rawBaseUrl = (options.rawBaseUrl ?? DEFAULT_SUB_AGENT_RAW_BASE_URL).replace(/\/$/, '');
  const markdown = await fetchText(`${rawBaseUrl}/${agent.path}`, options.fetchImpl);
  if (!markdown.startsWith('---\n')) {
    throw new Error(`catalog entry ${agent.name} did not download as an Autohand markdown agent`);
  }

  const destinationDir = options.destinationDir ?? AUTOHAND_PATHS.agents;
  await fs.mkdir(destinationDir, { recursive: true });

  const targetPath = path.join(destinationDir, `${safeAgentFilename(agent.name)}.md`);
  const exists = await fs.access(targetPath).then(() => true).catch(() => false);
  if (exists && options.overwrite !== true) {
    return `Sub-agent ${agent.name} already exists at ${targetPath}. Use overwrite=true to replace it.`;
  }

  await fs.writeFile(targetPath, markdown, 'utf8');
  return [
    `Installed sub-agent ${agent.name} to ${targetPath}.`,
    `Use delegate_task agent_name="${agent.name}" task="..." or add_teammate agent_name="${agent.name}" after creating a team.`,
  ].join('\n');
}
