/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fse from 'fs-extra';
import path from 'node:path';

async function resolveUploadPaths(value: unknown, workspaceRoot: string): Promise<string[]> {
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.some((candidate) => typeof candidate !== 'string')
  ) {
    throw new Error('Browser file upload requires a paths array.');
  }
  return Promise.all(value.map(async (candidate) => {
    const resolved = path.isAbsolute(candidate)
      ? path.normalize(candidate)
      : path.resolve(workspaceRoot, candidate);
    const exists = await fse.pathExists(resolved);
    if (!exists || !(await fse.stat(resolved)).isFile()) {
      throw new Error(`Browser upload file is not available: ${path.basename(resolved)}`);
    }
    return resolved;
  }));
}

export async function prepareBrowserFileInputs(
  toolName: string,
  input: Record<string, unknown>,
  workspaceRoot: string,
): Promise<Record<string, unknown>> {
  if (toolName === 'browser_upload_file') {
    return {
      ...input,
      paths: await resolveUploadPaths(input.paths ?? input.files, workspaceRoot),
    };
  }
  if (toolName !== 'browser_fill_form' || !Array.isArray(input.assignments)) {
    return input;
  }

  const assignments: unknown[] = [];
  for (const assignment of input.assignments) {
    if (
      assignment
      && typeof assignment === 'object'
      && !Array.isArray(assignment)
      && (assignment as Record<string, unknown>).kind === 'files'
    ) {
      const record = assignment as Record<string, unknown>;
      assignments.push({
        ...record,
        paths: await resolveUploadPaths(record.paths, workspaceRoot),
      });
    } else {
      assignments.push(assignment);
    }
  }
  return { ...input, assignments };
}
