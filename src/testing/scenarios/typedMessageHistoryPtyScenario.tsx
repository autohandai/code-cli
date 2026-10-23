/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useCallback, useState } from 'react';
import { Box, Text, render } from 'ink';
import { AgentUI, createInitialUIState, type AgentUIState } from '../../ui/ink/AgentUI.js';
import { I18nProvider } from '../../ui/i18n/index.js';
import { ThemeProvider } from '../../ui/theme/ThemeContext.js';

function HistoryScenario() {
  const [state, setState] = useState<AgentUIState>(() => ({
    ...createInitialUIState(),
    completionStats: { elapsed: '0m 02s', tokens: '↑42.8k ↓12 · context: 16.3% (42.8k/262.1k)' },
    tip: { kind: 'tip', text: 'Type /review security to check auth flows' },
  }));
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
