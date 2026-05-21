/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import fse from 'fs-extra';
import type {
  ImportSource,
  ImportCategory,
  ImportScanResult,
  ImportResult,
  ImportError,
  ImportCategoryResult,
  ProgressCallback,
} from '../types.js';
import type { SessionMessage } from '../../session/types.js';
import { AUTOHAND_PATHS } from '../../constants.js';
import { BaseImporter } from './BaseImporter.js';

type ParsedTomlValue = string | number | boolean;
type DirentLike = {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
};

/**
 * Importer for Kimi Code CLI data (~/.kimi).
 *
 * Handles sessions (context.jsonl), settings (config.toml / kimi.json),
 * MCP servers (mcp.json), global memory (AGENTS.md), skills, and hooks.
 */
export class KimiImporter extends BaseImporter {
  readonly name: ImportSource = 'kimi';
  readonly displayName = 'Kimi CLI';
  readonly homePath = '~/.kimi';

  async scan(): Promise<ImportScanResult> {
    const available = new Map<ImportCategory, { count: number; description: string }>();
    const home = this.resolvedHomePath;

    if (!(await fse.pathExists(home))) {
      return { source: this.name, available };
    }

    const configPath = path.join(home, 'config.toml');
    const metadataPath = path.join(home, 'kimi.json');
    const settingsCount = await this.countExisting([configPath, metadataPath]);
    if (settingsCount > 0) {
      available.set('settings', {
        count: settingsCount,
        description: 'Kimi config.toml and runtime metadata',
      });
    }

    if (await fse.pathExists(path.join(home, 'mcp.json'))) {
      available.set('mcp', { count: 1, description: 'Kimi MCP server configuration' });
    }

    if (await fse.pathExists(path.join(home, 'AGENTS.md'))) {
      available.set('memory', { count: 1, description: 'Kimi global AGENTS.md instructions' });
    }

    const skills = await this.discoverSkillDirs();
    if (skills.length > 0) {
      available.set('skills', {
        count: skills.length,
        description: `${skills.length} Kimi skill${skills.length !== 1 ? 's' : ''}`,
      });
    }

    const sessions = await this.discoverSessionDirs();
    if (sessions.length > 0) {
      available.set('sessions', {
        count: sessions.length,
        description: `${sessions.length} Kimi session${sessions.length !== 1 ? 's' : ''}`,
      });
    }

    if (await fse.pathExists(configPath)) {
      try {
        const config = await fse.readFile(configPath, 'utf-8') as string;
        const hooks = this.extractTomlArraySections(config, 'hooks');
        if (hooks.length > 0) {
          available.set('hooks', {
            count: hooks.length,
            description: `${hooks.length} Kimi hook${hooks.length !== 1 ? 's' : ''}`,
          });
        }
      } catch {
        // Ignore unreadable config during scan; import will report the error.
      }
    }

    return { source: this.name, available };
  }

  async import(
    categories: ImportCategory[],
    onProgress?: ProgressCallback,
  ): Promise<ImportResult> {
    const start = Date.now();
    const imported = new Map<ImportCategory, ImportCategoryResult>();
    const errors: ImportError[] = [];

    for (const category of categories) {
      switch (category) {
        case 'sessions':
          await this.importSessions(imported, errors, onProgress);
          break;
        case 'settings':
          await this.importSettings(imported, errors, onProgress);
          break;
        case 'mcp':
          await this.importMcp(imported, errors, onProgress);
          break;
        case 'memory':
          await this.importMemory(imported, errors, onProgress);
          break;
        case 'skills':
          await this.importSkills(imported, errors, onProgress);
          break;
        case 'hooks':
          await this.importHooks(imported, errors, onProgress);
          break;
        default:
          break;
      }
    }

    return {
      source: this.name,
      imported,
      errors,
      duration: Date.now() - start,
    };
  }

