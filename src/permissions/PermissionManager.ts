/**
 * Permission Manager - Handles tool/command approval with allow/deny lists
 * @license Apache-2.0
 */
import type {
  PermissionSettings,
  PermissionDecision,
  PermissionContext,
  PermissionMode,
  PermissionRule,
  PermissionPromptResult,
  PermissionSnapshot,
} from './types.js';
import path from 'node:path';
import {
  loadLocalProjectSettings,
  addToLocalAllowList,
  addToLocalDenyList,
  mergePermissions
} from './localProjectPermissions.js';
import { matchesToolPattern } from './toolPatterns.js';
import {
  addToSessionAllowList,
  addToSessionDenyList,
  getSessionPermissionsPath,
  loadSessionProjectPermissions,
  type SessionProjectPermissions,
} from './sessionProjectPermissions.js';

/**
 * Default security blacklist - always blocked patterns for sensitive files and dangerous commands.
 * These are merged with user settings and cannot be overridden by allowLists.
 */
export const DEFAULT_SECURITY_BLACKLIST: string[] = [
  // === Sensitive Files (read/write blocked) ===
  // Environment files with secrets
  'read_file:.env',
  'read_file:.env.*',
  'read_file:*.env',
  'write_file:.env',
  'write_file:.env.*',
  'write_file:*.env',

  // Git credentials and config
  'read_file:.git/config',
  'write_file:.git/config',
  'read_file:.git/credentials',
  'write_file:.git/credentials',
  'read_file:.gitconfig',
  'write_file:.gitconfig',

  // SSH keys
  'read_file:*/.ssh/*',
  'write_file:*/.ssh/*',
  'read_file:*/id_rsa*',
  'read_file:*/id_ed25519*',
  'read_file:*/id_ecdsa*',
  'write_file:*/id_rsa*',
  'write_file:*/id_ed25519*',

  // Cloud credentials
  'read_file:*/.aws/credentials',
  'read_file:*/.aws/config',
  'write_file:*/.aws/*',
  'read_file:*/.azure/*',
  'write_file:*/.azure/*',
  'read_file:*/.gcloud/*',
  'write_file:*/.gcloud/*',

  // Private keys and certificates
  'read_file:*.pem',
  'read_file:*.key',
  'read_file:*.p12',
  'read_file:*.pfx',
  'write_file:*.pem',
  'write_file:*.key',

  // GPG keys
  'read_file:*/.gnupg/*',
  'write_file:*/.gnupg/*',

  // NPM tokens
  'read_file:.npmrc',
  'write_file:.npmrc',

  // Docker credentials
  'read_file:*/.docker/config.json',
  'write_file:*/.docker/config.json',

  // Kubernetes credentials
  'read_file:*/.kube/config',
  'write_file:*/.kube/config',

  // === Dangerous Commands ===
  // Environment exposure
  'run_command:printenv',
  'run_command:printenv *',
  'run_command:env',
  'run_command:export',
  'run_command:set',

  // System information
  'run_command:cat /etc/passwd',
  'run_command:cat /etc/shadow',
  'run_command:cat /etc/sudoers',

  // Privilege escalation
  'run_command:sudo *',
  'run_command:su *',
  'run_command:doas *',

  // Destructive operations
  'run_command:rm -rf /',
  'run_command:rm -rf /*',
  'run_command:rm -rf ~',
  'run_command:rm -rf ~/*',
  'run_command:dd if=* of=/dev/*',
  'run_command:mkfs*',
  'run_command:wipefs*',
  'run_command:shred*',

  // Remote code execution
  'run_command:curl * | *sh',
  'run_command:wget * | *sh',
  'run_command:curl *|*sh',
  'run_command:wget *|*sh',

  // Network tools that can exfiltrate
  'run_command:nc -e*',
  'run_command:ncat -e*',
  'run_command:netcat -e*',

  // Credential theft
  'run_command:cat */.ssh/*',
  'run_command:cat */.aws/*',
  'run_command:cat *.pem',
  'run_command:cat *.key',
];

export interface PermissionManagerOptions {
  settings?: PermissionSettings;
  /** Callback to persist settings to config.json */
  onPersist?: (settings: PermissionSettings) => Promise<void>;
  /** Workspace root for local project permissions */
  workspaceRoot?: string;
}

