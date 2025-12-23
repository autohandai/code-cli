/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import { AgentDefinition } from './AgentRegistry.js';
import type { LLMProvider } from '../../providers/LLMProvider.js';
import { ConversationManager } from '../conversationManager.js';
import { ToolManager, DEFAULT_TOOL_DEFINITIONS, type ToolDefinition } from '../toolManager.js';
import { ToolFilter } from '../toolFilter.js';
import { ActionExecutor } from '../actionExecutor.js';
import { AgentDelegator, type DelegatorOptions } from './AgentDelegator.js';
import type { AssistantReactPayload, ClientContext, FunctionDefinition, LLMResponse } from '../../types.js';

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

export class SubAgent {
    private conversation: ConversationManager;
    private toolManager: ToolManager;
    private delegator: AgentDelegator | null = null;
    private name: string;
    private options: SubAgentOptions;

    constructor(
        private readonly config: AgentDefinition,
        private readonly llm: LLMProvider,
        private readonly actionExecutor: ActionExecutor,
        options: SubAgentOptions
    ) {
        this.name = config.name;
        this.options = options;

        // Determine if this sub-agent can delegate further
        const canDelegate = options.depth < options.maxDepth;

        // Build tool definitions:
        // 1. Start with tools allowed by config
        // 2. Apply context filtering
        // 3. Add delegation tools if depth allows
        const allowedTools = new Set(config.tools);
        let definitions = DEFAULT_TOOL_DEFINITIONS.filter(def => allowedTools.has(def.name));

        // Add delegation tools if sub-agent can delegate further
        if (canDelegate) {
            definitions = [...definitions, ...DELEGATION_TOOL_DEFINITIONS];
        }

        // Apply context filter (slack, api, restricted modes)
        const toolFilter = new ToolFilter(options.clientContext);
        definitions = toolFilter.filterDefinitions(definitions);

        // Create delegator if sub-agent can delegate
        if (canDelegate) {
            this.delegator = new AgentDelegator(llm, actionExecutor, {
                clientContext: options.clientContext,
                currentDepth: options.depth,
                maxDepth: options.maxDepth
            });
        }

        this.toolManager = new ToolManager({
            executor: async (action, context) => {
                // Handle delegation actions
                if (action.type === 'delegate_task' && this.delegator) {
                    return this.delegator.delegateTask(
                        (action as any).agent_name,
                        (action as any).task
                    );
                }
                if (action.type === 'delegate_parallel' && this.delegator) {
                    return this.delegator.delegateParallel((action as any).tasks);
                }
                return this.actionExecutor.execute(action, context);
            },
            confirmApproval: async () => true, // Sub-agents auto-approve (inherit from main agent in future)
            definitions,
            clientContext: options.clientContext
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

        return [
            basePrompt,
            '',
            '## Available Tools',
            'You have access to the following tools. Use them when needed:',
            '',
            toolSignatures,
            '',
            '## Response Format',
            'Always respond with structured JSON:',
            '```json',
            '{',
            '  "thought": "Your reasoning about what to do next",',
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

        const maxIterations = 10;
        for (let i = 0; i < maxIterations; i++) {
            const completion = await this.llm.complete({
                messages: this.conversation.history(),
                model: this.config.model,
                temperature: 0.2,
                tools: tools.length > 0 ? tools : undefined,
                toolChoice: tools.length > 0 ? 'auto' : undefined
            });

            // Prefer native tool calls if available
            const payload = this.parseResponse(completion);

            // Add assistant message to conversation
            if (completion.toolCalls?.length) {
                // For native tool calls, add the raw response
                this.conversation.addMessage({
                    role: 'assistant',
                    content: completion.content || ''
                });
            } else {
                this.conversation.addMessage({ role: 'assistant', content: completion.content });
            }

            if (payload.thought) {
                console.log(chalk.gray(`[${this.name}] ${payload.thought}`));
            }

            if (payload.toolCalls && payload.toolCalls.length > 0) {
                // Execute tools
                const results = await this.toolManager.execute(payload.toolCalls);

                for (let j = 0; j < results.length; j++) {
                    const result = results[j];
                    const toolCall = completion.toolCalls?.[j];
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
                continue;
            }

            // No tools, return final response
            const response = payload.finalResponse ?? payload.response ?? completion.content;
            console.log(chalk.cyan(`[${this.name}] Finished.`));
            return response;
        }

        return `[${this.name}] Failed to complete task within ${maxIterations} iterations.`;
    }

    /**
     * Parse LLM response, preferring native tool calls over JSON parsing
     */
    private parseResponse(completion: LLMResponse): AssistantReactPayload {
        // If we have native tool calls, use them
        if (completion.toolCalls && completion.toolCalls.length > 0) {
            return {
                thought: completion.content || undefined,
                toolCalls: completion.toolCalls.map(tc => ({
                    tool: tc.function.name as any,
                    args: this.safeParseJson(tc.function.arguments)
                }))
            };
        }

        // Fall back to parsing JSON from content
        return this.parsePayload(completion.content);
    }

    /**
     * Safely parse JSON, returning empty object on failure
     */
    private safeParseJson(json: string): Record<string, any> {
        try {
            return JSON.parse(json);
        } catch {
            return {};
        }
    }

    private parsePayload(raw: string): AssistantReactPayload {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return { finalResponse: raw.trim() };
        }
        try {
            const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

            // Check if this looks like our expected structured format
            const hasExpectedFields =
                'thought' in parsed ||
                'toolCalls' in parsed ||
                'finalResponse' in parsed ||
                'response' in parsed;

            if (hasExpectedFields) {
                return {
                    thought: typeof parsed.thought === 'string' ? parsed.thought : undefined,
                    toolCalls: Array.isArray(parsed.toolCalls) ? parsed.toolCalls : undefined,
                    finalResponse:
                        (typeof parsed.finalResponse === 'string' ? parsed.finalResponse : undefined) ??
                        (typeof parsed.response === 'string' ? parsed.response : undefined),
                    response: typeof parsed.response === 'string' ? parsed.response : undefined
                };
            }

            // Handle non-standard JSON formats from various models
            const contentValue = this.extractContentFromJson(parsed);
            if (contentValue) {
                return { finalResponse: contentValue };
            }

            return { finalResponse: raw.trim() };
        } catch {
            return { finalResponse: raw.trim() };
        }
    }

    /**
     * Extracts content from non-standard JSON response formats.
     */
    private extractContentFromJson(parsed: Record<string, unknown>): string | undefined {
        const contentFields = ['content', 'text', 'message', 'answer', 'output', 'result', 'reply'];

        for (const field of contentFields) {
            const value = parsed[field];
            if (typeof value === 'string' && value.trim()) {
                return value.trim();
            }
        }

        // Check for nested message structures
        if (parsed.message && typeof parsed.message === 'object') {
            const msg = parsed.message as Record<string, unknown>;
            if (typeof msg.content === 'string' && msg.content.trim()) {
                return msg.content.trim();
            }
        }

        return undefined;
    }
}
