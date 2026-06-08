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

describe('/statusline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens a navigable multi-select list with current status line fields', async () => {
    const { statusline } = await import('../../src/commands/statusline.js');
    const config = createConfig({
      showContext: true,
      showCommandHint: false,
      showPullRequest: true,
      showSessionLines: false,
    });

    showModalMock.mockResolvedValueOnce({ value: '__done__' });

    await statusline({ config });

    expect(showModalMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Status Line',
      multiSelect: true,
      options: expect.arrayContaining([
        expect.objectContaining({ value: 'showContext', checked: true }),
        expect.objectContaining({ value: 'showCommandHint', checked: false }),
        expect.objectContaining({ value: 'showPullRequest', checked: true }),
        expect.objectContaining({ value: 'showSessionLines', checked: false }),
      ]),
    }));
  });

  it('saves toggled status line fields back to ui.statusLine', async () => {
    const { statusline } = await import('../../src/commands/statusline.js');
    const config = createConfig();

    showModalMock.mockImplementationOnce(async (options: {
      onToggle?: (option: ModalOption, checked: boolean) => void;
    }) => {
      options.onToggle?.({ label: 'Session line changes', value: 'showSessionLines' }, true);
      return { value: '__done__' };
    });

    const result = await statusline({ config });

    expect(result).toBe('Status line settings saved.');
    expect(config.ui?.statusLine?.showSessionLines).toBe(true);
    expect(saveConfigMock).toHaveBeenCalledWith(config);
  });

  it('does not save when cancelled', async () => {
    const { statusline } = await import('../../src/commands/statusline.js');
    const config = createConfig();

    showModalMock.mockResolvedValueOnce(null);

    await expect(statusline({ config })).resolves.toBeNull();
    expect(saveConfigMock).not.toHaveBeenCalled();
  });
});

function createConfig(statusLine?: LoadedConfig['ui']['statusLine']): LoadedConfig {
  return {
    configPath: '/tmp/autohand-config.json',
    provider: 'openrouter',
    ui: {
      statusLine,
    },
  } as LoadedConfig;
}
