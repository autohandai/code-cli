/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { z } from 'zod';

// Schema for Agent Configuration
export const AgentConfigSchema = z.object({
    description: z.string(),
    systemPrompt: z.string(),
    tools: z.array(z.string()),
    model: z.string().optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export interface AgentDefinition extends AgentConfig {
    name: string; // Derived from filename
    path: string;
}

export class AgentRegistry {
    private static instance: AgentRegistry;
    private agents: Map<string, AgentDefinition> = new Map();
    private agentsDir: string;

    private constructor() {
        this.agentsDir = path.join(os.homedir(), '.autohand-cli', 'agents');
    }

    public static getInstance(): AgentRegistry {
        if (!AgentRegistry.instance) {
            AgentRegistry.instance = new AgentRegistry();
        }
        return AgentRegistry.instance;
    }

    /**
     * Scans the agents directory and loads all valid agent configurations.
     */
    public async loadAgents(): Promise<void> {
        this.agents.clear();

        try {
            // Ensure directory exists
            await fs.mkdir(this.agentsDir, { recursive: true });

            const files = await fs.readdir(this.agentsDir);

            for (const file of files) {
                const filePath = path.join(this.agentsDir, file);
                if (file.endsWith('.json')) {
                    await this.loadJsonAgent(filePath);
                    continue;
                }
                if (file.endsWith('.md') || file.endsWith('.markdown')) {
                    await this.loadMarkdownAgent(filePath);
                }
            }
        } catch (error) {
            console.error(`Error loading agents from ${this.agentsDir}:`, error);
        }
    }

    public getAgent(name: string): AgentDefinition | undefined {
        return this.agents.get(name);
    }

    public getAllAgents(): AgentDefinition[] {
        return Array.from(this.agents.values());
    }

    public getAgentsDirectory(): string {
        return this.agentsDir;
    }

    private async loadJsonAgent(filePath: string): Promise<void> {
        const name = path.basename(filePath, '.json');
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const json = JSON.parse(content);
            const config = AgentConfigSchema.parse(json);
            this.agents.set(name, { name, path: filePath, ...config });
        } catch (error) {
            console.warn(`Failed to load agent '${name}': ${(error as Error).message}`);
        }
    }

    private async loadMarkdownAgent(filePath: string): Promise<void> {
        const name = path.basename(filePath, path.extname(filePath));
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const description = extractMarkdownTitle(content) || `Agent ${name}`;
            const definition: AgentDefinition = {
                name,
                path: filePath,
                description,
                systemPrompt: content,
                tools: [],
                model: undefined
            };
            this.agents.set(name, definition);
        } catch (error) {
            console.warn(`Failed to load agent '${name}': ${(error as Error).message}`);
        }
    }
}

function extractMarkdownTitle(content: string): string | null {
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('#')) {
            return trimmed.replace(/^#+\s*/, '').trim() || null;
        }
        return trimmed;
    }
    return null;
}
