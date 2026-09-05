import type { Session } from 'tuistory';

export async function openLifecycleHooks(session: Session): Promise<void> {
  await session.waitForText('❯');
  await session.type('/hooks');
  await session.press('enter');
  await session.waitForText('Lifecycle hooks from config and enabled plugins.');
}

export async function describeSessionEndHook(session: Session): Promise<void> {
  await openLifecycleHooks(session);
  await session.press('down');
  await session.waitForText(/▸ 2\.\s+session-end/);
  await session.press('enter');
  await session.waitForText('Describe what this hook should do in plain English');
  await session.type('Append SESSION_END_HOOK_RAN to lifecycle.log when the session ends');
  await session.press('enter');
  await session.waitForText('Review lifecycle hook');
}
