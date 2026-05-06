/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedConfig } from '../../src/types.js';

var mockShowModal = vi.fn();
var mockSaveConfig = vi.fn();
function mockModalComponent(props: { title?: string; options?: Array<{ label: string }> }) {
  const options = props.options?.map((option, index) => `${index === 0 ? '\u25b8 ' : '  '}${index + 1}. ${option.label}`).join('\n');
  return [props.title, options].filter(Boolean).join('\n');
}

vi.mock('../../src/ui/ink/components/Modal.js', () => ({
  Modal: mockModalComponent,
  default: mockModalComponent,
  cleanupModalRender: (output = process.stdout) => {
    output.write('\x1b[?1049l');
    output.write('\x1b[?2004h');
  },
  isModalCancelInput: (char: string, key: { escape?: boolean; ctrl?: boolean }) =>
    key.escape === true ||
    char === '\x1b' ||
    /^\x1b\[27(?:;[0-9]+)?[u~]$/.test(char) ||
    (key.ctrl === true && char === 'c'),
  prepareModalRender: (output = process.stdout) => {
    output.write('\x1b[?2004l');
    output.write('\x1B[r');
    output.write('\x1b[?1049h\x1b[2J\x1b[H');
  },
  resolveInitialCursor: (
    mode: 'select' | 'confirm',
    optionCount: number,
    initialIndex?: number,
    confirmDefaultValue?: boolean,
  ) => {
    if (mode === 'confirm' && confirmDefaultValue === false) {
      return 1;
    }
    if (mode === 'select' && typeof initialIndex === 'number') {
      return Math.max(0, Math.min(initialIndex, Math.max(0, optionCount - 1)));
    }
    return 0;
  },
  showConfirm: vi.fn(),
  showInput: vi.fn(),
  showModal: (...args: unknown[]) => {
    if (!process.stdout.isTTY) {
      return Promise.resolve(null);
    }
    return mockShowModal(...args);
  },
  showPassword: vi.fn(),
}));

vi.mock('../../src/config.js', () => ({
  saveConfig: mockSaveConfig,
}));

const { theme } = await import('../../src/commands/theme.js');
const { getTheme, initTheme } = await import('../../src/ui/theme/index.js');

describe('/theme command', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  const originalStdoutIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
    });
    initTheme('dark');
    mockShowModal.mockResolvedValue(null);
    mockSaveConfig.mockResolvedValue(undefined);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalStdoutIsTTY,
      configurable: true,
    });
    initTheme('dark');
  });

  it('applies the selected theme before resuming the main Ink UI', async () => {
    const order: string[] = [];
    const config = { ui: { theme: 'dark' } } as LoadedConfig;

    mockShowModal.mockImplementation(async () => {
      order.push('modal');
      return { label: 'light', value: 'light' };
    });

    await theme({
      config,
      onBeforeModal: () => {
        order.push(`before:${getTheme().name}`);
      },
      onAfterModal: () => {
        order.push(`after:${getTheme().name}`);
      },
    });

    expect(order).toEqual(['before:dark', 'modal', 'after:light']);
    expect(getTheme().name).toBe('light');
    expect(config.ui?.theme).toBe('light');
    expect(mockSaveConfig).toHaveBeenCalledWith(config);
  });
});
