/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import fse from 'fs-extra';
import type {
  ImportSource,
  ImportCategory,
  ImportScanResult,
  ImportResult,
  ImportError,
  ImportCategoryResult,
  ProgressCallback,
  PermissionImportReport,
} from '../types.js';
import type { SessionMessage } from '../../session/types.js';
import { AUTOHAND_PATHS } from '../../constants.js';
import { detectConfigPath } from '../../config.js';
import YAML from 'yaml';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { BaseImporter } from './BaseImporter.js';
import { ClaudePermissionImport } from '../ClaudePermissionImport.js';
import { atomicWriteFile } from '../../utils/atomicFile.js';

/**
 * A single parsed Claude event from a session JSONL file.
 */
interface ClaudeEvent {
  type: string;
  sessionId?: string;
  cwd?: string;
  isMeta?: boolean;
  message?: {
    role: string;
    content: string | Array<{ type: string; text?: string; [k: string]: unknown }>;
    model?: string;
    [k: string]: unknown;
  };
  timestamp?: string;
  [k: string]: unknown;
}

type CollectedMcpServers = {
  user: Record<string, unknown>;
  project: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validMcpServers(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};

  return Object.fromEntries(Object.entries(value).filter(([name, server]) => {
    if (!name.trim()) return false;
    if (!isRecord(server)) return false;
    if (server.type === 'http' || server.type === 'sse') return typeof server.url === 'string' && server.url.length > 0;
    return (server.type === undefined || server.type === 'stdio') && typeof server.command === 'string' && server.command.length > 0;
  }));
}

function hasEnvPlaceholders(value: unknown): boolean {
  if (typeof value === 'string') return /\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[^}]*)?\}/.test(value);
  if (Array.isArray(value)) return value.some(hasEnvPlaceholders);
  return isRecord(value) && Object.values(value).some(hasEnvPlaceholders);
}

/**
 * Importer for Claude Code CLI data (~/.claude).
 *
 * Handles sessions (JSONL), settings (settings.json), skills (markdown files),
 * and per-project memory (CLAUDE.md / memory/ directories).
 */
export class ClaudeImporter extends BaseImporter {
  readonly name: ImportSource = 'claude';
  readonly displayName = 'Claude Code';
  readonly homePath = '~/.claude';
  private permissionReport?: PermissionImportReport;

  private permissionImport(): ClaudePermissionImport {
    return new ClaudePermissionImport(this.resolvedHomePath, this.hookImportOptions);
  }

  override async detect(): Promise<boolean> {
    return await super.detect() || await this.permissionImport().scan() > 0
      || await fse.pathExists(path.join(path.dirname(this.resolvedHomePath), '.claude.json'))
      || await fse.pathExists(path.join(path.resolve(this.hookImportOptions.workspaceRoot ?? process.cwd()), '.mcp.json'));
  }

  async previewSettings(): Promise<PermissionImportReport> {
    return this.permissionImport().preview();
  }

  // ---------------------------------------------------------------
  // scan()
  // ---------------------------------------------------------------

