/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Export all command modules
export * as ls from './ls.js';
export * as diff from './diff.js';
export * as undo from './undo.js';
export * as model from './model.js';
export * as approvals from './approvals.js';
export * as review from './review.js';
export * as newCmd from './new.js';
export * as init from './init.js';
export * as compact from './compact.js';
export * as quit from './quit.js';
export * as help from './help.js';
export * as resume from './resume.js';
export * as sessions from './sessions.js';

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
        modules.ls,
        modules.diff,
        modules.undo,
        modules.model,
        modules.approvals,
        modules.review,
        modules.newCmd,
        modules.init,
        modules.compact,
        modules.quit,
        modules.help,
        modules.resume,
        modules.sessions
    ];

    for (const mod of commandModules) {
        if (mod.metadata) {
            commands.push(mod.metadata);
        }
    }

    return commands;
}
