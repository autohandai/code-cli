/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { t } from '../i18n/index.js';

export type ToolPhase = 'running' | 'done';

/** Tools whose internal name says nothing to the person reading the transcript. */
const LABEL_KEYS: Readonly<Record<string, Record<ToolPhase, string>>> = {
  run_tool_script: { running: 'ui.scriptRunning', done: 'ui.scriptRan' },
};

export function hasToolDisplayLabel(tool: string | undefined): boolean {
  return tool !== undefined && Object.hasOwn(LABEL_KEYS, tool);
}

/** The name shown for a tool: a translated phrase where one exists, the tool's own name otherwise. */
export function toolDisplayLabel(tool: string | undefined, phase: ToolPhase): string {
  if (tool !== undefined && Object.hasOwn(LABEL_KEYS, tool)) return t(LABEL_KEYS[tool][phase]);
  return tool ?? 'Tool';
}

export type DetailsHint = 'expand' | 'expandLatest' | 'collapse';

const HINT_KEYS: Readonly<Record<DetailsHint, string>> = {
  expand: 'ui.detailsExpandClick',
  expandLatest: 'ui.detailsExpand',
  collapse: 'ui.detailsCollapse',
};

/** The row under a result that says its details can be opened or closed, and how. */
export function detailsHint(hint: DetailsHint): string {
  return `${hint === 'collapse' ? '▾' : '▸'} ${t(HINT_KEYS[hint])}`;
}
