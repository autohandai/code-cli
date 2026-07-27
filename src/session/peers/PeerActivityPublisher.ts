/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { sanitizeAnnouncementText } from '../../announcements/AnnouncementContent.js';
import type {
  ActiveAgentActivity,
  ActiveAgentPhase,
} from '../ActiveAgentRegistry.js';
import { normalizePeerPath } from './PeerWarnings.js';
import type { RepoHead } from './RepoStateReader.js';

const MAX_TEXT_CHARACTERS = 200;
const MAX_PATHS = 20;
const COMMAND_TOOLS = new Set(['run_command', 'shell']);
const EDITING_TOOLS = new Set([
  'add_dependency',
  'append_file',
  'apply_patch',
  'copy_path',
  'create_directory',
  'delete_path',
  'format_file',
  'git_apply_patch',
  'git_checkout',
  'notebook_edit',
  'remove_dependency',
  'rename_path',
  'replace_in_file',
  'search_replace',
  'write_file',
]);

export interface ActivityInput {
  isInstructionActive: boolean;
  awaitingInput: boolean;
  activeTool?: string;
  instruction?: string;
  command?: string;
  pathsWritten: string[];
  headRef?: RepoHead | null;
  claims?: string[];
}

export function derivePhase(input: ActivityInput): ActiveAgentPhase {
  if (!input.isInstructionActive) return 'idle';
  if (input.awaitingInput) return 'waiting_input';
  if (input.activeTool && COMMAND_TOOLS.has(input.activeTool)) return 'running_command';
  if (input.activeTool && EDITING_TOOLS.has(input.activeTool)) return 'editing';
  return 'thinking';
}

export function buildActivity(input: ActivityInput): ActiveAgentActivity {
  const instruction = publishableText(input.instruction);
  const command = publishableText(input.command);
  const pathsWritten = normalizedUniquePaths(input.pathsWritten);
  const claims = input.claims ? normalizedUniquePaths(input.claims) : [];

  return {
    phase: derivePhase(input),
    ...(instruction ? { instruction } : {}),
    ...(command ? { command } : {}),
    pathsWritten,
    ...(claims.length > 0 ? { claims } : {}),
    ...(input.headRef ? { headRef: { ...input.headRef } } : {}),
  };
}

function normalizedUniquePaths(values: string[]): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const value of values) {
    const normalized = normalizePeerPath(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    paths.push(normalized);
    if (paths.length >= MAX_PATHS) {
      break;
    }
  }
  return paths;
}

function publishableText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const sanitized = sanitizeAnnouncementText(value, {
    maxCharacters: MAX_TEXT_CHARACTERS,
    preserveParagraphs: false,
  });
  return sanitized || undefined;
}
