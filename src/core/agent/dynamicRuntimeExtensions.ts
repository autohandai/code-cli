/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AgentRuntime } from '../../types.js';
import type { ToolManager } from '../toolManager.js';
import type { ToolsRegistry } from '../toolsRegistry.js';
import { AgentRegistry } from '../agents/AgentRegistry.js';
import path from 'node:path';
import { AUTOHAND_PATHS, PROJECT_DIR_NAME } from '../../constants.js';
import { ExtensionRegistry } from '../../extensions/ExtensionRegistry.js';
import type { ExtensionSnapshot } from '../../extensions/types.js';
import type { SkillsRegistry } from '../../skills/SkillsRegistry.js';
import { extensionRuntimeHost } from '../../extensions/ExtensionRuntimeHost.js';
import { SLASH_COMMANDS } from '../slashCommands.js';

export interface DynamicRuntimeExtensionHost {
  toolsRegistry?: ToolsRegistry;
  toolManager?: Pick<ToolManager, 'replaceRuntimeMetaTools'>;
  extensionRegistry?: Pick<ExtensionRegistry, 'load'>;
  extensionSnapshot?: ExtensionSnapshot;
  skillsRegistry?: Pick<SkillsRegistry, 'listSkills' | 'setExtensionSkills'>;
  permissionManager?: {
    setExtensionPolicies(policies: ReturnType<typeof extensionRuntimeHost.getPermissionPolicies>): void;
  };
  hookManager?: {
    setExtensionHooks(hooks: ReturnType<typeof extensionRuntimeHost.getHooks>): void;
  };
  inkRenderer?: object | null;
  slashHandler?: unknown;
}

export function configureAgentRegistry(runtime: AgentRuntime): AgentRegistry {
  const registry = AgentRegistry.getInstance();
  registry.configureExternalAgents(runtime.config.externalAgents);
  const inlineAgents = runtime.options?.inlineAgents;
  if (inlineAgents?.length) {
    registry.setSessionAgents(inlineAgents);
  } else {
    registry.clearSessionAgents();
  }
  return registry;
}

export async function syncDynamicRuntimeExtensions(
  host: DynamicRuntimeExtensionHost,
  runtime: AgentRuntime
): Promise<ExtensionSnapshot> {
  const agentRegistry = configureAgentRegistry(runtime);
  if (host.toolsRegistry) {
    await host.toolsRegistry.initialize();
  }
  await agentRegistry.loadAgents();
  const extensionRegistry = host.extensionRegistry ?? new ExtensionRegistry({
    userRoot: AUTOHAND_PATHS.extensions,
    projectRoot: path.join(runtime.workspaceRoot, PROJECT_DIR_NAME, 'extensions'),
  });
  const snapshot = await extensionRegistry.load({
    reservedToolNames: host.toolsRegistry
      ?.listMetaTools({ includeDisabled: true })
      .map((tool) => tool.name),
    reservedAgentNames: agentRegistry
      .getAllAgents()
      .filter((agent) => agent.source !== 'extension')
      .map((agent) => agent.name),
    reservedSkillNames: host.skillsRegistry
      ?.listSkills()
      .filter((skill) => skill.source !== 'extension')
      .map((skill) => skill.name),
  });
  const runtimeDiagnostics = await extensionRuntimeHost.sync(snapshot);
  snapshot.diagnostics.push(...runtimeDiagnostics);
  host.extensionSnapshot = snapshot;
  agentRegistry.setExtensionAgents(snapshot.agents);
  host.skillsRegistry?.setExtensionSkills?.(snapshot.skills);
  host.permissionManager?.setExtensionPolicies(extensionRuntimeHost.getPermissionPolicies());
  host.hookManager?.setExtensionHooks(extensionRuntimeHost.getHooks());
  const inkRenderer = host.inkRenderer as {
    setRuntimeSlashCommands?: (commands: typeof SLASH_COMMANDS) => void;
    setExtensionKeybindings?: (
      keybindings: ReturnType<typeof extensionRuntimeHost.getKeybindings>
    ) => void;
    setRuntimeLineExtensions?: (
      lineExtensions: ReturnType<typeof extensionRuntimeHost.getLineExtensions>
    ) => void;
  } | null | undefined;
  inkRenderer?.setRuntimeSlashCommands?.([
    ...SLASH_COMMANDS,
    ...extensionRuntimeHost.getCommands().map((command) => ({
      command: command.command,
      description: command.description,
      implemented: true,
    })),
  ]);
  inkRenderer?.setExtensionKeybindings?.(extensionRuntimeHost.getKeybindings());
  inkRenderer?.setRuntimeLineExtensions?.(extensionRuntimeHost.getLineExtensions());

  if (!host.toolsRegistry || !host.toolManager) {
    return snapshot;
  }

  host.toolsRegistry.setExtensionTools(snapshot.tools);
  host.toolManager.replaceRuntimeMetaTools(host.toolsRegistry.toToolDefinitions());
  return snapshot;
}
