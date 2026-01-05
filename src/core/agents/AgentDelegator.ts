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

/** Context passed to the subagent-stop hook callback */
export interface SubagentStopContext {
    /** Unique identifier for the subagent run */
    subagentId: string;
    /** Name of the agent that ran */
    subagentName: string;
    /** Type of agent (from registry) */
    subagentType: string;
    /** Whether the subagent completed successfully */
    success: boolean;
    /** Error message if failed */
    error?: string;
    /** Duration in milliseconds */
    duration: number;
}

export interface DelegatorOptions {
    /** Client context for tool filtering (inherited by sub-agents) */
    clientContext?: ClientContext;
    /** Current depth in the delegation hierarchy */
    currentDepth?: number;
    /** Maximum delegation depth (default: 3) */
    maxDepth?: number;
    /** Callback fired when a subagent completes */
    onSubagentStop?: (context: SubagentStopContext) => Promise<void>;
}

export class AgentDelegator {
    private registry: AgentRegistry;
    private readonly clientContext: ClientContext;
    private readonly currentDepth: number;
    private readonly maxDepth: number;
    private readonly onSubagentStop?: (context: SubagentStopContext) => Promise<void>;
    private subagentCounter = 0;

    constructor(
        private readonly llm: LLMProvider,
        private readonly actionExecutor: ActionExecutor,
        options: DelegatorOptions = {}
    ) {
        this.registry = AgentRegistry.getInstance();
        this.clientContext = options.clientContext ?? 'cli';
        this.currentDepth = options.currentDepth ?? 0;
        this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
        this.onSubagentStop = options.onSubagentStop;
    }

    private generateSubagentId(): string {
        return `subagent-${Date.now()}-${++this.subagentCounter}`;
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

        const subagentId = this.generateSubagentId();
        const startTime = Date.now();
        const agent = new SubAgent(agentConfig, this.llm, this.actionExecutor, subAgentOptions);

        try {
            const result = await agent.run(task);

            // Fire subagent-stop hook on success
            if (this.onSubagentStop) {
                await this.onSubagentStop({
                    subagentId,
                    subagentName: agentName,
                    subagentType: agentConfig.source ?? 'user',
                    success: true,
                    duration: Date.now() - startTime
                });
            }

            return result;
        } catch (error) {
            const errorMessage = (error as Error).message;

            // Fire subagent-stop hook on failure
            if (this.onSubagentStop) {
                await this.onSubagentStop({
                    subagentId,
                    subagentName: agentName,
                    subagentType: agentConfig.source ?? 'user',
                    success: false,
                    error: errorMessage,
                    duration: Date.now() - startTime
                });
            }

            return `Error running agent '${agentName}': ${errorMessage}`;
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

            const subagentId = this.generateSubagentId();
            const startTime = Date.now();
            const agent = new SubAgent(agentConfig, this.llm, this.actionExecutor, subAgentOptions);

            try {
                const result = await agent.run(task);

                // Fire subagent-stop hook on success
                if (this.onSubagentStop) {
                    await this.onSubagentStop({
                        subagentId,
                        subagentName: agent_name,
                        subagentType: agentConfig.source ?? 'user',
                        success: true,
                        duration: Date.now() - startTime
                    });
                }

                return `[${agent_name}] Result:\n${result}`;
            } catch (error) {
                const errorMessage = (error as Error).message;

                // Fire subagent-stop hook on failure
                if (this.onSubagentStop) {
                    await this.onSubagentStop({
                        subagentId,
                        subagentName: agent_name,
                        subagentType: agentConfig.source ?? 'user',
                        success: false,
                        error: errorMessage,
                        duration: Date.now() - startTime
                    });
                }

                return `[${agent_name}] Failed: ${errorMessage}`;
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
