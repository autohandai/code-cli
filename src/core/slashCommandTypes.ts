/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SessionManager, Session } from '../session/SessionManager.js';
import type { LLMProvider } from '../providers/LLMProvider.js';
import type { MemoryManager } from '../memory/MemoryManager.js';
import type { PermissionManager } from '../permissions/PermissionManager.js';
import type { SkillsRegistry } from '../skills/SkillsRegistry.js';
import type { LoadedConfig, ProviderName } from '../types.js';

export interface SlashCommandContext {
    listWorkspaceFiles?: () => Promise<void>;
    printGitDiff?: () => void;
    undoFileMutation?: () => Promise<void>;
    removeLastTurn?: () => void;
    promptModelSelection: () => Promise<void>;
    promptApprovalMode?: () => Promise<void>;
    createAgentsFile: () => Promise<void>;
    resetConversation: () => void | Promise<void>;
    sessionManager: SessionManager;
    currentSession?: Session;
    memoryManager: MemoryManager;
    permissionManager: PermissionManager;
    llm: LLMProvider;
    workspaceRoot: string;
    model: string;
    /** Current provider name (for /status) */
    provider?: ProviderName;
    /** Full config object (for /status and /theme) */
    config?: LoadedConfig;
    /** Get current context percentage remaining (for /status) */
    getContextPercentLeft?: () => number;
    /** Get current total tokens used (for /status) */
    getTotalTokensUsed?: () => number;
    /** Skills registry for /skills commands */
    skillsRegistry?: SkillsRegistry;
}
