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

  // ---------------------------------------------------------------
  // scan()
  // ---------------------------------------------------------------

  async scan(): Promise<ImportScanResult> {
    const available = new Map<ImportCategory, { count: number; description: string }>();
    const home = this.resolvedHomePath;

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

    // Check settings
    const settingsPath = path.join(home, 'settings.json');
    if (await fse.pathExists(settingsPath)) {
      available.set('settings', { count: 1, description: 'Claude Code settings.json' });
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
        case 'memory':
          await this.importMemory(imported, errors, onProgress);
          break;
        default:
          // Categories not supported by Claude (mcp, hooks) – skip silently
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
    const settingsPath = path.join(this.resolvedHomePath, 'settings.json');

    if (!(await fse.pathExists(settingsPath))) {
      imported.set('settings', { success: 0, failed: 0, skipped: 1 });
      return;
    }

    onProgress?.({
      category: 'settings',
      current: 1,
      total: 1,
      item: 'settings.json',
      status: 'importing',
    });

    try {
      const settings = await this.safeReadJson(settingsPath);

      // Extract permissions.allow and merge into autohand config
      const permissions = settings.permissions as { allow?: string[] } | undefined;
      if (permissions?.allow) {
        const configDir = AUTOHAND_PATHS.config;
        await fse.ensureDir(configDir);

        const importedSettingsPath = path.join(configDir, 'imported-claude-settings.json');
        await fse.writeJson(importedSettingsPath, {
          importedFrom: 'claude',
          importedAt: new Date().toISOString(),
          permissions: permissions.allow,
          raw: settings,
        }, { spaces: 2 });
      }

      imported.set('settings', { success: 1, failed: 0, skipped: 0 });

      onProgress?.({
        category: 'settings',
        current: 1,
        total: 1,
        item: 'settings.json',
        status: 'done',
      });
    } catch (err) {
      imported.set('settings', { success: 0, failed: 1, skipped: 0 });
      errors.push({
        category: 'settings',
        item: 'settings.json',
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
