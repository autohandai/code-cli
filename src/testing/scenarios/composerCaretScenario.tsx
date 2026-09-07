/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState } from 'react';
import { Box, Static, Text, render, useApp, useInput } from 'ink';
import { InputLine } from '../../ui/ink/InputLine.js';
import { StatusLine } from '../../ui/ink/StatusLine.js';
import { I18nProvider } from '../../ui/i18n/index.js';
import { ThemeProvider } from '../../ui/theme/ThemeContext.js';

function ComposerCaretScenario() {
  const [value, setValue] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [mounted, setMounted] = useState(true);
  const [extraRow, setExtraRow] = useState(false);
  const [messages, setMessages] = useState<number[]>([]);
  const { exit } = useApp();
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
    } else if (key.ctrl && input === 'd') {
      setEnabled((previous) => !previous);
    } else if (key.ctrl && input === 'u') {
      setMounted((previous) => !previous);
    } else if (key.ctrl && input === 'l') {
      setExtraRow((previous) => !previous);
    } else if (key.ctrl && input === 's') {
      setMessages((previous) => [...previous, previous.length + 1]);
    } else {
      setValue((previous) => previous + input);
    }
  });

  return (
    <Box flexDirection="column">
      <Static items={messages}>{(message) => <Text key={message}>CARET_TRANSCRIPT_{message}</Text>}</Static>
      <StatusLine isWorking={!process.argv.includes('--idle')} status="CARET_BACKGROUND_ACTIVE" />
      {extraRow ? <Text>CARET_EXTRA_ROW</Text> : null}
      <Text>{mounted ? (enabled ? 'CARET_ENABLED' : 'CARET_DISABLED') : 'CARET_UNMOUNTED'}</Text>
      {mounted ? <InputLine value={value} cursorOffset={value.length} isActive width={80} enableHardwareCursor={enabled} /> : null}
    </Box>
  );
}

const instance = render(
  <I18nProvider>
    <ThemeProvider>
      <ComposerCaretScenario />
    </ThemeProvider>
  </I18nProvider>,
  { incrementalRendering: process.argv.includes('--incremental') },
);
await instance.waitUntilExit();