  private async importSettings(
    imported: Map<ImportCategory, ImportCategoryResult>,
    errors: ImportError[],
    onProgress?: ProgressCallback,
  ): Promise<void> {
    const configPath = path.join(this.resolvedHomePath, 'config.toml');
    const metadataPath = path.join(this.resolvedHomePath, 'kimi.json');
    const hasConfig = await fse.pathExists(configPath);
    const hasMetadata = await fse.pathExists(metadataPath);

    if (!hasConfig && !hasMetadata) {
      imported.set('settings', { success: 0, failed: 0, skipped: 1 });
      return;
    }

    onProgress?.({
      category: 'settings',
      current: 1,
      total: 1,
      item: 'config.toml / kimi.json',
      status: 'importing',
    });

    try {
      const output: Record<string, unknown> = {
        importedFrom: 'kimi',
        importedAt: new Date().toISOString(),
      };

      if (hasConfig) {
        const raw = await fse.readFile(configPath, 'utf-8') as string;
        output.configToml = raw;
        output.parsed = this.parseToml(raw);
      }

      if (hasMetadata) {
        output.metadata = await this.safeReadJson(metadataPath);
      }

      await fse.ensureDir(AUTOHAND_PATHS.config);
      await fse.writeJson(path.join(AUTOHAND_PATHS.config, 'imported-kimi-settings.json'), output, {
        spaces: 2,
      });

      imported.set('settings', { success: 1, failed: 0, skipped: 0 });
      onProgress?.({
        category: 'settings',
        current: 1,
        total: 1,
        item: 'config.toml / kimi.json',
        status: 'done',
      });
    } catch (err) {
      imported.set('settings', { success: 0, failed: 1, skipped: 0 });
      errors.push({
        category: 'settings',
        item: 'config.toml / kimi.json',
        error: err instanceof Error ? err.message : String(err),
        retriable: false,
      });
    }
  }

  private async importMcp(
    imported: Map<ImportCategory, ImportCategoryResult>,
    errors: ImportError[],
    onProgress?: ProgressCallback,
  ): Promise<void> {
    const mcpPath = path.join(this.resolvedHomePath, 'mcp.json');

    if (!(await fse.pathExists(mcpPath))) {
      imported.set('mcp', { success: 0, failed: 0, skipped: 1 });
      return;
    }

    onProgress?.({
      category: 'mcp',
      current: 1,
      total: 1,
      item: 'mcp.json',
      status: 'importing',
    });

    try {
      const mcpData = await this.safeReadJson(mcpPath);
      await fse.ensureDir(AUTOHAND_PATHS.config);
      await fse.writeJson(
        path.join(AUTOHAND_PATHS.config, 'imported-kimi-mcp.json'),
        {
          importedFrom: 'kimi',
          importedAt: new Date().toISOString(),
          mcpServers: this.extractMcpServers(mcpData) ?? mcpData,
        },
        { spaces: 2 },
      );

      imported.set('mcp', { success: 1, failed: 0, skipped: 0 });
      onProgress?.({
        category: 'mcp',
        current: 1,
        total: 1,
        item: 'mcp.json',
        status: 'done',
      });
    } catch (err) {
      imported.set('mcp', { success: 0, failed: 1, skipped: 0 });
      errors.push({
        category: 'mcp',
        item: 'mcp.json',
        error: err instanceof Error ? err.message : String(err),
        retriable: false,
      });
    }
  }

  private async importMemory(
    imported: Map<ImportCategory, ImportCategoryResult>,
    errors: ImportError[],
    onProgress?: ProgressCallback,
  ): Promise<void> {
    const agentsPath = path.join(this.resolvedHomePath, 'AGENTS.md');

    if (!(await fse.pathExists(agentsPath))) {
      imported.set('memory', { success: 0, failed: 0, skipped: 1 });
      return;
    }

    onProgress?.({
      category: 'memory',
      current: 1,
      total: 1,
      item: 'AGENTS.md',
      status: 'importing',
    });

    try {
      const destDir = path.join(AUTOHAND_PATHS.memory, 'imported-kimi');
      await fse.ensureDir(destDir);
      await fse.copy(agentsPath, path.join(destDir, 'AGENTS.md'));
      imported.set('memory', { success: 1, failed: 0, skipped: 0 });
      onProgress?.({
        category: 'memory',
        current: 1,
        total: 1,
        item: 'AGENTS.md',
        status: 'done',
      });
    } catch (err) {
      imported.set('memory', { success: 0, failed: 1, skipped: 0 });
      errors.push({
        category: 'memory',
        item: 'AGENTS.md',
        error: err instanceof Error ? err.message : String(err),
        retriable: true,
      });
    }
  }

