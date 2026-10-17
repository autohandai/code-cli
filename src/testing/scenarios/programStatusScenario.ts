import type { Session } from 'tuistory';

export async function submitProgramStatusPrompt(session: Session, instruction: string): Promise<void> {
  await session.waitForText('❯');
  await session.type(instruction);
  await session.press('enter');
}
