/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { z } from 'zod';
import { AUTOHAND_PATHS } from '../../constants.js';

// Schema for Agent Configuration
export const AgentConfigSchema = z.object({
    description: z.string(),
    systemPrompt: z.string(),
    tools: z.array(z.string()),
    model: z.string().optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

/** Source of an agent definition */
export type AgentSource = 'builtin' | 'user' | 'external';

export interface AgentDefinition extends AgentConfig {
    name: string; // Derived from filename
    path: string;
    /** Where this agent was loaded from */
    source: AgentSource;
}

export class AgentRegistry {
    private static instance: AgentRegistry;
    private agents: Map<string, AgentDefinition> = new Map();
    private agentsDir: string;
    private externalPaths: string[] = [];

    private constructor() {
        this.agentsDir = AUTOHAND_PATHS.agents;
    }

    public static getInstance(): AgentRegistry {
        if (!AgentRegistry.instance) {
            AgentRegistry.instance = new AgentRegistry();
        }
        return AgentRegistry.instance;
    }

    /**
     * Set external agent paths from config
     * Supports tilde (~) expansion for home directory
     */
    public setExternalPaths(paths: string[]): void {
        this.externalPaths = paths.map(p =>
            p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p
        );
    }

    /**
     * Get configured external paths
     */
    public getExternalPaths(): string[] {
        return [...this.externalPaths];
    }

    /**
     * Scans the agents directory and all external paths for agent configurations.
     */
    public async loadAgents(): Promise<void> {
        this.agents.clear();

        // Load from main autohand agents directory
        await this.loadAgentsFromDir(this.agentsDir, 'user');

        // Load from external paths
        for (const extPath of this.externalPaths) {
            await this.loadAgentsFromDir(extPath, 'external');
        }
    }

    /**
     * Load agents from a specific directory
     */
    private async loadAgentsFromDir(dir: string, source: AgentSource): Promise<void> {
        try {
            // Only create the main agents dir, not external ones
            if (source === 'user') {
                await fs.mkdir(dir, { recursive: true });
            }

            const exists = await fs.access(dir).then(() => true).catch(() => false);
            if (!exists) {
                return;
            }

            const files = await fs.readdir(dir);

            for (const file of files) {
                const filePath = path.join(dir, file);

                // Check if it's a file, not a directory
                const stat = await fs.stat(filePath).catch(() => null);
                if (!stat?.isFile()) {
                    continue;
                }

                if (file.endsWith('.json')) {
                    await this.loadJsonAgent(filePath, source);
                    continue;
                }
                if (file.endsWith('.md') || file.endsWith('.markdown')) {
                    await this.loadMarkdownAgent(filePath, source);
                }
            }
        } catch (error) {
            // Only warn for main directory errors, not missing external paths
            if (source === 'user') {
                console.error(`Error loading agents from ${dir}:`, error);
            }
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

    /**
     * Get agents filtered by source
     */
    public getAgentsBySource(source: AgentSource): AgentDefinition[] {
        return this.getAllAgents().filter(a => a.source === source);
    }

    private async loadJsonAgent(filePath: string, source: AgentSource): Promise<void> {
        const name = path.basename(filePath, '.json');
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const json = JSON.parse(content);
            const config = AgentConfigSchema.parse(json);
            // Don't overwrite existing agents (first loaded wins)
            if (!this.agents.has(name)) {
                this.agents.set(name, { name, path: filePath, source, ...config });
            }
        } catch (error) {
            console.warn(`Failed to load agent '${name}': ${(error as Error).message}`);
        }
    }

    private async loadMarkdownAgent(filePath: string, source: AgentSource): Promise<void> {
        const name = path.basename(filePath, path.extname(filePath));
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const description = extractMarkdownTitle(content) || `Agent ${name}`;
            const definition: AgentDefinition = {
                name,
                path: filePath,
                source,
                description,
                systemPrompt: content,
                tools: [],
                model: undefined
            };
            // Don't overwrite existing agents (first loaded wins)
            if (!this.agents.has(name)) {
                this.agents.set(name, definition);
            }
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
