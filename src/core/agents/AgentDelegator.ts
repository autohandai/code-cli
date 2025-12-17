/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import { AgentRegistry } from './AgentRegistry.js';
import { SubAgent, type SubAgentOptions } from './SubAgent.js';
import type { LLMProvider } from '../../providers/LLMProvider.js';
import { ActionExecutor } from '../actionExecutor.js';
import type { ClientContext } from '../../types.js';

/** Default maximum delegation depth to prevent infinite loops */
const DEFAULT_MAX_DEPTH = 3;

export interface DelegatorOptions {
    /** Client context for tool filtering (inherited by sub-agents) */
    clientContext?: ClientContext;
    /** Current depth in the delegation hierarchy */
    currentDepth?: number;
    /** Maximum delegation depth (default: 3) */
    maxDepth?: number;
}

export class AgentDelegator {
    private registry: AgentRegistry;
    private readonly clientContext: ClientContext;
    private readonly currentDepth: number;
    private readonly maxDepth: number;

    constructor(
        private readonly llm: LLMProvider,
        private readonly actionExecutor: ActionExecutor,
        options: DelegatorOptions = {}
    ) {
        this.registry = AgentRegistry.getInstance();
        this.clientContext = options.clientContext ?? 'cli';
        this.currentDepth = options.currentDepth ?? 0;
        this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    }

    public async delegateTask(agentName: string, task: string): Promise<string> {
        // Check depth limit to prevent infinite delegation loops
        if (this.currentDepth >= this.maxDepth) {
            return `Error: Maximum delegation depth (${this.maxDepth}) reached. Cannot delegate to '${agentName}'.`;
        }

        await this.registry.loadAgents();
        const agentConfig = this.registry.getAgent(agentName);

        if (!agentConfig) {
            return `Error: Agent '${agentName}' not found. Use /agents to list available agents.`;
        }

        // Create sub-agent options with inherited context and incremented depth
        const subAgentOptions: SubAgentOptions = {
            clientContext: this.clientContext,
            depth: this.currentDepth + 1,
            maxDepth: this.maxDepth
        };

        const agent = new SubAgent(agentConfig, this.llm, this.actionExecutor, subAgentOptions);
        try {
            return await agent.run(task);
        } catch (error) {
            return `Error running agent '${agentName}': ${(error as Error).message}`;
        }
    }

    public async delegateParallel(tasks: Array<{ agent_name: string; task: string }>): Promise<string> {
        // Check depth limit
        if (this.currentDepth >= this.maxDepth) {
            return `Error: Maximum delegation depth (${this.maxDepth}) reached. Cannot delegate parallel tasks.`;
        }

        if (tasks.length > 5) {
            return `Error: Maximum 5 parallel agents allowed. You requested ${tasks.length}.`;
        }

        await this.registry.loadAgents();

        // Sub-agent options with inherited context
        const subAgentOptions: SubAgentOptions = {
            clientContext: this.clientContext,
            depth: this.currentDepth + 1,
            maxDepth: this.maxDepth
        };

        const promises = tasks.map(async ({ agent_name, task }) => {
            const agentConfig = this.registry.getAgent(agent_name);
            if (!agentConfig) {
                return `[${agent_name}] Error: Agent not found.`;
            }

            const agent = new SubAgent(agentConfig, this.llm, this.actionExecutor, subAgentOptions);
            try {
                const result = await agent.run(task);
                return `[${agent_name}] Result:\n${result}`;
            } catch (error) {
                return `[${agent_name}] Failed: ${(error as Error).message}`;
            }
        });

        const results = await Promise.all(promises);
        return results.join('\n\n' + chalk.gray('─'.repeat(40)) + '\n\n');
    }

    /**
     * Get the current delegation depth
     */
    getDepth(): number {
        return this.currentDepth;
    }

    /**
     * Check if further delegation is allowed
     */
    canDelegate(): boolean {
        return this.currentDepth < this.maxDepth;
    }
}
