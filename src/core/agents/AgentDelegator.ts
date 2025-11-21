/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import { AgentRegistry } from './AgentRegistry.js';
import { SubAgent } from './SubAgent.js';
import { OpenRouterClient } from '../../openrouter.js';
import { ActionExecutor } from '../actionExecutor.js';

export class AgentDelegator {
    private registry: AgentRegistry;

    constructor(
        private readonly llm: OpenRouterClient,
        private readonly actionExecutor: ActionExecutor
    ) {
        this.registry = AgentRegistry.getInstance();
    }

    public async delegateTask(agentName: string, task: string): Promise<string> {
        await this.registry.loadAgents();
        const agentConfig = this.registry.getAgent(agentName);

        if (!agentConfig) {
            return `Error: Agent '${agentName}' not found. Use /agents to list available agents.`;
        }

        const agent = new SubAgent(agentConfig, this.llm, this.actionExecutor);
        try {
            return await agent.run(task);
        } catch (error) {
            return `Error running agent '${agentName}': ${(error as Error).message}`;
        }
    }

    public async delegateParallel(tasks: Array<{ agent_name: string; task: string }>): Promise<string> {
        if (tasks.length > 5) {
            return `Error: Maximum 5 parallel agents allowed. You requested ${tasks.length}.`;
        }

        await this.registry.loadAgents();

        const promises = tasks.map(async ({ agent_name, task }) => {
            const agentConfig = this.registry.getAgent(agent_name);
            if (!agentConfig) {
                return `[${agent_name}] Error: Agent not found.`;
            }

            const agent = new SubAgent(agentConfig, this.llm, this.actionExecutor);
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
}
