import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Session } from 'tuistory';

export const FIRST_PLAN_NOTES = [
  '## Goal',
  'Refresh session tokens lazily instead of at startup.',
  '',
  '## Steps',
  '1. Read src/session/store.ts and list every caller of refreshToken',
  '   - note which callers run at startup',
  '2. Extract a TokenRefresher class',
  '3. Run the test suite',
  '',
  '## Risks',
  '- The mobile relay reads the token synchronously',
].join('\n');

export const REFINED_PLAN_NOTES = FIRST_PLAN_NOTES.replace(
  '3. Run the test suite',
  '3. Replace the eager refresh with a lazy getter\n4. Run the test suite',
);

export const REVIEW_PROMPT = 'Would you like to proceed?';

/** Submits the planning request and waits for the review prompt of the refined plan. */
export async function planUntilReview(session: Session): Promise<string> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.type('Plan the token refresh refactor');
  await session.press('enter');
  return await session.text({
    timeout: 30_000,
    waitFor: (text) => text.includes(REVIEW_PROMPT) || text.includes('resume an incomplete plan'),
    trimEnd: true,
  });
}

export async function findPlanFile(plansDir: string, containing: string): Promise<string> {
  for (const name of await readdir(plansDir)) {
    const filePath = path.join(plansDir, name);
    if ((await readFile(filePath, 'utf8')).includes(containing)) return filePath;
  }
  throw new Error(`No saved plan contains "${containing}".`);
}

/** Opens the plan from the review prompt, edits the saved file the way a user would, and accepts it. */
export async function openEditAndAcceptPlan(session: Session, planFile: string, addedStep: string): Promise<void> {
  await session.press(['ctrl', 'g']);
  await session.waitForText('Opened with code', { timeout: 10_000 });
  // Edit the notes, which is the part of the file a person reads; the checklist above it is derived.
  const [checklist, notes] = (await readFile(planFile, 'utf8')).split('## Notes');
  if (!notes) throw new Error('The saved plan has no notes section to edit.');
  await writeFile(planFile, `${checklist}## Notes${notes.replace('4. Run the test suite', `4. ${addedStep}\n5. Run the test suite`)}`);
  await session.type('2');
  await session.waitForText('Using the plan as you edited it', { timeout: 10_000 });
}
