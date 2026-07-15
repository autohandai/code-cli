/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Centralized constants for Autohand CLI
 */
import os from 'node:os';
import path from 'node:path';

/**
 * Base directory for all Autohand user data and configuration.
 * Default: ~/.autohand/
 * Override: Set AUTOHAND_HOME environment variable
 */
export const AUTOHAND_HOME = process.env.AUTOHAND_HOME || path.join(os.homedir(), '.autohand');

/**
 * Subdirectory paths within AUTOHAND_HOME
 */
export const AUTOHAND_PATHS = {
  /** Configuration files (config.toml, config.yaml, config.yml, config.json) */
  config: AUTOHAND_HOME,

  /** Session data storage */
  sessions: path.join(AUTOHAND_HOME, 'sessions'),

  /** Active local CLI session heartbeat files */
  activeAgents: path.join(AUTOHAND_HOME, 'active-agents'),

  /** Project knowledge base */
  projects: path.join(AUTOHAND_HOME, 'projects'),

  /** User-level memory */
  memory: path.join(AUTOHAND_HOME, 'memory'),

  /** Feedback state and responses */
  feedback: path.join(AUTOHAND_HOME, 'feedback'),

  /** Telemetry data */
  telemetry: path.join(AUTOHAND_HOME, 'telemetry'),

  /** Custom commands */
  commands: path.join(AUTOHAND_HOME, 'commands'),

  /** Agent definitions */
  agents: path.join(AUTOHAND_HOME, 'agents'),

  /** Custom tools */
  tools: path.join(AUTOHAND_HOME, 'tools'),

  /** Declarative extension packages */
  extensions: path.join(AUTOHAND_HOME, 'extensions'),

  /** Skills (instruction packages) */
  skills: path.join(AUTOHAND_HOME, 'skills'),

  /** Plan files for plan mode */
  plans: path.join(AUTOHAND_HOME, 'plans'),

  /** MCP community registry cache */
  mcpCache: path.join(AUTOHAND_HOME, 'community-mcp', 'cache'),

  /** Auto-report data */
  reporting: path.join(AUTOHAND_HOME, 'reporting'),
} as const;

/**
 * File paths within AUTOHAND_HOME
 */
export const AUTOHAND_FILES = {
  /** Main config file */
  configJson: path.join(AUTOHAND_HOME, 'config.json'),
  configToml: path.join(AUTOHAND_HOME, 'config.toml'),
  configYaml: path.join(AUTOHAND_HOME, 'config.yaml'),
  configYml: path.join(AUTOHAND_HOME, 'config.yml'),

  /** Device ID for telemetry */
  deviceId: path.join(AUTOHAND_HOME, 'device-id'),

  /** Error log */
  errorLog: path.join(AUTOHAND_HOME, 'error.log'),

  /** Feedback log */
  feedbackLog: path.join(AUTOHAND_HOME, 'feedback.log'),

  /** Telemetry queue */
  telemetryQueue: path.join(AUTOHAND_PATHS.telemetry, 'queue.json'),

  /** Session sync queue */
  sessionSyncQueue: path.join(AUTOHAND_PATHS.telemetry, 'session-sync-queue.json'),

  /** Last successful remote feature flag evaluation */
  featureFlagsCache: path.join(AUTOHAND_HOME, 'feature-flags.json'),
} as const;

/**
 * Project-level directory name (within workspace root)
 * This is NOT under AUTOHAND_HOME - it's in the project directory
 */
export const PROJECT_DIR_NAME = '.autohand';

const getAuthBaseUrl = () => process['env']['AUTOHAND_API_URL'] || 'https://autohand.ai';

export const AUTH_CONFIG = {
  get apiBaseUrl() { return `${getAuthBaseUrl()}/api/auth`; },
  get authorizationUrl() { return `${getAuthBaseUrl()}/cli-auth`; },
  pollInterval: 2000,
  authTimeout: 5 * 60 * 1000,
  sessionExpiryDays: 30,
  /** Idle timeout in ms before forcing logout (30 minutes) */
  idleTimeoutMs: 30 * 60 * 1000,
} as const;

/**
 * Settings sync configuration
 */
export const SYNC_CONFIG = {
  /** Default sync interval in ms (5 minutes) */
  defaultInterval: 5 * 60 * 1000,
  /** API endpoint for sync operations */
  get apiBaseUrl() { return `${getAuthBaseUrl()}/api`; },
  /** Maximum file size to sync (10MB) */
  maxFileSize: 10 * 1024 * 1024,
  /** Maximum total sync size (100MB) */
  maxTotalSize: 100 * 1024 * 1024,
  /** Request timeout in ms */
  timeout: 30000,
} as const;

const THIRD_PARTY_PROJECT_SKILL_DIRS = [
  '.aider-desk/skills',
  '.augment/skills',
  '.bob/skills',
  '.codeartsdoer/skills',
  '.codebuddy/skills',
  '.codemaker/skills',
  '.codestudio/skills',
  '.commandcode/skills',
  '.continue/skills',
  '.cortex/skills',
  '.crush/skills',
  '.devin/skills',
  '.factory/skills',
  '.forge/skills',
  '.goose/skills',
  '.hermes/skills',
  '.junie/skills',
  '.iflow/skills',
  '.kilocode/skills',
  '.kiro/skills',
  '.kode/skills',
  '.mcpjam/skills',
  '.vibe/skills',
  '.mux/skills',
  '.openhands/skills',
  '.pi/skills',
  '.qoder/skills',
  '.qwen/skills',
  '.rovodev/skills',
  '.roo/skills',
  '.tabnine/agent/skills',
  '.trae/skills',
  '.windsurf/skills',
  '.zencoder/skills',
  '.neovate/skills',
  '.pochi/skills',
  '.adal/skills',
  '.agent/skills',
  '.agents/skills',
  'skills',
] as const;

/**
 * User skill search locations in order of precedence (later wins on collision).
 * Each entry specifies: path pattern, source type, and whether to search recursively.
 */
export function getUserSkillLocations(homeDir = os.homedir(), autohandSkillsDir = AUTOHAND_PATHS.skills) {
  return [
    { basePath: path.join(homeDir, '.codex', 'skills'), source: 'codex-user' as const, recursive: true },
    { basePath: path.join(homeDir, '.claude', 'skills'), source: 'claude-user' as const, recursive: false },
    { basePath: path.join(homeDir, '.agent', 'skills'), source: 'agent-user' as const, recursive: true },
    { basePath: path.join(homeDir, '.agents', 'skills'), source: 'agent-user' as const, recursive: true },
    { basePath: autohandSkillsDir, source: 'autohand-user' as const, recursive: true },
  ];
}

export const SKILL_LOCATIONS = getUserSkillLocations();

/**
 * Get project-level skill locations for a given workspace root
 */
export function getProjectSkillLocations(workspaceRoot: string) {
  return [
    { basePath: path.join(workspaceRoot, '.claude', 'skills'), source: 'claude-project' as const, recursive: false },
    ...THIRD_PARTY_PROJECT_SKILL_DIRS.map((relativePath) => ({
      basePath: path.join(workspaceRoot, relativePath),
      source: 'agent-project' as const,
      recursive: true,
    })),
    { basePath: path.join(workspaceRoot, PROJECT_DIR_NAME, 'skills'), source: 'autohand-project' as const, recursive: true },
  ];
}