  async scan(): Promise<ImportScanResult> {
    const available = new Map<ImportCategory, { count: number; description: string }>();
    await this.scanHooks(available);
    const settingsCount = await this.permissionImport().scan();
    if (settingsCount > 0) available.set('settings', { count: settingsCount, description: 'Claude user and project permission settings' });
    const home = this.resolvedHomePath;
    const mcp = await this.collectMcpServers();
    if (Object.keys(mcp.user).length + Object.keys(mcp.project).length > 0) {
      available.set('mcp', { count: Object.keys(mcp.user).length + Object.keys(mcp.project).length, description: 'Claude MCP servers' });
    }

    if (!(await fse.pathExists(home))) {
      return { source: this.name, available };
    }

    // Count sessions across all project directories
    const projectsDir = path.join(home, 'projects');
    let sessionCount = 0;
    let memoryCount = 0;

    if (await fse.pathExists(projectsDir)) {
      const entries = await fse.readdir(projectsDir, { withFileTypes: true }) as unknown as Array<{ name: string; isDirectory(): boolean }>;
      const projectDirs = entries.filter(e => e.isDirectory());

      for (const dir of projectDirs) {
        const projectDir = path.join(projectsDir, dir.name);
        const projectEntries = await fse.readdir(projectDir, { withFileTypes: true }) as unknown as Array<{ name: string; isFile(): boolean; isDirectory(): boolean }>;

        // Count .jsonl session files
        const jsonlFiles = projectEntries.filter(e => e.isFile() && e.name.endsWith('.jsonl'));
        sessionCount += jsonlFiles.length;

        // Check for memory (memory/ dir or CLAUDE.md)
        const hasMemoryDir = await fse.pathExists(path.join(projectDir, 'memory'));
        const hasClaudeMd = await fse.pathExists(path.join(projectDir, 'CLAUDE.md'));
        if (hasMemoryDir || hasClaudeMd) {
          memoryCount++;
        }
      }
    }

    if (sessionCount > 0) {
      available.set('sessions', {
        count: sessionCount,
        description: `${sessionCount} session file${sessionCount !== 1 ? 's' : ''} across project directories`,
      });
    }

    // Check skills
    const skillsDir = path.join(home, 'skills');
    if (await fse.pathExists(skillsDir)) {
      const skillEntries = await fse.readdir(skillsDir, { withFileTypes: true }) as unknown as Array<{ name: string; isFile(): boolean }>;
      const skillFiles = skillEntries.filter(e => e.isFile());
      if (skillFiles.length > 0) {
        available.set('skills', {
          count: skillFiles.length,
          description: `${skillFiles.length} skill file${skillFiles.length !== 1 ? 's' : ''}`,
        });
      }
    }

    // Memory
    if (memoryCount > 0) {
      available.set('memory', {
        count: memoryCount,
        description: `${memoryCount} project${memoryCount !== 1 ? 's' : ''} with memory data`,
      });
    }

    return { source: this.name, available };
  }

  // ---------------------------------------------------------------
  // import()
  // ---------------------------------------------------------------

  async import(
    categories: ImportCategory[],
    onProgress?: ProgressCallback,
  ): Promise<ImportResult> {
    const start = Date.now();
    const imported = new Map<ImportCategory, ImportCategoryResult>();
    const errors: ImportError[] = [];
    this.permissionReport = undefined;

    for (const category of categories) {
      switch (category) {
        case 'hooks':
          await this.importCommandHooks(imported, errors, onProgress);
          break;
        case 'sessions':
          await this.importSessions(imported, errors, onProgress);
          break;
        case 'settings':
          await this.importSettings(imported, errors, onProgress);
          break;
        case 'skills':
          await this.importSkills(imported, errors, onProgress);
          break;
        case 'memory':
          await this.importMemory(imported, errors, onProgress);
          break;
        case 'mcp':
          await this.importMcpServers(imported, errors);
          break;
        default:
          break;
      }
    }

    if (!categories.includes('settings')) {
      this.permissionReport = await this.permissionImport().cleanup();
      errors.push(...(this.permissionReport.errors ?? []));
    }

    return {
      source: this.name,
      imported,
      errors,
      duration: Date.now() - start,
      ...(this.permissionReport ? { permissions: this.permissionReport } : {}),
    };
  }

