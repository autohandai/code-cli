/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { saveConfig } from '../config.js';
import { t } from '../i18n/index.js';
import type { LoadedConfig, StatusLineSettings } from '../types.js';
import { showModal, type ModalOption } from '../ui/ink/components/Modal.js';
import {
  STATUS_LINE_SETTING_KEYS,
  isStatusLineSettingKey,
  resolveStatusLineSettings,
  type StatusLineSettingKey,
} from '../core/agent/StatusLineSettings.js';

export interface StatuslineCommandContext {
  config: LoadedConfig;
}

const STATUS_LINE_LABEL_KEYS: Record<StatusLineSettingKey, string> = {
  showContext: 'commands.statusline.fields.showContext',
  showCommandHint: 'commands.statusline.fields.showCommandHint',
  showPullRequest: 'commands.statusline.fields.showPullRequest',
  showSessionLines: 'commands.statusline.fields.showSessionLines',
};

const STATUS_LINE_DESCRIPTION_KEYS: Record<StatusLineSettingKey, string> = {
  showContext: 'commands.statusline.fields.showContextDesc',
  showCommandHint: 'commands.statusline.fields.showCommandHintDesc',
  showPullRequest: 'commands.statusline.fields.showPullRequestDesc',
  showSessionLines: 'commands.statusline.fields.showSessionLinesDesc',
};

function buildOptions(settings: Required<StatusLineSettings>): ModalOption[] {
  return [
    ...STATUS_LINE_SETTING_KEYS.map((key) => ({
      label: t(STATUS_LINE_LABEL_KEYS[key]),
      value: key,
      description: t(STATUS_LINE_DESCRIPTION_KEYS[key]),
      checked: settings[key],
    })),
    {
      label: t('commands.statusline.done'),
      value: '__done__',
    },
  ];
}

function persistDraft(config: LoadedConfig, draft: Required<StatusLineSettings>): void {
  config.ui = {
    ...config.ui,
    statusLine: draft,
  };
}

export async function statusline(ctx: StatuslineCommandContext): Promise<string | null> {
  const draft = { ...resolveStatusLineSettings(ctx.config.ui?.statusLine) };
  const initial = JSON.stringify(draft);

  const result = await showModal({
    title: t('commands.statusline.title'),
    options: buildOptions(draft),
    multiSelect: true,
    maxVisible: 8,
    onToggle: (option, checked) => {
      if (isStatusLineSettingKey(option.value)) {
        draft[option.value] = checked;
      }
    },
  });

  if (!result) {
    return null;
  }

  if (isStatusLineSettingKey(result.value)) {
    draft[result.value] = !draft[result.value];
  }

  if (JSON.stringify(draft) === initial) {
    return null;
  }

  persistDraft(ctx.config, draft);
  await saveConfig(ctx.config);
  return chalk.green(t('commands.statusline.saved'));
}

export const metadata = {
  command: '/statusline',
  description: 'configure status line display',
  implemented: true,
};
