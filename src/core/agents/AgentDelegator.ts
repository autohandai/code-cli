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
import type { ClientContext, LoadedConfig, ToolActionOutcome } from '../../types.js';
import type { ToolAuthorizationOptions, ToolManagerOptions } from '../toolManager.js';

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
    /** Active CLI config for feature-gated tools inherited by sub-agents. */
    featureConfig?: LoadedConfig;
    /** Parent authorization policy and hook bridge inherited by every nested tool call. */
    authorization?: ToolAuthorizationOptions;
    /** Parent confirmation seam inherited by every nested tool call. */
    confirmApproval?: ToolManagerOptions['confirmApproval'];
}

export class AgentDelegator {
    private registry: AgentRegistry;
    private readonly clientContext: ClientContext;
    private readonly currentDepth: number;
    private readonly maxDepth: number;
    private readonly onSubagentStop?: (context: SubagentStopContext) => Promise<void>;
    private readonly featureConfig?: LoadedConfig;
    private readonly authorization?: ToolAuthorizationOptions;
    private readonly confirmApproval?: ToolManagerOptions['confirmApproval'];
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
        this.featureConfig = options.featureConfig;
        this.authorization = options.authorization;
        this.confirmApproval = options.confirmApproval;
    }

    private generateSubagentId(): string {
        return `subagent-${Date.now()}-${++this.subagentCounter}`;
    }

    public async delegateTask(agentName: string, task: string): Promise<string> {
        return this.toLegacyOutput(await this.delegateTaskForTool(agentName, task));
    }

    public async delegateTaskForTool(agentName: string, task: string): Promise<ToolActionOutcome> {
        // Check depth limit to prevent infinite delegation loops
        if (this.currentDepth >= this.maxDepth) {
            const error = `Maximum delegation depth (${this.maxDepth}) reached. Cannot delegate to '${agentName}'.`;
            return { success: false, kind: 'validation', error, output: `Error: ${error}` };
        }

        await this.registry.loadAgents();
        const agentConfig = this.registry.getAgent(agentName);

        if (!agentConfig) {
            const error = `Agent '${agentName}' not found. Use /agents to list available agents.`;
            return { success: false, kind: 'validation', error, output: `Error: ${error}` };
        }

        // Create sub-agent options with inherited context and incremented depth
        const subAgentOptions: SubAgentOptions = {
            clientContext: this.clientContext,
            depth: this.currentDepth + 1,
            maxDepth: this.maxDepth,
            featureConfig: this.featureConfig,
            authorization: this.authorization,
            confirmApproval: this.confirmApproval,
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

            return { success: true, output: result };
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

            const output = `Error running agent '${agentName}': ${errorMessage}`;
            return { success: false, kind: 'operational', error: errorMessage, output };
        }
    }

    public async delegateParallel(tasks: Array<{ agent_name: string; task: string }>): Promise<string> {
        return this.toLegacyOutput(await this.delegateParallelForTool(tasks));
    }

    public async delegateParallelForTool(
        tasks: Array<{ agent_name: string; task: string }>
    ): Promise<ToolActionOutcome> {
        // Check depth limit
        if (this.currentDepth >= this.maxDepth) {
            const error = `Maximum delegation depth (${this.maxDepth}) reached. Cannot delegate parallel tasks.`;
            return { success: false, kind: 'validation', error, output: `Error: ${error}` };
        }

        if (tasks.length > 5) {
            const error = `Maximum 5 parallel agents allowed. You requested ${tasks.length}.`;
            return { success: false, kind: 'validation', error, output: `Error: ${error}` };
        }

        await this.registry.loadAgents();

        // Sub-agent options with inherited context
        const subAgentOptions: SubAgentOptions = {
            clientContext: this.clientContext,
            depth: this.currentDepth + 1,
            maxDepth: this.maxDepth,
            featureConfig: this.featureConfig,
            authorization: this.authorization,
            confirmApproval: this.confirmApproval,
        };

        const promises = tasks.map(async ({ agent_name, task }): Promise<{
            success: boolean;
            text: string;
            error?: string;
        }> => {
            const agentConfig = this.registry.getAgent(agent_name);
            if (!agentConfig) {
                const error = `Agent '${agent_name}' not found.`;
                return { success: false, text: `[${agent_name}] Error: Agent not found.`, error };
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

                return { success: true, text: `[${agent_name}] Result:\n${result}` };
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

                return {
                    success: false,
                    text: `[${agent_name}] Failed: ${errorMessage}`,
                    error: errorMessage,
                };
            }
        });

        const results = await Promise.all(promises);
        const output = results.map(result => result.text)
            .join('\n\n' + chalk.gray('─'.repeat(40)) + '\n\n');
        const failures = results.filter(result => !result.success);
        if (failures.length > 0) {
            return {
                success: false,
                kind: 'operational',
                error: failures.map(result => result.error ?? 'Delegated task failed.').join('; '),
                output,
            };
        }
        return { success: true, output };
    }

    private toLegacyOutput(outcome: ToolActionOutcome): string {
        return outcome.output ?? (outcome.success ? '' : outcome.error);
    }

    public getAuthorizationOptions(): ToolAuthorizationOptions | undefined {
        return this.authorization;
    }

    public getConfirmApproval(): ToolManagerOptions['confirmApproval'] | undefined {
        return this.confirmApproval;
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
