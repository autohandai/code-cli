import type { Session } from 'tuistory';

async function selectModalOption(session: Session, label: string): Promise<void> {
  for (let step = 0; step < 30; step += 1) {
    const screen = await session.text({ trimEnd: true });
    const selected = screen.split('\n').find((line) => line.includes('▸'));
    const optionLabel = selected?.replace(/^\s*▸\s+\d+\.\s*(?:[●○]\s*)?/u, '').trim();
    if (optionLabel === label) {
      await session.press('enter');
      return;
    }
    await session.press('down');
  }
  throw new Error(`Provider picker did not offer ${label}:\n${await session.text({ trimEnd: true })}`);
}

export async function openConfiguredOpenAIModelPicker(session: Session): Promise<string> {
  await session.waitForText('❯');
  await session.type('/model');
  await session.press('enter');
  await session.waitForText('What would you like to change?');
  await selectModalOption(session, 'Change provider');
  await session.waitForText('Choose an LLM provider');
  await selectModalOption(session, 'OpenAI (hosted)');
  await session.waitForText('What would you like to change?');
  await selectModalOption(session, 'Change model only');
  await session.waitForText('Select a model');
  return session.text({ trimEnd: true });
}

export async function acceptConfiguredOpenAIModel(session: Session): Promise<void> {
  await session.press('enter');
  await session.waitForText('Select reasoning effort');
  await session.press('enter');
  await session.waitForText('OpenAI settings updated');
}
