/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { t } from '../i18n/index.js';

/**
 * Model selection command - prompts user to select model
 */
export async function model(ctx: { promptModelSelection: () => Promise<void> }): Promise<string | null> {
    await ctx.promptModelSelection();
    return null;
}

export const metadata = {
    command: '/model',
    description: t('commands.model.description'),
    implemented: true
};
