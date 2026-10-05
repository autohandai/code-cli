/** @license Apache-2.0 */
import { open } from 'node:fs/promises';
import path from 'node:path';
import type { SlashCommandContext } from '../core/slashCommandTypes.js';
import type { SessionMetadata } from '../session/types.js';

export interface UsageQuery { scope: 'project' | 'all'; days: 7 | 30 }
export interface CapabilityActivity {
  id: string;
  date: string;
  kind: 'skill' | 'slash_command';
  name: string;
  source: string;
  project: string;
  failed: boolean;
}
export interface UsageExtension { name: string; scope: string; enabled: boolean; skills: number; tools: number }
export interface UsageReportData {
  generatedAt: string;
  sessions: SessionMetadata[];
  totalSessions: number;
  capabilities: CapabilityActivity[];
  extensions: UsageExtension[];
  warnings: string[];
}
export interface UsageDay { date: string; tokens: number; input: number; output: number; messages: number; sessions: number; skills: number; extensions: number }
export interface CapabilityTotal { name: string; source: string; uses: number; failed: number }

const DAY_MS = 86_400_000;
const SESSION_LIMIT = 1000;
const PROJECT_LIMIT = 20;
const EVENT_BYTES = 256 * 1024;
const count = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export const isExtensionSource = (source: string): boolean => source === 'extension' || source.startsWith('extension:');

export function aggregateUsageReport(sessions: SessionMetadata[], events: CapabilityActivity[], range: number, now: Date) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = today - (range - 1) * DAY_MS;
  const end = today + DAY_MS;
  const days: UsageDay[] = Array.from({ length: range }, (_, i) => ({
    date: new Date(start + i * DAY_MS).toISOString().slice(0, 10), tokens: 0, input: 0, output: 0, messages: 0, sessions: 0, skills: 0, extensions: 0,
  }));
  const byDate = new Map(days.map(day => [day.date, day]));
  const unique = new Map(sessions.map(session => [session.sessionId, session]));
  const selected = [...unique.values()].filter(session => {
    const date = Date.parse(session.lastActiveAt);
    return date >= start && date < end;
  });
  let unknownSessions = 0;
  let longestTurnMs = 0;
  let cacheRead: number | undefined;
  for (const session of selected) {
    const day = byDate.get(new Date(session.lastActiveAt).toISOString().slice(0, 10))!;
    const usage = session.usage;
    day.sessions++;
    day.messages += count(session.messageCount);
    if (usage?.tokenUsageStatus === 'actual') {
      day.tokens += count(usage.totalTokens);
      day.input += count(usage.promptTokens);
      day.output += count(usage.completionTokens);
      if (usage.cacheReadTokens !== undefined) cacheRead = (cacheRead ?? 0) + count(usage.cacheReadTokens);
    } else unknownSessions++;
    longestTurnMs = Math.max(longestTurnMs, count(usage?.longestTurnDurationMs));
  }
  const skills = new Map<string, CapabilityTotal>();
  const extensions = new Map<string, CapabilityTotal>();
  const seen = new Set<string>();
  for (const event of events) {
    const timestamp = Date.parse(event.date);
    if (!(timestamp >= start && timestamp < end) || seen.has(event.id)) continue;
    seen.add(event.id);
    const day = byDate.get(new Date(timestamp).toISOString().slice(0, 10))!;
    for (const [include, totals] of [[event.kind === 'skill', skills], [isExtensionSource(event.source), extensions]] as const) {
      if (!include) continue;
      const key = JSON.stringify([event.name, event.source]);
      const total = totals.get(key) ?? { name: event.name, source: event.source, uses: 0, failed: 0 };
      total.uses++;
      if (event.failed) total.failed++;
      totals.set(key, total);
    }
    if (event.kind === 'skill') day.skills++;
    if (isExtensionSource(event.source)) day.extensions++;
  }
  const sorted = (totals: Map<string, CapabilityTotal>) => [...totals.values()].sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
  return {
    days, sessions: selected, tokens: days.reduce((sum, day) => sum + day.tokens, 0),
    messages: days.reduce((sum, day) => sum + day.messages, 0), unknownSessions, longestTurnMs, cacheRead,
    skills: sorted(skills), extensions: sorted(extensions),
  };
}

