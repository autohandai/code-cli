/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { ThinkingOutput } from '../../../src/ui/ink/ThinkingOutput.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';
import { I18nProvider } from '../../../src/ui/i18n/index.js';

function renderWithProviders(thought: string | null) {
  return render(
    <I18nProvider>
      <ThemeProvider>
        <ThinkingOutput thought={thought} />
      </ThemeProvider>
    </I18nProvider>
  );
}

describe('ThinkingOutput', () => {
  it('renders thought text when provided', () => {
    const { lastFrame } = renderWithProviders('Analyzing the code structure...');
    const output = lastFrame();
    expect(output).toContain('Analyzing the code structure...');
  });

  it('renders null when thought is null', () => {
    const { lastFrame } = renderWithProviders(null);
    const output = lastFrame();
    expect(output).toBe('');
  });

  it('renders null when thought is empty string', () => {
    const { lastFrame } = renderWithProviders('');
    const output = lastFrame();
    expect(output).toBe('');
  });

  it('renders thought that was extracted from JSON (no longer filtered)', () => {
    // After the fix, thoughts that were previously filtered because they
    // started with { are now displayed since parseAssistantReactPayload
    // has already extracted the text from JSON by this point.
    // However, the thought prop should already be clean text.
    const { lastFrame } = renderWithProviders('The user greeted me with hey there');
    const output = lastFrame();
    expect(output).toContain('The user greeted me with hey there');
  });
});
