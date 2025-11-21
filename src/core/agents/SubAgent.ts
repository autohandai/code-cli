/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import { AgentDefinition } from './AgentRegistry.js';
import { OpenRouterClient } from '../../openrouter.js';
import { ConversationManager } from '../conversationManager.js';
import { ToolManager, DEFAULT_TOOL_DEFINITIONS } from '../toolManager.js';
import { ActionExecutor } from '../actionExecutor.js';
import { AssistantReactPayload, ToolCallRequest, LLMMessage } from '../../types.js';

export class SubAgent {
    private conversation: ConversationManager;
    private toolManager: ToolManager;
    private name: string;

    constructor(
        private readonly config: AgentDefinition,
        private readonly llm: OpenRouterClient,
        private readonly actionExecutor: ActionExecutor
    ) {
        this.name = config.name;
        this.conversation = new ConversationManager();
        this.conversation.reset(config.systemPrompt);

        // Initialize ToolManager with only allowed tools
        const allowedTools = new Set(config.tools);
        const definitions = DEFAULT_TOOL_DEFINITIONS.filter(def => allowedTools.has(def.name));

        this.toolManager = new ToolManager({
            executor: (action) => this.actionExecutor.execute(action),
            confirmApproval: async () => true, // Sub-agents auto-approve for now (or inherit policy?)
            definitions
        });
    }

    public async run(task: string): Promise<string> {
        console.log(chalk.cyan(`\n🤖 Sub-agent '${this.name}' starting task...`));

        this.conversation.addMessage({ role: 'user', content: task });

        const maxIterations = 10;
        for (let i = 0; i < maxIterations; i++) {
            const completion = await this.llm.complete({
                messages: this.conversation.history(),
                model: this.config.model, // Use agent-specific model if defined
                temperature: 0.2
            });

            const payload = this.parsePayload(completion.content);
            this.conversation.addMessage({ role: 'assistant', content: completion.content });

            if (payload.thought) {
                console.log(chalk.gray(`[${this.name}] ${payload.thought}`));
            }

            if (payload.toolCalls && payload.toolCalls.length > 0) {
                // Execute tools
                const results = await this.toolManager.execute(payload.toolCalls);

                for (const result of results) {
                    const content = result.success
                        ? result.output ?? '(no output)'
                        : result.error ?? 'Tool failed';

                    this.conversation.addMessage({
                        role: 'tool',
                        name: result.tool,
                        content
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

    private parsePayload(raw: string): AssistantReactPayload {
        // Simplified parsing logic (copied from AutohandAgent)
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return { finalResponse: raw.trim() };
        }
        try {
            const parsed = JSON.parse(jsonMatch[0]);
            return {
                thought: parsed.thought,
                toolCalls: parsed.toolCalls,
                finalResponse: parsed.finalResponse ?? parsed.response,
                response: parsed.response
            };
        } catch {
            return { finalResponse: raw.trim() };
        }
    }
}
