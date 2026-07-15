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

export interface DynamicRuntimeExtensionHost {
  toolsRegistry?: ToolsRegistry;
  toolManager?: Pick<ToolManager, 'replaceRuntimeMetaTools'>;
  extensionRegistry?: Pick<ExtensionRegistry, 'load'>;
  extensionSnapshot?: ExtensionSnapshot;
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
  });
  host.extensionSnapshot = snapshot;
  agentRegistry.setExtensionAgents(snapshot.agents);

  if (!host.toolsRegistry || !host.toolManager) {
    return snapshot;
  }

  host.toolsRegistry.setExtensionTools(snapshot.tools);
  host.toolManager.replaceRuntimeMetaTools(host.toolsRegistry.toToolDefinitions());
  return snapshot;
}