export class PermissionManager {
  private settings: PermissionSettings;
  private localSettings: PermissionSettings | undefined;
  private sessionProjectSettings: SessionProjectPermissions | undefined;
  private sessionCache: Map<string, boolean> = new Map();
  private mode: PermissionMode;
  private onPersist?: (settings: PermissionSettings) => Promise<void>;
  private workspaceRoot?: string;
  private localSettingsLoaded = false;

  private normalizeSettings(settings: PermissionSettings | undefined): PermissionSettings {
    return {
      mode: settings?.mode ?? 'interactive',
      allowList: [...(settings?.allowList ?? settings?.whitelist ?? [])],
      denyList: [...(settings?.denyList ?? settings?.blacklist ?? [])],
      rules: [...(settings?.rules ?? [])],
      rememberSession: settings?.rememberSession ?? true,
      allowPatterns: [...(settings?.allowPatterns ?? [])],
      denyPatterns: [...(settings?.denyPatterns ?? [])],
      availableTools: [...(settings?.availableTools ?? [])],
      excludedTools: [...(settings?.excludedTools ?? [])],
      allPathsAllowed: settings?.allPathsAllowed,
      allUrlsAllowed: settings?.allUrlsAllowed,
    };
  }

  constructor(options: PermissionManagerOptions | PermissionSettings = {}) {
    // Support both old (PermissionSettings) and new (PermissionManagerOptions) signatures
    const isOptions = 'settings' in options || 'onPersist' in options || 'workspaceRoot' in options;
    const settings = isOptions ? (options as PermissionManagerOptions).settings ?? {} : options as PermissionSettings;
    this.onPersist = isOptions ? (options as PermissionManagerOptions).onPersist : undefined;
    this.workspaceRoot = isOptions ? (options as PermissionManagerOptions).workspaceRoot : undefined;

    this.settings = this.normalizeSettings(settings);
    this.mode = this.settings.mode || 'interactive';
  }

  /**
   * Initialize local project settings (async)
   * Call this after construction to load local .autohand/settings.local.json
   */
  async initLocalSettings(): Promise<void> {
    if (!this.workspaceRoot || this.localSettingsLoaded) return;

    try {
      const localSettings = await loadLocalProjectSettings(this.workspaceRoot);
      if (localSettings?.permissions) {
        this.localSettings = this.normalizeSettings(localSettings.permissions);
      }
      const sessionSettings = await loadSessionProjectPermissions(this.workspaceRoot);
      if (sessionSettings) {
        this.sessionProjectSettings = {
          allowList: [...(sessionSettings.allowList ?? [])],
          denyList: [...(sessionSettings.denyList ?? [])],
          version: sessionSettings.version,
        };
      }
      this.localSettingsLoaded = true;
    } catch {
      // Ignore errors - local settings are optional
    }
  }

  /**
   * Get merged settings (global + local)
   */
  private getMergedSettings(): PermissionSettings {
    return mergePermissions(this.settings, this.localSettings);
  }

  /**
   * Set permission mode (can be overridden by CLI flags)
   */
  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  /**
   * Get current mode
   */
  getMode(): PermissionMode {
    return this.mode;
  }

