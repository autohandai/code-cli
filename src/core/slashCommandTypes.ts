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
import type { McpClientManager } from '../mcp/McpClientManager.js';
import type { TeamManager } from './teams/TeamManager.js';
import type { RepeatManager } from './RepeatManager.js';
import type { LoadedConfig, ProviderName } from '../types.js';
import type { ToolsRegistry } from './toolsRegistry.js';

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
    /** Get whether token usage is exact provider-reported usage or unavailable */
    getTokenUsageStatus?: () => 'actual' | 'unavailable';
    /** Skills registry for /skills commands */
    skillsRegistry?: SkillsRegistry;
    /** Meta-tools registry for /tools commands */
    toolsRegistry?: ToolsRegistry;
    /** Auto-mode manager for /automode commands */
    automodeManager?: AutomodeManager;
    /** Interactive auto-mode toggle state for /automode commands */
    isInteractiveAutomodeEnabled?: () => boolean;
    /** Toggle interactive auto-mode state for /automode commands */
    setInteractiveAutomodeEnabled?: (enabled: boolean) => void;
    /** MCP client manager for /mcp commands */
    mcpManager?: McpClientManager;
    /** File action manager for /add-dir commands */
    fileManager?: FileActionManager;
    /** Additional directories added via --add-dir or /add-dir */
    additionalDirs?: string[];
    /** Callback to add an additional directory at runtime */
    addAdditionalDir?: (dir: string) => void;
    /** Toggle context compaction on/off */
    toggleContextCompaction?: () => void;
    /** Check if context compaction is enabled */
    isContextCompactionEnabled?: () => boolean;
    /** Whether running in non-interactive mode (RPC/ACP) where stdin is not a TTY */
    isNonInteractive?: boolean;
    /** Called before /learn shows a modal (pause persistent input) */
    onBeforeModal?: () => void | Promise<void>;
    /** Called after /learn modal closes (resume persistent input) */
    onAfterModal?: () => void | Promise<void>;
    /** Called with the top recommended skill slug from /learn for install hint */
    onTopRecommendation?: (slug: string) => void;
    /** Team manager for /team and /tasks commands */
    teamManager?: TeamManager;
    /** Repeat manager for /repeat recurring prompt scheduling */
    repeatManager?: RepeatManager;
    /** Queue an instruction to be sent to the LLM on the next turn (not displayed to user) */
    queueInstruction?: (instruction: string) => void;
    /** Event emitter for RPC/ACP mode notifications */
    eventEmitter?: {
        emit: (event: string, data?: unknown) => void;
    };
    /** Set YOLO mode pattern (e.g. 'allow:*' or undefined to clear) */
    setYoloMode?: (pattern: string | undefined) => void;
    /** Clear the terminal screen / Ink UI (used by /clear, /new) */
    clearScreen?: () => void;
    /** Restore an existing session into the active conversation and UI. */
    restoreSession?: (sessionId: string) => Promise<void>;
}

export interface SlashCommandSubcommand {
  name: string;
  description: string;
}

export interface SlashCommand {
  command: string;
  description: string;
  implemented: boolean;
  prd?: string;
  /** Optional subcommands for slash commands that support them (e.g. /learn deep) */
  subcommands?: SlashCommandSubcommand[];
}