  private async importSkills(
    imported: Map<ImportCategory, ImportCategoryResult>,
    errors: ImportError[],
    onProgress?: ProgressCallback,
  ): Promise<void> {
    const skills = await this.discoverSkillDirs();

    if (skills.length === 0) {
      imported.set('skills', { success: 0, failed: 0, skipped: 1 });
      return;
    }

    const destBase = path.join(AUTOHAND_PATHS.skills, 'imported-kimi');
    let success = 0;
    let failed = 0;

    for (let i = 0; i < skills.length; i++) {
      const skill = skills[i];
      onProgress?.({
        category: 'skills',
        current: i + 1,
        total: skills.length,
        item: skill.name,
        status: 'importing',
      });

      try {
        await fse.ensureDir(destBase);
        await fse.copy(skill.path, path.join(destBase, skill.name));
        success++;
      } catch (err) {
        failed++;
        errors.push({
          category: 'skills',
          item: skill.name,
          error: err instanceof Error ? err.message : String(err),
          retriable: true,
        });
      }
    }

    imported.set('skills', { success, failed, skipped: 0 });
  }

  private async importHooks(
    imported: Map<ImportCategory, ImportCategoryResult>,
    errors: ImportError[],
    onProgress?: ProgressCallback,
  ): Promise<void> {
    const configPath = path.join(this.resolvedHomePath, 'config.toml');

    if (!(await fse.pathExists(configPath))) {
      imported.set('hooks', { success: 0, failed: 0, skipped: 1 });
      return;
    }

    onProgress?.({
      category: 'hooks',
      current: 1,
      total: 1,
      item: 'hooks from config.toml',
      status: 'importing',
    });

    try {
      const config = await fse.readFile(configPath, 'utf-8') as string;
      const hooks = this.extractTomlArraySections(config, 'hooks');

      if (hooks.length === 0) {
        imported.set('hooks', { success: 0, failed: 0, skipped: 1 });
        return;
      }

      await fse.ensureDir(AUTOHAND_PATHS.config);
      await fse.writeJson(
        path.join(AUTOHAND_PATHS.config, 'imported-kimi-hooks.json'),
        {
          importedFrom: 'kimi',
          importedAt: new Date().toISOString(),
          hooksToml: hooks.join('\n\n'),
        },
        { spaces: 2 },
      );

      imported.set('hooks', { success: 1, failed: 0, skipped: 0 });
      onProgress?.({
        category: 'hooks',
        current: 1,
        total: 1,
        item: 'hooks from config.toml',
        status: 'done',
      });
    } catch (err) {
      imported.set('hooks', { success: 0, failed: 1, skipped: 0 });
      errors.push({
        category: 'hooks',
        item: 'hooks from config.toml',
        error: err instanceof Error ? err.message : String(err),
        retriable: false,
      });
    }
  }

  private async importSessions(
    imported: Map<ImportCategory, ImportCategoryResult>,
    errors: ImportError[],
    onProgress?: ProgressCallback,
  ): Promise<void> {
    const sessions = await this.discoverSessionDirs();

    if (sessions.length === 0) {
      imported.set('sessions', { success: 0, failed: 0, skipped: 1 });
      return;
    }

    let success = 0;
    let failed = 0;
    let skipped = 0;
    const skipReasons: Record<string, number> = {};
    const trackSkip = (reason: string) => {
      skipped++;
      skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
    };

    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i];
      onProgress?.({
        category: 'sessions',
        current: i + 1,
        total: sessions.length,
        item: session.sessionId,
        status: 'importing',
      });