  /**
   * Check if an action should be allowed, denied, or prompted
   */
  checkPermission(context: PermissionContext): PermissionDecision {
    // SECURITY: Always check security blacklist FIRST - cannot be bypassed by any mode
    if (this.isSecurityBlacklisted(context)) {
      return { allowed: false, reason: 'blacklisted' };
    }

    // Pattern-based checks (AFTER security blacklist, BEFORE session cache)
    const patternDecision = this.checkPatterns(context);
    if (patternDecision) {
      return patternDecision;
    }

    const cacheKey = this.getCacheKey(context);

    // Check session cache
    if (this.settings.rememberSession && this.sessionCache.has(cacheKey)) {
      return {
        allowed: this.sessionCache.get(cacheKey)!,
        reason: this.sessionCache.get(cacheKey) ? 'user_approved' : 'user_denied',
        cached: true
      };
    }

    // Check mode-based decisions
    if (this.mode === 'unrestricted') {
      return { allowed: true, reason: 'mode_unrestricted' };
    }

    if (this.mode === 'restricted') {
      return { allowed: false, reason: 'mode_restricted' };
    }

    const sessionDecision = this.checkScopedLists(
      context,
      this.sessionProjectSettings?.allowList,
      this.sessionProjectSettings?.denyList,
      'session'
    );
    if (sessionDecision) {
      return sessionDecision;
    }

    const projectDecision = this.checkScopedLists(
      context,
      this.localSettings?.allowList,
      this.localSettings?.denyList,
      'project'
    );
    if (projectDecision) {
      return projectDecision;
    }

    const userDecision = this.checkScopedLists(
      context,
      this.settings.allowList,
      this.settings.denyList,
      'user'
    );
    if (userDecision) {
      return userDecision;
    }

    // Check custom rules
    const ruleDecision = this.checkRules(context);
    if (ruleDecision) {
      return ruleDecision;
    }

    // Default: needs prompt (interactive mode)
    return { allowed: false, reason: 'default' };
  }

  /**
   * Record a user's decision using the legacy boolean API.
   * Approved permissions are saved to the project allowList when possible.
   */
  async recordDecision(context: PermissionContext, allowed: boolean): Promise<void> {
    // Always cache in session
    const merged = this.getMergedSettings();
    if (merged.rememberSession) {
      const cacheKey = this.getCacheKey(context);
      this.sessionCache.set(cacheKey, allowed);
    }

    // Build pattern for allowList/denyList
    const pattern = this.contextToPattern(context);

    // For path-based approvals, also generate a directory wildcard so future
    // writes in the same directory are auto-approved (trust the directory).
    // Only for approvals — denials stay exact to avoid over-blocking.
    const dirPattern = allowed && context.path
      ? this.buildDirectoryWildcard(context)
      : null;

    // Save to LOCAL project settings (approve once, don't ask again for this project)
    if (allowed && this.workspaceRoot) {
      try {
        const patterns = dirPattern ? [pattern, dirPattern] : [pattern];
        for (const p of patterns) {
          await addToLocalAllowList(this.workspaceRoot, p);
        }
        // Also update local cache
        if (!this.localSettings) {
          this.localSettings = { allowList: [] };
        }
        if (!this.localSettings.allowList) {
          this.localSettings.allowList = [];
        }
        for (const p of patterns) {
          if (!this.localSettings.allowList.includes(p)) {
            this.localSettings.allowList.push(p);
          }
        }
      } catch {
        // If local save fails, fall back to global
        this.addToAllowList(pattern);
        if (dirPattern) this.addToAllowList(dirPattern);
      }
    } else if (allowed) {
      // No workspace root - save to global
      this.addToAllowList(pattern);
      if (dirPattern) this.addToAllowList(dirPattern);
    } else {
      // Denied - add exact path only to denyList (no directory wildcards for denials)
      this.addToDenyList(pattern);
    }

    // Persist global settings if callback provided
    if (this.onPersist) {
      await this.onPersist(this.settings);
    }
  }

