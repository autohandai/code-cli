/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import { AgentDefinition } from './AgentRegistry.js';
import type { LLMProvider } from '../../providers/LLMProvider.js';
import { ConversationManager } from '../conversationManager.js';
import {
    ToolManager,
    DEFAULT_TOOL_DEFINITIONS,
    GOAL_TOOL_DEFINITIONS,
    type ToolAuthorizationOptions,
    type ToolDefinition,
    type ToolManagerOptions,
} from '../toolManager.js';
import { ToolFilter } from '../toolFilter.js';
import { ActionExecutor } from '../actionExecutor.js';
import { AgentDelegator } from './AgentDelegator.js';
import type { ClientContext, LLMMessage, LoadedConfig, ToolCallRequest } from '../../types.js';
import { isGoalFeatureEnabled } from '../../goals/feature.js';
import { ReactionParser } from '../agent/ReactionParser.js';
import {
    resolveAssistantToolCalls,
    ToolLoopGuard,
    ToolReflectionGuard,
} from '../agent/ToolLoopPolicy.js';

/**
 * Options for creating a SubAgent with context inheritance
 */
export interface SubAgentOptions {
    /** Client context for tool filtering */
    clientContext: ClientContext;
    /** Current depth in the delegation hierarchy */
    depth: number;
    /** Maximum delegation depth */
    maxDepth: number;
    /** Max concurrent tool executions (passed from parent agent) */
    maxConcurrency?: number;
    /** Active CLI config for feature-gated tools inherited by sub-agents. */
    featureConfig?: LoadedConfig;
    /** Parent authorization policy and hooks for nested tool calls. */
    authorization?: ToolAuthorizationOptions;
    /** Parent confirmation seam for nested permission prompts. */
    confirmApproval?: ToolManagerOptions['confirmApproval'];
    /** Resolve the current runtime tool set, including extension-owned tools. */
    getToolDefinitions?: () => ToolDefinition[];
}

/** Tool definitions for delegation (added only if sub-agent can delegate further) */
const DELEGATION_TOOL_DEFINITIONS: ToolDefinition[] = [
    {
        name: 'delegate_task',
        description: 'Delegate a task to another specialized sub-agent',
        parameters: {
            type: 'object',
            properties: {
                agent_name: { type: 'string', description: 'Name of the agent to delegate to' },
                task: { type: 'string', description: 'Task description for the sub-agent' }
            },
            required: ['agent_name', 'task']
        }
    },
    {
        name: 'delegate_parallel',
        description: 'Run multiple sub-agents in parallel (max 5)',
        parameters: {
            type: 'object',
            properties: {
                tasks: { type: 'array', description: 'Array of {agent_name, task} objects' }
            },
            required: ['tasks']
        }
    }
];

function uniqueToolDefinitions(definitions: ToolDefinition[]): ToolDefinition[] {
    const names = new Set<string>();
    return definitions.filter((definition) => {
        if (names.has(definition.name)) {
            return false;
        }
        names.add(definition.name);
        return true;
    });
}

export class SubAgent {
    private conversation: ConversationManager;
    private toolManager: ToolManager;
    private delegator: AgentDelegator | null = null;
    private name: string;
    private options: SubAgentOptions;
    private readonly supportsNativeToolCalling: boolean;
    private readonly reactionParser = new ReactionParser();

