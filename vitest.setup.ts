/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Global test setup: ensures i18n is initialized before any module-level
 * t() calls (e.g., metadata descriptions) execute.
 */
import { initI18n } from './src/i18n/index.js';

await initI18n('en');
