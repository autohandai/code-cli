/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
    SessionMetadata,
    SessionMessage,
    WorkspaceState,
    SessionIndex
} from './types.js';
import { AUTOHAND_PATHS } from '../constants.js';

export interface BranchSessionOptions {
    type: 'fork' | 'clone';
    userMessageOrdinal?: number;
}

export class SessionManager {
    private readonly sessionsDir: string;
    private currentSession: Session | null = null;
    private index: SessionIndex | null = null;

    constructor(baseDir?: string) {
        this.sessionsDir = baseDir ?? AUTOHAND_PATHS.sessions;
    }

    async initialize(): Promise<void> {
        await fs.ensureDir(this.sessionsDir);
        await this.loadIndex();
    }

    async createSession(projectPath: string, model: string): Promise<Session> {
        const sessionId = this.generateSessionId();
        const sessionDir = path.join(this.sessionsDir, sessionId);
        await fs.ensureDir(sessionDir);

        // Detect client from environment (set by ACP extensions like Zed)
        const client = process.env.AUTOHAND_CLIENT_NAME || 'terminal';
        const clientVersion = process.env.AUTOHAND_CLIENT_VERSION;

        const metadata: SessionMetadata = {
            sessionId,
            createdAt: new Date().toISOString(),
            lastActiveAt: new Date().toISOString(),
            projectPath: path.resolve(projectPath),
            projectName: path.basename(projectPath),
            model,
            messageCount: 0,
            status: 'active',
            client,
            clientVersion,
        };

        const session = new Session(sessionDir, metadata);
        await session.save();

        this.currentSession = session;
        await this.addToIndex(session.metadata);

        return session;
    }

    async loadSession(sessionId: string): Promise<Session> {
        const resolvedSessionId = await this.resolveSessionReference(sessionId);
        const sessionDir = path.join(this.sessionsDir, resolvedSessionId);
        if (!(await fs.pathExists(sessionDir))) {
            throw new Error(`Session not found: ${sessionId}`);
        }

        const metadataPath = path.join(sessionDir, 'metadata.json');
        const metadata = await fs.readJson(metadataPath) as SessionMetadata;
        const session = new Session(sessionDir, metadata);
        await session.load();

        this.currentSession = session;
        return session;
    }

    async resolveSessionReference(reference: string): Promise<string> {
        const trimmed = reference.trim();
        if (!trimmed) {
            throw new Error('Session reference is required');
        }

        const asPath = path.resolve(trimmed);
        if (await fs.pathExists(asPath)) {
            const stat = await fs.stat(asPath);
            const sessionDir = stat.isDirectory() ? asPath : path.dirname(asPath);
            const metadataPath = path.join(sessionDir, 'metadata.json');
            if (await fs.pathExists(metadataPath)) {
                const metadata = await fs.readJson(metadataPath) as SessionMetadata;
                return metadata.sessionId;
            }
        }

        const directDir = path.join(this.sessionsDir, trimmed);
        if (await fs.pathExists(path.join(directDir, 'metadata.json'))) {
            return trimmed;
        }

        await this.loadIndex();
        const candidates = this.index?.sessions.filter((session) => session.id.startsWith(trimmed)) ?? [];
        if (candidates.length === 1) {
            return candidates[0].id;
        }
        if (candidates.length > 1) {
            throw new Error(`Ambiguous session reference: ${reference}`);
        }

        throw new Error(`Session not found: ${reference}`);
    }

    async branchSession(sourceReference: string, options: BranchSessionOptions): Promise<Session> {
        const sourceSessionId = await this.resolveSessionReference(sourceReference);
        const sourceSession = await this.loadSession(sourceSessionId);
        const sourceMessages = sourceSession.getMessages();
        const copiedMessages = selectBranchMessages(sourceMessages, options);
        const createdAt = new Date().toISOString();
        const sessionId = this.generateSessionId();
        const sessionDir = path.join(this.sessionsDir, sessionId);
        await fs.ensureDir(sessionDir);

        const metadata: SessionMetadata = {
            ...sourceSession.metadata,
            sessionId,
            createdAt,
            lastActiveAt: createdAt,
            closedAt: undefined,
            messageCount: copiedMessages.length,
            status: 'active',
            exitCode: undefined,
            branch: {
                type: options.type,
                sourceSessionId,
                sourceMessageIndex: options.type === 'fork' && copiedMessages.length > 0
                    ? copiedMessages.length - 1
                    : undefined,
                sourceUserMessageOrdinal: options.type === 'fork' ? options.userMessageOrdinal : undefined,
                createdAt,
            },
        };

        const session = new Session(sessionDir, metadata);
        await session.replaceMessages(copiedMessages);
        const sourceState = sourceSession.getState();
        if (sourceState) {
            await session.updateState(sourceState);
        }
        await session.save();

        this.currentSession = session;
        await this.addToIndex(session.metadata);
        return session;
    }