    constructor(
        private readonly config: AgentDefinition,
        private readonly llm: LLMProvider,
        private readonly actionExecutor: ActionExecutor,
        options: SubAgentOptions
    ) {
        this.name = config.name;
        this.options = options;
        this.supportsNativeToolCalling = this.llm.getCapabilities?.().nativeToolCalling === true;

        // Determine if this sub-agent can delegate further
        const canDelegate = options.depth < options.maxDepth;

        // Build tool definitions:
        // 1. Start with tools allowed by config
        // 2. Apply context filtering
        // 3. Add delegation tools if depth allows
        const allowedTools = new Set(config.tools);
        const baseDefinitions = isGoalFeatureEnabled(options.featureConfig)
            ? [...DEFAULT_TOOL_DEFINITIONS, ...GOAL_TOOL_DEFINITIONS]
            : DEFAULT_TOOL_DEFINITIONS;
        const availableDefinitions = uniqueToolDefinitions([
            ...baseDefinitions,
            ...(options.getToolDefinitions?.() ?? []),
        ]);
        let definitions = allowedTools.has('*')
            ? availableDefinitions
            : availableDefinitions.filter(def => allowedTools.has(def.name));

        // Add delegation tools if sub-agent can delegate further
        if (canDelegate) {
            definitions = uniqueToolDefinitions([...definitions, ...DELEGATION_TOOL_DEFINITIONS]);
        }

        // Apply context filter (slack, api, restricted modes)
        const toolFilter = new ToolFilter(options.clientContext);
        definitions = toolFilter.filterDefinitions(definitions);

        // Create delegator if sub-agent can delegate
        if (canDelegate) {
            this.delegator = new AgentDelegator(llm, actionExecutor, {
                clientContext: options.clientContext,
                currentDepth: options.depth,
                maxDepth: options.maxDepth,
                featureConfig: options.featureConfig,
                authorization: options.authorization,
                confirmApproval: options.confirmApproval,
                getToolDefinitions: options.getToolDefinitions,
            });
        }

        // Scale down concurrency at deeper delegation levels to prevent cascading parallelism
        const scaledConcurrency = options.depth === 0
            ? (options.maxConcurrency ?? 5)
            : options.depth === 1
                ? Math.min(3, options.maxConcurrency ?? 5)
                : 1; // depth 2+ = sequential

        this.toolManager = new ToolManager({
            executor: async (action, context) => {
                // Handle delegation actions
                if (action.type === 'delegate_task' && this.delegator) {
                    return this.delegator.delegateTaskForTool(
                        action.agent_name,
                        action.task
                    );
                }
                if (action.type === 'delegate_parallel' && this.delegator) {
                    return this.delegator.delegateParallelForTool(action.tasks);
                }
                return this.actionExecutor.executeForTool(action, context);
            },
            confirmApproval: options.confirmApproval ?? (async () => false),
            definitions,
            clientContext: options.clientContext,
            maxConcurrency: scaledConcurrency,
            authorization: options.authorization,
        });

        // Build enhanced system prompt with tool signatures
        const enhancedSystemPrompt = this.buildSystemPrompt(config.systemPrompt, definitions);
        this.conversation = new ConversationManager();
        this.conversation.reset(enhancedSystemPrompt);
    }

    /**
     * Build system prompt with tool signatures for the LLM
     */
    private buildSystemPrompt(basePrompt: string, tools: ToolDefinition[]): string {
        const toolSignatures = tools.map(def => this.formatToolSignature(def)).join('\n');

        if (this.supportsNativeToolCalling) {
            return [
                basePrompt,
                '',
                '## Available Tools',
                'Use the native tool interface to call the following tools when needed:',
                '',
                toolSignatures,
                '',
                '### Parallel Tool Calling',
                'Call multiple independent tools together through the native tool interface.',
                '',
                'After receiving tool results, analyze those observations before choosing another tool.',
                'When the task is complete, respond normally with the final answer.',
                '',
                `Depth: ${this.options.depth}/${this.options.maxDepth} ${this.delegator ? '(can delegate further)' : '(max depth reached)'}`
            ].join('\n');
        }

        return [
            basePrompt,
            '',
            '## Available Tools',
            'You have access to the following tools. Use them when needed:',
            '',
            toolSignatures,
            '',
            '### Parallel Tool Calling',
            'When performing multiple independent operations, include all tool calls in a single toolCalls array.',
            'They will execute in parallel for faster results.',
            '',
            '## Response Format',
            'Always respond with structured JSON:',
            '```json',
            '{',
            '  "thought": "Your reasoning about what to do next",',
            '  "reflection": "What the previous tool outputs established before another tool call",',
            '  "toolCalls": [{"tool": "tool_name", "args": {...}}],',
            '  "finalResponse": "Your final answer when done (omit toolCalls if providing this)"',
            '}',
            '```',
            '',
            `Depth: ${this.options.depth}/${this.options.maxDepth} ${this.delegator ? '(can delegate further)' : '(max depth reached)'}`
        ].join('\n');
    }

    /**
     * Format a tool definition as a signature string
     */
    private formatToolSignature(def: ToolDefinition): string {
        const params = def.parameters?.properties
            ? Object.entries(def.parameters.properties)
                .map(([name, prop]) => {
                    const required = def.parameters?.required?.includes(name) ? '' : '?';
                    return `${name}${required}: ${prop.type}`;
                })
                .join(', ')
            : '';

        return `- ${def.name}(${params}): ${def.description}`;
    }

