/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Default sub-agent catalog backed by autohandai/awesome-sub-agents.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AUTOHAND_PATHS } from '../constants.js';
import {
  hashCatalogContent,
  writeCatalogProvenanceEntry,
} from '../core/agents/catalogProvenance.js';

export const DEFAULT_SUB_AGENT_REGISTRY_URL =
  'https://raw.githubusercontent.com/autohandai/awesome-sub-agents/main/registry.json';
export const DEFAULT_SUB_AGENT_RAW_BASE_URL =
  'https://raw.githubusercontent.com/autohandai/awesome-sub-agents/main';

const CATALOG_REQUEST_TIMEOUT_MS = 10_000;
const MAX_CATALOG_REGISTRY_BYTES = 2 * 1024 * 1024;
const MAX_CATALOG_AGENT_BYTES = 256 * 1024;
const CATALOG_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

class CatalogRequestError extends Error {}

export interface CatalogSubAgent {
  name: string;
  description: string;
  category: string;
  path: string;
  tools: string[];
  model?: string;
  sha256?: string;
}

export interface CatalogRegistry {
  schemaVersion: number;
  repository: string;
  agents: CatalogSubAgent[];
  cachedAt?: number;
}

interface RegistryFetchOptions {
  fetchImpl?: typeof fetch;
  registryUrl?: string;
  cachePath?: string | false;
}

export interface SearchSubAgentsOptions extends RegistryFetchOptions {
  category?: string;
  limit?: number;
}

export interface InstallSubAgentOptions {
  destinationDir?: string;
  overwrite?: boolean;
  fetchImpl?: typeof fetch;
  registryUrl?: string;
  rawBaseUrl?: string;
  allowedTools?: ReadonlySet<string>;
  registry?: CatalogRegistry;
}

function getFetch(fetchImpl?: typeof fetch): typeof fetch {
  if (fetchImpl) return fetchImpl;
  if (typeof fetch === 'function') return fetch;
  throw new Error('fetch is unavailable in this runtime');
}

async function fetchText(
  url: string,
  fetchImpl?: typeof fetch,
  maxBytes = MAX_CATALOG_REGISTRY_BYTES,
): Promise<string> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new CatalogRequestError(`Sub-agent catalogue request timed out after ${CATALOG_REQUEST_TIMEOUT_MS}ms: ${url}`));
    }, CATALOG_REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([deadline, (async () => {
      const request = getFetch(fetchImpl);
      const response = await request(url, { signal: controller.signal }).catch((cause: unknown) => {
        throw new CatalogRequestError(`Sub-agent catalogue request failed: ${url}`, { cause });
      });
      if (controller.signal.aborted) void response.body?.cancel().catch(() => {});
      controller.signal.throwIfAborted();
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        const message = `request failed for ${url}: ${response.status} ${response.statusText}`;
        if (response.status >= 500 || response.status === 408 || response.status === 429) {
          throw new CatalogRequestError(message);
        }
        throw new Error(message);
      }
      if (Number(response.headers.get('content-length')) > maxBytes) {
        void response.body?.cancel().catch(() => {});
        throw new Error(`Sub-agent catalogue response exceeds ${maxBytes} bytes: ${url}`);
      }
      reader = response.body?.getReader();
      if (!reader) return '';
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      while (true) {
        const next = await reader.read().catch((cause: unknown) => {
          throw new CatalogRequestError(`Sub-agent catalogue response interrupted: ${url}`, { cause });
        });
        if (next.done) break;
        totalBytes += next.value.byteLength;
        if (totalBytes > maxBytes) {
          throw new Error(`Sub-agent catalogue response exceeds ${maxBytes} bytes: ${url}`);
        }
        chunks.push(next.value);
      }
      return Buffer.concat(chunks, totalBytes).toString('utf8');
    })()]);
  } finally {
    clearTimeout(timeout);
    void reader?.cancel().catch(() => {});
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const strings: string[] = [];
  for (const entry of value) {
    const tool = asString(entry);
    if (!tool || !/^[a-zA-Z0-9_.:-]+$/.test(tool)) return undefined;
    strings.push(tool);
  }
  return strings;
}

