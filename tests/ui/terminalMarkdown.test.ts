/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { stripVTControlCharacters } from 'node:util';
import { readFileSync } from 'node:fs';
import stringWidth from 'string-width';
import { markdownRenderingSample } from '../../src/testing/scenarios/markdownRenderingScenario.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatAssistantMarkdown,
  isTerminalMarkdownEnabled,
  renderMarkdownForTerminal,
  setTerminalMarkdownPreference,
} from '../../src/ui/terminalMarkdown.js';

vi.mock('terminal-link', () => ({
  default: Object.assign((text: string, url: string) => `\u001b]8;;${url}\u0007${text}\u001b]8;;\u0007`, { isSupported: true }),
}));

const plain = (markdown: string) => renderMarkdownForTerminal(markdown, { color: false, hyperlinks: false, width: 60 });

afterEach(() => {
  setTerminalMarkdownPreference(() => true);
});

describe('renderMarkdownForTerminal', () => {
  it('matches the rich terminal transcript snapshot', () => {
    const snapshot = readFileSync(new URL('../../src/testing/snapshots/markdown-rich.txt', import.meta.url), 'utf8');
    expect(plain(markdownRenderingSample())).toBe(snapshot.trimEnd());
  });

  it('uses the enclosing link for linked images without nesting terminal hyperlinks', () => {
    const rendered = renderMarkdownForTerminal('[![Preview](./preview.png)](https://example.test/full)', { color: false });
    expect(rendered).toContain('\u001b]8;;https://example.test/full\u0007Image: Preview');
    expect(rendered).not.toContain('file://');
  });

  it('wraps styled Unicode text without splitting its visible column budget', () => {
    const rendered = renderMarkdownForTerminal('- **你好 👩‍💻** and more readable text', { color: true, width: 16 });
    expect(rendered.split('\n').every(line => stringWidth(line) <= 16)).toBe(true);
    expect(stripVTControlCharacters(rendered)).toContain('你好 👩‍💻');
  });

  it('emits clickable labels for web links and local images when supported', () => {
    const rendered = renderMarkdownForTerminal('[Docs](https://example.test)\n\n![Preview](./preview.png)', { color: false });

    expect(rendered).toContain('\u001b]8;;https://example.test\u0007Docs');
    expect(rendered).toContain(`\u001b]8;;file://${process.cwd()}/preview.png\u0007Image: Preview`);
    expect(stripVTControlCharacters(rendered)).toBe('Docs\n\nImage: Preview');
  });

  it('never emits active links for executable schemes or terminal control sequences from content', () => {
    const rendered = renderMarkdownForTerminal('[Run](javascript:alert)\n\nhello\u001b]52;c;c2VjcmV0\u0007 world', { color: false });

    expect(rendered).not.toContain('\u001b]8;;javascript:');
    expect(rendered).not.toContain('\u001b]52;');
    expect(rendered).toContain('hello world');
  });

  it('wraps prose and list continuations within the available columns', () => {
    const rendered = renderMarkdownForTerminal('A short introduction that should wrap.\n\n- A long list item that remains aligned with its text\n  - A nested item that also wraps neatly', { color: false, width: 24 });

    expect(rendered.split('\n').every(line => stringWidth(line) <= 24)).toBe(true);
    expect(rendered).toContain('• A long list item that\n  remains aligned with\n  its text');
    expect(rendered).toContain('  ◦ A nested item that\n    also wraps neatly');
  });

  it('keeps wide tables within the terminal and preserves every cell', () => {
    const rendered = renderMarkdownForTerminal('| Package | Description |\n| --- | --- |\n| cli | A long description for a small terminal |', { color: false, width: 28 });

    expect(rendered.split('\n').every(line => stringWidth(line) <= 28)).toBe(true);
    expect(rendered).toContain('Package');
    expect(rendered.replace(/\s*│\s*/g, ' ').replace(/\s+/g, ' ')).toContain('A long description for a small terminal');
  });

  it('resolves reference links and images without printing definition syntax', () => {
    const rendered = plain('[Documentation][docs]\n\n![Architecture][diagram]\n\n[docs]: https://example.test/docs\n[diagram]: https://example.test/diagram.png');

    expect(rendered).toContain('Documentation (https://example.test/docs)');
    expect(rendered).toContain('Image: Architecture');
    expect(rendered).toContain('https://example.test/diagram.png');
    expect(rendered).not.toContain('[docs]:');
    expect(rendered).not.toContain('![Architecture]');
  });

  it('labels images clearly and keeps their destination accessible without graphics support', () => {
    expect(plain('![Build preview](./preview.png)')).toBe('Image: Build preview (./preview.png)');
  });

  it('resolves nested definitions and preserves the first destination for duplicate references', () => {
    expect(plain('[Docs][ref]\n\n> [ref]: https://first.test\n\n[ref]: https://second.test')).toContain('Docs (https://first.test)');
  });

  it('gives fenced code a left rail and wraps it without losing content', () => {
    const rendered = renderMarkdownForTerminal('```ts\nconst greeting = "hello world";\n```', { color: false, width: 24 });

    expect(rendered).toContain('│ const greeting =');
    expect(rendered.split('\n').every(line => stringWidth(line) <= 24)).toBe(true);
    expect(rendered).toContain('"hello world";');
  });

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

  it('renders fenced code with its original indentation inside a left rail', () => {
    const rendered = plain('Before\n\n```ts\nconst answer = 42;\n  return answer;\n```\n\nAfter');

    expect(rendered).toBe('Before\n\nts\n│ const answer = 42;\n│   return answer;\n\nAfter');
    expect(rendered).not.toContain('```');
  });

  it('renders an unterminated fence while a response is still streaming', () => {
    expect(plain('```python\nprint("partial"')).toBe('python\n│ print("partial"');
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
