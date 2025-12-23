/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface SessionMetadata {
    sessionId: string;
    createdAt: string;
    lastActiveAt: string;
    closedAt?: string;
    projectPath: string;
    projectName: string;
    model: string;
    messageCount: number;
    summary?: string;
    status: 'active' | 'completed' | 'crashed';
    exitCode?: number;
}

export interface SessionMessage {
    role: 'user' | 'assistant' | 'tool' | 'system';
    content: string;
    timestamp: string;
    toolCalls?: any[];
    name?: string;
    tool_call_id?: string;
    _meta?: Record<string, unknown>;
}

export interface WorkspaceState {
    workspaceRoot: string;
    workspaceFiles: string[];
    gitStatus?: string;
    contextUsed: number;
    contextLimit: number;
}

export interface SessionIndex {
    sessions: Array<{
        id: string;
        projectPath: string;
        createdAt: string;
        summary?: string;
    }>;
    byProject: Record<string, string[]>;
}

export interface FailureRecord {
    timestamp: string;
    sessionId: string;
    tool: string;
    command?: string;
    error: string;
    context: string;
    tags: string[];
}

export interface SuccessRecord {
    timestamp: string;
    sessionId: string;
    tool?: string;
    command?: string;
    pattern?: string;
    description?: string;
    result?: string;
    context: string;
    tags: string[];
}

export interface ProjectKnowledge {
    updatedAt: string;
    summary: string;
    sessionCount: number;
    antiPatterns: Array<{
        pattern: string;
        reason: string;
        occurredAt: string;
        confidence: number;
    }>;
    bestPractices: Array<{
        pattern: string;
        reason: string;
        confidence: number;
    }>;
    techStack: {
        languages: string[];
        frameworks: string[];
        tools: string[];
    };
    conventions: Record<string, string>;
}

export interface ProjectIndex {
    projectPath: string;
    projectHash: string;
    displayName: string;
    firstSeen: string;
    lastActiveAt: string;
    sessionCount: number;
    techStack: {
        languages: string[];
        frameworks: string[];
        tools: string[];
    };
    patterns: Record<string, string>;
}
