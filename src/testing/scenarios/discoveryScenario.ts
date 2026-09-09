import type { Session } from 'tuistory';
import type { PtyDriver } from '../drivers/pty-driver.js';

export async function runDiscoveryProgressPtyScenario(
  driver: PtyDriver,
  command: string,
  args: string[],
  cwd: string
): Promise<string> {
  driver.launch(command, args, { cwd });
  await driver.waitFor('Discover useful workflows');
  await driver.waitFor('Uploading selected drafts');
  const screen = driver.snapshot();
  driver.ctrlC();
  await driver.waitFor('Discovery cancelled');
  return screen;
}

export async function cancelDiscoveryUpload(session: Session): Promise<void> {
  await session.waitForText('Uploading selected workflows', {
    timeout: 20_000,
  });
  await session.press(['ctrl', 'c']);
}
