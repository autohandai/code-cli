/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';

// Mock fs-extra so importers don't touch the real filesystem
vi.mock('fs-extra', () => ({
  default: {
    pathExists: vi.fn().mockResolvedValue(false),
    readFile: vi.fn(),
    ensureDir: vi.fn(),
    writeJson: vi.fn(),
    readJson: vi.fn(),
    writeFile: vi.fn(),
  },
}));

describe('ImportWizard', () => {
  it('should export showImportWizard as a function', async () => {
    const module = await import('../../../src/import/ui/ImportWizard.js');
    expect(module.showImportWizard).toBeDefined();
    expect(typeof module.showImportWizard).toBe('function');
  });

  it('showImportWizard should accept registry and options parameters', async () => {
    const module = await import('../../../src/import/ui/ImportWizard.js');
    // Verify the function signature by checking it exists and is callable
    expect(module.showImportWizard.length).toBeGreaterThanOrEqual(1);
  });
});
