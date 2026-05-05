/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AgentRuntime } from '../../types.js';
import type { ToolManager } from '../toolManager.js';
import type { ToolsRegistry } from '../toolsRegistry.js';
import { AgentRegistry } from '../agents/AgentRegistry.js';

export interface DynamicRuntimeExtensionHost {
  toolsRegistry?: ToolsRegistry;
  toolManager?: Pick<ToolManager, 'registerMetaTools'>;
}

export function configureAgentRegistry(runtime: AgentRuntime): AgentRegistry {
  const registry = AgentRegistry.getInstance();
  registry.configureExternalAgents(runtime.config.externalAgents);
  return registry;
}

export async function syncDynamicRuntimeExtensions(
  host: DynamicRuntimeExtensionHost,
  runtime: AgentRuntime
): Promise<void> {
  configureAgentRegistry(runtime);

  if (!host.toolsRegistry || !host.toolManager) {
    return;
  }

  await host.toolsRegistry.initialize();
  host.toolManager.registerMetaTools(host.toolsRegistry.toToolDefinitions());
}
