/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AgentAction, ToolCallRequest, ToolExecutionResult } from '../types.js';

export interface ToolDefinition {
  name: AgentAction['type'];
  description: string;
  requiresApproval?: boolean;
  approvalMessage?: string;
}

export interface ToolManagerOptions {
  executor: (action: AgentAction) => Promise<string | undefined>;
  confirmApproval: (message: string) => Promise<boolean>;
  definitions?: ToolDefinition[];
}

export const DEFAULT_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'delete_path',
    description: 'Remove files or directories from the workspace',
    requiresApproval: true
  },
  {
    name: 'add_dependency',
    description: 'Add a package dependency (supports dev flag)'
  },
  {
    name: 'remove_dependency',
    description: 'Remove a package dependency (supports dev flag)'
  },
  {
    name: 'semantic_search',
    description: 'Search workspace text semantically with gitignore awareness'
  },
  {
    name: 'custom_command',
    description: 'Define and execute a one-off command (saved for reuse)'
  },
  {
    name: 'run_command',
    description: 'Execute arbitrary shell commands',
    requiresApproval: true,
    approvalMessage: 'Allow the agent to run a shell command?'
  },
  {
    name: 'git_apply_patch',
    description: 'Apply a git patch to the working tree',
    requiresApproval: true
  },
  {
    name: 'git_worktree_remove',
    description: 'Remove a git worktree',
    requiresApproval: true
  },
  {
    name: 'git_worktree_add',
    description: 'Add a git worktree (may modify git state)',
    requiresApproval: true
  }
];

export class ToolManager {
  private readonly definitions = new Map<AgentAction['type'], ToolDefinition>();
  private readonly executor: ToolManagerOptions['executor'];
  private readonly confirmApproval: ToolManagerOptions['confirmApproval'];

  constructor(options: ToolManagerOptions) {
    this.executor = options.executor;
    this.confirmApproval = options.confirmApproval;
    const defs = options.definitions ?? DEFAULT_TOOL_DEFINITIONS;
    for (const def of defs) {
      this.register(def);
    }
  }

  register(definition: ToolDefinition): void {
    this.definitions.set(definition.name, definition);
  }

  listToolNames(): AgentAction['type'][] {
    return Array.from(this.definitions.keys());
  }

  async execute(toolCalls: ToolCallRequest[]): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];
    for (const call of toolCalls) {
      const definition = this.definitions.get(call.tool);
      if (definition?.requiresApproval) {
        const message = definition.approvalMessage ?? `Allow tool ${definition.name}? ${definition.description}`;
        const confirmed = await this.confirmApproval(message);
        if (!confirmed) {
          results.push({
            tool: call.tool,
            success: false,
            output: 'Tool execution skipped by user.'
          });
          continue;
        }
      }

      try {
        const action = this.toAction(call);
        const output = await this.executor(action);
        results.push({
          tool: call.tool,
          success: true,
          output
        });
      } catch (error) {
        results.push({
          tool: call.tool,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return results;
  }

  private toAction(call: ToolCallRequest): AgentAction {
    return {
      type: call.tool,
      ...(call.args ?? {})
    } as AgentAction;
  }
}
