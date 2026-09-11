/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { stripVTControlCharacters } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  formatAssistantMarkdown,
  isTerminalMarkdownEnabled,
  renderMarkdownForTerminal,
  setTerminalMarkdownPreference,
} from '../../src/ui/terminalMarkdown.js';

const plain = (markdown: string) => renderMarkdownForTerminal(markdown, { color: false, width: 60 });

afterEach(() => {
  setTerminalMarkdownPreference(() => true);
});

describe('renderMarkdownForTerminal', () => {
  it('drops heading markers and keeps the heading text', () => {
    expect(plain('### 1. Inline thinking extraction')).toBe('1. Inline thinking extraction');
    expect(plain('# Title\n\n## Section')).toBe('Title\n\nSection');
  });

  it('renders bullet, nested, ordered, and task lists', () => {
    expect(plain('- first\n- second\n  - nested')).toBe('• first\n• second\n  ◦ nested');
    expect(plain('3. three\n4. four')).toBe('3. three\n4. four');
    expect(plain('- [ ] todo\n- [x] done')).toBe('☐ todo\n☑ done');
  });

  it('keeps inline code readable without color and styles it without backticks when color is on', () => {
    expect(plain('Run `bun run proof` now')).toBe('Run `bun run proof` now');

    const colored = renderMarkdownForTerminal('Run `bun run proof` now', { color: true, width: 60 });
    expect(colored).not.toBe(stripVTControlCharacters(colored));
    expect(stripVTControlCharacters(colored)).toBe('Run bun run proof now');
  });

  it('styles bold and italic text only when color is on', () => {
    expect(plain('**bold** and _italic_')).toBe('bold and italic');
    const colored = renderMarkdownForTerminal('**bold**', { color: true, width: 60 });
    expect(colored).toContain('[1m');
  });

  it('renders fenced code verbatim, indented under its language, without fence markers', () => {
    const rendered = plain('Before\n\n```ts\nconst answer = 42;\n  return answer;\n```\n\nAfter');

    expect(rendered).toBe('Before\n\n  ts\n  const answer = 42;\n    return answer;\n\nAfter');
    expect(rendered).not.toContain('```');
  });

  it('renders an unterminated fence while a response is still streaming', () => {
    expect(plain('```python\nprint("partial"')).toBe('  python\n  print("partial"');
  });

  it('renders block quotes, rules, and links', () => {
    expect(plain('> quoted line')).toBe('│ quoted line');
    expect(plain('---')).toMatch(/^─+$/);
    expect(plain('[docs](https://docs.example.test)')).toBe('docs (https://docs.example.test)');
    expect(plain('<https://docs.example.test>')).toBe('https://docs.example.test');
  });

  it('aligns table columns with box drawing separators', () => {
    const rendered = plain('| Name | Count |\n| --- | ---: |\n| hooks | 2 |\n| servers | 10 |');

    expect(rendered.split('\n')).toEqual([
      'Name    │ Count',
      '────────┼──────',
      'hooks   │     2',
      'servers │    10',
    ]);
  });

  it('turns the raw status summary from the report into readable terminal text', () => {
    const rendered = plain([
      '### 1. Inline thinking extraction (`src/providers/inlineThinking.ts`)',
      '- New `splitInlineThinking` utilities',
      '- Wired into **LLMGatewayClient**',
      '',
      '## State & risk',
      '1. Run the unit suite',
    ].join('\n'));

    expect(rendered).not.toMatch(/^#{1,6} /m);
    expect(rendered).toContain('• New `splitInlineThinking` utilities');
    expect(rendered).toContain('• Wired into LLMGatewayClient');
    expect(rendered).toContain('State & risk');
    expect(rendered).toContain('1. Run the unit suite');
  });
});

describe('terminal markdown preference', () => {
  it('is on by default and follows the configured provider', () => {
    expect(isTerminalMarkdownEnabled()).toBe(true);

    let enabled = false;
    setTerminalMarkdownPreference(() => enabled);
    expect(isTerminalMarkdownEnabled()).toBe(false);

    enabled = true;
    expect(isTerminalMarkdownEnabled()).toBe(true);
  });

  it('leaves assistant markdown as written when rendering is turned off', () => {
    setTerminalMarkdownPreference(() => false);

    const output = stripVTControlCharacters(formatAssistantMarkdown('### Title\n- item\n`code`'));

    expect(output).toBe('### Title\n- item\n`code`');
  });

  it('renders assistant markdown when rendering is on', () => {
    setTerminalMarkdownPreference(() => true);

    const output = stripVTControlCharacters(formatAssistantMarkdown('### Title\n- item'));

    expect(output).not.toContain('###');
    expect(output).toContain('• item');
  });
});