function validateCatalogPath(agentPath: string): void {
  const normalized = path.posix.normalize(agentPath);
  const segments = agentPath.split('/');
  if (
    path.posix.isAbsolute(agentPath)
    || agentPath.includes('\\')
    || normalized !== agentPath
    || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
    || !/\.(?:md|markdown)$/i.test(agentPath)
  ) {
    throw new Error(`invalid catalog path: ${agentPath}`);
  }
}

function validateCatalogName(name: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(name)) {
    throw new Error(`invalid catalog agent name: ${name}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseRegistry(raw: string): CatalogRegistry {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.agents)) {
    throw new Error('unsupported sub-agent registry schema');
  }

  const names = new Set<string>();
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
    validateCatalogName(name);
    if (names.has(name.toLowerCase())) {
      throw new Error(`duplicate catalog agent name: ${name}`);
    }
    names.add(name.toLowerCase());
    validateCatalogPath(agentPath);
    const sha256 = asString(record.sha256);
    if (record.sha256 !== undefined && (!sha256 || !/^[a-f0-9]{64}$/i.test(sha256))) {
      throw new Error(`invalid sha256 for sub-agent registry entry at index ${index}`);
    }
    return {
      name,
      description,
      category,
      path: agentPath,
      tools,
      model: asString(record.model),
      sha256,
    };
  });

  return {
    schemaVersion: 1,
    repository: asString(parsed.repository) ?? 'https://github.com/autohandai/awesome-sub-agents',
    agents,
  };
}

function registryCachePath(options: RegistryFetchOptions): string | undefined {
  if (options.cachePath === false) return undefined;
  if (options.cachePath) return options.cachePath;
  if (options.fetchImpl || (options.registryUrl && options.registryUrl !== DEFAULT_SUB_AGENT_REGISTRY_URL)) {
    return undefined;
  }
  return path.join(AUTOHAND_PATHS.agents, '.catalog', 'registry.json');
}

async function readCachedRegistry(cachePath: string, registryUrl: string): Promise<CatalogRegistry | undefined> {
  const file = await fs.open(cachePath, 'r');
  let raw: string;
  try {
    const buffer = Buffer.alloc(MAX_CATALOG_REGISTRY_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_CATALOG_REGISTRY_BYTES) throw new Error('cached catalogue metadata exceeds size limit');
    raw = buffer.toString('utf8', 0, length);
  } finally {
    await file.close();
  }
  const cache: unknown = JSON.parse(raw);
  if (!isRecord(cache) || cache.version !== 1 || cache.registryUrl !== registryUrl
    || typeof cache.fetchedAt !== 'number' || !Number.isFinite(cache.fetchedAt)) {
    throw new Error('invalid cached catalogue metadata');
  }
  const age = Date.now() - cache.fetchedAt;
  if (age < 0 || age > CATALOG_CACHE_MAX_AGE_MS) return undefined;
  return { ...parseRegistry(JSON.stringify(cache.registry)), cachedAt: cache.fetchedAt };
}

async function cacheRegistry(cachePath: string, registryUrl: string, registry: CatalogRegistry): Promise<void> {
  const content = JSON.stringify({ version: 1, registryUrl, fetchedAt: Date.now(), registry });
  if (Buffer.byteLength(content, 'utf8') > MAX_CATALOG_REGISTRY_BYTES) return;
  const temporaryPath = `${cachePath}.${randomUUID()}.tmp`;
  try {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await fs.rename(temporaryPath, cachePath);
  } finally {
    await fs.unlink(temporaryPath).catch(() => {});
  }
}

export async function fetchSubAgentsRegistry(options: RegistryFetchOptions = {}): Promise<CatalogRegistry> {
  const registryUrl = options.registryUrl ?? DEFAULT_SUB_AGENT_REGISTRY_URL;
  const cachePath = registryCachePath(options);
  let raw: string;
  try {
    raw = await fetchText(registryUrl, options.fetchImpl);
  } catch (error) {
    if (!(error instanceof CatalogRequestError) || !cachePath) throw error;
    const cached = await readCachedRegistry(cachePath, registryUrl).catch(() => undefined);
    if (cached) return cached;
    throw error;
  }
  const registry = parseRegistry(raw);
  if (cachePath) await cacheRegistry(cachePath, registryUrl, registry).catch(() => {});
  return registry;
}

function normalizeLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return 10;
  return Math.max(1, Math.min(Math.floor(limit ?? 10), 20));
}

/** Natural-language glue words that should not influence ranking. */
const STOP_TOKENS = new Set([
  'a', 'an', 'the', 'and', 'or', 'to', 'for', 'of', 'in', 'on', 'at', 'by', 'with', 'from',
  'into', 'over', 'under', 'as', 'is', 'are', 'be', 'this', 'that', 'these', 'those',
  'need', 'needs', 'needed', 'want', 'wants', 'bring', 'find', 'get', 'use', 'using',
  'please', 'help', 'me', 'my', 'our', 'your', 'some', 'any', 'all',
]);

/** Split query into searchable tokens (hyphens/underscores count as separators). */
export function tokenizeSubAgentQuery(query: string): string[] {
  return query
    .toLowerCase()
    .trim()
    .split(/[\s/_.,:;|+()-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !STOP_TOKENS.has(token));
}

function normalizeNameKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Role/title tokens that appear on dozens of agents — keep them weak so specific domain terms win. */
const GENERIC_ROLE_TOKENS = new Set([
  'agent',
  'assistant',
  'developer',
  'engineer',
  'expert',
  'pro',
  'specialist',
  'architect',
  'manager',
  'reviewer',
  'tester',
  'analyst',
  'designer',
  'writer',
  'coder',
  'task',
  'work',
  'code',
  'app',
  'system',
  'service',
]);

/** True when token appears as a whole word/segment (avoids "ui" matching "guidance"). */
function containsToken(haystack: string, token: string): boolean {
  if (!token) return false;
  if (token.length <= 2) {
    const pattern = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(token)}(?:[^a-z0-9]|$)`, 'i');
    return pattern.test(haystack);
  }
  return haystack.toLowerCase().includes(token.toLowerCase());
}

