/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { stripVTControlCharacters } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlainUIManager } from '../../src/ui/PlainUIManager.js';
import { setTerminalMarkdownPreference } from '../../src/ui/terminalMarkdown.js';

afterEach(() => {
  vi.restoreAllMocks();
  setTerminalMarkdownPreference(() => true);
});

function printedFinalResponse(response: string): string {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  createPlainUIManager({ silentMode: true }).setFinalResponse(response);
  return stripVTControlCharacters(log.mock.calls.map(([text]) => String(text)).join('\n'));
}

describe('PlainUIManager final response markdown', () => {
  it('prints rendered markdown when rendering is on', () => {
    const printed = printedFinalResponse('### Title\n- item');

    expect(printed).toContain('Title');
    expect(printed).not.toContain('###');
    expect(printed).toContain('• item');
  });

  it('prints the markdown as written when rendering is off', () => {
    setTerminalMarkdownPreference(() => false);

    const printed = printedFinalResponse('### Title\n- item');

    expect(printed).toContain('### Title');
    expect(printed).toContain('- item');
  });
});
