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

/** Picks a theme from `/settings` → UI & Display instead of `/theme`. */
export async function selectThemeFromSettings(session: Session, name: string): Promise<void> {
  await session.waitForText('❯');
  await session.type('/settings');
  await session.press('enter');
  await session.waitForText('Select a category:');
  await session.press('1');
  await session.waitForText('Select a setting to change:');
  await session.press('1');
  await session.text({ timeout: 5_000, waitFor: (text) => /▸\s+\d+\.\s*aurora \(current\)/.test(text) });
  for (let step = 0; step < 40; step += 1) {
    const screen = await session.text({ trimEnd: true });
    const selected = screen.split('\n').find(line => line.includes('▸'));
    const label = selected?.replace(/^\s*▸\s+\d+\.\s*/, '').replace(/ \(current\)$/, '').trim();
    if (label === name) {
      await session.press('enter');
      await session.waitForText(`Theme: ${name}`);
      await session.press('escape');
      await session.waitForText('Select a category:');
      await session.press('escape');
      await session.waitForText('❯');
      return;
    }
    await session.press('down');
  }
  throw new Error(`Settings theme picker did not offer ${name}`);
}
