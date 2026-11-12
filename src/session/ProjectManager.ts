/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import crypto from 'node:crypto';
import { open } from 'node:fs/promises';
import type {
    ProjectIndex,
    ProjectKnowledge,
    FailureRecord,
    SuccessRecord
} from './types.js';
import { AUTOHAND_PATHS } from '../constants.js';

export class ProjectManager {
    private readonly projectsDir: string;
    private projectCache = new Map<string, ProjectIndex>();

    constructor(baseDir?: string) {
        this.projectsDir = baseDir ?? AUTOHAND_PATHS.projects;
    }

    async initialize(): Promise<void> {
        await fs.ensureDir(this.projectsDir);
    }

    async getOrCreateProject(projectPath: string): Promise<string> {
        const projectHash = this.hashPath(projectPath);
        const projectDir = path.join(this.projectsDir, projectHash);

        if (await fs.pathExists(projectDir)) {
            return projectHash;
        }

        // Create new project
        await fs.ensureDir(projectDir);

        const index: ProjectIndex = {
            projectPath: path.resolve(projectPath),
            projectHash,
            displayName: path.basename(projectPath),
            firstSeen: new Date().toISOString(),
            lastActiveAt: new Date().toISOString(),
            sessionCount: 0,
            techStack: {
                languages: [],
                frameworks: [],
                tools: []
            },
            patterns: {}
        };

        await fs.writeJson(path.join(projectDir, 'index.json'), index, { spaces: 2 });

        // Create empty logs
        await fs.writeFile(path.join(projectDir, 'failures.jsonl'), '');
        await fs.writeFile(path.join(projectDir, 'successes.jsonl'), '');

        // Create initial knowledge
        const knowledge: ProjectKnowledge = {
            updatedAt: new Date().toISOString(),
            summary: '',
            sessionCount: 0,
            antiPatterns: [],
            bestPractices: [],
            techStack: {
                languages: [],
                frameworks: [],
                tools: []
            },
            conventions: {}
        };
        await fs.writeJson(path.join(projectDir, 'knowledge.json'), knowledge, { spaces: 2 });

        this.projectCache.set(projectPath, index);
        return projectHash;
    }

    async recordFailure(projectPath: string, failure: FailureRecord): Promise<void> {
        const projectHash = await this.getOrCreateProject(projectPath);
        const projectDir = path.join(this.projectsDir, projectHash);
        const failuresPath = path.join(projectDir, 'failures.jsonl');

        await this.appendLogRecord(failuresPath, failure);
        await this.updateKnowledge(projectHash);
    }

    async recordSuccess(projectPath: string, success: SuccessRecord): Promise<void> {
        const projectHash = await this.getOrCreateProject(projectPath);
        const projectDir = path.join(this.projectsDir, projectHash);
        const successesPath = path.join(projectDir, 'successes.jsonl');

        await this.appendLogRecord(successesPath, success);
        await this.updateKnowledge(projectHash);
    }

    async getRecentFailures(projectPath: string, lookbackDays = 7): Promise<FailureRecord[]> {
        const projectHash = await this.getOrCreateProject(projectPath);
        const projectDir = path.join(this.projectsDir, projectHash);
        const failuresPath = path.join(projectDir, 'failures.jsonl');

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - lookbackDays);

