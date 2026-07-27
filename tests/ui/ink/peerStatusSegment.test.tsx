/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { buildPeerLineExtension } from '../../../src/core/agent/AgentUIRuntime.js';
import { StatusLine } from '../../../src/ui/ink/StatusLine.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';
import { I18nProvider } from '../../../src/ui/i18n/index.js';

describe('buildPeerLineExtension', () => {
  it('renders nothing with no peers', () => {
    expect(buildPeerLineExtension(0)).toBeUndefined();
  });

  it('renders singular and plural peer counts', () => {
    expect(buildPeerLineExtension(1)?.segments?.[0]?.text).toContain('1 peer');
    expect(buildPeerLineExtension(3)?.segments?.[0]?.text).toContain('3 peers');
  });

  it('renders the peer segment through the real Ink status line', () => {
    const { lastFrame } = render(
      <I18nProvider>
        <ThemeProvider>
          <StatusLine
            isWorking={false}
            status=""
            lineExtension={buildPeerLineExtension(2)}
          />
        </ThemeProvider>
      </I18nProvider>,
    );

    expect(lastFrame()).toContain('⚉ 2 peers');
  });
});
