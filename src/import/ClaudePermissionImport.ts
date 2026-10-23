import fs from 'fs-extra';
import { promises as nodeFs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import type { ImportedClaudeRule } from '../permissions/importedClaudeRules.js';
import { isSimplePermissionCommand } from '../permissions/commandParts.js';
import { AUTOHAND_PATHS } from '../constants.js';
import { detectConfigPath } from '../config.js';
import { atomicWriteFile, atomicWriteJson, withFileLock } from '../utils/atomicFile.js';
import { isRecord, type HookImportOptions } from './HookImportService.js';
import type { ImportCategoryResult, ImportError, PermissionImportMapping, PermissionImportReport } from './types.js';

interface SettingsSource { path: string; workspaceRoot?: string }
interface PermissionPlan {
  files: SettingsSource[];
  mappings: PermissionImportMapping[];
  errors: ImportError[];
  legacyPaths: string[];
}

const unsafeRuleText = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/;

function translateRule(rule: string, workspaceRoot?: string): string[] | null {
  if (!rule || rule !== rule.trim() || unsafeRuleText.test(rule)) return null;
  if (/^mcp__[\w.-]+__[\w.-]+$/.test(rule)) return [rule + ':*'];
  const match = /^(Bash|Read|Edit|Write|WebFetch)(?:\((.*)\))?$/.exec(rule);
  if (!match) return null;
  const [, tool, argument] = match;
  if (tool === 'Bash') {
    if (argument !== undefined && (!argument || argument !== argument.trim() || /[?\[\]{}]/.test(argument))) return null;
    const prefix = argument?.endsWith(':*') ? argument.slice(0, -2) : argument;
    if (prefix !== undefined && !isSimplePermissionCommand(prefix)) return null;
    const command = argument === undefined ? '*' : argument.endsWith(':*') ? argument.slice(0, -2) + '*' : argument;
    return ['run_command:' + command, 'shell:' + command];
  }
  if (tool === 'WebFetch') return argument === undefined ? ['fetch_url:*'] : null;
  if (argument !== undefined && (!argument || /[?\[\]{}~\\]/.test(argument) || argument.startsWith('/') || !argument.startsWith('./') || (argument.includes('*') && (!argument.endsWith('/**') || argument.slice(0, -3).includes('*'))))) return null;
  let target = argument ?? '*';
  if (path.isAbsolute(target)) {
    if (!workspaceRoot) return null;
    target = path.relative(workspaceRoot, target);
    if (target.startsWith('..') || path.isAbsolute(target)) return null;
  }
  target = target.replace(/^\.\//, '');
  if (!target || target.split('/').includes('..')) return null;
  const capability = tool === 'Read' ? 'read_file' : 'write_file';
  const patterns = [capability + ':' + target];
  if (workspaceRoot && argument !== undefined && !target.includes('*')) {
    patterns.push(capability + ':' + path.resolve(workspaceRoot, target));
  }
  return patterns;
}

function report(plan: PermissionPlan, scrubbed = false): PermissionImportReport {
  const translated = plan.mappings.filter(mapping => mapping.status === 'translated');
  return {
    allow: translated.filter(mapping => mapping.disposition === 'allow').length,
    deny: translated.filter(mapping => mapping.disposition === 'deny').length,
    repositories: new Set(translated.flatMap(mapping => mapping.workspaceRoot ? [mapping.workspaceRoot] : [])).size,
    skipped: plan.mappings.filter(mapping => mapping.status === 'skipped').length,
    mappings: plan.mappings,
    errors: plan.errors,
    legacySettingsScrubbed: scrubbed,
    legacySettingsToScrub: plan.legacyPaths,
  };
}

const printable = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ');

export function permissionImportLines(value: PermissionImportReport, dryRun = false): string[] {
  const lines = [(dryRun ? 'Would translate ' : 'Translated ') + value.allow + ' allow and ' + value.deny + ' deny rules across ' + value.repositories + ' repos; ' + value.skipped + ' skipped'];
  if (dryRun) lines.push('Scope | Rule | Translation');
  for (const error of value.errors ?? []) lines.push(printable(error.item + ': ' + error.error));
  for (const mapping of value.mappings) {
    if (!dryRun && mapping.status === 'translated') continue;
    const result = mapping.status === 'translated' ? mapping.patterns.join(', ') : mapping.status + ' (' + mapping.reason + ')';
    lines.push(printable((mapping.workspaceRoot ?? 'User') + ' | ' + mapping.disposition + ' ' + mapping.rule + ' | ' + result));
  }
  if (dryRun) for (const file of value.legacySettingsToScrub) lines.push('Would scrub raw settings and environment data from ' + printable(file));
  else if (value.legacySettingsScrubbed) lines.push('Scrubbed raw Claude settings and environment data from the legacy import file.');
  return lines;
}

export class ClaudePermissionImport {
  constructor(private readonly sourceHome: string, private readonly options: HookImportOptions = {}) {}

  private async recordedWorkspace(file: string): Promise<string | null> {
    const handle = await nodeFs.open(file, 'r');
    try {
      const buffer = Buffer.alloc(128 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      for (const line of buffer.subarray(0, bytesRead).toString('utf8').split('\n')) {
        try {
          const value: unknown = JSON.parse(line);
          if (isRecord(value) && typeof value.cwd === 'string' && path.isAbsolute(value.cwd)) return path.normalize(value.cwd);
        } catch { /* Incomplete or non-JSON header lines do not identify a repository. */ }
      }
      return null;
    } finally { await handle.close(); }
  }

  private async discover(): Promise<SettingsSource[]> {
    const roots = new Set([path.resolve(this.options.workspaceRoot ?? process.cwd())]);
    const registry = this.sourceHome + '.json';
    if (await fs.pathExists(registry)) {
      try {
        const data: unknown = JSON.parse(await fs.readFile(registry, 'utf8'));
        if (isRecord(data) && isRecord(data.projects)) for (const root of Object.keys(data.projects)) if (path.isAbsolute(root)) roots.add(path.normalize(root));
      } catch { /* Session headers and the selected workspace remain independent sources. */ }
    }
    const projects = path.join(this.sourceHome, 'projects');
    if (await fs.pathExists(projects)) {
      for (const directory of await fs.readdir(projects, { withFileTypes: true })) {
        if (!directory.isDirectory()) continue;
        const folder = path.join(projects, directory.name);
        for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
          if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
          try {
            const root = await this.recordedWorkspace(path.join(folder, entry.name));
            if (root) { roots.add(root); break; }
          } catch { /* An unreadable session does not justify decoding its lossy directory name. */ }
        }
      }
    }
    const files: SettingsSource[] = [];
    const global = path.join(this.sourceHome, 'settings.json');
    if (await fs.pathExists(global)) files.push({ path: global });
    for (const root of roots) {
      for (const name of ['settings.json', 'settings.local.json']) {
        const file = path.join(root, '.claude', name);
        if (await fs.pathExists(file)) files.push({ path: file, workspaceRoot: root });
      }
    }
    return files;
  }

  async scan(): Promise<number> {
    const files = await this.discover();
    return files.length || (await fs.pathExists(path.join(AUTOHAND_PATHS.config, 'imported-claude-settings.json')) ? 1 : 0);
  }

  private async needsScrub(file: string): Promise<boolean> {
    if (!await fs.pathExists(file)) return false;
    try {
      const value: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
      return !isRecord(value) || Object.hasOwn(value, 'raw') || Object.hasOwn(value, 'env');
    } catch { return true; }
  }

  private async plan(): Promise<PermissionPlan> {
    const configPath = await detectConfigPath(this.options.configPath);
    const files = await this.discover();
    const plan: PermissionPlan = { files, mappings: [], errors: [], legacyPaths: [] };
    for (const file of files) {
      try {
        const data: unknown = JSON.parse(await fs.readFile(file.path, 'utf8'));
        if (!isRecord(data) || (data.permissions !== undefined && !isRecord(data.permissions))) throw new Error('Invalid permissions');
        const permissions = isRecord(data.permissions) ? data.permissions : {};
        const destination = file.workspaceRoot ? path.join(file.workspaceRoot, '.autohand', 'settings.local.json') : configPath;
        for (const disposition of ['allow', 'deny'] as const) {
          const values = permissions[disposition];
          if (values === undefined) continue;
          const entries: unknown[] = Array.isArray(values) ? values : [null];
          const seen = new Set<string>();
          for (const entry of entries) {
            const rule = typeof entry === 'string' ? entry : '[non-text rule]';
            if (seen.has(rule)) continue;
            seen.add(rule);
            const patterns = typeof entry === 'string' ? translateRule(entry, file.workspaceRoot) : null;
            const mapping = { source: file.path, destination, ...(file.workspaceRoot ? { workspaceRoot: file.workspaceRoot } : {}), disposition, rule };
            plan.mappings.push(patterns ? { ...mapping, status: 'translated', patterns } : { ...mapping, status: 'skipped', reason: 'no equivalent' });
          }
        }
      } catch {
        plan.errors.push({ category: 'settings', item: file.path, error: 'Could not read Claude permission settings. No raw settings were copied.', retriable: false });
      }
    }
    for (const home of new Set([AUTOHAND_PATHS.config, path.dirname(configPath)])) {
      const file = path.join(home, 'imported-claude-settings.json');
      if (await this.needsScrub(file)) plan.legacyPaths.push(file);
    }
    return plan;
  }

  async preview(): Promise<PermissionImportReport> { return report(await this.plan()); }

  private async updateDestination(file: string, mappings: readonly PermissionImportMapping[]): Promise<void> {
    const project = mappings.find(mapping => mapping.workspaceRoot)?.workspaceRoot;
    const assertContained = async () => {
      if (!project) return;
      const root = await fs.realpath(project);
      const directory = path.dirname(file);
      if (await fs.pathExists(directory)) {
        const actual = await fs.realpath(directory);
        if (actual !== path.join(root, '.autohand')) throw new Error('Project settings directory escapes its repository');
      }
      if (await fs.pathExists(file) && (await fs.lstat(file)).isSymbolicLink()) throw new Error('Project settings file is a symlink');
    };
    await assertContained();
    const merge = async () => {
      await assertContained();
      const extension = path.extname(file);
      const raw = await fs.pathExists(file) ? await fs.readFile(file, 'utf8') : extension === '.toml' ? '' : '{}';
      const data: unknown = extension === '.toml' ? parseToml(raw) : /\.ya?ml$/.test(extension) ? YAML.parse(raw) : JSON.parse(raw);
      if (!isRecord(data) || (data.permissions !== undefined && !isRecord(data.permissions))) throw new Error('Invalid destination settings');
      const permissions = isRecord(data.permissions) ? data.permissions : {};
      const list = (canonical: string, legacy: string) => {
        const value = permissions[canonical] ?? permissions[legacy] ?? [];
        if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) throw new Error('Invalid destination permission list');
        return value as string[];
      };
      const currentAllow = list('allowList', 'whitelist'), currentDeny = list('denyList', 'blacklist');
      const patterns = (disposition: 'allow' | 'deny') => mappings.flatMap(mapping => mapping.status === 'translated' && mapping.disposition === disposition ? [...mapping.patterns] : []);
      const allowList = [...new Set([...currentAllow, ...patterns('allow')])];
      const denyList = [...new Set([...currentDeny, ...patterns('deny')])];
      const existingMetadata = permissions.importedClaudeRules ?? [];
      if (!Array.isArray(existingMetadata)) throw new Error('Invalid imported permission metadata');
      const importedClaudeRules = [...existingMetadata];
      for (const mapping of mappings) {
        if (mapping.status !== 'translated') continue;
        const existing = mapping.disposition === 'allow' ? currentAllow : currentDeny;
        for (const pattern of mapping.patterns) {
          // A pre-existing Autohand rule retains its original matching semantics.
          if (existing.includes(pattern)) continue;
          const kind: ImportedClaudeRule['kind'] = mapping.rule.startsWith('Bash(')
            ? mapping.rule.endsWith(':*)') ? 'command-prefix' : 'command-exact'
            : /^(Read|Edit|Write)\(/.test(mapping.rule) ? 'file' : 'tool';
          const metadata: ImportedClaudeRule = { pattern, action: mapping.disposition, kind };
          if (!importedClaudeRules.some(value => isRecord(value) && value.pattern === pattern && value.action === metadata.action)) importedClaudeRules.push(metadata);
        }
      }
      if (JSON.stringify(currentAllow) === JSON.stringify(allowList) && JSON.stringify(currentDeny) === JSON.stringify(denyList)
        && JSON.stringify(existingMetadata) === JSON.stringify(importedClaudeRules)) return null;
      data.permissions = { ...permissions, allowList, denyList, importedClaudeRules };
      if (mappings.some(mapping => mapping.workspaceRoot) && data.version === undefined) data.version = 1;
      return extension === '.toml' ? stringifyToml(data) : /\.ya?ml$/.test(extension) ? YAML.stringify(data) : JSON.stringify(data, null, 2) + '\n';
    };
    if (await merge() === null) return;
    await fs.ensureDir(path.dirname(file));
    await withFileLock(file + '.lock', async () => {
      const content = await merge();
      if (content !== null) await atomicWriteFile(file, content);
    });
  }

  async scrubLegacy(files?: readonly string[]): Promise<{ scrubbed: boolean; errors: ImportError[] }> {
    if (!files) files = (await this.plan()).legacyPaths;
    const errors: ImportError[] = [];
    let scrubbed = false;
    for (const file of files) {
      try {
        await withFileLock(file + '.lock', async () => {
          if (!await this.needsScrub(file)) return;
          await atomicWriteJson(file, { importedFrom: 'claude', scrubbed: true });
          await fs.chmod(file, 0o600);
          scrubbed = true;
        });
      } catch {
        errors.push({ category: 'settings', item: file, error: 'Could not scrub the legacy Claude settings file.', retriable: true });
      }
    }
    return { scrubbed, errors };
  }

  async cleanup(): Promise<PermissionImportReport> {
    const plan = await this.plan();
    const cleanup = await this.scrubLegacy(plan.legacyPaths);
    return report({ ...plan, files: [], mappings: [], errors: cleanup.errors }, cleanup.scrubbed);
  }

  async import(): Promise<{ stats: ImportCategoryResult; errors: ImportError[]; report: PermissionImportReport }> {
    const plan = await this.plan();
    const destinations = new Set(plan.mappings.filter(mapping => mapping.status === 'translated').map(mapping => mapping.destination));
    for (const destination of destinations) {
      try {
        await this.updateDestination(destination, plan.mappings.filter(mapping => mapping.destination === destination));
      } catch {
        plan.errors.push({ category: 'settings', item: destination, error: 'Could not merge permission rules; existing settings were preserved.', retriable: false });
        plan.mappings = plan.mappings.map(mapping => mapping.destination === destination && mapping.status === 'translated'
          ? { source: mapping.source, destination: mapping.destination, workspaceRoot: mapping.workspaceRoot, disposition: mapping.disposition, rule: mapping.rule, status: 'failed', reason: 'destination settings could not be updated' }
          : mapping);
      }
    }
    const cleanup = await this.scrubLegacy(plan.legacyPaths);
    plan.errors.push(...cleanup.errors);
    const scrubbed = cleanup.scrubbed;
    const result = report(plan, scrubbed);
    const failedSources = new Set(plan.errors.map(error => error.item));
    for (const mapping of plan.mappings) if (mapping.status === 'failed') failedSources.add(mapping.source);
    const success = plan.files.filter(file => !failedSources.has(file.path)).length;
    return { report: result, errors: plan.errors, stats: {
      success, failed: plan.errors.length, skipped: result.skipped + (!plan.files.length && !plan.legacyPaths.length ? 1 : 0),
      ...(result.skipped ? { skipReasons: { 'no equivalent': result.skipped } } : {}),
    } };
  }
}
