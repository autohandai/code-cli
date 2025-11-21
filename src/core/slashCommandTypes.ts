/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SessionManager } from '../session/SessionManager.js';
import type { OpenRouterClient } from '../openrouter.js';

export interface SlashCommandContext {
    listWorkspaceFiles?: () => Promise<void>;
    printGitDiff?: () => void;
    undoLastMutation?: () => Promise<void>;
    promptModelSelection: () => Promise<void>;
    promptApprovalMode?: () => Promise<void>;
    createAgentsFile: () => Promise<void>;
    resetConversation?: () => void;
    sessionManager?: SessionManager;
    llm: OpenRouterClient;
}
