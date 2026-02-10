/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { t } from '../i18n/index.js';

/**
 * Init command - creates AGENTS.md file
 */
export async function init(ctx: { createAgentsFile: () => Promise<void> }): Promise<string | null> {
    await ctx.createAgentsFile();
    return null;
}

export const metadata = {
    command: '/init',
    description: t('commands.init.description'),
    implemented: true
};