      try {
        const importedSession = await this.readKimiSession(session);
        if (!importedSession || importedSession.messages.length === 0) {
          trackSkip('no user/assistant messages');
          continue;
        }

        const result = await this.writeAutohandSession({
          projectPath: importedSession.projectPath,
          projectName: path.basename(importedSession.projectPath),
          model: importedSession.model,
          messages: importedSession.messages,
          source: this.name,
          originalId: session.sessionId,
          createdAt: importedSession.messages[0].timestamp,
          closedAt: importedSession.messages[importedSession.messages.length - 1].timestamp,
          summary: importedSession.summary,
          status: 'completed',
        });

        if (result === null) {
          trackSkip('already imported');
        } else {
          success++;
        }
      } catch (err) {
        failed++;
        errors.push({
          category: 'sessions',
          item: session.sessionId,
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

  private async readKimiSession(session: {
    dir: string;
    workDirHash: string;
    sessionId: string;
  }): Promise<{
    projectPath: string;
    model: string;
    summary: string;
    messages: SessionMessage[];
  } | null> {
    const contextPath = path.join(session.dir, 'context.jsonl');
    const records = await this.readJsonlFile(contextPath);
    const state = await this.readOptionalJson(path.join(session.dir, 'state.json'));
    const config = await this.readOptionalConfig();
    const messages: SessionMessage[] = [];

    for (const record of records) {
      const role = this.normalizeRole(this.readString(record, 'role'));
      if (!role) continue;

      const content = this.extractMessageContent(record.content ?? record.message);
      if (!content.trim()) continue;

      messages.push({
        role,
        content,
        timestamp: this.toIsoTimestamp(record.timestamp ?? record.time ?? record.created_at),
      });
    }

    if (messages.length === 0) return null;

    const projectPath =
      this.readString(state, 'cwd') ??
      this.readString(state, 'work_dir') ??
      this.readString(state, 'workDir') ??
      this.readString(state, 'directory') ??
      this.readString(state, 'projectPath') ??
      process.cwd();
    const title = this.readString(state, 'title');
    const model = this.readString(state, 'model') ?? this.readString(config, 'default_model') ?? 'kimi';

    return {
      projectPath,
      model,
      summary: title?.trim() || this.buildSummary(messages),
      messages,
    };
  }

  private async discoverSessionDirs(): Promise<Array<{
    dir: string;
    workDirHash: string;
    sessionId: string;
  }>> {
    const sessionsDir = path.join(this.resolvedHomePath, 'sessions');
    if (!(await fse.pathExists(sessionsDir))) return [];

    const workDirs = await this.readDir(sessionsDir);
    const sessions: Array<{ dir: string; workDirHash: string; sessionId: string }> = [];

    for (const workDir of workDirs.filter(entry => entry.isDirectory())) {
      const workDirPath = path.join(sessionsDir, workDir.name);
      const sessionDirs = await this.readDir(workDirPath);

      for (const sessionDir of sessionDirs.filter(entry => entry.isDirectory())) {
        const dir = path.join(workDirPath, sessionDir.name);
        if (await fse.pathExists(path.join(dir, 'context.jsonl'))) {
          sessions.push({ dir, workDirHash: workDir.name, sessionId: sessionDir.name });
        }
      }
    }

    return sessions;
  }

  private async discoverSkillDirs(): Promise<Array<{ name: string; path: string }>> {
    const skillsDir = path.join(this.resolvedHomePath, 'skills');
    if (!(await fse.pathExists(skillsDir))) return [];

    const entries = await this.readDir(skillsDir);
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => ({
        name: entry.name,
        path: path.join(skillsDir, entry.name),
      }));
  }

  private async readDir(dir: string): Promise<DirentLike[]> {
    return await fse.readdir(dir, { withFileTypes: true }) as unknown as DirentLike[];
  }

  private async countExisting(paths: string[]): Promise<number> {
    let count = 0;
    for (const candidate of paths) {
      if (await fse.pathExists(candidate)) count++;
    }
    return count;
  }

  private async readOptionalJson(filePath: string): Promise<Record<string, unknown>> {
    if (!(await fse.pathExists(filePath))) return {};
    try {
      const json = await fse.readJson(filePath);
      return this.asRecord(json);
    } catch {
      return {};
    }
  }

  private async readOptionalConfig(): Promise<Record<string, ParsedTomlValue>> {
    const configPath = path.join(this.resolvedHomePath, 'config.toml');
    if (!(await fse.pathExists(configPath))) return {};
    try {
      const raw = await fse.readFile(configPath, 'utf-8') as string;
      return this.parseToml(raw);
    } catch {
      return {};
    }
  }

  private parseToml(content: string): Record<string, ParsedTomlValue> {
    const result: Record<string, ParsedTomlValue> = {};
    let currentSection = '';

    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith('[[')) continue;

      const sectionMatch = line.match(/^\[([^\]]+)\]$/);
      if (sectionMatch) {
        currentSection = sectionMatch[1];
        continue;
      }

      const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*=\s*(.+)$/);
      if (!kvMatch) continue;

