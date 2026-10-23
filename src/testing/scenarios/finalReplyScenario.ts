import type { Session } from 'tuistory';

export async function startReviewedReply(session: Session): Promise<void> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.type('Read package.json and give the verified facts.');
  await session.press('enter');
  await session.waitForText('REVIEW_PENDING_ANSWER', { timeout: 20_000 });
  await session.waitForText('completion review is pending', { timeout: 10_000 });
}

export async function configureExaSearch(session: Session): Promise<void> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.type('/search'); await session.press('enter');
  await session.waitForText('Select search provider:', { timeout: 15_000 });
  await session.press('down'); await session.press('enter');
  await session.waitForText('Enter Exa.ai API key:');
  await session.type('exa-terminal-fixture'); await session.press('enter');
  await session.waitForText('saved to config', { timeout: 10_000 });
}

export async function changeSearchInSettings(session: Session): Promise<void> {
  if (session.exitInfo) throw new Error(`CLI exited after /search: ${session.getRawOutput().slice(-6000)}`);
  await session.waitForText('❯', { timeout: 10_000 });
  await session.type('/settings search.provider parallel'); await session.press('enter');
  await session.waitForText('search.provider', { timeout: 10_000 });
  await session.type('/search'); await session.press('enter');
  await session.waitForText('Select search provider:', { timeout: 10_000 });
  await session.text({ timeout: 10_000, waitFor: text => /▸\s+\d+\.\s+Parallel\.ai/.test(text) });
  await session.press('escape');
}

export async function configureRouterPolicy(session: Session, baseUrl: string): Promise<void> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.type('/model'); await session.press('enter');
  await session.waitForText('Change provider'); await session.type('3');
  await session.waitForText('Choose an LLM provider');
  await session.press('up'); await session.press('enter');
  await session.waitForText('Provider display name');
  await session.type('Routes'); await session.press('enter');
  await session.waitForText('OpenAI-compatible base URL');
  await session.press(['ctrl', 'e']);
  for (let i = 0; i < 'https://api.example.com/v1'.length; i++) await session.press('backspace');
  await session.type(baseUrl); await session.press('enter');
  await session.waitForText('Does this provider require an API key?'); await session.press('enter');
  await session.waitForText('API key'); await session.type('router-terminal-key'); await session.press('enter');
  await session.waitForText('model ID');
  await session.press(['ctrl', 'e']);
  for (let i = 0; i < 'gpt-4o'.length; i++) await session.press('backspace');
  await session.type('router-balanced'); await session.press('enter');
  await session.waitForText('Context window tokens'); await session.press('enter');
  await session.waitForText('Configure reasoning effort'); await session.press('enter');
  await session.waitForText('Save this provider with model router-balanced anyway?');
  await session.press('up'); await session.press('enter');
  await session.waitForText('configured successfully', { timeout: 10_000 });
}
