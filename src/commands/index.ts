/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Export all command modules
export * as model from './model.js';
export * as cc from './cc.js';
export * as newCmd from './new.js';
export * as init from './init.js';
export * as quit from './quit.js';
export * as help from './help.js';
export * as resume from './resume.js';
export * as sessions from './sessions.js';
export * as agents from './agents.js';
export * as agentsNew from './agents-new.js';
export * as feedback from './feedback.js';
export * as session from './session.js';
export * as undo from './undo.js';
export * as memory from './memory.js';
export * as plan from './plan.js';

// Command registry type
export interface CommandModule {
    metadata: {
        command: string;
        description: string;
        implemented: boolean;
        prd?: string;
    };
    [key: string]: any;
}

// Get all command metadata
import * as modules from './index.js';

export function getAllCommands(): Array<{ command: string; description: string; implemented: boolean; prd?: string }> {
    const commands: Array<{ command: string; description: string; implemented: boolean; prd?: string }> = [];

    // Manually collect all command metadata
    const commandModules = [
        modules.model,
        modules.cc,
        modules.newCmd,
        modules.init,
        modules.quit,
        modules.help,
        modules.resume,
        modules.sessions,
        modules.agents,
        modules.agentsNew,
        modules.feedback,
        modules.session,
        modules.undo,
        modules.memory,
        modules.plan
    ];

    for (const mod of commandModules) {
        if (mod.metadata) {
            commands.push(mod.metadata);
        }
    }

    return commands;
}
