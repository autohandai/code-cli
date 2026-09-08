import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function prepareVerboseCommandScenario(workspaceRoot: string): Promise<string> {
  const scriptPath = path.join(workspaceRoot, 'verbose-output.cjs');
  await writeFile(scriptPath, `process.stdout.write('CAPTURE_HEAD' + 'x'.repeat(2 * 1024 * 1024) + 'CAPTURE_TAIL\\nCAPTURE_DONE\\n');\n`);
  return `node '${scriptPath.replaceAll("'", "'\\''")}'`;
}
