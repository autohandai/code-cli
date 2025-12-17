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
  /** Configuration files (config.json, config.yaml, config.yml) */
  config: AUTOHAND_HOME,

  /** Session data storage */
  sessions: path.join(AUTOHAND_HOME, 'sessions'),

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
} as const;

/**
 * File paths within AUTOHAND_HOME
 */
export const AUTOHAND_FILES = {
  /** Main config file */
  configJson: path.join(AUTOHAND_HOME, 'config.json'),
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
} as const;