  async applyPromptDecision(context: PermissionContext, result: PermissionPromptResult): Promise<void> {
    const pattern = this.contextToPattern(context);
    const dirPattern = this.buildDirectoryWildcard(context);
    const allowPatterns = dirPattern ? [pattern, dirPattern] : [pattern];

    switch (result.decision) {
      case 'allow_once':
      case 'deny_once':
      case 'alternative':
        return;
      case 'allow_session': {
        if (!this.workspaceRoot) {
          return;
        }
        for (const entry of allowPatterns) {
          await addToSessionAllowList(this.workspaceRoot, entry);
        }
        this.sessionProjectSettings = {
          ...(this.sessionProjectSettings ?? {}),
          allowList: Array.from(new Set([...(this.sessionProjectSettings?.allowList ?? []), ...allowPatterns])),
          denyList: [...(this.sessionProjectSettings?.denyList ?? [])],
        };
        return;
      }
      case 'deny_session': {
        if (!this.workspaceRoot) {
          return;
        }
        await addToSessionDenyList(this.workspaceRoot, pattern);
        this.sessionProjectSettings = {
          ...(this.sessionProjectSettings ?? {}),
          allowList: [...(this.sessionProjectSettings?.allowList ?? [])],
          denyList: Array.from(new Set([...(this.sessionProjectSettings?.denyList ?? []), pattern])),
        };
        return;
      }
      case 'allow_always_project': {
        if (!this.workspaceRoot) {
          this.addToAllowList(pattern);
          if (dirPattern) this.addToAllowList(dirPattern);
          if (this.onPersist) {
            await this.onPersist(this.settings);
          }
          return;
        }
        for (const entry of allowPatterns) {
          await addToLocalAllowList(this.workspaceRoot, entry);
        }
        if (!this.localSettings) {
          this.localSettings = this.normalizeSettings({});
        }
        this.localSettings.allowList = Array.from(new Set([...(this.localSettings.allowList ?? []), ...allowPatterns]));
        return;
      }
      case 'deny_always_project': {
        if (!this.workspaceRoot) {
          this.addToDenyList(pattern);
          if (this.onPersist) {
            await this.onPersist(this.settings);
          }
          return;
        }
        await addToLocalDenyList(this.workspaceRoot, pattern);
        if (!this.localSettings) {
          this.localSettings = this.normalizeSettings({});
        }
        this.localSettings.denyList = Array.from(new Set([...(this.localSettings.denyList ?? []), pattern]));
        return;
      }
      case 'allow_always_user':
        this.addToAllowList(pattern);
        if (dirPattern) this.addToAllowList(dirPattern);
        if (this.onPersist) {
          await this.onPersist(this.settings);
        }
        return;
      case 'deny_always_user':
        this.addToDenyList(pattern);
        if (this.onPersist) {
          await this.onPersist(this.settings);
        }
        return;
    }
  }

  /**
   * Convert context to a pattern string for whitelist/blacklist
   */
  private contextToPattern(context: PermissionContext): string {
    const tool = context.tool;
    let value: string;

    if (context.command) {
      // For commands, use exact command (no wildcards for safety)
      const args = context.args?.join(' ') || '';
      value = args ? `${context.command} ${args}` : context.command;
    } else if (context.path) {
      // For paths, use exact path
      value = context.path;
    } else {
      // Fallback to tool name with wildcard
      return `${tool}:*`;
    }

    return `${tool}:${value}`;
  }

  /**
   * Build a directory-level wildcard pattern for path-based approvals.
   * E.g., write_file:/project/tests/foo.ts → write_file:/project/tests/*
   * This allows future writes in the same directory to be auto-approved.
   */
  private buildDirectoryWildcard(context: PermissionContext): string | null {
    if (!context.path) return null;
    const dir = path.dirname(context.path);
    // Don't create wildcards for root-level paths
    if (dir === '.' || dir === '/') return null;
    return `${context.tool}:${dir}/*`;
  }

  /**
   * Convert a PermissionContext to the { kind, target } shape used by matchesToolPattern.
   */
  private contextToCall(context: PermissionContext): { kind: string; target: string } {
    return { kind: context.tool, target: this.getFullCommand(context) };
  }

