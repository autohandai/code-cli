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

/**
 * A parsed Codex session JSONL event.
 */
interface CodexEvent {
  timestamp: string;
  type: string;
  payload: Record<string, unknown>;
}

/**
 * Importer for OpenAI Codex CLI data (~/.codex).
 *
 * Handles sessions (JSONL in date-organized directories), settings (config.toml),
 * and skills (markdown files).
 */
export class CodexImporter extends BaseImporter {
  readonly name: ImportSource = 'codex';
  readonly displayName = 'OpenAI Codex';
  readonly homePath = '~/.codex';

  // ---------------------------------------------------------------
  // scan()
  // ---------------------------------------------------------------

  async scan(): Promise<ImportScanResult> {
    const available = new Map<ImportCategory, { count: number; description: string }>();
    const home = this.resolvedHomePath;

    if (!(await fse.pathExists(home))) {
      return { source: this.name, available };
    }

    // Count sessions recursively
    const sessionsDir = path.join(home, 'sessions');
    if (await fse.pathExists(sessionsDir)) {
      const sessionFiles = await this.walkJsonlFiles(sessionsDir);
      if (sessionFiles.length > 0) {
        available.set('sessions', {
          count: sessionFiles.length,
          description: `${sessionFiles.length} session file${sessionFiles.length !== 1 ? 's' : ''}`,
        });
      }
    }

    // Check config.toml
    if (await fse.pathExists(path.join(home, 'config.toml'))) {
      available.set('settings', { count: 1, description: 'Codex config.toml' });
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

    // Check rules
    const rulesDir = path.join(home, 'rules');
    if (await fse.pathExists(rulesDir)) {
      const ruleEntries = await fse.readdir(rulesDir, { withFileTypes: true }) as unknown as Array<{ name: string; isFile(): boolean }>;
      const ruleFiles = ruleEntries.filter(e => e.isFile());
      if (ruleFiles.length > 0) {
        available.set('memory', {
          count: ruleFiles.length,
          description: `${ruleFiles.length} rule file${ruleFiles.length !== 1 ? 's' : ''}`,
        });
      }
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
  // Sessions
  // ---------------------------------------------------------------

  protected async importSessions(
    imported: Map<ImportCategory, ImportCategoryResult>,
    errors: ImportError[],
    onProgress?: ProgressCallback,
  ): Promise<void> {
    const sessionsDir = path.join(this.resolvedHomePath, 'sessions');
    let success = 0;
    let failed = 0;
    let skipped = 0;

    if (!(await fse.pathExists(sessionsDir))) {
      imported.set('sessions', { success: 0, failed: 0, skipped: 0 });
      return;
    }

    const sessionFiles = await this.walkJsonlFiles(sessionsDir);
    const total = sessionFiles.length;

    for (let i = 0; i < sessionFiles.length; i++) {
      const filePath = sessionFiles[i];

      onProgress?.({
        category: 'sessions',
        current: i + 1,
        total,
        item: path.basename(filePath),
        status: 'importing',
      });

      try {
        const records = await this.readJsonlFile(filePath);
        const events = records as unknown as CodexEvent[];

        // Extract session metadata
        const metaEvent = events.find(e => e.type === 'session_meta');
        const sessionId = (metaEvent?.payload?.id as string) ?? path.basename(filePath, '.jsonl');
        const cwd = (metaEvent?.payload?.cwd as string) ?? '/unknown';

        // Extract messages
        const messages: SessionMessage[] = [];

        for (const event of events) {
          if (event.type === 'response_item') {
            const payload = event.payload as {
              type?: string;
              role?: string;
              content?: Array<{ type: string; text?: string }>;
            };

            if (payload.type === 'message' && payload.role && payload.content) {
              const text = payload.content
                .filter(c => (c.type === 'input_text' || c.type === 'output_text') && c.text)
                .map(c => c.text!)
                .join('');

              if (text) {
                messages.push({
                  role: payload.role as SessionMessage['role'],
                  content: text,
                  timestamp: event.timestamp,
                });
              }
            }
          } else if (event.type === 'event_msg') {
            const payload = event.payload as { type?: string; message?: string };
            if (payload.type === 'agent_message' && payload.message) {
              messages.push({
                role: 'assistant',
                content: payload.message,
                timestamp: event.timestamp,
              });
            }
          }
          // Skip: session_meta, turn_context, event_msg with token_count, etc.
        }

        if (messages.length === 0) {
          skipped++;
          continue;
        }

        const projectName = path.basename(cwd);

        await this.writeAutohandSession({
          projectPath: cwd,
          projectName,
          model: 'codex',
          messages,
          source: this.name,
          originalId: sessionId,
          createdAt: messages[0].timestamp,
          closedAt: messages[messages.length - 1].timestamp,
          summary: this.buildSummary(messages),
          status: 'completed',
        });

        success++;
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

    imported.set('sessions', { success, failed, skipped });
  }

  // ---------------------------------------------------------------
  // Settings (TOML)
  // ---------------------------------------------------------------

  protected async importSettings(
    imported: Map<ImportCategory, ImportCategoryResult>,
    errors: ImportError[],
    onProgress?: ProgressCallback,
  ): Promise<void> {
    const configPath = path.join(this.resolvedHomePath, 'config.toml');

    if (!(await fse.pathExists(configPath))) {
      imported.set('settings', { success: 0, failed: 0, skipped: 1 });
      return;
    }

    onProgress?.({
      category: 'settings',
      current: 1,
      total: 1,
      item: 'config.toml',
      status: 'importing',
    });

    try {
      const tomlContent = await fse.readFile(configPath, 'utf-8') as string;
      const parsed = this.parseToml(tomlContent);

      const configDir = AUTOHAND_PATHS.config;
      await fse.ensureDir(configDir);

      await fse.writeJson(
        path.join(configDir, 'imported-codex-settings.json'),
        {
          importedFrom: 'codex',
          importedAt: new Date().toISOString(),
          parsed,
          raw: tomlContent,
        },
        { spaces: 2 },
      );

      imported.set('settings', { success: 1, failed: 0, skipped: 0 });

      onProgress?.({
        category: 'settings',
        current: 1,
        total: 1,
        item: 'config.toml',
        status: 'done',
      });
    } catch (err) {
      imported.set('settings', { success: 0, failed: 1, skipped: 0 });
      errors.push({
        category: 'settings',
        item: 'config.toml',
        error: err instanceof Error ? err.message : String(err),
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
    const destDir = path.join(AUTOHAND_PATHS.skills, 'imported-codex');

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
  // Helpers
  // ---------------------------------------------------------------

  /**
   * Recursively walk a directory tree and collect all .jsonl file paths.
   */
  protected async walkJsonlFiles(dir: string): Promise<string[]> {
    const results: string[] = [];
    const entries = await fse.readdir(dir, { withFileTypes: true }) as unknown as Array<{
      name: string;
      isFile(): boolean;
      isDirectory(): boolean;
    }>;

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await this.walkJsonlFiles(fullPath);
        results.push(...nested);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        results.push(fullPath);
      }
    }

    return results;
  }

  /**
   * Simple TOML parser. Handles:
   * - `key = "value"` (quoted strings)
   * - `key = value` (unquoted – numbers, booleans, bare strings)
   * - `[section]` and `[section.subsection]` headers
   * - `# comments`
   * - blank lines
   *
   * Returns a flat object with dotted keys for sections
   * (e.g. `{ "section.key": "value" }`).
   */
  protected parseToml(content: string): Record<string, string | number | boolean> {
    const result: Record<string, string | number | boolean> = {};
    let currentSection = '';

    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();

      // Skip empty lines and comments
      if (!line || line.startsWith('#')) continue;

      // Section header: [section] or [section.subsection]
      const sectionMatch = line.match(/^\[([^\]]+)\]$/);
      if (sectionMatch) {
        currentSection = sectionMatch[1];
        continue;
      }

      // Key-value pair: key = value
      const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*=\s*(.+)$/);
      if (!kvMatch) continue;

      const key = currentSection ? `${currentSection}.${kvMatch[1]}` : kvMatch[1];
      let value = kvMatch[2].trim();

      // Remove inline comments
      const inlineComment = value.indexOf(' #');
      if (inlineComment > 0) {
        value = value.slice(0, inlineComment).trim();
      }

      // Parse value type
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
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

  /**
   * Build a brief summary from the first user message.
   */
  protected buildSummary(messages: SessionMessage[]): string {
    const firstUser = messages.find(m => m.role === 'user');
    if (!firstUser) return 'Imported Codex session';
    const text = firstUser.content.slice(0, 100);
    return text.length < firstUser.content.length ? `${text}...` : text;
  }
}
