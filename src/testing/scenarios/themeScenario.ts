import type { Session } from 'tuistory';

export async function selectTheme(session: Session, name: string): Promise<void> {
  await session.waitForText('❯');
  await session.type('/theme');
  await session.press('enter');
  await session.waitForText('Select a theme:');
  for (let step = 0; step < 30; step += 1) {
    const screen = await session.text({ trimEnd: true });
    const selected = screen.split('\n').find(line => line.includes('▸'));
    const label = selected?.replace(/^\s*▸\s+\d+\.\s*/, '').replace(/ \(current\)$/, '').trim();
    if (label === name) {
      await session.press('enter');
      await session.waitForText(`Theme changed to '${name}'`);
      return;
    }
    await session.press('down');
  }
  throw new Error(`Theme picker did not offer ${name}`);
}