  /**
   * Check pattern-based allow/deny rules (denyPatterns, availableTools, excludedTools,
   * allowPatterns, allPathsAllowed, allUrlsAllowed).
   * Returns a decision when a pattern fires, or null to continue with normal flow.
   */
  private checkPatterns(context: PermissionContext): PermissionDecision | null {
    const settings = this.getMergedSettings();
    const call = this.contextToCall(context);

    // 1. denyPatterns – always denied
    if (settings.denyPatterns?.length) {
      for (const p of settings.denyPatterns) {
        if (matchesToolPattern(p, call)) {
          return { allowed: false, reason: 'pattern_denied' };
        }
      }
    }

    // 2. availableTools – if non-empty, tool must appear in the list
    if (settings.availableTools?.length) {
      const inAvailable = settings.availableTools.some(p => matchesToolPattern(p, call));
      if (!inAvailable) {
        return { allowed: false, reason: 'not_in_available' };
      }
    }

    // 3. excludedTools – always denied
    if (settings.excludedTools?.length) {
      for (const p of settings.excludedTools) {
        if (matchesToolPattern(p, call)) {
          return { allowed: false, reason: 'excluded' };
        }
      }
    }

    // 4. allowPatterns – explicitly allowed
    if (settings.allowPatterns?.length) {
      for (const p of settings.allowPatterns) {
        if (matchesToolPattern(p, call)) {
          return { allowed: true, reason: 'pattern_allowed' };
        }
      }
    }

    // 5. allPathsAllowed – allow any file-path tool
    const fileTools = new Set(['read_file', 'write_file', 'list_dir', 'delete_path', 'move_path', 'copy_path']);
    if (settings.allPathsAllowed && fileTools.has(context.tool)) {
      return { allowed: true, reason: 'all_paths_allowed' };
    }

    // 6. allUrlsAllowed – allow url tool
    if (settings.allUrlsAllowed && context.tool === 'url') {
      return { allowed: true, reason: 'all_urls_allowed' };
    }

    return null;
  }

  /**
   * Check if context matches the immutable security blacklist
   * This check CANNOT be bypassed by any mode, allowList, or user setting
   */
  private isSecurityBlacklisted(context: PermissionContext): boolean {
    return DEFAULT_SECURITY_BLACKLIST.some(pattern => this.matchesPattern(context, pattern));
  }

  /**
   * Check scoped allow/deny lists, returning a source-specific decision if matched.
   */
  private checkScopedLists(
    context: PermissionContext,
    allowList: string[] | undefined,
    denyList: string[] | undefined,
    scope: 'session' | 'project' | 'user'
  ): PermissionDecision | null {
    const normalizedAllowList = allowList ?? [];
    const normalizedDenyList = denyList ?? [];

    if (normalizedDenyList.some(pattern => this.matchesPattern(context, pattern))) {
      return {
        allowed: false,
        reason: scope === 'user' ? 'deny_list' : `${scope}_deny_list` as PermissionDecision['reason'],
      };
    }

    if (normalizedAllowList.some(pattern => this.matchesPattern(context, pattern))) {
      return {
        allowed: true,
        reason: scope === 'user' ? 'allow_list' : `${scope}_allow_list` as PermissionDecision['reason'],
      };
    }

    return null;
  }

  /**
   * Check custom rules (uses merged global + local settings)
   */
  private checkRules(context: PermissionContext): PermissionDecision | null {
    const merged = this.getMergedSettings();
    const rules = merged.rules || [];

    for (const rule of rules) {
      if (this.ruleMatches(context, rule)) {
        if (rule.action === 'allow') {
          return { allowed: true, reason: 'rule_match' };
        }
        if (rule.action === 'deny') {
          return { allowed: false, reason: 'rule_match' };
        }
        // 'prompt' action falls through to default behavior
      }
    }

    return null;
  }

  /**
   * Check if a rule matches the context
   */
  private ruleMatches(context: PermissionContext, rule: PermissionRule): boolean {
    // Tool must match
    if (rule.tool !== '*' && rule.tool !== context.tool) {
      return false;
    }

    // If pattern specified, it must match
    if (rule.pattern) {
      const fullCommand = this.getFullCommand(context);
      return this.globMatch(fullCommand, rule.pattern);
    }

    return true;
  }

