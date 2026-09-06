/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import { randomUUID } from 'node:crypto';
import { AgentRegistry, type AgentDefinition } from './AgentRegistry.js';
import { SubAgent, type SubAgentOptions, type SubAgentProgress } from './SubAgent.js';
import type { LLMProvider } from '../../providers/LLMProvider.js';
import { ActionExecutor } from '../actionExecutor.js';
import type { ClientContext, LLMUsage, LoadedConfig, ToolActionOutcome } from '../../types.js';
import type { ToolAuthorizationOptions, ToolDefinition, ToolManagerOptions } from '../toolManager.js';
import type { TeamModelAssignment } from '../teams/TeamModelPolicy.js';
import { getSessionThreadBudget, SessionThreadLimitError, type ThreadBudget, type ThreadLease } from './SessionThreadBudget.js';

/** Default maximum delegation depth to prevent infinite loops */
const DEFAULT_MAX_DEPTH = 3;

export type SubagentAssignmentResolver = (definition: AgentDefinition) => TeamModelAssignment;
export type SubagentProviderFactory = (assignment: TeamModelAssignment) => LLMProvider;

export interface DelegationExecutionOptions {
    signal?: AbortSignal;
}

type ParallelDelegationResult =
    | { success: true; text: string }
    | {
        success: false;
        kind: 'validation' | 'operational' | 'aborted';
        text: string;
        error: string;
    };

/** Context published when a subagent begins execution. */
export interface SubagentStartContext {
    cancel?: () => void;
    parentId?: string;
    depth?: number;
    /** Unique identifier for the subagent run */
    subagentId: string;
    /** Name of the agent that ran */
    subagentName: string;
    /** Type of agent (from registry) */
    subagentType: string;
    /** Delegated task text */
    task: string;
    workspaceRoot?: string;
    userRequest?: string;
    /** Provider selected for this execution when an explicit assignment was resolved. */
    provider?: string;
    /** Model selected for this execution when an explicit assignment was resolved. */
    model?: string;
    /** Why the provider/model pair was selected. */
    modelSource?: TeamModelAssignment['source'];
}

/** Context passed to the subagent-stop hook callback */
export interface SubagentStopContext extends SubagentStartContext {
    result?: string;
    usage?: LLMUsage;
    /** Whether the subagent completed successfully */
    success: boolean;
    /** Error message if failed */
    error?: string;
    /** Duration in milliseconds */
    duration: number;
    status?: 'completed' | 'failed' | 'cancelled';
}

export interface SubagentProgressContext extends SubagentStartContext, SubAgentProgress {}

export interface DelegatorOptions {
    workspaceRoot?: string;
    getWorkspaceRoot?: () => string;
    getUserRequest?: () => string | undefined;
    allowedToolNames?: ReadonlySet<string>;
    threadBudget?: ThreadBudget;
    parentId?: string;
    onSubagentProgress?: (context: SubagentProgressContext) => void | Promise<void>;
    /** Client context for tool filtering (inherited by sub-agents) */
    clientContext?: ClientContext;
    /** Current depth in the delegation hierarchy */
    currentDepth?: number;
    /** Maximum delegation depth (default: 3) */
    maxDepth?: number;
    /** Callback fired when a subagent completes */
    onSubagentStop?: (context: SubagentStopContext) => Promise<void>;
    /** Callback fired immediately before a subagent begins execution. */
    onSubagentStart?: (context: SubagentStartContext) => Promise<void>;
    /** Active CLI config for feature-gated tools inherited by sub-agents. */
    featureConfig?: LoadedConfig;
    /** Parent authorization policy and hook bridge inherited by every nested tool call. */
    authorization?: ToolAuthorizationOptions;
    /** Parent confirmation seam inherited by every nested tool call. */
    confirmApproval?: ToolManagerOptions['confirmApproval'];
    /** Resolve the current runtime tool set for extension-aware agent allowlists. */
    getToolDefinitions?: () => ToolDefinition[];
    /** Resolve the provider/model pair for one in-process sub-agent. */
    resolveSubagentAssignment?: SubagentAssignmentResolver;
    /** Create an isolated LLM client for a resolved sub-agent assignment. */
    createSubagentProvider?: SubagentProviderFactory;
}

