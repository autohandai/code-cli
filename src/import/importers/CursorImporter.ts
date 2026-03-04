/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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

/**
 * Importer for Cursor editor data (~/.cursor).
 *
 * Handles:
 * - Sessions from chats/ SQLite databases (store.db)
 * - Settings from cli-config.json (preferred) or hooks.json (fallback)
 * - Hooks from hooks.json
 * - MCP server configurations from mcp.json
 * - Skills from skills-cursor/ subdirectories (SKILL.md files)
 */
export class CursorImporter extends BaseImporter {
  readonly name: ImportSource = 'cursor';
  readonly displayName = 'Cursor';
  readonly homePath = '~/.cursor';

  // ---------------------------------------------------------------
  // scan()
  // ---------------------------------------------------------------

  async scan(): Promise<ImportScanResult> {
    const available = new Map<ImportCategory, { count: number; description: string }>();
    const home = this.resolvedHomePath;

    if (!(await fse.pathExists(home))) {
      return { source: this.name, available };
    }

    // Settings: check cli-config.json (preferred) and hooks.json
    const cliConfigPath = path.join(home, 'cli-config.json');
    const hooksPath = path.join(home, 'hooks.json');
    const hasCli = await fse.pathExists(cliConfigPath);
    const hasHooks = await fse.pathExists(hooksPath);

    if (hasCli || hasHooks) {
      const count = (hasCli ? 1 : 0) + (hasHooks ? 1 : 0);
      const desc = hasCli
        ? 'Cursor CLI config & preferences'
        : 'Cursor hooks.json preferences';
      available.set('settings', { count, description: desc });
    }

    // Hooks
    if (hasHooks) {
      available.set('hooks', { count: 1, description: 'Cursor hook configurations' });
    }

    // MCP
    const mcpPath = path.join(home, 'mcp.json');
    if (await fse.pathExists(mcpPath)) {
      available.set('mcp', { count: 1, description: 'Cursor MCP server configurations' });
    }

    // Skills from skills-cursor/
    const skillsDir = path.join(home, 'skills-cursor');
    if (await fse.pathExists(skillsDir)) {
      const entries = await fse.readdir(skillsDir, { withFileTypes: true }) as unknown as Array<{ name: string; isDirectory(): boolean }>;
      const skillDirs = entries.filter(e => e.isDirectory());
      if (skillDirs.length > 0) {
        available.set('skills', {
          count: skillDirs.length,
          description: `${skillDirs.length} Cursor skill${skillDirs.length !== 1 ? 's' : ''}`,
        });
      }
    }

    // Sessions from chats/ SQLite databases
    const sessionDbs = await this.discoverSessionDbs();
    if (sessionDbs.length > 0) {
      available.set('sessions', {
        count: sessionDbs.length,
        description: `${sessionDbs.length} Cursor chat session${sessionDbs.length !== 1 ? 's' : ''}`,
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

    for (const category of categories) {
      switch (category) {
        case 'sessions':
          await this.importSessions(imported, errors, onProgress);
          break;
        case 'settings':
          await this.importSettings(imported, errors, onProgress);
          break;
        case 'hooks':
          await this.importHooks(imported, errors, onProgress);
          break;
        case 'mcp':
          await this.importMcp(imported, errors, onProgress);
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

  // ---------------------------------------------------------------
  // Settings – prefers cli-config.json, falls back to hooks.json
  // ---------------------------------------------------------------

  protected async importSettings(
    imported: Map<ImportCategory, ImportCategoryResult>,
    errors: ImportError[],
    onProgress?: ProgressCallback,
  ): Promise<void> {
    const cliConfigPath = path.join(this.resolvedHomePath, 'cli-config.json');
    const hooksPath = path.join(this.resolvedHomePath, 'hooks.json');

    const hasCli = await fse.pathExists(cliConfigPath);
    const hasHooks = await fse.pathExists(hooksPath);

    if (!hasCli && !hasHooks) {
      imported.set('settings', { success: 0, failed: 0, skipped: 1 });
      return;
    }

    // Prefer cli-config.json over hooks.json
    const sourcePath = hasCli ? cliConfigPath : hooksPath;
    const sourceFile = hasCli ? 'cli-config.json' : 'hooks.json';

    onProgress?.({
      category: 'settings',
      current: 1,
      total: 1,
      item: sourceFile,
      status: 'importing',
    });

    try {
      const data = await this.safeReadJson(sourcePath);
      const configDir = AUTOHAND_PATHS.config;
      await fse.ensureDir(configDir);

      await fse.writeJson(
        path.join(configDir, 'imported-cursor-settings.json'),
        {
          importedFrom: 'cursor',
          importedAt: new Date().toISOString(),
          sourceFile,
          raw: data,
        },
        { spaces: 2 },
      );

      imported.set('settings', { success: 1, failed: 0, skipped: 0 });

      onProgress?.({
        category: 'settings',
        current: 1,
        total: 1,
        item: sourceFile,
        status: 'done',
      });
    } catch (err) {
      imported.set('settings', { success: 0, failed: 1, skipped: 0 });
      errors.push({
        category: 'settings',
        item: sourceFile,
        error: err instanceof Error ? err.message : String(err),
        retriable: false,
      });
    }
  }

  // ---------------------------------------------------------------
  // Hooks
  // ---------------------------------------------------------------

  protected async importHooks(
    imported: Map<ImportCategory, ImportCategoryResult>,
    errors: ImportError[],
    onProgress?: ProgressCallback,
  ): Promise<void> {
    const hooksPath = path.join(this.resolvedHomePath, 'hooks.json');

    if (!(await fse.pathExists(hooksPath))) {
      imported.set('hooks', { success: 0, failed: 0, skipped: 1 });
      return;
    }

    onProgress?.({
      category: 'hooks',
      current: 1,
      total: 1,
      item: 'hooks.json',
      status: 'importing',
    });

    try {
      const hooksData = await this.safeReadJson(hooksPath);
      const configDir = AUTOHAND_PATHS.config;
      await fse.ensureDir(configDir);

      await fse.writeJson(
        path.join(configDir, 'imported-cursor-hooks.json'),
        {
          importedFrom: 'cursor',
          importedAt: new Date().toISOString(),
          hooks: hooksData.hooks ?? hooksData,
        },
        { spaces: 2 },
      );

      imported.set('hooks', { success: 1, failed: 0, skipped: 0 });

      onProgress?.({
        category: 'hooks',
        current: 1,
        total: 1,
        item: 'hooks.json',
        status: 'done',
      });
    } catch (err) {
      imported.set('hooks', { success: 0, failed: 1, skipped: 0 });
      errors.push({
        category: 'hooks',
        item: 'hooks.json',
        error: err instanceof Error ? err.message : String(err),
        retriable: false,
      });
    }
  }

  // ---------------------------------------------------------------
  // MCP
  // ---------------------------------------------------------------

  protected async importMcp(
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
      const configDir = AUTOHAND_PATHS.config;
      await fse.ensureDir(configDir);

      await fse.writeJson(
        path.join(configDir, 'imported-cursor-mcp.json'),
        {
          importedFrom: 'cursor',
          importedAt: new Date().toISOString(),
          mcpServers: mcpData.mcpServers ?? mcpData,
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

  // ---------------------------------------------------------------
  // Skills – from ~/.cursor/skills-cursor/ subdirectories
  // ---------------------------------------------------------------

  protected async importSkills(
    imported: Map<ImportCategory, ImportCategoryResult>,
    errors: ImportError[],
    onProgress?: ProgressCallback,
  ): Promise<void> {
    const skillsDir = path.join(this.resolvedHomePath, 'skills-cursor');

    if (!(await fse.pathExists(skillsDir))) {
      imported.set('skills', { success: 0, failed: 0, skipped: 1 });
      return;
    }

    const entries = await fse.readdir(skillsDir, { withFileTypes: true }) as unknown as Array<{ name: string; isDirectory(): boolean }>;
    const skillDirs = entries.filter(e => e.isDirectory());

    let success = 0;
    let failed = 0;
    const total = skillDirs.length;
    const destBase = path.join(AUTOHAND_PATHS.skills, 'imported-cursor');

    for (let i = 0; i < skillDirs.length; i++) {
      const dir = skillDirs[i];
      const src = path.join(skillsDir, dir.name);
      const dest = path.join(destBase, dir.name);

      onProgress?.({
        category: 'skills',
        current: i + 1,
        total,
        item: dir.name,
        status: 'importing',
      });

      try {
        await fse.ensureDir(destBase);
        await fse.copy(src, dest);
        success++;
      } catch (err) {
        failed++;
        errors.push({
          category: 'skills',
          item: dir.name,
          error: err instanceof Error ? err.message : String(err),
          retriable: true,
        });
      }
    }

    imported.set('skills', { success, failed, skipped: 0 });
  }

  // ---------------------------------------------------------------
  // Sessions – from ~/.cursor/chats/*/*/store.db (SQLite)
  // ---------------------------------------------------------------

  /**
   * Discovers all session database paths under ~/.cursor/chats/.
   * Structure: chats/<hash>/<uuid>/store.db
   */
  private async discoverSessionDbs(): Promise<string[]> {
    const chatsDir = path.join(this.resolvedHomePath, 'chats');

    if (!(await fse.pathExists(chatsDir))) {
      return [];
    }

    const hashEntries = await fse.readdir(chatsDir, { withFileTypes: true }) as unknown as Array<{ name: string; isDirectory(): boolean }>;
    const hashDirs = hashEntries.filter(e => e.isDirectory());

    const dbPaths: string[] = [];

    for (const hashDir of hashDirs) {
      const hashPath = path.join(chatsDir, hashDir.name);
      const uuidEntries = await fse.readdir(hashPath, { withFileTypes: true }) as unknown as Array<{ name: string; isDirectory(): boolean }>;
      const uuidDirs = uuidEntries.filter(e => e.isDirectory());

      for (const uuidDir of uuidDirs) {
        dbPaths.push(path.join(hashPath, uuidDir.name, 'store.db'));
      }
    }

    return dbPaths;
  }

  protected async importSessions(
    imported: Map<ImportCategory, ImportCategoryResult>,
    errors: ImportError[],
    onProgress?: ProgressCallback,
  ): Promise<void> {
    const dbPaths = await this.discoverSessionDbs();

    if (dbPaths.length === 0) {
      imported.set('sessions', { success: 0, failed: 0, skipped: 1 });
      return;
    }

    let success = 0;
    let failed = 0;
    let skipped = 0;
    const total = dbPaths.length;

    for (let i = 0; i < dbPaths.length; i++) {
      const dbPath = dbPaths[i];
      const sessionUuid = path.basename(path.dirname(dbPath));

      onProgress?.({
        category: 'sessions',
        current: i + 1,
        total,
        item: sessionUuid,
        status: 'importing',
      });

      try {
        const sessionData = this.readCursorSession(dbPath);

        if (!sessionData || sessionData.messages.length === 0) {
          skipped++;
          continue;
        }

        const result = await this.writeAutohandSession({
          projectPath: sessionData.projectPath,
          projectName: path.basename(sessionData.projectPath),
          model: sessionData.model,
          messages: sessionData.messages,
          source: this.name,
          originalId: sessionData.agentId,
          createdAt: sessionData.createdAt,
          summary: sessionData.name,
          status: 'completed',
        });

        if (result === null) {
          skipped++;
        } else {
          success++;
        }
      } catch (err) {
        failed++;
        errors.push({
          category: 'sessions',
          item: sessionUuid,
          error: err instanceof Error ? err.message : String(err),
          retriable: true,
        });
      }
    }

    imported.set('sessions', { success, failed, skipped });
  }

  /**
   * Reads a single Cursor session from its SQLite store.db.
   * Returns extracted metadata and converted messages, or null if unreadable.
   */
  private readCursorSession(dbPath: string): {
    agentId: string;
    name: string;
    model: string;
    createdAt: string;
    projectPath: string;
    messages: SessionMessage[];
  } | null {
    const db = new DatabaseSync(dbPath, { readOnly: true } as Record<string, unknown>);

    try {
      // Read meta (hex-encoded JSON at key '0')
      const metaRow = db.prepare('SELECT value FROM meta WHERE key = ?').get('0') as { value: string } | undefined;
      if (!metaRow) return null;

      const metaJson = Buffer.from(metaRow.value, 'hex').toString('utf-8');
      const meta = JSON.parse(metaJson) as {
        agentId: string;
        name: string;
        createdAt: number;
        lastUsedModel: string;
      };

      // Read all non-empty blobs
      const blobRows = db.prepare('SELECT data FROM blobs WHERE length(data) > 50').all() as Array<{ data: Buffer }>;

      // Extract JSON messages and project path from blobs
      const rawMessages: Array<{ role: string; content: unknown; providerOptions?: unknown }> = [];
      let projectPath = process.cwd();
      const seenContent = new Set<string>();

      for (const row of blobRows) {
        const buf = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data as unknown as ArrayBuffer);

        // Scan for file:// URIs to extract project path
        const bufStr = buf.toString('utf-8', 0, Math.min(buf.length, 100000));
        const fileMatch = bufStr.match(/file:\/\/\/([\w/.\-]+)/);
        if (fileMatch) {
          projectPath = '/' + fileMatch[1];
        }

        // Scan for JSON objects with role field
        this.extractJsonMessages(buf, rawMessages, seenContent);
      }

      // Convert to Autohand SessionMessage format, filtering system messages
      const createdAt = new Date(meta.createdAt).toISOString();
      const messages: SessionMessage[] = [];

      for (const raw of rawMessages) {
        if (raw.role === 'system') continue;
        if (raw.role !== 'user' && raw.role !== 'assistant') continue;

        const converted = this.convertCursorMessage(raw, createdAt);
        if (converted) {
          messages.push(converted);
        }
      }

      return {
        agentId: meta.agentId,
        name: meta.name,
        model: meta.lastUsedModel,
        createdAt,
        projectPath,
        messages,
      };
    } finally {
      db.close();
    }
  }

  /**
   * Scans a binary buffer for JSON objects with a `role` field.
   * Deduplicates by stringified content.
   */
  private extractJsonMessages(
    buf: Buffer,
    out: Array<{ role: string; content: unknown; providerOptions?: unknown }>,
    seen: Set<string>,
  ): void {
    for (let i = 0; i < buf.length - 1; i++) {
      // Look for '{"' byte pattern (start of JSON object)
      if (buf[i] !== 0x7B || buf[i + 1] !== 0x22) continue;

      let depth = 0;
      for (let j = i; j < buf.length; j++) {
        if (buf[j] === 0x7B) depth++;
        else if (buf[j] === 0x7D) {
          depth--;
          if (depth === 0) {
            try {
              const str = buf.subarray(i, j + 1).toString('utf-8');
              const obj = JSON.parse(str);
              if (
                obj &&
                typeof obj === 'object' &&
                typeof obj.role === 'string' &&
                (obj.role === 'user' || obj.role === 'assistant' || obj.role === 'system')
              ) {
                const key = JSON.stringify(obj);
                if (!seen.has(key)) {
                  seen.add(key);
                  out.push(obj);
                }
              }
            } catch {
              // Not valid JSON — skip
            }
            i = j; // Advance past this object
            break;
          }
        }
      }
    }
  }

  /**
   * Converts a Cursor message to Autohand's SessionMessage format.
   *
   * Handles:
   * - content as string (plain text)
   * - content as array of {type, text} objects (text, reasoning, tool_use)
   * - <user_query> XML wrapping in user messages
   */
  private convertCursorMessage(
    raw: { role: string; content: unknown },
    timestamp: string,
  ): SessionMessage | null {
    let textContent = '';
    let thinking: string | undefined;

    if (typeof raw.content === 'string') {
      textContent = this.stripUserQueryTags(raw.content);
    } else if (Array.isArray(raw.content)) {
      const textParts: string[] = [];
      for (const part of raw.content) {
        if (part && typeof part === 'object') {
          if (part.type === 'text' && typeof part.text === 'string') {
            textParts.push(part.text);
          } else if (part.type === 'reasoning' && typeof part.text === 'string') {
            thinking = part.text;
          }
        }
      }
      textContent = this.stripUserQueryTags(textParts.join('\n'));
    }

    if (!textContent.trim()) return null;

    const msg: SessionMessage = {
      role: raw.role as 'user' | 'assistant',
      content: textContent,
      timestamp,
    };

    if (thinking) {
      msg._meta = { thinking };
    }

    return msg;
  }

  /**
   * Strips Cursor's <user_query> XML wrapping from message content.
   */
  private stripUserQueryTags(text: string): string {
    return text
      .replace(/<user_query>\n?/g, '')
      .replace(/\n?<\/user_query>/g, '')
      .trim();
  }
}
