import React from 'react';
import { stripVTControlCharacters } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { renderInkScreen } from '../../../src/testing/drivers/ink-driver.js';
import { MarkdownText } from '../../../src/ui/ink/components/MarkdownText.js';
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
