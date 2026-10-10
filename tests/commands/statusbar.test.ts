/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModalOption } from '../../src/ui/ink/components/Modal.js';
import type { LoadedConfig } from '../../src/types.js';

const showModalMock = vi.fn();
const saveConfigMock = vi.fn();

vi.mock('../../src/ui/ink/components/Modal.js', () => ({
  showModal: showModalMock,
}));

vi.mock('../../src/config.js', () => ({
  saveConfig: saveConfigMock,
}));

describe('/statusbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the main menu with layout and toggle sections options', async () => {
    const { statusbar } = await import('../../src/commands/statusbar.js');
    const config = createConfig();

    showModalMock.mockResolvedValueOnce({ value: '__done__' });

    await statusbar({ config });

    expect(showModalMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Status Bar',
      options: expect.arrayContaining([
        expect.objectContaining({ value: '__layout__' }),
        expect.objectContaining({ value: '__sections__' }),
        expect.objectContaining({ value: '__done__' }),
      ]),
    }));
  });

  it('opens layout selection when layout option is chosen', async () => {
    const { statusbar } = await import('../../src/commands/statusbar.js');
    const config = createConfig();

    // First call: choose layout
    showModalMock.mockResolvedValueOnce({ value: '__layout__' });
    // Second call: select two-line
    showModalMock.mockResolvedValueOnce({ value: 'two-line' });
    // Third call: back to main menu → done
    showModalMock.mockResolvedValueOnce({ value: '__done__' });

    const result = await statusbar({ config });

    expect(result).toBe('Status bar settings saved.');
    expect(config.ui?.statusBar?.layout).toBe('two-line');
    expect(saveConfigMock).toHaveBeenCalledWith(config);
  });

  it('opens section toggles when sections option is chosen', async () => {
    const { statusbar } = await import('../../src/commands/statusbar.js');
    const config = createConfig();

    // First call: choose sections
    showModalMock.mockResolvedValueOnce({ value: '__sections__' });
    // Second call: toggle a section off, then close
    showModalMock.mockImplementationOnce(async (options: {
      onToggle?: (option: ModalOption, checked: boolean) => void;
    }) => {
      options.onToggle?.({ label: 'Git branch', value: 'git' }, false);
      return { value: '__done__' };
    });
    // Third call: main menu → done
    showModalMock.mockResolvedValueOnce({ value: '__done__' });

    const result = await statusbar({ config });

    expect(result).toBe('Status bar settings saved.');
    const gitSection = config.ui?.statusBar?.sections?.find((s) => s.id === 'git');
    expect(gitSection?.enabled).toBe(false);
    expect(saveConfigMock).toHaveBeenCalledWith(config);
  });

  it('does not save when no changes are made', async () => {
    const { statusbar } = await import('../../src/commands/statusbar.js');
    const config = createConfig();

    showModalMock.mockResolvedValueOnce({ value: '__done__' });

    const result = await statusbar({ config });

    expect(result).toBeNull();
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it('saves when layout changes', async () => {
    const { statusbar } = await import('../../src/commands/statusbar.js');
    const config = createConfig();

    showModalMock.mockResolvedValueOnce({ value: '__layout__' });
    showModalMock.mockResolvedValueOnce({ value: 'two-line' });
    showModalMock.mockResolvedValueOnce({ value: '__done__' });

    const result = await statusbar({ config });

    expect(result).toBe('Status bar settings saved.');
    expect(config.ui?.statusBar?.layout).toBe('two-line');
    expect(config.ui?.statusBar?.sections).toBeDefined();
    expect(config.ui?.statusBar?.sections).toHaveLength(20);
  });

  it('does not save when cancelled from main menu', async () => {
    const { statusbar } = await import('../../src/commands/statusbar.js');
    const config = createConfig();

    showModalMock.mockResolvedValueOnce(null);

    await expect(statusbar({ config })).resolves.toBeNull();
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it('shows section toggle options grouped by line', async () => {
    const { statusbar } = await import('../../src/commands/statusbar.js');
    const config = createConfig();

    showModalMock.mockResolvedValueOnce({ value: '__sections__' });
    showModalMock.mockResolvedValueOnce({ value: '__done__' });
    showModalMock.mockResolvedValueOnce({ value: '__done__' });

    await statusbar({ config });

    // Second call should be the section toggle modal
    const sectionCall = showModalMock.mock.calls[1];
    expect(sectionCall[0]).toEqual(expect.objectContaining({
      title: 'Toggle Status Bar Sections',
      multiSelect: true,
    }));

    const options: ModalOption[] = sectionCall[0].options;
    // Should have header separators for line 1 and line 2
    expect(options.some((o) => o.value === '__header_1__')).toBe(true);
    expect(options.some((o) => o.value === '__header_2__')).toBe(true);
    // Should include known sections
    expect(options.some((o) => o.value === 'project')).toBe(true);
    expect(options.some((o) => o.value === 'git')).toBe(true);
    expect(options.some((o) => o.value === 'agents')).toBe(true);
    expect(options.some((o) => o.value === 'hints')).toBe(true);
    // Should have a Done option
    expect(options.some((o) => o.value === '__done__')).toBe(true);
  });

  it('exports metadata with correct command name', async () => {
    const { metadata } = await import('../../src/commands/statusbar.js');
    expect(metadata.command).toBe('/statusbar');
    expect(metadata.implemented).toBe(true);
  });
});

function createConfig(statusBar?: LoadedConfig['ui']['statusBar']): LoadedConfig {
  return {
    configPath: '/tmp/autohand-config.json',
    provider: 'openrouter',
    ui: {
      statusBar,
    },
  } as LoadedConfig;
}
