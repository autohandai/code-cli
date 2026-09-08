import type { Session } from 'tuistory';

export async function runNativeContextCropScenario(session: Session): Promise<void> {
  await session.waitForText('❯');
  await session.type('Compact one message from the bottom of context, then continue.');
  await session.press('enter');
  await session.waitForText('NATIVE_CONTEXT_CROP_CONTINUED');
}
