/**
 * Permission Manager - Handles tool/command approval with whitelist/blacklist
 * @license Apache-2.0
 */
import type {
  PermissionSettings,
  PermissionDecision,
  PermissionContext,
  PermissionMode,
  PermissionRule
} from './types.js';

export interface PermissionManagerOptions {
  settings?: PermissionSettings;
  /** Callback to persist settings to config.json */
  onPersist?: (settings: PermissionSettings) => Promise<void>;
}

export class PermissionManager {
  private settings: PermissionSettings;
  private sessionCache: Map<string, boolean> = new Map();
  private mode: PermissionMode;
  private onPersist?: (settings: PermissionSettings) => Promise<void>;

  constructor(options: PermissionManagerOptions | PermissionSettings = {}) {
    // Support both old (PermissionSettings) and new (PermissionManagerOptions) signatures
    const isOptions = 'settings' in options || 'onPersist' in options;
    const settings = isOptions ? (options as PermissionManagerOptions).settings ?? {} : options as PermissionSettings;
    this.onPersist = isOptions ? (options as PermissionManagerOptions).onPersist : undefined;

    this.settings = {
      mode: 'interactive',
      whitelist: [],
      blacklist: [],
      rules: [],
      rememberSession: true,
      ...settings
    };
    this.mode = this.settings.mode || 'interactive';
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
    const cacheKey = this.getCacheKey(context);

    // Check session cache first
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

    // Check blacklist first (deny takes precedence)
    if (this.isBlacklisted(context)) {
      return { allowed: false, reason: 'blacklisted' };
    }

    // Check whitelist
    if (this.isWhitelisted(context)) {
      return { allowed: true, reason: 'whitelisted' };
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
   * Record a user's decision - adds to whitelist/blacklist and persists
   */
  async recordDecision(context: PermissionContext, allowed: boolean): Promise<void> {
    // Always cache in session
    if (this.settings.rememberSession) {
      const cacheKey = this.getCacheKey(context);
      this.sessionCache.set(cacheKey, allowed);
    }

    // Build pattern for whitelist/blacklist
    const pattern = this.contextToPattern(context);

    if (allowed) {
      this.addToWhitelist(pattern);
    } else {
      this.addToBlacklist(pattern);
    }

    // Persist to config if callback provided
    if (this.onPersist) {
      await this.onPersist(this.settings);
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
   * Check if context matches blacklist
   */
  private isBlacklisted(context: PermissionContext): boolean {
    const blacklist = this.settings.blacklist || [];
    return blacklist.some(pattern => this.matchesPattern(context, pattern));
  }

  /**
   * Check if context matches whitelist
   */
  private isWhitelisted(context: PermissionContext): boolean {
    const whitelist = this.settings.whitelist || [];
    return whitelist.some(pattern => this.matchesPattern(context, pattern));
  }

  /**
   * Check custom rules
   */
  private checkRules(context: PermissionContext): PermissionDecision | null {
    const rules = this.settings.rules || [];

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

    // Check command/path match
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
   * Add to whitelist dynamically
   */
  addToWhitelist(pattern: string): void {
    if (!this.settings.whitelist) {
      this.settings.whitelist = [];
    }
    if (!this.settings.whitelist.includes(pattern)) {
      this.settings.whitelist.push(pattern);
    }
  }

  /**
   * Add to blacklist dynamically
   */
  addToBlacklist(pattern: string): void {
    if (!this.settings.blacklist) {
      this.settings.blacklist = [];
    }
    if (!this.settings.blacklist.includes(pattern)) {
      this.settings.blacklist.push(pattern);
    }
  }

  /**
   * Remove from whitelist
   */
  async removeFromWhitelist(pattern: string): Promise<boolean> {
    if (!this.settings.whitelist) return false;
    const index = this.settings.whitelist.indexOf(pattern);
    if (index !== -1) {
      this.settings.whitelist.splice(index, 1);
      if (this.onPersist) {
        await this.onPersist(this.settings);
      }
      return true;
    }
    return false;
  }

  /**
   * Remove from blacklist
   */
  async removeFromBlacklist(pattern: string): Promise<boolean> {
    if (!this.settings.blacklist) return false;
    const index = this.settings.blacklist.indexOf(pattern);
    if (index !== -1) {
      this.settings.blacklist.splice(index, 1);
      if (this.onPersist) {
        await this.onPersist(this.settings);
      }
      return true;
    }
    return false;
  }

  /**
   * Get current whitelist
   */
  getWhitelist(): string[] {
    return [...(this.settings.whitelist || [])];
  }

  /**
   * Get current blacklist
   */
  getBlacklist(): string[] {
    return [...(this.settings.blacklist || [])];
  }

  /**
   * Get current settings (for display)
   */
  getSettings(): PermissionSettings {
    return { ...this.settings };
  }
}
