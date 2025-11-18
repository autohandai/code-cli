/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Review command - asks AI to review current changes
 */
export async function review(): Promise<string | null> {
    return 'Review my current changes and find issues. Focus on bugs and risky diffs.';
}

export const metadata = {
    command: '/review',
    description: 'review my current changes and find issues',
    implemented: true
};
