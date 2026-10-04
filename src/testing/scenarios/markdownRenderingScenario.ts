import type { Session } from 'tuistory';

export function markdownRenderingSample(marker = 'RENDERED_HEADING'): string {
  return [
    `### ${marker}`,
    '- first `inline_code` item',
    '- second item',
    '',
    '| Area | Status |',
    '| --- | --- |',
    '| hooks | done |',
    '',
    '[Documentation][docs]',
    '',
    '![Architecture](https://example.test/architecture.png)',
    '',
    '```ts',
    'const ready = true;',
    '```',
    '',
    '> A readable quote.',
    '',
    '[docs]: https://example.test/docs',
  ].join('\n');
}

/** Submit a prompt in the composer and wait until the expected text renders. */
export async function submitPromptAndWait(session: Session, prompt: string, expected: string | RegExp): Promise<void> {
  await session.type(prompt);
  // Wait for the composer echo so text and Enter cannot coalesce into pasted input.
  await session.waitForText(`❯ ${prompt}`);
  await session.press('enter');
  await session.waitForText(expected, { timeout: 20_000 });
}

/** Toggle terminal markdown rendering through the /settings command. */
export async function setMarkdownRendering(session: Session, enabled: boolean): Promise<void> {
  await session.type(`/settings ui.renderMarkdown ${enabled}`);
  await session.press('enter');
  await session.waitForText(`Set ui.renderMarkdown = ${enabled}`, { timeout: 20_000 });
}
