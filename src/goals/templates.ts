/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import fs from 'fs-extra';
import path from 'node:path';
import type { GoalTemplateMetadata } from './types.js';

const TEMPLATE_DIR = '.pi-goals';
const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
const DEFAULT_COMMAND_OUTPUT_LIMIT = 20_000;

interface GoalTemplate {
  name: string;
  path: string;
  description?: string;
  aliases: string[];
  allowCommands: boolean;
  commandTimeoutMs: number;
  commandOutputLimit: number;
  body: string;
}

interface ResolvedTemplate {
  name: string;
  path: string;
  objective: string;
  flags: Record<string, string>;
  args: string;
}

export type TemplateResolution =
  | { ok: true; template: ResolvedTemplate }
  | { ok: false; error: string }
  | { ok: false; notTemplate: true };

export async function listGoalTemplateMetadata(root: string): Promise<GoalTemplateMetadata[]> {
  const templates = await discoverGoalTemplates(root);
  return templates.map((template) => {
    const requiredPlaceholders = findRequiredPlaceholders(template.body);
    return {
      name: template.name,
      path: template.path,
      description: template.description,
      aliases: template.aliases,
      allowCommands: template.allowCommands,
      requiredPlaceholders,
      requiredFlags: requiredPlaceholders.filter((placeholder) => placeholder !== 'args'),
      requiresArgs: requiredPlaceholders.includes('args'),
    };
  });
}

export async function resolveGoalTemplateInvocation(input: string, root: string): Promise<TemplateResolution> {
  const parsed = parseInvocation(input);
  if (!parsed) return { ok: false, notTemplate: true };
  return resolveGoalTemplateByName(root, parsed.name, parsed.flags, parsed.args);
}

export async function resolveGoalTemplateByName(
  root: string,
  nameOrAlias: string,
  flags: Record<string, string> = {},
  args = '',
): Promise<TemplateResolution> {
  const templates = await discoverGoalTemplates(root);
  const matches = templates.filter((template) => template.name === nameOrAlias || template.aliases.includes(nameOrAlias));
  if (matches.length === 0) return { ok: false, notTemplate: true };
  if (matches.length > 1) {
    return { ok: false, error: `Ambiguous goal template '${nameOrAlias}' matches: ${matches.map((template) => template.name).join(', ')}.` };
  }

  const template = matches[0];
  try {
    const objective = resolveInlineCommands(interpolate(template.body, { ...flags, args }), template, root).trim();
    return { ok: true, template: { name: template.name, path: template.path, objective, flags: { ...flags }, args } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function discoverGoalTemplates(root: string): Promise<GoalTemplate[]> {
  const templates: GoalTemplate[] = [];
  for (const dir of templateDirs(root)) {
    if (!(await fs.pathExists(dir))) continue;
    await collectTemplates(root, dir, templates);
  }
  templates.sort((a, b) => a.name.localeCompare(b.name));
  return templates;
}

function templateDirs(root: string): string[] {
  return [path.join(root, TEMPLATE_DIR), path.join(root, '.ai', TEMPLATE_DIR)];
}

async function collectTemplates(root: string, templateDir: string, templates: GoalTemplate[]): Promise<void> {
  const entries = await fs.readdir(templateDir).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(templateDir, entry);
    const stats = await fs.stat(fullPath).catch(() => null);
    if (!stats) continue;
    if (stats.isDirectory()) {
      await collectTemplates(root, fullPath, templates);
      continue;
    }
    if (!['.md', '.markdown', '.txt'].includes(path.extname(entry).toLowerCase())) continue;
    const raw = await fs.readFile(fullPath, 'utf8');
    const parsed = parseFrontmatter(raw);
    const name = stripMarkdownExt(path.relative(templateDir, fullPath).split(path.sep).join('/'));
    templates.push({
      name,
      path: path.relative(root, fullPath),
      description: parsed.frontmatter.description || firstContentLine(parsed.body),
      aliases: parseList(parsed.frontmatter.aliases),
      allowCommands: parseBoolean(parsed.frontmatter.allow_commands),
      commandTimeoutMs: parsePositiveInt(parsed.frontmatter.command_timeout_ms, DEFAULT_COMMAND_TIMEOUT_MS),
      commandOutputLimit: parsePositiveInt(parsed.frontmatter.command_output_limit, DEFAULT_COMMAND_OUTPUT_LIMIT),
      body: parsed.body,
    });
  }
}

function parseFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
  if (!raw.startsWith('---\n')) return { frontmatter: {}, body: raw };
  const end = raw.indexOf('\n---', 4);
  if (end < 0) return { frontmatter: {}, body: raw };
  const frontmatter: Record<string, string> = {};
  for (const line of raw.slice(4, end).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) frontmatter[match[1]] = stripQuotes(match[2].trim());
  }
  return { frontmatter, body: raw.slice(end + 4).replace(/^\r?\n/, '') };
}

function parseInvocation(input: string): { name: string; flags: Record<string, string>; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  let rest = match[2] ?? '';
  let args = '';
  if (rest.startsWith('-- ')) {
    args = rest.slice(3).trim();
    rest = '';
  } else {
    const delimiter = rest.indexOf(' -- ');
    if (delimiter >= 0) {
      args = rest.slice(delimiter + 4).trim();
      rest = rest.slice(0, delimiter).trim();
    }
  }
  return { name: match[1], flags: parseFlags(rest), args };
}

function parseFlags(input: string): Record<string, string> {
  const values: Record<string, string> = {};
  const tokens = input.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  for (let i = 0; i < tokens.length; i++) {
    const token = unquote(tokens[i]);
    if (!token.startsWith('--')) continue;
    const eq = token.indexOf('=');
    if (eq > 2) {
      values[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const next = tokens[i + 1] && !tokens[i + 1].startsWith('--') ? unquote(tokens[++i]) : 'true';
    values[token.slice(2)] = next;
  }
  return values;
}

function interpolate(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g, (_match, key: string) => {
    if (values[key] === undefined) throw new Error(`Missing template value for {{${key}}}.`);
    return values[key];
  });
}

function resolveInlineCommands(text: string, template: GoalTemplate, cwd: string): string {
  return text.replace(/!`([^`]+)`/g, (_match, command: string) => {
    if (!template.allowCommands) throw new Error(`Template ${template.name} uses inline commands but allow_commands is not true.`);
    const output = execFileSync('/bin/bash', ['-lc', command], {
      cwd,
      encoding: 'utf8',
      timeout: template.commandTimeoutMs,
      maxBuffer: template.commandOutputLimit + 1024,
    });
    return output.length > template.commandOutputLimit ? `${output.slice(0, template.commandOutputLimit)}\n[output truncated]` : output;
  });
}

function findRequiredPlaceholders(text: string): string[] {
  return Array.from(text.matchAll(/\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g), (match) => match[1])
    .filter((placeholder, index, all) => all.indexOf(placeholder) === index)
    .sort();
}

function parseList(value?: string): string[] {
  if (!value) return [];
  return value.replace(/^\[|\]$/g, '').split(',').map((item) => stripQuotes(item.trim())).filter(Boolean);
}

function parseBoolean(value?: string): boolean {
  return value === 'true' || value === 'yes' || value === '1';
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function stripMarkdownExt(filePath: string): string {
  return filePath.replace(/\.(md|markdown|txt)$/i, '');
}

function firstContentLine(body: string): string | undefined {
  return body.split(/\r?\n/).map((line) => line.replace(/^#+\s*/, '').trim()).find(Boolean);
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '');
}

function unquote(value: string): string {
  return stripQuotes(value);
}
