import React from 'react';
import { Box } from 'ink';
import { stripVTControlCharacters } from 'node:util';
import stringWidth from 'string-width';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderInkScreen } from '../../../src/testing/drivers/ink-driver.js';
import { MarkdownText } from '../../../src/ui/ink/components/MarkdownText.js';
import { AgentUI, createInitialUIState } from '../../../src/ui/ink/AgentUI.js';
import { I18nProvider } from '../../../src/ui/i18n/index.js';
import { setTerminalMarkdownPreference } from '../../../src/ui/terminalMarkdown.js';

const mounted: { unmount(): void }[] = [];
afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount();
  setTerminalMarkdownPreference(() => true);
});

const content = '### Release notes\n- Added `trust` prompt\n\n| Area | Status |\n| --- | --- |\n| hooks | done |';

function frameOf(view: ReturnType<typeof renderInkScreen>): string {
  return stripVTControlCharacters(view.lastFrame() ?? '');
}

describe('MarkdownText', () => {
  it('reflows list continuations when the terminal becomes narrower', async () => {
    const view = renderInkScreen(<MarkdownText content="- A long list item that remains aligned with its text" />);
    mounted.push(view);
    await new Promise<void>(resolve => setImmediate(resolve));
    Object.defineProperty(view.stdout, 'columns', { configurable: true, value: 24 });
    view.stdout.emit('resize');

    await vi.waitFor(() => expect(frameOf(view)).toContain('• A long list item that\n  remains aligned with\n  its text'));
  });

  it('uses the same markdown presentation while the assistant is streaming', () => {
    const view = renderInkScreen(<I18nProvider><AgentUI
      state={{ ...createInitialUIState(), isWorking: true, streamingResponse: '## Progress\n\n- Reading the project\n\n![Preview](https://example.test/preview.png)' }}
      onInstruction={() => {}} onEscape={() => {}} onCtrlC={() => {}}
    /></I18nProvider>);
    mounted.push(view);

    expect(frameOf(view)).not.toContain('## Progress');
    expect(frameOf(view)).toContain('• Reading the project');
    expect(frameOf(view)).toContain('Image: Preview');
  });

  it('uses a readable column width on wide terminals', () => {
    const view = renderInkScreen(<Box width={160}><MarkdownText content={'Readable text with breathing room. '.repeat(10)} /></Box>);
    mounted.push(view);

    expect(frameOf(view).split('\n').every(line => stringWidth(line) <= 100)).toBe(true);
    expect(frameOf(view).split('\n').length).toBeGreaterThan(3);
  });

  it('renders headings, lists, and tables in the terminal when markdown rendering is on', () => {
    const view = renderInkScreen(<MarkdownText content={content} />);
    mounted.push(view);
    const frame = frameOf(view);

    expect(frame).toContain('Release notes');
    expect(frame).not.toContain('###');
    expect(frame).toMatch(/•\s+Added/);
    expect(frame).toMatch(/Area\s+│\s+Status/);
    expect(frame).not.toContain('| --- |');
  });

  it('shows the markdown as written when rendering is off', () => {
    setTerminalMarkdownPreference(() => false);
    const view = renderInkScreen(<MarkdownText content={content} />);
    mounted.push(view);
    const frame = frameOf(view);

    expect(frame).toContain('### Release notes');
    expect(frame).toContain('- Added `trust` prompt');
    expect(frame).toContain('| --- | --- |');
  });

  it('follows a preference change on the next render', () => {
    let enabled = true;
    setTerminalMarkdownPreference(() => enabled);
    const view = renderInkScreen(<MarkdownText content={content} />);
    mounted.push(view);
    expect(frameOf(view)).not.toContain('###');

    enabled = false;
    view.rerender(<MarkdownText content={`${content}\n`} />);

    expect(frameOf(view)).toContain('### Release notes');
  });
});
