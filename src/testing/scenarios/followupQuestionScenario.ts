import type { Session } from 'tuistory';
import { submitProgramStatusPrompt } from './programStatusScenario.js';

export async function answerThreeChoiceFollowup(session: Session): Promise<string> {
  await submitProgramStatusPrompt(session, 'Ask which skill workflow I want');
  await session.text({ timeout: 15_000, waitFor: text => /▸\s+1\. Local discovery/u.test(text) });
  await session.press('down');
  const selected = await session.text({ timeout: 15_000, waitFor: text => /▸\s+2\. Registry matching/u.test(text) });
  await session.press('enter');
  return selected;
}

export async function cancelFollowupAndRetainDraft(session: Session): Promise<string> {
  await session.text({ timeout: 15_000, waitFor: text => text.includes('Which environment?') && /▸\s+1\. Staging/u.test(text) });
  await session.press('escape');
  await session.waitForText('FOLLOWUP_QUESTION_COMPLETE', { timeout: 15_000 });
  await session.waitForText('❯', { timeout: 15_000 });
  await session.type('FOLLOWUP_RETAINED_DRAFT');
  return session.text({ timeout: 15_000, waitFor: text => text.includes('FOLLOWUP_RETAINED_DRAFT') });
}
