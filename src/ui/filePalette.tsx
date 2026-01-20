/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useMemo, useState } from 'react';
import { Box, Text, useInput, render } from 'ink';
import { I18nProvider, useTranslation } from './i18n/index.js';

export interface FilePaletteOptions {
  files: string[];
  statusLine?: string;
  seed?: string;
}

export async function showFilePalette(options: FilePaletteOptions): Promise<string | null> {
  const { files, statusLine, seed } = options;
  if (!files.length) {
    return null;
  }
  if (!process.stdout.isTTY) {
    return files[0];
  }

  return new Promise((resolve) => {
    let completed = false;
    const instance = render(
      <I18nProvider>
        <FilePalette
          files={files}
          statusLine={statusLine}
          seed={seed}
          onSubmit={(value) => {
            if (completed) {
              return;
            }
            completed = true;
            instance.unmount();
            resolve(value);
          }}
        />
      </I18nProvider>,
      { exitOnCtrlC: false }
    );
  });
}

interface FilePaletteProps {
  files: string[];
  statusLine?: string;
  seed?: string;
  onSubmit: (value: string | null) => void;
}

function FilePalette({ files, statusLine, seed, onSubmit }: FilePaletteProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(seed ?? '');
  const [cursor, setCursor] = useState(0);

  const filtered = useMemo(() => {
    const normalized = value.toLowerCase();
    if (!normalized) {
      return files;
    }
    return files.filter((file) => file.toLowerCase().includes(normalized));
  }, [files, value]);

  const cursorIndex = filtered.length ? Math.min(cursor, filtered.length - 1) : 0;

  useInput((input, key) => {
    if (key.escape) {
      onSubmit(null);
      return;
    }
    if (key.return) {
      onSubmit(filtered[cursorIndex] ?? null);
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
      setValue((prev) => prev.slice(0, -1));
      setCursor(0);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setValue((prev) => prev + input);
      setCursor(0);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      {statusLine ? <Text color="gray">{statusLine}</Text> : null}
      <Text color="cyan">{t('ui.selectFile')}</Text>
      <Text>
        <Text color="magenta">{t('ui.typeToFilter')}: </Text>
        <Text>{value || ' '}</Text>
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {filtered.length === 0 && <Text color="gray">{t('ui.noMatchingFiles')}</Text>}
        {filtered.slice(0, 20).map((file, index) => (
          <Text key={file} color={index === cursorIndex ? 'cyan' : undefined}>
            {index === cursorIndex ? '▸' : ' '} {file}
          </Text>
        ))}
      </Box>
      <Text color="gray">{t('ui.fileNavigateHint')}</Text>
    </Box>
  );
}