    public async run(task: string): Promise<string> {
        console.log(chalk.cyan(`\n🤖 Sub-agent '${this.name}' starting task... (depth ${this.options.depth}/${this.options.maxDepth})`));

        this.conversation.addMessage({ role: 'user', content: task });

        // Get function definitions for LLM function calling
        const tools = this.toolManager.toFunctionDefinitions();
        const loopGuard = new ToolLoopGuard();
        const reflectionGuard = new ToolReflectionGuard();
        const maxIterations = 10;
        for (let i = 0; i < maxIterations; i++) {
            const requestTools = this.supportsNativeToolCalling
                && !loopGuard.isForcingFinalResponse()
                && tools.length > 0
                ? tools
                : undefined;

            const completion = await this.llm.complete({
                messages: this.conversation.history(),
                model: this.config.model,
                temperature: 0.2,
                tools: requestTools,
                toolChoice: requestTools ? 'auto' : undefined
            });

            // Prefer native tool calls if available
            const payload = this.reactionParser.parseAssistantResponse(completion);

            // Preserve native tool_calls on the assistant turn so Responses API
            // providers (xAI OAuth / Grok 4.5) can continue multi-turn tool use.
            const assistantToolCalls = resolveAssistantToolCalls(
                completion.toolCalls,
                payload.toolCalls,
                this.supportsNativeToolCalling,
            );
            const assistantMessage: LLMMessage = {
                role: 'assistant',
                content: completion.content || '',
            };
            if (assistantToolCalls.length) {
                assistantMessage.tool_calls = assistantToolCalls;
            }
            this.conversation.addMessage(assistantMessage);

            if (payload.thought) {
                console.log(chalk.gray(`[${this.name}] ${payload.thought}`));
            }

            if (payload.toolCalls && payload.toolCalls.length > 0) {
                const reflectionDecision = reflectionGuard.evaluate(payload);
                if (reflectionDecision.type === 'integrity_failure') {
                    loopGuard.forceFinalResponse();
                    this.recordRejectedNativeToolCalls(
                        payload.toolCalls,
                        'Tool call not executed: prior tool-result visibility was reported as unavailable.',
                    );
                    this.conversation.addSystemNote(
                        '[Tool Result Integrity] Prior tool results were reported as unavailable. '
                        + 'The proposed follow-up tools were not executed. '
                        + 'Use the results already in the conversation and provide the final answer.'
                    );
                    continue;
                }

                if (reflectionDecision.type === 'require_reflection') {
                    this.recordRejectedNativeToolCalls(
                        payload.toolCalls,
                        'Tool call not executed: reflection on the previous tool results is required first.',
                    );
                    this.conversation.addSystemNote(
                        '[Reflection Required] Analyze the previous tool results before calling another tool. '
                        + 'Include a reflection explaining what the outputs established and why the next call is needed.'
                    );
                    continue;
                }

                if (reflectionDecision.type === 'force_final') {
                    loopGuard.forceFinalResponse();
                    this.recordRejectedNativeToolCalls(
                        payload.toolCalls,
                        'Tool call not executed: repeated missing reflection forced a final response.',
                    );
                    this.conversation.addSystemNote(
                        '[Critical Reflection Guard] Another tool call was attempted without analyzing prior results. '
                        + 'The call was not executed. Do not call tools again; provide the final answer.'
                    );
                    continue;
                }

                const decision = loopGuard.observeCalls(payload.toolCalls);
                if (decision.type !== 'allow') {
                    this.recordRejectedNativeToolCalls(
                        payload.toolCalls,
                        'Tool call not executed: the loop guard requires a final response.',
                    );
                    this.conversation.addSystemNote(
                        '[Critical Loop Guard] Tool calls and outputs are repeating without progress. '
                        + 'Stop calling tools and provide the final answer using the existing results.'
                    );
                    if (decision.type === 'reject' && decision.exhausted) {
                        return `[${this.name}] Stopped repeated tool calls to prevent a loop and token waste.`;
                    }
                    continue;
                }

                // Execute tools
                const results = await this.toolManager.execute(payload.toolCalls);

                for (let j = 0; j < results.length; j++) {
                    const result = results[j];
                    const toolCall = payload.toolCalls[j];
                    const content = result.success
                        ? result.output ?? '(no output)'
                        : result.error ?? 'Tool failed';

                    this.conversation.addMessage({
                        role: 'tool',
                        name: result.tool,
                        content,
                        tool_call_id: toolCall?.id
                    });

                    if (!result.success) {
                        console.log(chalk.red(`[${this.name}] Tool ${result.tool} failed: ${content}`));
                    }
                }
                if (loopGuard.observeResults(results).forcedFinalResponse) {
                    this.conversation.addSystemNote(
                        '[Critical Loop Guard] Tool calls and outputs are repeating without progress. '
                        + 'Do not call tools again. Provide the final answer using the current results.'
                    );
                }
                reflectionGuard.expectReflection();
                continue;
            }

            // No tools, return final response
            const response = payload.finalResponse ?? payload.response ?? completion.content;
            console.log(chalk.cyan(`[${this.name}] Finished.`));
            return response;
        }

        return `[${this.name}] Failed to complete task within ${maxIterations} iterations.`;
    }

    private recordRejectedNativeToolCalls(calls: ToolCallRequest[], content: string): void {
        if (!this.supportsNativeToolCalling) return;

        for (const call of calls) {
            if (!call.id) continue;
            this.conversation.addMessage({
                role: 'tool',
                name: call.tool,
                content,
                tool_call_id: call.id,
            });
        }
    }
}
