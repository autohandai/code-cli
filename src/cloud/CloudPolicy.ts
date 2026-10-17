import { open } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { LoadedConfig } from '../types.js';

const policy = z.object({
  mode: z.string().optional(),
  denyList: z.array(z.unknown()).optional(), blacklist: z.array(z.unknown()).optional(),
  rules: z.array(z.unknown()).optional(), denyPatterns: z.array(z.unknown()).optional(),
  excludedTools: z.array(z.unknown()).optional(), availableTools: z.array(z.unknown()).optional(),
});
function check(value: unknown, readOnly: boolean): void {
  const settings = policy.parse(value ?? {});
  const denied = [...(settings.denyList ?? []), ...(settings.blacklist ?? [])];
  const mutatingOnly = (value: unknown) => typeof value === 'string' && /^(git_merge|write_file|delete_path|apply_patch)(:.*)?$/.test(value);
  const incompatibleMode = settings.mode && !['interactive', 'unrestricted', ...(readOnly ? ['restricted'] : [])].includes(settings.mode);
  if (incompatibleMode || denied.some(value => !readOnly || !mutatingOnly(value)) || [settings.rules, settings.denyPatterns, settings.excludedTools, settings.availableTools].some(items => items?.length)) {
    throw new Error('Cloud cannot enforce this local security policy. Keep this task local or configure an equivalent hosted policy before using Cloud.');
  }
}
export async function validateCloudPolicy(config: LoadedConfig, workspaceRoot: string, readOnly = false): Promise<void> {
  check(config.permissions, readOnly);
  for (const name of ['settings.local.json', 'session-permissions.json']) {
    let contents: string;
    try {
      const file = await open(path.join(workspaceRoot, '.autohand', name), 'r');
      try {
        const buffer = Buffer.alloc(64_001), { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        if (bytesRead > 64_000) throw new Error('Review the local security policy before using Cloud: the settings file is too large.');
        contents = buffer.subarray(0, bytesRead).toString('utf8');
      } finally { await file.close(); }
    }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue; throw error; }
    const value: unknown = JSON.parse(contents);
    check(name === 'settings.local.json' ? z.object({ permissions: policy.optional() }).parse(value).permissions : value, readOnly);
  }
}