export class AgentDelegator {
    private registry: AgentRegistry;
    private readonly clientContext: ClientContext;
    private readonly currentDepth: number;
    private readonly maxDepth: number;
    private readonly onSubagentStop?: (context: SubagentStopContext) => Promise<void>;
    private readonly onSubagentStart?: (context: SubagentStartContext) => Promise<void>;
    private readonly featureConfig?: LoadedConfig;
    private readonly authorization?: ToolAuthorizationOptions;
    private readonly confirmApproval?: ToolManagerOptions['confirmApproval'];
    private readonly getToolDefinitions?: () => ToolDefinition[];
    private readonly resolveSubagentAssignment?: SubagentAssignmentResolver;
    private readonly createSubagentProvider?: SubagentProviderFactory;
    private readonly threadBudget: ThreadBudget;

    constructor(
        private readonly llm: LLMProvider,
        private readonly actionExecutor: ActionExecutor,
        private readonly options: DelegatorOptions = {}
    ) {
        this.registry = AgentRegistry.getInstance();
        this.clientContext = options.clientContext ?? 'cli';
        this.currentDepth = options.currentDepth ?? 0;
        this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
        this.onSubagentStop = options.onSubagentStop;
        this.onSubagentStart = options.onSubagentStart;
        this.featureConfig = options.featureConfig;
        this.authorization = options.authorization;
        this.confirmApproval = options.confirmApproval;
        this.getToolDefinitions = options.getToolDefinitions;
        this.resolveSubagentAssignment = options.resolveSubagentAssignment;
        this.createSubagentProvider = options.createSubagentProvider;
        this.threadBudget = options.threadBudget ?? getSessionThreadBudget(options.featureConfig);
    }

    private generateSubagentId(): string {
        return `subagent-${randomUUID()}`;
    }

    public async delegateTask(agentName: string, task: string): Promise<string> {
        return this.toLegacyOutput(await this.delegateTaskForTool(agentName, task));
    }

    public async delegateTaskForTool(
        agentName: string, task: string, options: DelegationExecutionOptions = {},
    ): Promise<ToolActionOutcome> {
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

        return this.runRegisteredTask(agentConfig, agentName, task, options);
    }

    private async runRegisteredTask(
        agentConfig: AgentDefinition, agentName: string, task: string,
        options: DelegationExecutionOptions,
    ): Promise<ToolActionOutcome> {
        const workspaceRoot = this.options.getWorkspaceRoot?.() ?? this.options.workspaceRoot;
        const userRequest = this.options.getUserRequest?.();
        const subAgentOptions: SubAgentOptions = {
            workspaceRoot,
            userRequest,
            allowedToolNames: this.options.allowedToolNames,
            clientContext: this.clientContext,
            depth: this.currentDepth + 1,
            maxDepth: this.maxDepth,
            featureConfig: this.featureConfig,
            authorization: this.authorization,
            confirmApproval: this.confirmApproval,
            getToolDefinitions: this.getToolDefinitions,
            resolveSubagentAssignment: this.resolveSubagentAssignment,
            createSubagentProvider: this.createSubagentProvider,
            threadBudget: this.threadBudget,
            onSubagentStart: this.onSubagentStart,
            onSubagentStop: this.onSubagentStop,
            onSubagentProgress: this.options.onSubagentProgress,
        };

        const subagentId = this.generateSubagentId();
        const controller = new AbortController();
        const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
        const startTime = Date.now();
        let lease: ThreadLease | undefined;
        let started = false;
        let agent: SubAgent | undefined;
        let startContext: SubagentStartContext = {
            subagentId,
            subagentName: agentName,
            subagentType: agentConfig.source ?? 'user',
            task,
            workspaceRoot,
            userRequest,
            parentId: this.options.parentId,
            depth: this.currentDepth + 1,
            cancel: () => controller.abort(),
        };
        try {
            signal.throwIfAborted();
            lease = await this.threadBudget.tryAcquire(subagentId);
            signal.throwIfAborted();
            const assignment = this.resolveSubagentAssignment?.(agentConfig);
            if (assignment) {
                startContext = { ...startContext, provider: assignment.provider, model: assignment.model, modelSource: assignment.source };
            }
            started = true;
            await this.notifyObserver(this.onSubagentStart, startContext);
            agent = new SubAgent(
                agentConfig,
                assignment && this.createSubagentProvider ? this.createSubagentProvider(assignment) : this.llm,
                this.actionExecutor,
                {
                    ...subAgentOptions, parentId: subagentId,
                    ...(assignment ? { model: assignment.model } : {}),
                    onProgress: progress => this.notifyObserver(this.options.onSubagentProgress, { ...startContext, ...progress }),
                },
            );
            const result = await agent.run(task, { signal });

            // Fire subagent-stop hook on success
            if (started && this.onSubagentStop) {
                await this.notifyObserver(this.onSubagentStop, {
                    ...startContext,
                    success: true,
                    status: 'completed',
                    result,
                    usage: agent.getUsage(),
                    duration: Date.now() - startTime
                });
            }

            return { success: true, output: result };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const cancelled = signal.aborted
                || (error instanceof Error && error.name === 'AbortError');

            // Fire subagent-stop hook on failure
            if (started && this.onSubagentStop) {
                await this.notifyObserver(this.onSubagentStop, {
                    ...startContext,
                    success: false,
                    status: cancelled ? 'cancelled' : 'failed',
                    usage: agent?.getUsage(),
                    error: errorMessage,
                    duration: Date.now() - startTime
                });
            }

            const output = `Error running agent '${agentName}': ${errorMessage}`;
            return {
                success: false,
                kind: cancelled ? 'aborted' : error instanceof SessionThreadLimitError ? 'validation' : 'operational',
                error: errorMessage, output,
            };
        } finally {
            await lease?.release();
        }
    }

