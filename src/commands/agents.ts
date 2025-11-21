/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import { AgentRegistry } from '../core/agents/AgentRegistry.js';

export const metadata = {
    command: '/agents',
    description: 'list available sub-agents (markdown or json)',
    implemented: true,
    prd: 'prd/sub_agents_architecture.md'
};

export async function handler(): Promise<string> {
    const registry = AgentRegistry.getInstance();
    await registry.loadAgents();
    const agents = registry.getAllAgents();

    if (agents.length === 0) {
        return `No agents found in ${chalk.cyan(registry.getAgentsDirectory())}.\nCreate a markdown file (e.g., helper.md) there to define a new sub-agent.`;
    }

    let output = chalk.bold('Available Agents:\n\n');

    for (const agent of agents) {
        output += `${chalk.green('🤖 ' + agent.name)}\n`;
        output += `  ${chalk.gray(agent.description)}\n`;
        output += `  ${chalk.blue('Path:')} ${agent.path}\n`;
        if (agent.model) {
            output += `  ${chalk.yellow('Model:')} ${agent.model}\n`;
        }
        if (agent.tools?.length) {
            output += `  ${chalk.blue('Tools:')} ${agent.tools.join(', ')}\n`;
        }
        output += '\n';
    }

    return output.trim();
}