  /**
   * Match context against a pattern string
   * Format: "tool:pattern" or just "pattern" for run_command
   * Supports prefix patterns like "write_file:*" and directory-specific patterns
   */
  private matchesPattern(context: PermissionContext, pattern: string): boolean {
    // Parse pattern
    const colonIndex = pattern.indexOf(':');
    let toolPattern: string;
    let commandPattern: string;

    if (colonIndex !== -1) {
      toolPattern = pattern.substring(0, colonIndex);
      commandPattern = pattern.substring(colonIndex + 1);
    } else {
      // Assume run_command if no tool specified
      toolPattern = 'run_command';
      commandPattern = pattern;
    }

    // Check tool match
    if (toolPattern !== '*' && toolPattern !== context.tool) {
      return false;
    }

    // Handle prefix patterns (tool:*)
    if (commandPattern === '*') {
      return true;
    }

    // Handle directory/workspace-specific prefix patterns
    if (commandPattern.endsWith(':*')) {
      const prefix = commandPattern.slice(0, -2);
      const fullCommand = this.getFullCommand(context);
      
      // Check if the command/path starts with the prefix
      if (fullCommand.startsWith(prefix)) {
        // Ensure it's a proper prefix (either exact match or followed by separator)
        return fullCommand === prefix || 
               fullCommand.startsWith(prefix + ' ') || 
               fullCommand.startsWith(prefix + '/') ||
               fullCommand.startsWith(prefix + path.sep);
      }
      return false;
    }

    // Handle workspace-relative patterns like "write_file:src/*"
    if (this.workspaceRoot && (commandPattern.includes('/*'))) {
      
      // For file operations, check if the path matches the workspace pattern
      if (context.path) {
        // Convert workspace-relative patterns to absolute paths for matching
        let workspacePattern = commandPattern;
        if (commandPattern.startsWith('src/*') || commandPattern.startsWith('tests/*') || 
            commandPattern.startsWith('docs/*') || commandPattern.startsWith('config/*') ||
            commandPattern.startsWith('utils/*') || commandPattern.startsWith('build/*')) {
          workspacePattern = path.join(this.workspaceRoot, commandPattern);
        }
        
        if (workspacePattern !== commandPattern) {
          const resolvedPath = path.resolve(this.workspaceRoot, context.path);
          return this.globMatch(resolvedPath, workspacePattern);
        }
      }
    }

    // Check command/path match with standard glob matching
    const fullCommand = this.getFullCommand(context);
    return this.globMatch(fullCommand, commandPattern);
  }

  /**
   * Get full command string from context
   */
  private getFullCommand(context: PermissionContext): string {
    if (context.command) {
      const args = context.args?.join(' ') || '';
      return args ? `${context.command} ${args}` : context.command;
    }
    if (context.path) {
      return context.path;
    }
    return context.tool;
  }

  /**
   * Simple glob matching (* for wildcards)
   */
  private globMatch(text: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex chars
      .replace(/\*/g, '.*') // Convert * to .*
      .replace(/\?/g, '.'); // Convert ? to .

    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(text);
  }

  /**
   * Generate cache key from context
   */
  private getCacheKey(context: PermissionContext): string {
    const parts = [context.tool];
    if (context.command) parts.push(context.command);
    if (context.args?.length) parts.push(context.args.join(' '));
    if (context.path) parts.push(context.path);
    return parts.join('::');
  }

  /**
   * Clear session cache
   */
  clearCache(): void {
    this.sessionCache.clear();
  }

