/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

var mockShowModal = vi.fn();
var mockDetectRunningIDEs = vi.fn();
var mockGetExtensionSuggestions = vi.fn();

vi.mock('../../src/ui/ink/components/Modal.js', () => ({
  showModal: mockShowModal,
}));

vi.mock('../../src/core/ide/ideDetector.js', () => ({
  detectRunningIDEs: mockDetectRunningIDEs,
  getExtensionSuggestions: mockGetExtensionSuggestions,
}));

vi.mock('chalk', () => ({
  default: {
    bold: { cyan: (s: string) => s },
    gray: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    dim: (s: string) => s,
  },
}));

vi.mock('terminal-link', () => ({
  default: (label: string) => label,
}));

const { ide } = await import('../../src/commands/ide.js');

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    workspaceRoot: '/tmp/test',
    onBeforeModal: vi.fn(),
    onAfterModal: vi.fn(),
    ...overrides,
  };
}

describe('/ide command modal lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetExtensionSuggestions.mockReturnValue([]);
    mockDetectRunningIDEs.mockResolvedValue([
      {
        kind: 'vscode',
        displayName: 'VS Code',
        workspacePath: '/tmp/test',
        matchesCwd: true,
      },
    ]);
    mockShowModal.mockResolvedValue(null);
  });

  it('calls onBeforeModal before showModal and onAfterModal after', async () => {
    const order: string[] = [];
    const ctx = makeCtx({
      onBeforeModal: vi.fn(() => order.push('before')),
      onAfterModal: vi.fn(() => order.push('after')),
    });

    mockShowModal.mockImplementation(async () => {
      order.push('modal');
      return null;
    });

    await ide(ctx as any);

    expect(order).toEqual(['before', 'modal', 'after']);
  });

  it('calls onAfterModal even when showModal throws', async () => {
    const ctx = makeCtx();
    mockShowModal.mockRejectedValue(new Error('render crash'));

    await ide(ctx as any).catch(() => {});

    expect(ctx.onBeforeModal).toHaveBeenCalledTimes(1);
    expect(ctx.onAfterModal).toHaveBeenCalledTimes(1);
  });
});
