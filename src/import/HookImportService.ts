import fs from 'fs-extra';
import path from 'node:path';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { detectConfigPath } from '../config.js';
import { atomicWriteFile, withFileLock } from '../utils/atomicFile.js';
import type { HookDefinition, HookEvent, HooksSettings, ImportedHookSource } from '../types.js';
import type { HookManager } from '../core/HookManager.js';
import type { ImportCategoryResult, ImportError } from './types.js';

export interface HookImportOptions {
  workspaceRoot?: string;
  configPath?: string;
  sourceHome?: string;
  hookManager?: HookManager;
}

interface HookFile {
  path: string;
  workspaceRoot?: string;
  workingDirectory?: string;
}

interface ParsedHooks {
  hooks: HookDefinition[];
  skipped: number;
  skipReasons: Record<string, number>;
}

const COMMON_EVENTS: Readonly<Record<string, HookEvent>> = {
  PreToolUse: 'pre-tool', PostToolUse: 'post-tool', PostToolUseFailure: 'post-tool',
  UserPromptSubmit: 'pre-prompt', SessionStart: 'session-start', SessionEnd: 'session-end',
  Notification: 'notification', PostCompact: 'context:compact', PermissionRequest: 'permission-request',
};
const CURSOR_EVENTS: Readonly<Record<string, HookEvent>> = {
  preToolUse: 'pre-tool', postToolUse: 'post-tool', postToolUseFailure: 'post-tool',
  beforeShellExecution: 'pre-tool', afterShellExecution: 'post-tool',
  beforeSubmitPrompt: 'pre-prompt', sessionStart: 'session-start', sessionEnd: 'session-end',
};
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseImportedHooks(
  source: ImportedHookSource,
  data: unknown,
  file: HookFile,
  workspaceRoot: string,
): ParsedHooks {
  if (!isRecord(data)) throw new Error('Expected a hook configuration object');
  const output: ParsedHooks = { hooks: [], skipped: 0, skipReasons: {} };
  const skip = (reason: string): void => {
    output.skipped++;
    output.skipReasons[reason] = (output.skipReasons[reason] ?? 0) + 1;
  };
  if (source === 'codex' && data.notify !== undefined) {
    skip('notify: legacy notification commands receive JSON in argv and require manual porting');
  }
  if (data.hooks === undefined) return output;
  if (!isRecord(data.hooks)) throw new Error('Expected an event-to-hooks object');
  if (source === 'cursor' && data.version !== undefined && data.version !== 1) {
    throw new Error('Unsupported Cursor hooks version');
  }
  for (const [sourceEvent, groups] of Object.entries(data.hooks)) {
    if (!Array.isArray(groups)) { skip(`${sourceEvent}: expected a hook array`); continue; }
    for (const group of groups) {
      if (!isRecord(group)) { skip(`${sourceEvent}: invalid hook group`); continue; }
      const handlers = source === 'cursor' ? [group] : group.hooks;
      if (!Array.isArray(handlers)) { skip(`${sourceEvent}: expected command handlers`); continue; }
      for (const handler of handlers) {
        const mapping = source === 'cursor' ? CURSOR_EVENTS : COMMON_EVENTS;
        const event = source === 'grok' && sourceEvent === 'Stop' ? 'stop'
          : Object.hasOwn(mapping, sourceEvent) ? mapping[sourceEvent] : undefined;
        if ((source === 'grok' && sourceEvent === 'PermissionRequest')
          || (source === 'codex' && ['Notification', 'PostToolUseFailure'].includes(sourceEvent))) {
          skip(`${sourceEvent}: unsupported event for ${source}`); continue;
        }
        if (!event) { skip(`${sourceEvent}: no equivalent lifecycle or continuation behavior`); continue; }
        if (!isRecord(handler)) { skip(`${sourceEvent}: invalid handler`); continue; }
        if (handler.type !== undefined && handler.type !== 'command') {
          skip(`${sourceEvent}: unsupported ${String(handler.type)} handler`); continue;
        }
        if (handler.async === true || handler.asyncRewake === true || handler.failClosed === true) {
          skip(`${sourceEvent}: async or failClosed semantics require manual porting`); continue;
        }
        const command = process.platform === 'win32' && typeof handler.commandWindows === 'string'
          ? handler.commandWindows : handler.command;
        if (typeof command !== 'string' || !command.trim()) { skip(`${sourceEvent}: missing command`); continue; }
        if (/\$(?:\{)?(?:CLAUDE|GROK)_PLUGIN_|\$(?:\{)?PLUGIN_(?:ROOT|DATA)/.test(command)) {
          skip(`${sourceEvent}: plugin paths require manual porting`); continue;
        }
        const matcher = handler.matcher ?? group.matcher;
        if (matcher !== undefined && typeof matcher !== 'string') { skip(`${sourceEvent}: unsupported matcher shape`); continue; }
        if (matcher && matcher !== '*') {
          try { new RegExp(matcher); } catch { skip(`${sourceEvent}: invalid matcher regex`); continue; }
        }
        const timeoutSeconds = handler.timeout ?? (source === 'codex' ? (event === 'session-end' ? 1 : 600) : source === 'claude' ? (event === 'pre-prompt' ? 30 : event === 'session-end' ? 1.5 : 600) : 5);
        if (typeof timeoutSeconds !== 'number' || !Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0 || timeoutSeconds * 1000 > 2_147_483_647) {
          skip(`${sourceEvent}: invalid timeout`); continue;
        }
        const importedFrom = {
          source, event: sourceEvent, configPath: file.path,
          ...(file.workspaceRoot ? { workspaceRoot: path.resolve(workspaceRoot) } : {}),
          ...(file.workingDirectory ? { workingDirectory: file.workingDirectory } : {}),
        };
        const id = createHash('sha256').update(JSON.stringify([importedFrom, command, matcher, timeoutSeconds])).digest('hex');
        output.hooks.push({
          event, command, enabled: false, timeout: timeoutSeconds * 1000,
          description: `Imported ${source} ${sourceEvent} — review before enabling`,
          ...(matcher && matcher !== '*' ? { matcher } : {}),
          importedFrom: { ...importedFrom, id },
        });
      }
    }
  }
  return output;
}

export class HookImportService {
  constructor(
    private readonly source: ImportedHookSource,
    private readonly sourceHome: string,
    private readonly options: HookImportOptions = {},
  ) {}

  async discover(): Promise<HookFile[]> {
    const workspaceRoot = path.resolve(this.options.workspaceRoot ?? process.cwd());
    const home = path.resolve(this.sourceHome);
    const project = path.join(workspaceRoot, `.${this.source}`);
    const files: HookFile[] = [];
    for (const directory of [...new Set([home, project])]) {
      const scope = directory === project ? { workspaceRoot } : {};
      const workingDirectory = this.source === 'cursor' ? (directory === project ? workspaceRoot : home) : undefined;
      const names = this.source === 'claude' ? ['settings.json', ...(directory === project ? ['settings.local.json'] : [])]
        : this.source === 'codex' ? ['hooks.json', 'config.toml']
        : this.source === 'cursor' ? ['hooks.json']
        : await this.grokFiles(directory);
      for (const name of names) {
        const filePath = path.join(directory, name);
        if (await fs.pathExists(filePath)) files.push({ path: filePath, ...scope, ...(workingDirectory ? { workingDirectory } : {}) });
      }
    }
    return files;
  }

  private async grokFiles(directory: string): Promise<string[]> {
    const hookDirectory = path.join(directory, 'hooks');
    if (!(await fs.pathExists(hookDirectory))) return [];
    const entries = await fs.readdir(hookDirectory, { withFileTypes: true });
    return entries.filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => path.join('hooks', entry.name)).sort();
  }

  async scan(): Promise<number> {
    const files = await this.discover();
    let count = 0;
    for (const file of files) {
      try {
        const data = await this.read(file.path);
        if (isRecord(data) && (data.hooks !== undefined || (this.source === 'codex' && data.notify !== undefined))) count++;
      } catch { count++; }
    }
    return count;
  }

  private async read(filePath: string): Promise<unknown> {
    if (filePath.endsWith('.toml')) return parseToml(await fs.readFile(filePath, 'utf8'));
    return fs.readJson(filePath);
  }

  async import(): Promise<{ stats: ImportCategoryResult; errors: ImportError[] }> {
    const errors: ImportError[] = [];
    const skipReasons: Record<string, number> = {};
    const definitions: HookDefinition[] = [];
    let skipped = 0;
    let failed = 0;
    let success = 0;
    const recordError = (item: string, error: unknown): void => {
      errors.push({ category: 'hooks', item, error: error instanceof Error ? error.message : String(error), retriable: false });
    };
    for (const file of await this.discover()) {
      try {
        const result = parseImportedHooks(this.source, await this.read(file.path), file, this.options.workspaceRoot ?? process.cwd());
        definitions.push(...result.hooks);
        skipped += result.skipped;
        for (const [reason, count] of Object.entries(result.skipReasons)) skipReasons[reason] = (skipReasons[reason] ?? 0) + count;
      } catch (error) { failed++; recordError(file.path, error); }
    }
    const merge = (settings: HooksSettings): HooksSettings => {
      const existing = settings.hooks ?? [];
      if (!Array.isArray(existing)) throw new Error('Destination hooks.hooks must be an array');
      const ids = new Set(existing.map(hook => hook.importedFrom?.id));
      const additions = definitions.filter(hook => {
        if (ids.has(hook.importedFrom?.id)) {
          skipped++;
          skipReasons['already imported'] = (skipReasons['already imported'] ?? 0) + 1;
          return false;
        }
        ids.add(hook.importedFrom?.id);
        return true;
      });
      success = additions.length;
      return { ...settings, hooks: [...existing, ...additions] };
    };
    if (definitions.length > 0) {
      try {
        if (this.options.hookManager) {
          const settings = merge(this.options.hookManager.getSettings());
          if (success > 0) await this.options.hookManager.updateSettings(settings);
        } else {
          const configPath = await detectConfigPath(this.options.configPath);
          await fs.ensureDir(path.dirname(configPath));
          await withFileLock(`${configPath}.lock`, async () => {
            const ext = path.extname(configPath);
            const raw = await fs.pathExists(configPath) ? await fs.readFile(configPath, 'utf8') : '{}';
            const data: unknown = ext === '.toml' ? parseToml(raw === '{}' ? '' : raw) : /\.ya?ml$/.test(ext) ? YAML.parse(raw) : JSON.parse(raw);
            if (!isRecord(data) || (data.hooks !== undefined && !isRecord(data.hooks))) throw new Error('Destination configuration has an invalid hooks section');
            data.hooks = merge((data.hooks ?? {}) as HooksSettings);
            if (success > 0) {
              const content = ext === '.toml' ? stringifyToml(data) : /\.ya?ml$/.test(ext) ? YAML.stringify(data) : JSON.stringify(data, null, 2) + '\n';
              await atomicWriteFile(configPath, content);
            }
          });
        }
      } catch (error) { failed += success || definitions.length; success = 0; recordError('Autohand config', error); }
    }
    return { stats: { success, failed, skipped, ...(skipped ? { skipReasons } : {}) }, errors };
  }
}
