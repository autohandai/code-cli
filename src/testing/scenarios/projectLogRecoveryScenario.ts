import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ProjectManager } from '../../session/ProjectManager.js';

export async function prepareDamagedProjectLog(autohandHome: string, workspaceRoot: string): Promise<string> {
  const projects = path.join(autohandHome, 'projects');
  const manager = new ProjectManager(projects);
  const hash = await manager.getOrCreateProject(workspaceRoot);
  const failures = path.join(projects, hash, 'failures.jsonl');
  await writeFile(failures, '{"tool":"interrupted historical record');
  return failures;
}