    public async delegateParallel(tasks: Array<{ agent_name: string; task: string }>): Promise<string> {
        return this.toLegacyOutput(await this.delegateParallelForTool(tasks));
    }

    public async delegateParallelForTool(
        tasks: Array<{ agent_name: string; task: string }>,
        options: DelegationExecutionOptions = {},
    ): Promise<ToolActionOutcome> {
        // Check depth limit
        if (this.currentDepth >= this.maxDepth) {
            const error = `Maximum delegation depth (${this.maxDepth}) reached. Cannot delegate parallel tasks.`;
            return { success: false, kind: 'validation', error, output: `Error: ${error}` };
        }

        await this.registry.loadAgents();

        const promises = tasks.map(async ({ agent_name, task }): Promise<ParallelDelegationResult> => {
            const agentConfig = this.registry.getAgent(agent_name);
            if (!agentConfig) {
                const error = `Agent '${agent_name}' not found.`;
                return {
                    success: false,
                    kind: 'validation',
                    text: `[${agent_name}] Error: Agent not found.`,
                    error,
                };
            }

            const result = await this.runRegisteredTask(agentConfig, agent_name, task, options);
            return result.success
                ? { success: true, text: `[${agent_name}] Result:\n${result.output ?? ''}` }
                : {
                    success: false,
                    kind: result.kind === 'aborted' || result.kind === 'validation' ? result.kind : 'operational',
                    text: `[${agent_name}] Failed: ${result.error}`,
                    error: result.error,
                };
        });

        const results = await Promise.all(promises);
        const output = results.map(result => result.text)
            .join('\n\n' + chalk.gray('─'.repeat(40)) + '\n\n');
        const failures = results.filter(result => !result.success);
        if (failures.length > 0) {
            return {
                success: false,
                kind: failures.some(result => result.kind === 'aborted') ? 'aborted'
                    : failures.some(result => result.kind === 'operational') ? 'operational' : 'validation',
                error: failures.map(result => result.error ?? 'Delegated task failed.').join('; '),
                output,
            };
        }
        return { success: true, output };
    }

    private toLegacyOutput(outcome: ToolActionOutcome): string {
        return outcome.output ?? (outcome.success ? '' : outcome.error);
    }

    private async notifyObserver<T>(observer: ((context: T) => void | Promise<void>) | undefined, context: T): Promise<void> {
        try {
            await observer?.(context);
        } catch {
            // Observability failures must not change execution outcomes or abandon sibling work.
        }
    }

    public getAuthorizationOptions(): ToolAuthorizationOptions | undefined {
        return this.authorization;
    }

    public getConfirmApproval(): ToolManagerOptions['confirmApproval'] | undefined {
        return this.confirmApproval;
    }

    public getRuntimeToolDefinitions(): (() => ToolDefinition[]) | undefined {
        return this.getToolDefinitions;
    }

    public getSubagentAssignmentResolver(): SubagentAssignmentResolver | undefined {
        return this.resolveSubagentAssignment;
    }

    public getSubagentProviderFactory(): SubagentProviderFactory | undefined {
        return this.createSubagentProvider;
    }

    public withProvider(provider: LLMProvider): AgentDelegator {
        return new AgentDelegator(provider, this.actionExecutor, { ...this.options, threadBudget: this.threadBudget });
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
