/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useCallback, useState } from 'react';
import { Box, Text, render } from 'ink';
import { AgentUI, createInitialUIState } from '../../ui/ink/AgentUI.js';
import { I18nProvider } from '../../ui/i18n/index.js';
import { ThemeProvider } from '../../ui/theme/ThemeContext.js';

function HistoryScenario() {
  const [state, setState] = useState(createInitialUIState);
  const [submitted, setSubmitted] = useState({ count: 0, text: '' });
  const onInputChange = useCallback((currentInput: string) => {
    setState(previous => previous.currentInput === currentInput ? previous : { ...previous, currentInput });
  }, []);
  return <I18nProvider><ThemeProvider><Box flexDirection="column">
    <Text>{`SUBMITTED ${submitted.count}: ${submitted.text}`}</Text>
    <AgentUI
      state={state}
      onInputChange={onInputChange}
      onInstruction={text => setSubmitted(previous => ({ count: previous.count + 1, text }))}
      onEscape={() => {}}
      onCtrlC={() => { process.stdout.write('\nHISTORY_PTY_EXIT\n', () => process.exit(0)); }}
    />
  </Box></ThemeProvider></I18nProvider>;
}

render(<HistoryScenario />, { exitOnCtrlC: false });