    async listSessions(filter?: { project?: string; since?: Date }): Promise<SessionMetadata[]> {
        await this.loadIndex();
        if (!this.index) return [];

        let sessions = this.index.sessions;

        if (filter?.project) {
            const projectPath = path.resolve(filter.project);
            const sessionIds = this.index.byProject[projectPath] || [];
            sessions = sessions.filter(s => sessionIds.includes(s.id));
        }

        if (filter?.since) {
            sessions = sessions.filter(s => new Date(s.createdAt) >= filter.since!);
        }

        // Load full metadata for each session
        const fullMetadata: SessionMetadata[] = [];
        for (const s of sessions) {
            const sessionDir = path.join(this.sessionsDir, s.id);
            const metadataPath = path.join(sessionDir, 'metadata.json');
            if (await fs.pathExists(metadataPath)) {
                const metadata = await fs.readJson(metadataPath) as SessionMetadata;
                fullMetadata.push(metadata);
            }
        }

        return fullMetadata.sort((a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
    }

    async getLastSession(projectPath?: string): Promise<SessionMetadata | null> {
        const sessions = await this.listSessions(projectPath ? { project: projectPath } : undefined);
        return sessions[0] || null;
    }

    async closeSession(summary?: string): Promise<void> {
        if (!this.currentSession) return;

        this.currentSession.metadata.closedAt = new Date().toISOString();
        this.currentSession.metadata.lastActiveAt = new Date().toISOString();
        this.currentSession.metadata.status = 'completed';
        if (summary) {
            this.currentSession.metadata.summary = summary;
        }

        await this.currentSession.save();
        await this.updateIndex(this.currentSession.metadata);
        this.currentSession = null;
    }

    getCurrentSession(): Session | null {
        return this.currentSession;
    }

    private generateSessionId(): string {
        const timestamp = Date.now();
        const uuid = crypto.randomUUID();
        return `${uuid}-${timestamp}`;
    }

    private async loadIndex(): Promise<void> {
        const indexPath = path.join(this.sessionsDir, 'index.json');
        if (await fs.pathExists(indexPath)) {
            try {
                this.index = await fs.readJson(indexPath) as SessionIndex;
            } catch (error) {
                const backupPath = `${indexPath}.corrupt-${Date.now()}`;
                await fs.move(indexPath, backupPath, { overwrite: true });
                const reason = error instanceof Error ? error.message : String(error);
                console.warn(`Session index was corrupt and has been reset: ${reason}. Backup saved to ${backupPath}`);
                this.index = { sessions: [], byProject: {} };
                await this.saveIndex();
            }
        } else {
            this.index = { sessions: [], byProject: {} };
        }
    }

    private async saveIndex(): Promise<void> {
        const indexPath = path.join(this.sessionsDir, 'index.json');
        await fs.writeJson(indexPath, this.index, { spaces: 2 });
    }

    private async addToIndex(metadata: SessionMetadata): Promise<void> {
        if (!this.index) await this.loadIndex();
        if (!this.index) return;

        this.index.sessions.push({
            id: metadata.sessionId,
            projectPath: metadata.projectPath,
            createdAt: metadata.createdAt,
            summary: metadata.summary,
            importedFrom: metadata.importedFrom
                ? {
                    source: metadata.importedFrom.source,
                    originalId: metadata.importedFrom.originalId,
                }
                : undefined,
            branch: metadata.branch,
        });

        if (!this.index.byProject[metadata.projectPath]) {
            this.index.byProject[metadata.projectPath] = [];
        }
        this.index.byProject[metadata.projectPath].push(metadata.sessionId);

        await this.saveIndex();
    }

    private async updateIndex(metadata: SessionMetadata): Promise<void> {
        if (!this.index) return;

        const session = this.index.sessions.find(s => s.id === metadata.sessionId);
        if (session) {
            session.summary = metadata.summary;
            session.branch = metadata.branch;
        }

        await this.saveIndex();
    }
}

function selectBranchMessages(messages: SessionMessage[], options: BranchSessionOptions): SessionMessage[] {
    if (options.type === 'clone' || options.userMessageOrdinal === undefined) {
        return [...messages];
    }

    if (!Number.isInteger(options.userMessageOrdinal) || options.userMessageOrdinal < 1) {
        throw new Error('Fork message must be a positive user-message number');
    }

    let seenUserMessages = 0;
    const selected: SessionMessage[] = [];
    for (const message of messages) {
        selected.push(message);
        if (message.role === 'user') {
            seenUserMessages += 1;
            if (seenUserMessages === options.userMessageOrdinal) {
                return selected;
            }
        }
    }

    throw new Error(`User message ${options.userMessageOrdinal} not found`);
}

export class Session {
    private readonly sessionDir: string;
    public metadata: SessionMetadata;
    private messages: SessionMessage[] = [];
    private state: WorkspaceState | null = null;

    constructor(sessionDir: string, metadata: SessionMetadata) {
        this.sessionDir = sessionDir;
        this.metadata = metadata;
    }

    private async ensureSessionDir(): Promise<void> {
        await fs.ensureDir(this.sessionDir);
    }

    async append(message: SessionMessage): Promise<void> {
        this.messages.push(message);
        this.metadata.messageCount = this.messages.length;
        this.metadata.lastActiveAt = new Date().toISOString();

        // Append to JSONL file
        await this.ensureSessionDir();
        const conversationPath = path.join(this.sessionDir, 'conversation.jsonl');
        await fs.appendFile(conversationPath, JSON.stringify(message) + '\n');

        // Update metadata
        await this.save();
    }

    async appendTransient(message: SessionMessage): Promise<void> {
        await this.ensureSessionDir();
        const conversationPath = path.join(this.sessionDir, 'conversation.jsonl');
        await fs.appendFile(conversationPath, JSON.stringify(message) + '\n');
    }

    async replaceMessages(messages: SessionMessage[]): Promise<void> {
        this.messages = [...messages];
        this.metadata.messageCount = this.messages.length;
        const conversationPath = path.join(this.sessionDir, 'conversation.jsonl');
        const content = this.messages.map((message) => JSON.stringify(message)).join('\n');
        await fs.writeFile(conversationPath, content ? `${content}\n` : '');
    }

    async updateState(state: WorkspaceState): Promise<void> {
        this.state = state;
        await this.ensureSessionDir();
        const statePath = path.join(this.sessionDir, 'state.json');
        await fs.writeJson(statePath, state, { spaces: 2 });
    }

    async save(): Promise<void> {
        await this.ensureSessionDir();
        const metadataPath = path.join(this.sessionDir, 'metadata.json');
        await fs.writeJson(metadataPath, this.metadata, { spaces: 2 });
    }

    async load(): Promise<void> {
        // Load conversation
        const conversationPath = path.join(this.sessionDir, 'conversation.jsonl');
        if (await fs.pathExists(conversationPath)) {
            const content = await fs.readFile(conversationPath, 'utf-8');
            this.messages = content
                .trim()
                .split('\n')
                .filter(line => line)
                .map(line => JSON.parse(line) as SessionMessage);
        }

        // Load state
        const statePath = path.join(this.sessionDir, 'state.json');
        if (await fs.pathExists(statePath)) {
            this.state = await fs.readJson(statePath) as WorkspaceState;
        }
    }

    getMessages(): SessionMessage[] {
        return this.messages;
    }

    getState(): WorkspaceState | null {
        return this.state;
    }

    async close(summary?: string): Promise<void> {
        this.metadata.closedAt = new Date().toISOString();
        this.metadata.status = 'completed';
        if (summary) {
            this.metadata.summary = summary;
        }
        await this.save();
    }
}