export async function readCapabilityActivity(project: string, signal: AbortSignal): Promise<{ events: CapabilityActivity[]; partial: boolean }> {
  signal.throwIfAborted();
  const file = path.join(project, '.autohand', 'memory', 'events', 'LOG.jsonl');
  let handle;
  try { handle = await open(file, 'r'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { events: [], partial: false };
    throw error;
  }
  try {
    const stat = await handle.stat();
    const start = Math.max(0, stat.size - EVENT_BYTES);
    const buffer = Buffer.alloc(Math.min(stat.size, EVENT_BYTES));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    signal.throwIfAborted();
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
    if (start > 0) lines.shift();
    let partial = start > 0;
    const events: CapabilityActivity[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event: unknown = JSON.parse(line);
        if (!isRecord(event) || event.operation !== 'capability_used') continue;
        const capability = event.capability;
        if (!isRecord(capability) || !['skill', 'slash_command'].includes(String(capability.kind))
          || typeof capability.name !== 'string' || typeof capability.source !== 'string'
          || typeof event.eventId !== 'string' || typeof event.occurredAt !== 'string'
          || !['succeeded', 'failed'].includes(String(event.outcome))) { partial = true; continue; }
        events.push({ id: event.eventId, date: event.occurredAt, kind: capability.kind as CapabilityActivity['kind'], name: capability.name,
          source: capability.source, project, failed: event.outcome === 'failed' });
      } catch { partial = true; }
    }
    return { events, partial };
  } finally { await handle.close(); }
}

export async function loadUsageReport(ctx: SlashCommandContext, query: UsageQuery, signal: AbortSignal): Promise<UsageReportData> {
  const warnings: string[] = [];
  const data: UsageReportData = { generatedAt: new Date().toISOString(), sessions: [], totalSessions: 0, capabilities: [], extensions: [], warnings };
  signal.throwIfAborted();
  const [sessionResult, extensionResult] = await Promise.allSettled([
    ctx.sessionManager.listRecentSessions(query.scope === 'project' ? { project: ctx.workspaceRoot } : undefined, SESSION_LIMIT),
    ctx.extensionService?.list(),
  ]);
  signal.throwIfAborted();
  if (sessionResult.status === 'fulfilled') {
    data.sessions = sessionResult.value.sessions;
    data.totalSessions = sessionResult.value.total;
    const live = ctx.sessionManager.getCurrentSession()?.metadata;
    if (live) {
      data.sessions = data.sessions.filter(session => session.sessionId !== live.sessionId);
      data.sessions.push({ ...live });
      data.totalSessions = Math.max(data.totalSessions, data.sessions.length);
    }
    if (data.totalSessions > SESSION_LIMIT) warnings.push(`Partial history: newest ${SESSION_LIMIT} indexed sessions of ${data.totalSessions}.`);
  } else warnings.push('Local session history unavailable.');
  if (extensionResult.status === 'fulfilled' && extensionResult.value) {
    data.extensions = extensionResult.value.extensions.map(extension => ({
      name: extension.manifest.name, scope: extension.scope, enabled: !extension.disabled,
      skills: extension.contributionFiles.skills.length, tools: extension.contributionFiles.tools.length,
    }));
    if (extensionResult.value.diagnostics.length) warnings.push('Some extensions could not be loaded. See /extensions doctor.');
  } else if (extensionResult.status === 'rejected') warnings.push('Extension inventory unavailable.');
  const projects = query.scope === 'project' ? [ctx.workspaceRoot] : [...new Set([ctx.workspaceRoot, ...data.sessions.map(session => session.projectPath)])];
  if (projects.length > PROJECT_LIMIT) warnings.push(`Capability history covers ${PROJECT_LIMIT} of ${projects.length} loaded projects.`);
  for (const project of projects.slice(0, PROJECT_LIMIT)) {
    signal.throwIfAborted();
    try {
      const result = await readCapabilityActivity(project, signal);
      data.capabilities.push(...result.events);
      if (result.partial && !warnings.includes('Capability history is partial (bounded log or invalid records).')) warnings.push('Capability history is partial (bounded log or invalid records).');
    } catch { signal.throwIfAborted(); warnings.push('A project capability log could not be read.'); }
  }
  return data;
}