function tokenWeight(token: string): number {
  if (GENERIC_ROLE_TOKENS.has(token)) return 0.25;
  if (token.length <= 2) return 1.4;
  return 1;
}

/**
 * Rank a catalog agent against a free-text query.
 * Uses soft token matching (any token can contribute) with stronger weights for
 * name hits so realistic LLM queries like "UI design specialist" still surface
 * ui-designer even when not every adjective appears in the registry description.
 */
export function scoreSubAgentMatch(agent: CatalogSubAgent, query: string): number {
  const tokens = tokenizeSubAgentQuery(query);
  if (tokens.length === 0) {
    return 1;
  }

  const name = agent.name.toLowerCase();
  const nameKey = normalizeNameKey(agent.name);
  const category = agent.category.toLowerCase();
  const description = agent.description.toLowerCase();
  const toolsText = agent.tools.join(' ').toLowerCase();
  const pathText = agent.path.toLowerCase();
  const nameSegments = name.split(/[-_./]+/).filter(Boolean);

  let score = 0;
  let matchedTokens = 0;

  const queryKey = normalizeNameKey(query);
  if (queryKey && (nameKey === queryKey || name === query.toLowerCase().trim())) {
    score += 200;
  } else if (queryKey && nameKey.includes(queryKey) && queryKey.length >= 3) {
    score += 120;
  }

  for (const token of tokens) {
    let tokenScore = 0;
    const tokenKey = normalizeNameKey(token);
    const weight = tokenWeight(token);

    if (name === token || nameKey === tokenKey || nameSegments.includes(token)) {
      tokenScore += 80;
    } else if (
      containsToken(name, token)
      || (tokenKey.length >= 3 && nameKey.includes(tokenKey))
    ) {
      tokenScore += 50;
    }

    if (containsToken(category, token) || category.split(/[-_/]/).includes(token)) {
      tokenScore += 20;
    }

    if (containsToken(description, token)) {
      tokenScore += 12;
    }

    if (containsToken(toolsText, token)) {
      tokenScore += 6;
    }

    if (containsToken(pathText, token)) {
      tokenScore += 4;
    }

    if (tokenScore > 0) {
      matchedTokens += 1;
      score += tokenScore * weight;
    }
  }

  if (matchedTokens === 0) {
    return 0;
  }

  // Prefer fuller token coverage without requiring every token (strict AND failed
  // against the live awesome-sub-agents wording).
  score += matchedTokens * 15;
  if (matchedTokens === tokens.length) {
    score += 25;
  }

  // Prefer agents whose primary name segment is a query token (ui-designer over
  // powershell-ui-architect for "UI specialist").
  const primarySegment = nameSegments[0];
  if (primarySegment && tokens.includes(primarySegment) && !GENERIC_ROLE_TOKENS.has(primarySegment)) {
    score += 40;
  }

  // Prefer compact names when scores are otherwise close.
  score += Math.max(0, 12 - nameSegments.length * 2);

  return score;
}

