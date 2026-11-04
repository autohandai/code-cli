import fs from 'node:fs/promises';
import path from 'node:path';
import type { Session } from 'tuistory';
import { getManifestTarget } from '../../browser/chrome.js';
import { waitForExit } from '../drivers/tuistory-driver.js';

export async function inspectBrowserBridgeInstall(session: Session, homeDir: string): Promise<{
  output: string;
  allowedOrigins: string[];
  savedExtensionId?: string;
}> {
  await waitForExit(session, 15_000);
  if (session.exitInfo?.exitCode !== 0) throw new Error(session.readAll());
  const manifest: { allowed_origins: string[] } = JSON.parse(await fs.readFile(
    getManifestTarget('chrome', process.platform, homeDir).manifestPath, 'utf8',
  ));
  const saved: { chrome?: { extensionId?: string } } = JSON.parse(await fs.readFile(
    path.join(homeDir, 'config.json'), 'utf8',
  ));
  return { output: session.readAll(), allowedOrigins: manifest.allowed_origins, savedExtensionId: saved.chrome?.extensionId };
}