        return (await this.loadJsonl<FailureRecord>(failuresPath))
            .filter(failure => new Date(failure.timestamp) >= cutoff);
    }

    async getKnowledge(projectPath: string): Promise<ProjectKnowledge | null> {
        const projectHash = await this.getOrCreateProject(projectPath);
        const projectDir = path.join(this.projectsDir, projectHash);
        const knowledgePath = path.join(projectDir, 'knowledge.json');

        if (await fs.pathExists(knowledgePath)) {
            return await fs.readJson(knowledgePath) as ProjectKnowledge;
        }

        return null;
    }

    async isDuplicateFailure(
        projectPath: string,
        toolType: string,
        command: string
    ): Promise<FailureRecord | null> {
        const recentFailures = await this.getRecentFailures(projectPath);

        for (const failure of recentFailures) {
            const similarity = this.calculateSimilarity(
                { tool: toolType, command },
                { tool: failure.tool, command: failure.command || '' }
            );

            if (similarity > 0.85) {
                return failure;
            }
        }

        return null;
    }

    private calculateSimilarity(
        a: { tool: string; command: string },
        b: { tool: string; command: string }
    ): number {
        let score = 0;

        // Same tool type: +0.3
        if (a.tool === b.tool) {
            score += 0.3;
        }

        // Similar command: +0.4 (fuzzy)
        if (a.command && b.command) {
            const aCmd = a.command.toLowerCase();
            const bCmd = b.command.toLowerCase();

            if (aCmd === bCmd) {
                score += 0.4;
            } else if (aCmd.includes(bCmd) || bCmd.includes(aCmd)) {
                score += 0.2;
            }
        }

        // Context/time: +0.3 (could add tag matching here)
        score += 0.3;

        return score;
    }

    private async updateKnowledge(projectHash: string): Promise<void> {
        const projectDir = path.join(this.projectsDir, projectHash);

        // Load failures and successes
        const failures = await this.loadJsonl<FailureRecord>(
            path.join(projectDir, 'failures.jsonl')
        );
        const successes = await this.loadJsonl<SuccessRecord>(
            path.join(projectDir, 'successes.jsonl')
        );

        // Synthesize knowledge
        const knowledge: ProjectKnowledge = {
            updatedAt: new Date().toISOString(),
            summary: this.generateSummary(failures, successes),
            sessionCount: new Set([...failures, ...successes].map(r => r.sessionId)).size,
            antiPatterns: this.extractAntiPatterns(failures),
            bestPractices: this.extractBestPractices(successes),
            techStack: this.extractTechStack(failures, successes),
            conventions: {}
        };

        await fs.writeJson(path.join(projectDir, 'knowledge.json'), knowledge, { spaces: 2 });
    }

    private async loadJsonl<T>(filePath: string): Promise<T[]> {
        if (!(await fs.pathExists(filePath))) {
            return [];
        }

        const content = await fs.readFile(filePath, 'utf-8');
        const records: T[] = [];
        for (const line of content.split('\n')) {
            if (!line.trim()) continue;
            try {
                records.push(JSON.parse(line) as T);
            } catch (error) {
                if (!(error instanceof SyntaxError)) throw error;
            }
        }
        return records;
    }

    private async appendLogRecord(filePath: string, record: FailureRecord | SuccessRecord): Promise<void> {
        const handle = await open(filePath, 'a+');
        try {
            const { size } = await handle.stat();
            const tail = Buffer.alloc(1);
            if (size > 0) await handle.read(tail, 0, 1, size - 1);
            const separator = size > 0 && tail[0] !== 10 ? '\n' : '';
            await handle.writeFile(`${separator}${JSON.stringify(record)}\n`, 'utf8');
        } finally {
            await handle.close();
        }
    }

    private generateSummary(failures: FailureRecord[], successes: SuccessRecord[]): string {
        // Basic summary: count successes and common patterns
        const tools = new Set([...successes.map(s => s.tool)].filter(Boolean));
        return `Project has ${successes.length} successful operations across ${tools.size} tools.`;
    }

    private extractAntiPatterns(failures: FailureRecord[]): ProjectKnowledge['antiPatterns'] {
        const patterns = new Map<string, { count: number; reason: string; occurredAt: string }>();

        for (const failure of failures) {
            const key = `${failure.tool}:${failure.command || failure.error}`;
            const existing = patterns.get(key);

            if (existing) {
                existing.count++;
            } else {
                patterns.set(key, {
                    count: 1,
                    reason: failure.error,
                    occurredAt: failure.timestamp
                });
            }
        }

        return Array.from(patterns.entries())
            .filter(([, data]) => data.count >= 1) // At least 1 occurrence
            .map(([pattern, data]) => ({
                pattern,
                reason: data.reason,
                occurredAt: data.occurredAt,
                confidence: Math.min(data.count / 3, 1) // Confidence increases with repetition
            }))
            .slice(0, 10); // Top 10
    }

    private extractBestPractices(successes: SuccessRecord[]): ProjectKnowledge['bestPractices'] {
        const practices = new Map<string, number>();

        for (const success of successes) {
            const key = success.pattern || success.description || `${success.tool}`;
            practices.set(key, (practices.get(key) || 0) + 1);
        }

        return Array.from(practices.entries())
            .map(([pattern, count]) => ({
                pattern,
                reason: `Successful ${count} times`,
                confidence: Math.min(count / 5, 1)
            }))
            .filter(p => p.confidence > 0.6)
            .slice(0, 10);
    }

    private extractTechStack(
        failures: FailureRecord[],
        successes: SuccessRecord[]
    ): ProjectKnowledge['techStack'] {
        const allTags = [...failures, ...successes].flatMap(r => r.tags);

        return {
            languages: this.extractByCategory(allTags, ['typescript', 'javascript', 'python', 'go']),
            frameworks: this.extractByCategory(allTags, ['react', 'vue', 'angular', 'express']),
            tools: this.extractByCategory(allTags, ['bun', 'npm', 'git', 'docker'])
        };
    }

    private extractByCategory(tags: string[], candidates: string[]): string[] {
        return candidates.filter(c => tags.some(t => t.toLowerCase().includes(c)));
    }

    private hashPath(projectPath: string): string {
        return crypto.createHash('sha256').update(path.resolve(projectPath)).digest('hex').slice(0, 8);
    }
}