  private async readOptionalJson(filePath: string): Promise<Record<string, unknown> | undefined> {
    try {
      const value: unknown = await fse.readJson(filePath);
      return isRecord(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  // Collect user and current-workspace MCP servers
  private async collectMcpServers(): Promise<CollectedMcpServers> {
    const claudeConfigPath = path.join(path.dirname(this.resolvedHomePath), '.claude.json');
    const workspaceRoot = path.resolve(this.hookImportOptions.workspaceRoot ?? process.cwd());
    const projectConfigPath = path.join(workspaceRoot, '.mcp.json');
    const collected: CollectedMcpServers = { user: {}, project: {} };

    const claudeConfig = await this.readOptionalJson(claudeConfigPath);
    if (claudeConfig && isRecord(claudeConfig.mcpServers)) {
      Object.assign(collected.user, validMcpServers(claudeConfig.mcpServers));
    }

    const localConfig = await this.readOptionalJson(projectConfigPath);
    if (localConfig && isRecord(localConfig.mcpServers)) {
      Object.assign(collected.project, validMcpServers(localConfig.mcpServers));
    }

    const projects = claudeConfig?.projects;
    if (isRecord(projects)) {
      const projectConfig = projects[workspaceRoot];
      if (isRecord(projectConfig) && isRecord(projectConfig.mcpServers)) {
        Object.assign(collected.project, validMcpServers(projectConfig.mcpServers));
      }
    }

    return collected;
  }

  // Import user and workspace MCP servers, preserving existing entries and skipping duplicates.
  private async importMcpServers(imported: Map<ImportCategory, ImportCategoryResult>, errors: ImportError[]): Promise<void> {
    const { user, project } = await this.collectMcpServers();
    const workspace = path.resolve(this.hookImportOptions.workspaceRoot ?? process.cwd());
    const destinations = [
      { servers: user, file: await detectConfigPath(this.hookImportOptions.configPath) },
      { servers: project, file: path.join(workspace, '.autohand', 'settings.local.json') },
    ];
    let success = 0;
    let skipped = 0;
    const skipReasons: Record<string, number> = {};
    for (const { servers, file } of destinations) {
      try {
        if (!Object.keys(servers).length) continue;
        if (servers === project) await this.assertProjectMcpDestination(workspace, file);
        const current = await this.readConfigFile(file);
        const mcp = isRecord(current.mcp) ? current.mcp : {};
        const existing = Array.isArray(mcp.servers) ? mcp.servers : [];
        const converted = Object.entries(servers).flatMap(([name, value]) => {
          if (!isRecord(value)) return [];
          if (hasEnvPlaceholders(value)) {
            errors.push({ category: 'mcp', item: name, error: 'Claude MCP environment variable placeholders are not supported by this importer', retriable: false });
            return [];
          }
          const server = value;
          const transport = server.type === 'http' || server.type === 'sse' ? server.type : 'stdio';
          return [{ ...server, name, transport, autoConnect: false, localOnly: true }];
        });
        const existingNames = new Set<string>();
        for (const server of existing) {
          if (isRecord(server) && typeof server.name === 'string') {
            existingNames.add(server.name);
          }
        }
        const additions = converted.filter(server => !existingNames.has(server.name));
        const duplicateCount = converted.length - additions.length;
        skipped += duplicateCount;
        if (duplicateCount > 0) skipReasons['already exists'] = (skipReasons['already exists'] ?? 0) + duplicateCount;

        if (additions.length === 0) continue;

        const merged = [...existing, ...additions];
        if (servers === project) await this.ignoreLocalSettings(workspace);
        await fse.ensureDir(path.dirname(file));
        if (servers === project) await this.assertProjectMcpDestination(workspace, file);
        const output = { ...current, mcp: { ...mcp, servers: merged } };
        await this.writeConfigFile(file, output);
        success += additions.length;
      } catch (error) { errors.push({ category: 'mcp', item: file, error: error instanceof Error ? error.message : String(error), retriable: false }); }
    }
    imported.set('mcp', {
      success,
      failed: errors.filter(e => e.category === 'mcp').length,
      skipped,
      ...(skipped > 0 ? { skipReasons } : {}),
    });
  }

  private async assertProjectMcpDestination(workspace: string, file: string): Promise<void> {
    const root = await fse.realpath(workspace);
    const directory = path.dirname(file);
    if (await fse.pathExists(directory) && await fse.realpath(directory) !== path.join(root, '.autohand')) {
      throw new Error('Project MCP settings directory escapes its repository');
    }
    try {
      if ((await fse.lstat(file)).isSymbolicLink()) throw new Error('Project MCP settings file is a symlink');
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
  }

  // Keep imported credentials out of Git without changing the shared .gitignore.
  private async ignoreLocalSettings(workspace: string): Promise<void> {
    let excludeFile: string;
    try {
      excludeFile = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'], {
        cwd: workspace,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    } catch (error) {
      const stderr = (error as NodeJS.ErrnoException & { stderr?: Buffer | string }).stderr?.toString() ?? '';
      if (stderr.includes('not a git repository')) return;
      throw error;
    }

    const pattern = '**/.autohand/settings.local.json';
    const current = await fse.pathExists(excludeFile) ? await fse.readFile(excludeFile, 'utf8') : '';
    if (current.split(/\r?\n/).includes(pattern)) return;
    const separator = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
    await fse.writeFile(excludeFile, `${current}${separator}${pattern}\n`);
  }

  private async readConfigFile(file: string): Promise<Record<string, unknown>> {
    if (!(await fse.pathExists(file))) return {};

    const extension = path.extname(file).toLowerCase();
    let parsed: unknown;
    if (extension === '.toml') {
      parsed = parseToml(await fse.readFile(file, 'utf8'));
    } else if (/\.ya?ml$/.test(extension)) {
      parsed = YAML.parse(await fse.readFile(file, 'utf8'));
    } else {
      parsed = await fse.readJson(file);
    }

    if (!isRecord(parsed)) {
      throw new Error(`Expected a configuration object in ${file}`);
    }
    return parsed;
  }

  private async writeConfigFile(file: string, config: Record<string, unknown>): Promise<void> {
    const extension = path.extname(file).toLowerCase();
    const content = extension === '.toml' ? stringifyToml(config)
      : /\.ya?ml$/.test(extension) ? YAML.stringify(config) : JSON.stringify(config, null, 2) + '\n';
    await atomicWriteFile(file, content);
    await fse.chmod(file, 0o600);
  }

  // ---------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------

  protected async importSessions(
    imported: Map<ImportCategory, ImportCategoryResult>,
    errors: ImportError[],
    onProgress?: ProgressCallback,
  ): Promise<void> {
    const home = this.resolvedHomePath;
    const projectsDir = path.join(home, 'projects');
    let success = 0;
    let failed = 0;
    let skipped = 0;
    const skipReasons: Record<string, number> = {};

    const trackSkip = (reason: string) => {
      skipped++;
      skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
    };

    if (!(await fse.pathExists(projectsDir))) {
      imported.set('sessions', { success: 0, failed: 0, skipped: 0 });
      return;
    }

    const projectEntries = await fse.readdir(projectsDir, { withFileTypes: true }) as unknown as Array<{ name: string; isDirectory(): boolean }>;
    const projectDirs = projectEntries.filter(e => e.isDirectory());

    // Collect all JSONL files across all project directories
    const allSessionFiles: Array<{ filePath: string; projectDirName: string }> = [];

    for (const dir of projectDirs) {
      const projectDir = path.join(projectsDir, dir.name);
      const entries = await fse.readdir(projectDir, { withFileTypes: true }) as unknown as Array<{ name: string; isFile(): boolean }>;
      const jsonlFiles = entries.filter(e => e.isFile() && e.name.endsWith('.jsonl'));

      for (const f of jsonlFiles) {
        allSessionFiles.push({
          filePath: path.join(projectDir, f.name),
          projectDirName: dir.name,
        });
      }
    }

    const total = allSessionFiles.length;

    for (let i = 0; i < allSessionFiles.length; i++) {
      const { filePath, projectDirName } = allSessionFiles[i];

      onProgress?.({
        category: 'sessions',
        current: i + 1,
        total,
        item: path.basename(filePath),
        status: 'importing',
      });

      try {
        // Pre-validation: check file is readable and non-empty
        const fileContent = await fse.readFile(filePath, 'utf-8') as string;
        if (!fileContent.trim()) {
          trackSkip('empty file');
          continue;
        }

        const records = await this.readJsonlFile(filePath);
        if (records.length === 0) {
          trackSkip('no valid JSON records');
          continue;
        }

        const events = records as unknown as ClaudeEvent[];

        // Filter relevant events
        const relevantEvents = events.filter(e =>
          (e.type === 'user' || e.type === 'assistant') &&
          !e.isMeta &&
          e.message,
        );

        if (relevantEvents.length === 0) {
          trackSkip('no user/assistant messages');
          continue;
        }

        // Group by sessionId
        const sessionGroups = new Map<string, ClaudeEvent[]>();
        for (const event of relevantEvents) {
          const sid = event.sessionId ?? 'unknown';
          if (!sessionGroups.has(sid)) {
            sessionGroups.set(sid, []);
          }
          sessionGroups.get(sid)!.push(event);
        }

        // Write each session group
        for (const [sessionId, sessionEvents] of sessionGroups) {
          const messages: SessionMessage[] = sessionEvents.map(e => ({
            role: e.message!.role as SessionMessage['role'],
            content: this.extractContent(e.message!.content),
            timestamp: e.timestamp ?? new Date().toISOString(),
          }));

          // Extract metadata from first event
          const firstEvent = sessionEvents[0];
          const cwd = firstEvent.cwd ?? this.projectDirNameToPath(projectDirName);
          const model = this.extractModel(sessionEvents) ?? 'unknown';
          const projectName = path.basename(cwd);

          const result = await this.writeAutohandSession({
            projectPath: cwd,
            projectName,
            model,
            messages,
            source: this.name,
            originalId: sessionId,
            createdAt: messages[0].timestamp,
            closedAt: messages[messages.length - 1].timestamp,
            summary: this.buildSummary(messages),
            status: 'completed',
          });

          if (result === null) {
            trackSkip('already imported');
          } else {
            success++;
          }
        }
      } catch (err) {
        failed++;
        errors.push({
          category: 'sessions',
          item: path.basename(filePath),
          error: err instanceof Error ? err.message : String(err),
          retriable: true,
        });
      }
    }

    imported.set('sessions', {
      success,
      failed,
      skipped,
      ...(Object.keys(skipReasons).length > 0 ? { skipReasons } : {}),
    });
  }

  // ---------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------

  protected async importSettings(
    imported: Map<ImportCategory, ImportCategoryResult>,
    errors: ImportError[],
    onProgress?: ProgressCallback,
  ): Promise<void> {
    onProgress?.({
      category: 'settings',
      current: 1,
      total: 1,
      item: 'Claude permission rules',
      status: 'importing',
    });

    try {
      const result = await this.permissionImport().import();
      this.permissionReport = result.report;
      imported.set('settings', result.stats);
      errors.push(...result.errors);

      onProgress?.({
        category: 'settings',
        current: 1,
        total: 1,
        item: 'Claude permission rules',
        status: result.stats.failed ? 'failed' : 'done',
      });
    } catch {
      imported.set('settings', { success: 0, failed: 1, skipped: 0 });
      errors.push({
        category: 'settings',
        item: 'settings.json',
        error: 'Could not import Claude permission settings. No raw settings were copied.',
        retriable: false,
      });
    }
  }

  // ---------------------------------------------------------------
  // Skills
  // ---------------------------------------------------------------

  protected async importSkills(
    imported: Map<ImportCategory, ImportCategoryResult>,
    errors: ImportError[],
    onProgress?: ProgressCallback,
  ): Promise<void> {
    const skillsDir = path.join(this.resolvedHomePath, 'skills');

    if (!(await fse.pathExists(skillsDir))) {
      imported.set('skills', { success: 0, failed: 0, skipped: 1 });
      return;
    }

    const entries = await fse.readdir(skillsDir, { withFileTypes: true }) as unknown as Array<{ name: string; isFile(): boolean }>;
    const skillFiles = entries.filter(e => e.isFile());

    let success = 0;
    let failed = 0;
    const total = skillFiles.length;
    const destDir = path.join(AUTOHAND_PATHS.skills, 'imported-claude');

    for (let i = 0; i < skillFiles.length; i++) {
      const file = skillFiles[i];
      const src = path.join(skillsDir, file.name);
      const dest = path.join(destDir, file.name);

      onProgress?.({
        category: 'skills',
        current: i + 1,
        total,
        item: file.name,
        status: 'importing',
      });

      try {
        await fse.ensureDir(destDir);
        await fse.copy(src, dest);
        success++;
      } catch (err) {
        failed++;
        errors.push({
          category: 'skills',
          item: file.name,
          error: err instanceof Error ? err.message : String(err),
          retriable: true,
        });
      }
    }

    imported.set('skills', { success, failed, skipped: 0 });
  }

  // ---------------------------------------------------------------
  // Memory
  // ---------------------------------------------------------------

  protected async importMemory(
    imported: Map<ImportCategory, ImportCategoryResult>,
    errors: ImportError[],
    onProgress?: ProgressCallback,
  ): Promise<void> {
    const projectsDir = path.join(this.resolvedHomePath, 'projects');
    let success = 0;
    let failed = 0;

    if (!(await fse.pathExists(projectsDir))) {
      imported.set('memory', { success: 0, failed: 0, skipped: 0 });
      return;
    }

    const entries = await fse.readdir(projectsDir, { withFileTypes: true }) as unknown as Array<{ name: string; isDirectory(): boolean }>;
    const projectDirs = entries.filter(e => e.isDirectory());
    const total = projectDirs.length;

    for (let i = 0; i < projectDirs.length; i++) {
      const dir = projectDirs[i];
      const projectDir = path.join(projectsDir, dir.name);

      const hasMemoryDir = await fse.pathExists(path.join(projectDir, 'memory'));
      const hasClaudeMd = await fse.pathExists(path.join(projectDir, 'CLAUDE.md'));

      if (!hasMemoryDir && !hasClaudeMd) {
        continue;
      }

      onProgress?.({
        category: 'memory',
        current: i + 1,
        total,
        item: dir.name,
        status: 'importing',
      });

      try {
        const projectHash = dir.name.replace(/[^a-zA-Z0-9-]/g, '_');
        const destDir = path.join(AUTOHAND_PATHS.projects, projectHash, 'imported-claude');
        await fse.ensureDir(destDir);

        if (hasMemoryDir) {
          await fse.copy(path.join(projectDir, 'memory'), path.join(destDir, 'memory'));
        }
        if (hasClaudeMd) {
          await fse.copy(path.join(projectDir, 'CLAUDE.md'), path.join(destDir, 'CLAUDE.md'));
        }

        success++;
      } catch (err) {
        failed++;
        errors.push({
          category: 'memory',
          item: dir.name,
          error: err instanceof Error ? err.message : String(err),
          retriable: true,
        });
      }
    }

    imported.set('memory', { success, failed, skipped: 0 });
  }

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------

  /**
   * Extract text content from a Claude message content field.
   * Content can be a string or an array of content blocks.
   */
  protected extractContent(
    content: string | Array<{ type: string; text?: string }>,
  ): string {
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .filter(block => block.type === 'text' && block.text)
        .map(block => block.text!)
        .join('');
    }
    return '';
  }

  /**
   * Extract the model name from session events. Takes the first found model.
   */
  protected extractModel(events: ClaudeEvent[]): string | undefined {
    for (const event of events) {
      if (event.message?.model) {
        return event.message.model;
      }
    }
    return undefined;
  }

  /**
   * Convert a project directory name (e.g. "-Users-me-project") to a path.
   */
  protected projectDirNameToPath(dirName: string): string {
    // Claude encodes paths by replacing / with -
    return '/' + dirName.replace(/^-/, '').replace(/-/g, '/');
  }

  /**
   * Build a brief summary from the first real user message.
   * Skips system-injected context (XML tags, CLAUDE.md, etc.)
   */
  protected buildSummary(messages: SessionMessage[]): string {
    for (const msg of messages) {
      if (msg.role !== 'user') continue;
      const cleaned = this.stripSystemContent(msg.content);
      if (cleaned.length > 0) {
        const text = cleaned.slice(0, 100);
        return text.length < cleaned.length ? `${text}...` : text;
      }
    }
    return 'Imported Claude session';
  }

  /**
   * Strip system-injected XML tags and their content from a message,
   * returning only the actual user text.
   */
  private stripSystemContent(text: string): string {
    // Remove common system-injected XML block patterns
    let cleaned = text;
    const systemTags = [
      'local-command-caveat', 'system-reminder', 'user_instructions',
      'environment_context', 'context', 'automatic_reminders',
      'user_request', 'bash-input', 'bash-stdout', 'bash-stderr',
    ];
    for (const tag of systemTags) {
      // Remove <tag>...</tag> blocks (non-greedy, supports multiline)
      const pattern = new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g');
      cleaned = cleaned.replace(pattern, '');
    }
    return cleaned.trim();
  }
}
