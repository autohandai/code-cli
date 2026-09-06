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

export async function importClaudeHooks(session: Session): Promise<void> {
  await session.waitForText('❯');
  await session.type('/import claude --categories hooks');
  await session.press('enter');
  await session.waitForText('saved disabled');
}

export async function enableImportedHook(session: Session, index: number): Promise<void> {
  await session.type('/hooks manage');
  await session.press('enter');
  await session.waitForText('Toggle hooks on/off');
  await session.press('down');
  await session.press('enter');
  await session.waitForText('Toggle hooks — spacebar to enable/disable');
  for (let step = 0; step < index; step++) await session.press('down');
  await session.press('space');
  await session.press('enter');
  await session.waitForText('Toggled 1 hook');
}

export async function submitHookScenarioPrompt(session: Session, prompt: string, expected: string): Promise<void> {
  await session.type(prompt);
  await session.press('enter');
  await session.waitForText(expected);
}