      const key = currentSection ? `${currentSection}.${kvMatch[1]}` : kvMatch[1];
      let value = kvMatch[2].trim();
      const inlineComment = value.indexOf(' #');
      if (inlineComment > 0) {
        value = value.slice(0, inlineComment).trim();
      }

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        result[key] = value.slice(1, -1);
      } else if (value === 'true') {
        result[key] = true;
      } else if (value === 'false') {
        result[key] = false;
      } else if (/^-?\d+(\.\d+)?$/.test(value)) {
        result[key] = Number(value);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  private extractTomlArraySections(content: string, sectionName: string): string[] {
    const header = `[[${sectionName}]]`;
    const blocks: string[] = [];
    let current: string[] | null = null;

    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (line === header) {
        if (current && current.length > 0) blocks.push(current.join('\n').trim());
        current = [rawLine];
        continue;
      }

      if (current) {
        if (line.startsWith('[[') && line !== header) {
          blocks.push(current.join('\n').trim());
          current = null;
        } else {
          current.push(rawLine);
        }
      }
    }

    if (current && current.length > 0) blocks.push(current.join('\n').trim());
    return blocks.filter(block => block.length > 0);
  }

  private extractMcpServers(data: Record<string, unknown>): Record<string, unknown> | undefined {
    const direct = data.mcpServers;
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct as Record<string, unknown>;
    }
    return undefined;
  }

  private normalizeRole(role: string | undefined): SessionMessage['role'] | null {
    if (!role || role.startsWith('_')) return null;
    if (role === 'model') return 'assistant';
    if (role === 'user' || role === 'assistant' || role === 'tool' || role === 'system') {
      return role;
    }
    return null;
  }

  private extractMessageContent(content: unknown): string {
    if (typeof content === 'string') return content;

    if (Array.isArray(content)) {
      return content
        .map(item => this.extractMessageContent(item))
        .filter(Boolean)
        .join('');
    }

    const record = this.asRecord(content);
    if (record) {
      const text = this.readString(record, 'text') ?? this.readString(record, 'content');
      if (text) return text;
    }

    return '';
  }

  private toIsoTimestamp(value: unknown): string {
    if (typeof value === 'string' && value.trim()) {
      const time = Date.parse(value);
      return Number.isNaN(time) ? new Date().toISOString() : new Date(time).toISOString();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      const milliseconds = value > 10_000_000_000 ? value : value * 1000;
      return new Date(milliseconds).toISOString();
    }
    return new Date().toISOString();
  }

  private buildSummary(messages: SessionMessage[]): string {
    const firstUser = messages.find(message => message.role === 'user');
    if (!firstUser) return 'Imported Kimi session';
    const text = firstUser.content.trim().slice(0, 100);
    return text.length < firstUser.content.trim().length ? `${text}...` : text;
  }

  private readString(record: unknown, key: string): string | undefined {
    const obj = this.asRecord(record);
    const value = obj?.[key];
    return typeof value === 'string' ? value : undefined;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }
}
