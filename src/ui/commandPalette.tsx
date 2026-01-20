/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useMemo, useState } from 'react';
import { Box, Text, useInput, render } from 'ink';
import type { SlashCommand } from '../core/slashCommands.js';
import { I18nProvider, useTranslation } from './i18n/index.js';

export async function showCommandPalette(
  commands: SlashCommand[],
  statusLine?: string
): Promise<string | null> {
  if (!process.stdout.isTTY) {
    return commands[0]?.command ?? null;
  }

  return new Promise((resolve) => {
    let unmounted = false;
    const instance = render(
      <I18nProvider>
        <CommandPalette
          commands={commands}
          statusLine={statusLine}
          onSubmit={(value) => {
            if (unmounted) {
              return;
            }
            unmounted = true;
            instance.unmount();
            resolve(value);
          }}
        />
      </I18nProvider>,
      { exitOnCtrlC: false }
    );
  });
}

interface CommandPaletteProps {
  commands: SlashCommand[];
  statusLine?: string;
  onSubmit: (value: string | null) => void;
}

function CommandPalette({ commands, statusLine, onSubmit }: CommandPaletteProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('/');
  const [cursor, setCursor] = useState(0);

  const filtered = useMemo(() => {
    const seed = filter.replace(/^\//, '').toLowerCase();
    if (!seed) {
      return commands;
    }
    return commands.filter((cmd) => cmd.command.replace('/', '').toLowerCase().includes(seed));
  }, [commands, filter]);

  const visibleCursor = filtered.length ? Math.min(cursor, filtered.length - 1) : 0;

  useInput((input, key) => {
    if (key.escape) {
      onSubmit(null);
      return;
    }

    if (key.return) {
      const item = filtered[visibleCursor];
      onSubmit(item?.command ?? null);
      return;
    }

    if (key.downArrow) {
      if (!filtered.length) {
        return;
      }
      setCursor((prev) => (prev + 1) % filtered.length);
      return;
    }

    if (key.upArrow) {
      if (!filtered.length) {
        return;
      }
      setCursor((prev) => (prev - 1 + filtered.length) % filtered.length);
      return;
    }

    if (key.backspace || key.delete) {
      setFilter((prev) => (prev.length > 1 ? prev.slice(0, -1) : '/'));
      setCursor(0);
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      setFilter((prev) => prev + input);
      setCursor(0);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      {statusLine ? <Text color="gray">{statusLine}</Text> : null}
      <Text color="cyan">{t('ui.commandPalette')}</Text>
      <Text>
        <Text color="magenta">Command: </Text>
        <Text>{filter}</Text>
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {filtered.length === 0 && <Text color="gray">{t('ui.noMatchingCommands')}</Text>}
        {filtered.map((cmd, index) => (
          <Text key={cmd.command} color={index === visibleCursor ? 'cyan' : undefined}>
            {index === visibleCursor ? '▸' : ' '} {cmd.command}{' '}
            <Text color="gray">— {cmd.description}</Text>
          </Text>
        ))}
      </Box>
      <Text color="gray">{t('ui.navigateHint')}</Text>
    </Box>
  );
}