function matchesCategory(agent: CatalogSubAgent, category?: string): boolean {
  if (!category) return true;
  const needle = category.toLowerCase().trim();
  if (!needle) return true;
  const hay = agent.category.toLowerCase();
  return hay === needle || hay.includes(needle) || needle.includes(hay);
}

export function rankSubAgentsCatalog(
  registry: CatalogRegistry,
  query: string,
  options: Pick<SearchSubAgentsOptions, 'category' | 'limit'> = {},
): CatalogSubAgent[] {
  const limit = normalizeLimit(options.limit);
  const normalizedQuery = query?.trim() ?? '';
  return registry.agents
    .filter((agent) => matchesCategory(agent, options.category))
    .map((agent) => ({ agent, score: scoreSubAgentMatch(agent, normalizedQuery) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.agent.name.localeCompare(b.agent.name);
    })
    .slice(0, limit)
    .map((entry) => entry.agent);
}

function formatAgentResults(agents: CatalogSubAgent[], query: string): string {
  const header = `Found ${agents.length} sub-agent${agents.length === 1 ? '' : 's'} matching "${query.trim() || '*'}":`;
  const body = agents.map((agent, index) => {
    const lines = [
      `${index + 1}. name: ${agent.name}`,
      `   category: ${agent.category}`,
      `   description: ${agent.description}`,
      `   tools: ${agent.tools.join(', ')}`,
    ];
    if (agent.model) {
      lines.push(`   model: ${agent.model}`);
    }
    lines.push(`   install: install_sub_agent name="${agent.name}"`);
    return lines.join('\n');
  }).join('\n\n');

  return `${header}\n\n${body}`;
}

export async function searchSubAgentsCatalog(
  query: string,
  options: SearchSubAgentsOptions = {},
): Promise<string> {
  const registry = await fetchSubAgentsRegistry(options);
  const normalizedQuery = query?.trim() ?? '';
  const ranked = rankSubAgentsCatalog(registry, normalizedQuery, options);
  const cacheNotice = registry.cachedAt === undefined ? ''
    : `Using validated cached catalogue metadata from ${new Date(registry.cachedAt).toISOString()}; installation still requires approval and fresh content validation.\n\n`;

  if (ranked.length === 0) {
    return cacheNotice + [
      `No sub-agents found matching "${normalizedQuery || '*'}".`,
      'Try broader role terms (for example "ui", "backend", "security", "react") or omit the category filter.',
      `Catalog: ${registry.repository}`,
    ].join('\n');
  }

  return cacheNotice + formatAgentResults(ranked, normalizedQuery);
}

function findAgent(agents: CatalogSubAgent[], name: string): CatalogSubAgent | undefined {
  const normalized = name.toLowerCase().trim();
  return agents.find((agent) => agent.name.toLowerCase() === normalized);
}

function findSimilarAgents(agents: CatalogSubAgent[], name: string): CatalogSubAgent[] {
  const normalized = name.toLowerCase().trim();
  if (!normalized) return [];
  return agents
    .map((agent) => ({ agent, score: scoreSubAgentMatch(agent, normalized) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.agent.name.localeCompare(b.agent.name))
    .slice(0, 5)
    .map((entry) => entry.agent);
}

function safeAgentFilename(name: string): string {
  const safe = name.trim().replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'sub-agent';
}

function parseDownloadedAgent(markdown: string): { tools: string[]; body: string } {
  if (Buffer.byteLength(markdown, 'utf8') > MAX_CATALOG_AGENT_BYTES) {
    throw new Error(`catalog agent exceeds ${MAX_CATALOG_AGENT_BYTES} bytes`);
  }
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!frontmatter) {
    throw new Error('catalog entry did not download as an Autohand markdown agent');
  }

  const fields = new Map<string, string>();
  for (const line of frontmatter[1].split(/\r?\n/)) {
    const match = line.match(/^([a-zA-Z][\w-]*):\s*(.*?)\s*$/);
    if (match) fields.set(match[1].toLowerCase(), match[2]);
  }
  if (!fields.get('description')?.trim()) {
    throw new Error('catalog agent frontmatter requires a description');
  }
  const tools = (fields.get('tools') ?? '')
    .split(',')
    .map((tool) => tool.trim())
    .filter(Boolean);
  if (tools.length === 0 || tools.some((tool) => !/^[a-zA-Z0-9_.:-]+$/.test(tool))) {
    throw new Error('catalog agent frontmatter requires a valid tool allowlist');
  }
  const body = frontmatter[2].trim();
  if (!body) throw new Error('catalog agent body is empty');
  return { tools, body };
}

function validateDownloadedAgent(
  agent: CatalogSubAgent,
  markdown: string,
  allowedTools?: ReadonlySet<string>,
): string {
  const parsed = parseDownloadedAgent(markdown);
  const registryTools = new Set(agent.tools);
  for (const tool of parsed.tools) {
    if (!registryTools.has(tool)) {
      throw new Error(`catalog agent declares unsupported tool not present in registry: ${tool}`);
    }
    if (allowedTools && !allowedTools.has(tool)) {
      throw new Error(`catalog agent declares unsupported tool: ${tool}`);
    }
  }
  const contentHash = hashCatalogContent(markdown);
  if (agent.sha256 && contentHash !== agent.sha256.toLowerCase()) {
    throw new Error(`catalog agent content hash mismatch for ${agent.name}`);
  }
  return contentHash;
}

async function writeAgentAtomically(
  targetPath: string,
  content: string,
  overwrite: boolean,
): Promise<void> {
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
  try {
    if (overwrite) {
      await fs.rename(temporaryPath, targetPath);
    } else {
      // A same-directory hard link makes target creation atomic and fails with
      // EEXIST if another process installs or creates this definition first.
      await fs.link(temporaryPath, targetPath);
      await fs.unlink(temporaryPath);
    }
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export async function installSubAgentFromCatalog(
  name: string,
  options: InstallSubAgentOptions = {},
): Promise<string> {
  const registry = options.registry
    ? parseRegistry(JSON.stringify(options.registry))
    : await fetchSubAgentsRegistry({ ...options, cachePath: false });
  const agent = findAgent(registry.agents, name);
  if (!agent) {
    const similar = findSimilarAgents(registry.agents, name);
    const suffix = similar.length > 0
      ? `\nSimilar sub-agents: ${similar.map((entry) => entry.name).join(', ')}`
      : '';
    return `Sub-agent not found: "${name}".${suffix}`;
  }

  const rawBaseUrl = (options.rawBaseUrl ?? DEFAULT_SUB_AGENT_RAW_BASE_URL).replace(/\/$/, '');
  const markdown = await fetchText(`${rawBaseUrl}/${agent.path}`, options.fetchImpl, MAX_CATALOG_AGENT_BYTES);
  const contentHash = validateDownloadedAgent(agent, markdown, options.allowedTools);

  const destinationDir = options.destinationDir ?? AUTOHAND_PATHS.agents;
  await fs.mkdir(destinationDir, { recursive: true });

  const targetPath = path.join(destinationDir, `${safeAgentFilename(agent.name)}.md`);
  const exists = await fs.access(targetPath).then(() => true).catch(() => false);
  if (exists && options.overwrite !== true) {
    return `Sub-agent ${agent.name} already exists at ${targetPath}. Use overwrite=true to replace it.`;
  }

  await writeAgentAtomically(targetPath, markdown, options.overwrite === true);
  await writeCatalogProvenanceEntry(destinationDir, {
    agentName: agent.name,
    fileName: path.basename(targetPath),
    repository: registry.repository,
    catalogPath: agent.path,
    contentHash,
    installedAt: new Date().toISOString(),
  });
  return [
    `Installed sub-agent ${agent.name} to ${targetPath}.`,
    `Use delegate_task agent_name="${agent.name}" task="..." or add_teammate agent_name="${agent.name}" after creating a team.`,
  ].join('\n');
}
