import type { Session } from 'tuistory';

export const SCRIPT_DESCRIPTION = 'Check the package name';

/** The script the scripted model submits: two reads, aggregated inside the script. */
export const SCRIPT = [
  "const [pkg, missing] = await Promise.all([",
  "  tools.read_file({ path: 'package.json' }),",
  "  tools.read_file({ path: 'does-not-exist.txt' }),",
  ']);',
  "console.log('checked', pkg.ok, missing.ok);",
  "return { hasName: pkg.ok && pkg.output.includes('tuistory-workspace'), missingReadable: missing.ok };",
].join('\n');

export async function runScriptTurn(session: Session, finishedMarker: string): Promise<string> {
  await session.waitForText('❯', { timeout: 20_000 });
  await session.type('Check the package name with a script');
  await session.press('enter');
  await session.waitForText(finishedMarker, { timeout: 30_000 });
  return await session.text({ immediate: true, trimEnd: true });
}
