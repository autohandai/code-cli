/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { saveConfig } from '../config.js';
import type { LoadedConfig, StatusBarConfig, StatusSectionConfig } from '../types.js';
import { showModal, type ModalOption } from '../ui/ink/components/Modal.js';
import { resolveStatusBarConfig } from '../core/agent/StatusBarConfig.js';

export interface StatusbarCommandContext {
  config: LoadedConfig;
}

// ── Section metadata for display ──────────────────────────────────────────

interface SectionMeta {
  label: string;
  description: string;
}

const SECTION_META: Record<string, SectionMeta> = {
  project: { label: 'Project', description: 'Workspace path with deterministic emoji' },
  git: { label: 'Git branch', description: 'Active branch or worktree name' },
  gitAhead: { label: 'Git ahead', description: 'Commits ahead of remote' },
  gitBehind: { label: 'Git behind', description: 'Commits behind remote' },
  dirty: { label: 'Dirty indicator', description: 'Uncommitted changes marker' },
  worktree: { label: 'Worktree', description: 'Worktree name when not on main' },
  pr: { label: 'Pull request', description: 'Associated PR number' },
  model: { label: 'Model', description: 'Active provider and model name' },
  provider: { label: 'Provider', description: 'Provider name separately from model' },
  mode: { label: 'Mode', description: 'PLAN / YOLO / AUTO indicator' },
  context: { label: 'Context', description: 'Remaining context percentage' },
  tokens: { label: 'Tokens', description: 'Cumulative token usage' },
  cost: { label: 'Cost', description: 'Session cost estimate' },
  clock: { label: 'Clock', description: 'Current time' },
  agents: { label: 'Agents', description: 'Active background agents' },
  mcp: { label: 'MCP servers', description: 'Connected MCP server count' },
  diff: { label: 'Session diff', description: 'Lines added/removed this session' },
  research: { label: 'Research', description: 'Active research sessions' },
  tasks: { label: 'Tasks', description: 'Todo list activity' },
  hints: { label: 'Hints', description: 'Keyboard shortcut hints' },
};

function sectionLabel(id: string): string {
  return SECTION_META[id]?.label ?? id;
}

function sectionDescription(id: string): string {
  return SECTION_META[id]?.description ?? '';
}

// ── Options builders ──────────────────────────────────────────────────────

function buildLayoutOptions(currentLayout: string): ModalOption[] {
  return [
    {
      label: currentLayout === 'classic' ? 'Classic (current)' : 'Classic',
      value: 'classic',
      description: 'Single-line layout — preserves the existing status line shape',
    },
    {
      label: currentLayout === 'two-line' ? 'Two-line (current)' : 'Two-line',
      value: 'two-line',
      description: 'Two-line layout — identity on line 1, state on line 2',
    },
    {
      label: 'Back',
      value: '__back__',
    },
  ];
}

function buildSectionOptions(sections: StatusSectionConfig[]): ModalOption[] {
  const options: ModalOption[] = [];

  const line1Sections = sections.filter((s) => s.line === 1);
  const line2Sections = sections.filter((s) => s.line === 2);

  if (line1Sections.length > 0) {
    options.push({
      label: '─ Line 1: Identity ─',
      value: '__header_1__',
      disabled: true,
    });
    for (const s of line1Sections) {
      options.push({
        label: sectionLabel(s.id),
        value: s.id,
        description: sectionDescription(s.id),
        checked: s.enabled ?? true,
      });
    }
  }

  if (line2Sections.length > 0) {
    options.push({
      label: '─ Line 2: State ─',
      value: '__header_2__',
      disabled: true,
    });
    for (const s of line2Sections) {
      options.push({
        label: sectionLabel(s.id),
        value: s.id,
        description: sectionDescription(s.id),
        checked: s.enabled ?? true,
      });
    }
  }

  options.push({ label: 'Done', value: '__done__', action: true });

  return options;
}

// ── Config persistence ────────────────────────────────────────────────────

function persistStatusBar(config: LoadedConfig, layout: string, sections: StatusSectionConfig[]): void {
  const statusBar: StatusBarConfig = { layout: layout as 'classic' | 'two-line', sections };
  config.ui = { ...config.ui, statusBar };
}

// ── Command ───────────────────────────────────────────────────────────────

export async function statusbar(ctx: StatusbarCommandContext): Promise<string | null> {
  const resolved = resolveStatusBarConfig(ctx.config);
  let currentLayout = resolved.layout;
  let sections = resolved.sections;
  const initialSignature = JSON.stringify({ layout: currentLayout, sections });

  while (true) {
    const result = await showModal({
      title: 'Status Bar',
      options: [
        { label: `Layout: ${currentLayout}`, value: '__layout__', description: 'Choose classic (single line) or two-line layout' },
        { label: 'Toggle sections', value: '__sections__', description: 'Enable or disable individual sections' },
        { label: 'Done', value: '__done__', action: true },
      ],
    });

    if (!result || result.value === '__done__') {
      break;
    }

    if (result.value === '__layout__') {
      const layoutResult = await showModal({
        title: 'Status Bar Layout',
        options: buildLayoutOptions(currentLayout),
      });
      if (layoutResult && (layoutResult.value === 'classic' || layoutResult.value === 'two-line')) {
        currentLayout = layoutResult.value;
      }
      continue;
    }

    if (result.value === '__sections__') {
      const draftSections = sections.map((s) => ({ ...s }));
      const sectionOptions = buildSectionOptions(draftSections);

      await showModal({
        title: 'Toggle Status Bar Sections',
        options: sectionOptions,
        multiSelect: true,
        onToggle: (option, checked) => {
          const idx = draftSections.findIndex((s) => s.id === option.value);
          if (idx >= 0) {
            draftSections[idx].enabled = checked;
          }
        },
      });

      sections = draftSections;
      continue;
    }
  }

  const finalSignature = JSON.stringify({ layout: currentLayout, sections });
  if (finalSignature === initialSignature) {
    return null;
  }

  persistStatusBar(ctx.config, currentLayout, sections);
  await saveConfig(ctx.config);
  return chalk.green('Status bar settings saved.');
}

export const metadata = {
  command: '/statusbar',
  description: 'configure status bar sections and layout',
  implemented: true,
};
