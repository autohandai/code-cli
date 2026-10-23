/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CLIOptions, LoadedConfig } from '../types.js';
import { applyRunConfigOverlay } from '../runConfigOverlay.js';

export const NO_DAEMON_MESSAGE = 'Background services and child processes are disabled by --no-daemon. Run commands in the foreground.';
export const NO_DAEMON_TOOLS = ['add_teammate', 'compose_team', 'cron_create', 'install_mcp_server'] as const;

export function applyNoDaemonConfig(config: LoadedConfig, options: CLIOptions): LoadedConfig {
  if (options.daemon !== false) return config;
  const overlay = applyRunConfigOverlay(config, { sets: [
    'ui.promptSuggestions=false', 'ui.repositoryReadiness=false', 'ui.checkForUpdates=false',
    'ui.notifications=false', 'ui.showCompletionNotification=false', 'agent.autoMemory=false',
    'features.automaticSpecialists=false', 'hooks.enabled=false', 'hooks.hooks=[]',
    'mcp.enabled=false', 'mcp.servers=[]', 'sync.enabled=false', 'telemetry.enabled=false',
    'telemetry.enableSessionSync=false', 'autoReport.enabled=false', 'communitySkills.enabled=false',
    'communitySkills.autoBackup=false', 'communitySkills.showSuggestionsOnStartup=false',
    'sessions.communication.enabled=false',
  ] });
  return {
    ...config,
    ...overlay.config,
    runOverlay: { ...config.runOverlay, entries: [...(config.runOverlay?.entries ?? []), ...(overlay.snapshot?.entries ?? [])] },
  };
}
