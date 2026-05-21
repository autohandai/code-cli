/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import os from 'node:os';
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

type DirentLike = {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
};

interface OpencodeConfigFile {
  path: string;
  file: string;
}

interface OpencodeSessionFile {
  path: string;
  projectId: string;
  sessionId: string;
}

interface StoredMessage {
  id: string;
  role: SessionMessage['role'];
  timestamp: string;
  content?: string;
}

/**
 * Importer for OpenCode data.
 *
 * OpenCode stores user configuration under ~/.config/opencode and runtime
 * session data under ~/.local/share/opencode.
 */
export class OpencodeImporter extends BaseImporter {
  readonly name: ImportSource = 'opencode';
  readonly displayName = 'OpenCode';
  readonly homePath = '~/.config/opencode';

  private get dataHome(): string {
    return path.join(os.homedir(), '.local', 'share', 'opencode');
  }

  async detect(): Promise<boolean> {
    if (await fse.pathExists(this.resolvedHomePath)) return true;
    if (await fse.pathExists(this.dataHome)) return true;

    for (const config of this.globalConfigCandidates()) {
      if (await fse.pathExists(config.path)) return true;
    }

    return false;
  }

  async scan(): Promise<ImportScanResult> {
    const available = new Map<ImportCategory, { count: number; description: string }>();

    if (!(await this.detect())) {
      return { source: this.name, available };
    }

    const settings = await this.existingConfigFiles();
    if (settings.length > 0) {
      available.set('settings', {
        count: settings.length,
        description: 'OpenCode config and TUI settings',
      });
    }

    const mcp = await this.collectMcpServers(settings);
    if (Object.keys(mcp).length > 0) {
      available.set('mcp', {
        count: Object.keys(mcp).length,
        description: `${Object.keys(mcp).length} OpenCode MCP server${Object.keys(mcp).length !== 1 ? 's' : ''}`,
      });
    }

    if (await fse.pathExists(path.join(this.resolvedHomePath, 'AGENTS.md'))) {
      available.set('memory', { count: 1, description: 'OpenCode global AGENTS.md rules' });
    }

    const skills = await this.discoverSkillDirs();
    if (skills.length > 0) {
      available.set('skills', {
        count: skills.length,
        description: `${skills.length} OpenCode skill${skills.length !== 1 ? 's' : ''}`,
      });
    }

    const sessionFiles = await this.discoverJsonSessionFiles();
    const sqlitePath = path.join(this.dataHome, 'opencode.db');
    const hasSqlite = await fse.pathExists(sqlitePath);
    if (sessionFiles.length > 0 || hasSqlite) {
      available.set('sessions', {
        count: sessionFiles.length + (hasSqlite ? 1 : 0),
        description: hasSqlite
          ? 'OpenCode session database and JSON session files'
          : `${sessionFiles.length} OpenCode JSON session${sessionFiles.length !== 1 ? 's' : ''}`,
      });
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
    const files = await this.existingConfigFiles();
    if (files.length === 0) {
      imported.set('settings', { success: 0, failed: 0, skipped: 1 });
      return;
    }

    onProgress?.({
      category: 'settings',
      current: 1,
      total: 1,
      item: 'OpenCode config files',
      status: 'importing',
    });

    try {
      const importedFiles: Array<{ file: string; raw: string; parsed?: Record<string, unknown> }> = [];

      for (const file of files) {
        const raw = await fse.readFile(file.path, 'utf-8') as string;
        const parsed = this.parseJsonc(raw);
        importedFiles.push({
          file: file.file,
          raw,
          ...(parsed ? { parsed } : {}),
        });
      }

      await fse.ensureDir(AUTOHAND_PATHS.config);
      await fse.writeJson(
        path.join(AUTOHAND_PATHS.config, 'imported-opencode-settings.json'),
        {
          importedFrom: 'opencode',
          importedAt: new Date().toISOString(),
          files: importedFiles,
        },
        { spaces: 2 },
      );

      imported.set('settings', { success: 1, failed: 0, skipped: 0 });
      onProgress?.({
        category: 'settings',
        current: 1,
        total: 1,
        item: 'OpenCode config files',
        status: 'done',
      });
    } catch (err) {
      imported.set('settings', { success: 0, failed: 1, skipped: 0 });
      errors.push({
        category: 'settings',
        item: 'OpenCode config files',
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
    const files = await this.existingConfigFiles();

    if (files.length === 0) {
      imported.set('mcp', { success: 0, failed: 0, skipped: 1 });
      return;
    }

    onProgress?.({
      category: 'mcp',
      current: 1,
      total: 1,
      item: 'mcp from opencode config',
      status: 'importing',
    });

    try {
      const mcpServers = await this.collectMcpServers(files);
      if (Object.keys(mcpServers).length === 0) {
        imported.set('mcp', { success: 0, failed: 0, skipped: 1 });
        return;
      }

      await fse.ensureDir(AUTOHAND_PATHS.config);
      await fse.writeJson(
        path.join(AUTOHAND_PATHS.config, 'imported-opencode-mcp.json'),
        {
          importedFrom: 'opencode',
          importedAt: new Date().toISOString(),
          mcpServers,
        },
        { spaces: 2 },
      );

      imported.set('mcp', { success: 1, failed: 0, skipped: 0 });
      onProgress?.({
        category: 'mcp',
        current: 1,
        total: 1,
        item: 'mcp from opencode config',
        status: 'done',
      });
    } catch (err) {
      imported.set('mcp', { success: 0, failed: 1, skipped: 0 });
      errors.push({
        category: 'mcp',
        item: 'mcp from opencode config',
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
      const destDir = path.join(AUTOHAND_PATHS.memory, 'imported-opencode');
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

    const destBase = path.join(AUTOHAND_PATHS.skills, 'imported-opencode');
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

  private async importSessions(
    imported: Map<ImportCategory, ImportCategoryResult>,
    errors: ImportError[],
    onProgress?: ProgressCallback,
  ): Promise<void> {
    const jsonSessions = await this.discoverJsonSessionFiles();
    const sqlitePath = path.join(this.dataHome, 'opencode.db');
    const hasSqlite = await fse.pathExists(sqlitePath);

    if (jsonSessions.length === 0 && !hasSqlite) {
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
    const total = jsonSessions.length + (hasSqlite ? 1 : 0);

    for (let i = 0; i < jsonSessions.length; i++) {
      const sessionFile = jsonSessions[i];
      onProgress?.({
        category: 'sessions',
        current: i + 1,
        total,
        item: sessionFile.sessionId,
        status: 'importing',
      });

      try {
        const session = await this.readJsonSession(sessionFile);
        if (!session || session.messages.length === 0) {
          trackSkip('no user/assistant messages');
          continue;
        }

        const result = await this.writeAutohandSession({
          projectPath: session.projectPath,
          projectName: path.basename(session.projectPath),
          model: session.model,
          messages: session.messages,
          source: this.name,
          originalId: session.originalId,
          createdAt: session.messages[0].timestamp,
          closedAt: session.messages[session.messages.length - 1].timestamp,
          summary: session.summary,
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
          item: sessionFile.sessionId,
          error: err instanceof Error ? err.message : String(err),
          retriable: true,
        });
      }
    }

    if (hasSqlite) {
      onProgress?.({
        category: 'sessions',
        current: jsonSessions.length + 1,
        total,
        item: 'opencode.db',
        status: 'importing',
      });

      try {
        const sqliteResult = await this.importSqliteSessions(sqlitePath);
        success += sqliteResult.success;
        failed += sqliteResult.failed;
        skipped += sqliteResult.skipped;
        for (const [reason, count] of Object.entries(sqliteResult.skipReasons)) {
          skipReasons[reason] = (skipReasons[reason] ?? 0) + count;
        }
        errors.push(...sqliteResult.errors);
      } catch (err) {
        failed++;
        errors.push({
          category: 'sessions',
          item: 'opencode.db',
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

  private async readJsonSession(sessionFile: OpencodeSessionFile): Promise<{
    originalId: string;
    projectPath: string;
    model: string;
    summary: string;
    messages: SessionMessage[];
  } | null> {
    const sessionData = this.asRecord(await fse.readJson(sessionFile.path));
    const originalId = this.readString(sessionData, 'id') ?? sessionFile.sessionId;
    const projectPath =
      this.readString(sessionData, 'directory') ??
      this.readString(this.asRecord(sessionData.path), 'cwd') ??
      this.readString(this.asRecord(sessionData.path), 'root') ??
      process.cwd();
    const model = this.extractModel(sessionData);
    const summary = this.readString(sessionData, 'title') ?? 'Imported OpenCode session';
    const rawMessages = await this.readJsonMessages(originalId);
    const messages = rawMessages
      .map(message => this.convertStoredMessage(message))
      .filter((message): message is SessionMessage => message !== null);

    if (messages.length === 0) return null;

    return {
      originalId,
      projectPath,
      model,
      summary,
      messages,
    };
  }

  private async readJsonMessages(sessionId: string): Promise<StoredMessage[]> {
    const messageDirs = [
      path.join(this.dataHome, 'storage', 'message', sessionId),
      path.join(this.dataHome, 'storage', 'session', 'message', sessionId),
    ];
    const messages: StoredMessage[] = [];

    for (const messageDir of messageDirs) {
      if (!(await fse.pathExists(messageDir))) continue;

      const entries = await this.readDir(messageDir);
      for (const entry of entries.filter(item => item.isFile() && item.name.endsWith('.json'))) {
        const messagePath = path.join(messageDir, entry.name);
        const messageData = this.asRecord(await fse.readJson(messagePath));
        const messageId = this.readString(messageData, 'id') ?? path.basename(entry.name, '.json');
        const role = this.normalizeRole(
          this.readString(messageData, 'role') ??
            this.readString(this.asRecord(messageData.data), 'role') ??
            this.readString(this.asRecord(messageData.info), 'role'),
        );
        if (!role) continue;

        const parts = await this.readJsonParts(sessionId, messageId);
        const content = parts.join('') ||
          this.readString(messageData, 'content') ||
          this.readString(this.asRecord(messageData.data), 'content') ||
          this.readString(messageData, 'text');

        messages.push({
          id: messageId,
          role,
          timestamp: this.toIsoTimestamp(
            this.asRecord(messageData.time).created ??
              messageData.time_created ??
              this.asRecord(messageData.data).time_created,
          ),
          content,
        });
      }
    }

    return messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  private async readJsonParts(sessionId: string, messageId: string): Promise<string[]> {
    const partDirs = [
      path.join(this.dataHome, 'storage', 'part', messageId),
      path.join(this.dataHome, 'storage', 'session', 'part', sessionId, messageId),
    ];
    const parts: string[] = [];

    for (const partDir of partDirs) {
      if (!(await fse.pathExists(partDir))) continue;

      const entries = await this.readDir(partDir);
      for (const entry of entries.filter(item => item.isFile() && item.name.endsWith('.json'))) {
        const partData = this.asRecord(await fse.readJson(path.join(partDir, entry.name)));
        const text = this.extractPartText(partData);
        if (text) parts.push(text);
      }
    }

    return parts;
  }

  private async importSqliteSessions(sqlitePath: string): Promise<{
    success: number;
    failed: number;
    skipped: number;
    skipReasons: Record<string, number>;
    errors: ImportError[];
  }> {
    let DatabaseSync: typeof import('node:sqlite').DatabaseSync;
    try {
      ({ DatabaseSync } = await import('node:sqlite'));
    } catch {
      return {
        success: 0,
        failed: 0,
        skipped: 1,
        skipReasons: { 'node:sqlite unavailable': 1 },
        errors: [],
      };
    }

    const db = new DatabaseSync(sqlitePath, { readOnly: true } as Record<string, unknown>);
    const errors: ImportError[] = [];
    const skipReasons: Record<string, number> = {};
    let success = 0;
    let failed = 0;
    let skipped = 0;
    const trackSkip = (reason: string) => {
      skipped++;
      skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
    };

    try {
      const sessions = db.prepare(
        'SELECT id, directory, title, model, time_created, time_updated FROM session ORDER BY time_created ASC',
      ).all() as Array<Record<string, unknown>>;

      for (const sessionRow of sessions) {
        const originalId = this.readString(sessionRow, 'id');
        if (!originalId) {
          trackSkip('missing session id');
          continue;
        }

        try {
          const messages = this.readSqliteMessages(db, originalId);
          if (messages.length === 0) {
            trackSkip('no user/assistant messages');
            continue;
          }

          const projectPath = this.readString(sessionRow, 'directory') ?? process.cwd();
          const result = await this.writeAutohandSession({
            projectPath,
            projectName: path.basename(projectPath),
            model: this.extractModel(sessionRow),
            messages,
            source: this.name,
            originalId,
            createdAt: messages[0].timestamp,
            closedAt: messages[messages.length - 1].timestamp,
            summary: this.readString(sessionRow, 'title') ?? this.buildSummary(messages),
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
            item: originalId,
            error: err instanceof Error ? err.message : String(err),
            retriable: true,
          });
        }
      }
    } finally {
      db.close();
    }

    return { success, failed, skipped, skipReasons, errors };
  }

  private readSqliteMessages(
    db: import('node:sqlite').DatabaseSync,
    sessionId: string,
  ): SessionMessage[] {
    const messages = db.prepare(
      'SELECT id, data, time_created FROM message WHERE session_id = ? ORDER BY time_created ASC, id ASC',
    ).all(sessionId) as Array<Record<string, unknown>>;
    const converted: SessionMessage[] = [];

    for (const messageRow of messages) {
      const data = this.parseStoredJson(messageRow.data);
      const role = this.normalizeRole(this.readString(data, 'role'));
      if (!role) continue;

      const messageId = this.readString(messageRow, 'id');
      if (!messageId) continue;

      const parts = db.prepare(
        'SELECT data FROM part WHERE message_id = ? ORDER BY time_created ASC, id ASC',
      ).all(messageId) as Array<Record<string, unknown>>;
      const content = parts
        .map(part => this.extractPartText(this.parseStoredJson(part.data)))
        .filter(Boolean)
        .join('') || this.readString(data, 'content') || this.readString(data, 'text') || '';

      if (!content.trim()) continue;

      converted.push({
        role,
        content,
        timestamp: this.toIsoTimestamp(messageRow.time_created),
      });
    }

    return converted;
  }

  private async discoverJsonSessionFiles(): Promise<OpencodeSessionFile[]> {
    const sessionRoot = path.join(this.dataHome, 'storage', 'session');
    if (!(await fse.pathExists(sessionRoot))) return [];

    const projectDirs = await this.readDir(sessionRoot);
    const files: OpencodeSessionFile[] = [];

    for (const projectDir of projectDirs.filter(entry => entry.isDirectory())) {
      if (projectDir.name === 'message' || projectDir.name === 'part' || projectDir.name === 'info') {
        continue;
      }

      const dir = path.join(sessionRoot, projectDir.name);
      const entries = await this.readDir(dir);
      for (const entry of entries.filter(item => item.isFile() && item.name.endsWith('.json'))) {
        files.push({
          path: path.join(dir, entry.name),
          projectId: projectDir.name,
          sessionId: path.basename(entry.name, '.json'),
        });
      }
    }

    return files;
  }

  private async existingConfigFiles(): Promise<OpencodeConfigFile[]> {
    const existing: OpencodeConfigFile[] = [];
    for (const candidate of this.globalConfigCandidates()) {
      if (await fse.pathExists(candidate.path)) {
        existing.push(candidate);
      }
    }
    return existing;
  }

  private globalConfigCandidates(): OpencodeConfigFile[] {
    return [
      { path: path.join(this.resolvedHomePath, 'opencode.json'), file: 'opencode.json' },
      { path: path.join(this.resolvedHomePath, 'opencode.jsonc'), file: 'opencode.jsonc' },
      { path: path.join(this.resolvedHomePath, 'tui.json'), file: 'tui.json' },
      { path: path.join(this.resolvedHomePath, 'tui.jsonc'), file: 'tui.jsonc' },
      { path: path.join(this.dataHome, 'opencode.json'), file: 'legacy-data/opencode.json' },
      { path: path.join(this.dataHome, 'opencode.jsonc'), file: 'legacy-data/opencode.jsonc' },
      { path: path.join(os.homedir(), '.opencode.json'), file: '~/.opencode.json' },
      { path: path.join(os.homedir(), '.opencode.jsonc'), file: '~/.opencode.jsonc' },
    ];
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

  private async collectMcpServers(files: OpencodeConfigFile[]): Promise<Record<string, unknown>> {
    const combined: Record<string, unknown> = {};

    for (const file of files) {
      try {
        const raw = await fse.readFile(file.path, 'utf-8') as string;
        const parsed = this.parseJsonc(raw);
        const mcp = parsed ? this.asRecord(parsed.mcp) : {};
        Object.assign(combined, mcp);
      } catch {
        // Ignore unreadable config during scan; importSettings reports details.
      }
    }

    return combined;
  }

  private parseJsonc(content: string): Record<string, unknown> | undefined {
    try {
      return this.asRecord(JSON.parse(this.removeTrailingCommas(this.stripJsonComments(content))));
    } catch {
      return undefined;
    }
  }

  private stripJsonComments(content: string): string {
    let output = '';
    let inString = false;
    let escaped = false;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      const next = content[i + 1];

      if (inString) {
        output += char;
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        output += char;
        continue;
      }

      if (char === '/' && next === '/') {
        while (i < content.length && content[i] !== '\n') i++;
        output += '\n';
        continue;
      }

      if (char === '/' && next === '*') {
        i += 2;
        while (i < content.length && !(content[i] === '*' && content[i + 1] === '/')) i++;
        i++;
        continue;
      }

      output += char;
    }

    return output;
  }

  private removeTrailingCommas(content: string): string {
    return content.replace(/,\s*([}\]])/g, '$1');
  }

  private async readDir(dir: string): Promise<DirentLike[]> {
    return await fse.readdir(dir, { withFileTypes: true }) as unknown as DirentLike[];
  }

  private convertStoredMessage(message: StoredMessage): SessionMessage | null {
    if (!message.content?.trim()) return null;
    return {
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
    };
  }

  private normalizeRole(role: string | undefined): SessionMessage['role'] | null {
    if (role === 'user' || role === 'assistant' || role === 'tool' || role === 'system') {
      return role;
    }
    return null;
  }

  private extractPartText(part: Record<string, unknown>): string {
    const type = this.readString(part, 'type');
    if (type && !['text', 'reasoning'].includes(type)) return '';

    const text = this.readString(part, 'text') ?? this.readString(this.asRecord(part.data), 'text');
    return text ?? '';
  }

  private extractModel(record: Record<string, unknown>): string {
    const direct = this.readString(record, 'model');
    if (direct) return direct;

    const model = this.parseStoredJson(record.model);
    const providerId = this.readString(model, 'providerID') ?? this.readString(model, 'provider_id');
    const modelId = this.readString(model, 'id') ?? this.readString(model, 'model');

    if (providerId && modelId) return `${providerId}/${modelId}`;
    if (modelId) return modelId;
    return 'opencode';
  }

  private parseStoredJson(value: unknown): Record<string, unknown> {
    if (typeof value === 'string') {
      try {
        return this.asRecord(JSON.parse(value));
      } catch {
        return {};
      }
    }
    return this.asRecord(value);
  }

  private toIsoTimestamp(value: unknown): string {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const milliseconds = value > 10_000_000_000 ? value : value * 1000;
      return new Date(milliseconds).toISOString();
    }
    if (typeof value === 'string' && value.trim()) {
      const time = Date.parse(value);
      return Number.isNaN(time) ? new Date().toISOString() : new Date(time).toISOString();
    }
    return new Date().toISOString();
  }

  private buildSummary(messages: SessionMessage[]): string {
    const firstUser = messages.find(message => message.role === 'user');
    if (!firstUser) return 'Imported OpenCode session';
    const text = firstUser.content.trim().slice(0, 100);
    return text.length < firstUser.content.trim().length ? `${text}...` : text;
  }

  private readString(record: unknown, key: string): string | undefined {
    const obj = this.asRecord(record);
    const value = obj[key];
    return typeof value === 'string' ? value : undefined;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }
}
