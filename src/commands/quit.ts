/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { t } from '../i18n/index.js';

/**
 * Quit command - exits the application
 */
export async function quit(): Promise<string | null> {
    return '/quit';
}

export async function exit(): Promise<string | null> {
    return '/exit';
}

export const metadata = {
    command: '/quit',
    description: t('commands.quit.description'),
    implemented: true
};

export const exitMetadata = {
    command: '/exit',
    description: t('commands.quit.description'),
    implemented: true
};