  /**
   * Get session cache stats
   */
  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.sessionCache.size,
      entries: Array.from(this.sessionCache.keys())
    };
  }

  /**
   * Add to allowList dynamically
   */
  addToAllowList(pattern: string): void {
    if (!this.settings.allowList) {
      this.settings.allowList = [];
    }
    if (!this.settings.allowList.includes(pattern)) {
      this.settings.allowList.push(pattern);
    }
  }

  /**
   * Add to denyList dynamically
   */
  addToDenyList(pattern: string): void {
    if (!this.settings.denyList) {
      this.settings.denyList = [];
    }
    if (!this.settings.denyList.includes(pattern)) {
      this.settings.denyList.push(pattern);
    }
  }

  /**
   * Remove from allowList
   */
  async removeFromAllowList(pattern: string): Promise<boolean> {
    if (!this.settings.allowList) return false;
    const index = this.settings.allowList.indexOf(pattern);
    if (index !== -1) {
      this.settings.allowList.splice(index, 1);
      if (this.onPersist) {
        await this.onPersist(this.settings);
      }
      return true;
    }
    return false;
  }

  /**
   * Remove from denyList
   */
  async removeFromDenyList(pattern: string): Promise<boolean> {
    if (!this.settings.denyList) return false;
    const index = this.settings.denyList.indexOf(pattern);
    if (index !== -1) {
      this.settings.denyList.splice(index, 1);
      if (this.onPersist) {
        await this.onPersist(this.settings);
      }
      return true;
    }
    return false;
  }

  /**
   * Get current allowList
   */
  getAllowList(): string[] {
    return [...(this.settings.allowList || [])];
  }

  /**
   * Get current denyList
   */
  getDenyList(): string[] {
    return [...(this.settings.denyList || [])];
  }

  /**
   * Get current settings (for display)
   */
  getSettings(): PermissionSettings {
    return {
      ...this.settings,
      allowList: [...(this.settings.allowList || [])],
      denyList: [...(this.settings.denyList || [])],
      rules: [...(this.settings.rules || [])],
      allowPatterns: [...(this.settings.allowPatterns || [])],
      denyPatterns: [...(this.settings.denyPatterns || [])],
      availableTools: [...(this.settings.availableTools || [])],
      excludedTools: [...(this.settings.excludedTools || [])],
    };
  }

  /**
   * Create a prefix pattern for a tool (e.g., write_file:src:*)
   */
  static createPrefixPattern(tool: string, prefix: string): string {
    return `${tool}:${prefix}:*`;
  }

  /**
   * Create a workspace-relative pattern (e.g., write_file:src/*)
   */
  static createWorkspacePattern(tool: string, workspaceDir: string): string {
    return `${tool}:${workspaceDir}/*`;
  }

  /**
   * Create a tool wildcard pattern (e.g., write_file:*)
   */
  static createToolWildcardPattern(tool: string): string {
    return `${tool}:*`;
  }

  /**
   * Add a prefix pattern to allowList
   */
  addPrefixPattern(tool: string, prefix: string): void {
    const pattern = PermissionManager.createPrefixPattern(tool, prefix);
    this.addToAllowList(pattern);
  }

  /**
   * Add a workspace-relative pattern to allowList
   */
  addWorkspacePattern(tool: string, workspaceDir: string): void {
    const pattern = PermissionManager.createWorkspacePattern(tool, workspaceDir);
    this.addToAllowList(pattern);
  }

  /**
   * Add a tool wildcard pattern to allowList
   */
  addToolWildcardPattern(tool: string): void {
    const pattern = PermissionManager.createToolWildcardPattern(tool);
    this.addToAllowList(pattern);
  }

  getWhitelist(): string[] {
    return this.getAllowList();
  }

  getBlacklist(): string[] {
    return this.getDenyList();
  }

  async removeFromWhitelist(pattern: string): Promise<boolean> {
    return this.removeFromAllowList(pattern);
  }

  async removeFromBlacklist(pattern: string): Promise<boolean> {
    return this.removeFromDenyList(pattern);
  }

  addToWhitelist(pattern: string): void {
    this.addToAllowList(pattern);
  }

  addToBlacklist(pattern: string): void {
    this.addToDenyList(pattern);
  }

  getPermissionSnapshot(userConfigPath: string): PermissionSnapshot {
    const effective = this.getMergedSettings();
    const effectiveAllowList = Array.from(new Set([
      ...(effective.allowList ?? []),
      ...(this.sessionProjectSettings?.allowList ?? []),
    ]));
    const effectiveDenyList = Array.from(new Set([
      ...(effective.denyList ?? []),
      ...(this.sessionProjectSettings?.denyList ?? []),
    ]));

    return {
      mode: this.mode,
      rememberSession: effective.rememberSession !== false,
      session: {
        path: this.workspaceRoot ? getSessionPermissionsPath(this.workspaceRoot) : '(project session unavailable)',
        allowList: [...(this.sessionProjectSettings?.allowList ?? [])],
        denyList: [...(this.sessionProjectSettings?.denyList ?? [])],
      },
      project: {
        path: this.workspaceRoot
          ? path.join(this.workspaceRoot, '.autohand', 'settings.local.json')
          : '(project unavailable)',
        allowList: [...(this.localSettings?.allowList ?? [])],
        denyList: [...(this.localSettings?.denyList ?? [])],
      },
      user: {
        path: userConfigPath,
        allowList: [...(this.settings.allowList ?? [])],
        denyList: [...(this.settings.denyList ?? [])],
      },
      effective: {
        path: 'merged',
        allowList: effectiveAllowList,
        denyList: effectiveDenyList,
      },
    };
  }
}
