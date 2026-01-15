/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SessionManager, Session } from '../session/SessionManager.js';
import type { LLMProvider } from '../providers/LLMProvider.js';
import type { MemoryManager } from '../memory/MemoryManager.js';
import type { PermissionManager } from '../permissions/PermissionManager.js';
import type { HookManager } from './HookManager.js';
import type { SkillsRegistry } from '../skills/SkillsRegistry.js';
import type { AutomodeManager } from './AutomodeManager.js';
import type { FileActionManager } from '../actions/filesystem.js';
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
    /** Hook manager for /hooks commands */
    hookManager?: HookManager;
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
    /** Auto-mode manager for /automode commands */
    automodeManager?: AutomodeManager;
    /** File action manager for /add-dir commands */
    fileManager?: FileActionManager;
    /** Additional directories added via --add-dir or /add-dir */
    additionalDirs?: string[];
    /** Callback to add an additional directory at runtime */
    addAdditionalDir?: (dir: string) => void;
}

export interface SlashCommand {
  command: string;
  description: string;
  implemented: boolean;
  prd?: string;
}
