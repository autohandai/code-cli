/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Global test setup:
 * - Ensures i18n is initialized before any module-level t() calls
 * - Mocks node:sqlite for CursorImporter tests
 */
import { vi } from 'vitest';

// Mock node:sqlite globally to avoid test isolation issues
// CursorImporter uses dynamic import which can conflict with per-file mocks
vi.mock('node:sqlite', () => ({
  DatabaseSync: vi.fn().mockImplementation(() => ({
    prepare: vi.fn(),
    close: vi.fn(),
  })),
  default: {
    DatabaseSync: vi.fn().mockImplementation(() => ({
      prepare: vi.fn(),
      close: vi.fn(),
    })),
  },
}));

import { initI18n } from './src/i18n/index.js';

await initI18n('en');
