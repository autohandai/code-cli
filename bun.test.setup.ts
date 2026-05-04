/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Global test setup:
 * - Ensures i18n is initialized before any module-level t() calls
 */

import { initI18n } from './src/i18n/index.js';

await initI18n('en');
