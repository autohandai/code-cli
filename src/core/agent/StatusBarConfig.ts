/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  LoadedConfig,
  SectionPriority,
  StatusBarConfig,
  StatusLineSettings,
  StatusSectionConfig,
} from "../../types.js";
import { STATUS_SECTION_IDS } from "../../types.js";

// ── Default priorities ────────────────────────────────────────────────────

const DEFAULT_PRIORITY: Record<string, SectionPriority> = {
  // Line 1: identity
  project: "critical",
  mode: "critical",
  git: "high",
  context: "high",
  model: "high",
  worktree: "normal",
  pr: "normal",
  tokens: "normal",
  clock: "normal",
  gitAhead: "low",
  gitBehind: "low",
  dirty: "low",
  provider: "low",
  cost: "low",
  // Line 2: state
  agents: "normal",
  tasks: "normal",
  diff: "normal",
  mcp: "low",
  research: "low",
  hints: "ambient",
};

// ── Default line assignment ────────────────────────────────────────────────

const DEFAULT_LINE: Record<string, 1 | 2> = {
  project: 1,
  mode: 1,
  git: 1,
  context: 1,
  model: 1,
  worktree: 1,
  pr: 1,
  tokens: 1,
  clock: 1,
  gitAhead: 1,
  gitBehind: 1,
  dirty: 1,
  provider: 1,
  cost: 1,
  agents: 2,
  tasks: 2,
  diff: 2,
  mcp: 2,
  research: 2,
  hints: 2,
};

// ── Default enabled state ─────────────────────────────────────────────────
// Comfortable defaults: identity + git + model + context + hints visible.
// Low-priority and line-2 sections default off until the user opts in.

const DEFAULT_ENABLED: Record<string, boolean> = {
  project: true,
  mode: true,
  git: true,
  context: true,
  model: true,
  worktree: false,
  pr: false,
  tokens: false,
  clock: false,
  gitAhead: false,
  gitBehind: false,
  dirty: false,
  provider: false,
  cost: false,
  agents: false,
  tasks: false,
  diff: false,
  mcp: false,
  research: false,
  hints: true,
};

// ── Ordered section list for defaults ─────────────────────────────────────

const DEFAULT_SECTION_ORDER = [
  "project",
  "git",
  "gitAhead",
  "gitBehind",
  "dirty",
  "worktree",
  "pr",
  "model",
  "provider",
  "mode",
  "context",
  "tokens",
  "cost",
  "clock",
  "agents",
  "mcp",
  "diff",
  "research",
  "tasks",
  "hints",
] as const;

// ── Old → new section ID mapping ──────────────────────────────────────────

const LEGACY_KEY_TO_SECTION_ID: Record<string, string> = {
  showProviderModel: "model",
  showContext: "context",
  showWorkspacePath: "project",
  showGitBranch: "git",
  showCommandHint: "hints",
  showPullRequest: "pr",
  showSessionLines: "diff",
  showQueue: "queue",
  showActiveStatus: "activeStatus",
  showActiveMetrics: "metrics",
  showCancelHint: "cancelHint",
  showModeLabel: "mode",
};

// Sections that exist in the old config but have no direct mapping to the
// new section model. These are runtime behaviors, not bar sections.
const LEGACY_RUNTIME_ONLY = new Set([
  "queue",
  "activeStatus",
  "metrics",
  "cancelHint",
]);

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Build the default section list with all known sections in canonical order.
 * Each section gets its default priority, line, and enabled state.
 */
export function buildDefaultSections(): StatusSectionConfig[] {
  return DEFAULT_SECTION_ORDER.map((id) => ({
    id,
    line: DEFAULT_LINE[id],
    enabled: DEFAULT_ENABLED[id],
    priority: DEFAULT_PRIORITY[id],
  }));
}

/**
 * Migrate a legacy `ui.statusLine` (boolean flags) to the new
 * `ui.statusBar.sections` model. Returns `null` if no legacy config exists.
 */
export function migrateLegacyStatusLine(
  legacy: StatusLineSettings | undefined,
): StatusSectionConfig[] | null {
  if (!legacy) return null;

  const sections = buildDefaultSections();
  const migrated = sections
    .filter((s) => {
      // Find the legacy key that maps to this section ID
      const legacyKey = Object.entries(LEGACY_KEY_TO_SECTION_ID)
        .find(([, sectionId]) => sectionId === s.id)?.[0];
      if (!legacyKey) return true; // Keep sections with no legacy equivalent
      const legacyValue = legacy[legacyKey as keyof StatusLineSettings];
      if (legacyValue === undefined) return true; // No override → keep default
      return legacyValue;
    })
    .map((s) => {
      // If the legacy key was explicitly true, enable the section
      // even if its default enabled state is false
      const legacyKey = Object.entries(LEGACY_KEY_TO_SECTION_ID)
        .find(([, sectionId]) => sectionId === s.id)?.[0];
      if (!legacyKey) return s;
      const legacyValue = legacy[legacyKey as keyof StatusLineSettings];
      if (legacyValue === true) return { ...s, enabled: true };
      return s;
    });

  return migrated;
}

/**
 * Resolve the effective status bar configuration from a loaded config.
 * If `ui.statusBar` is present, validate and use it.
 * If only `ui.statusLine` (legacy) is present, migrate it.
 * If neither is present, return defaults.
 */
export function resolveStatusBarConfig(
  config: LoadedConfig | undefined,
): { layout: "classic" | "two-line"; sections: StatusSectionConfig[] } {
  const statusBar = config?.ui?.statusBar;
  const legacy = config?.ui?.statusLine;

  // New format takes precedence
  if (statusBar?.sections && Array.isArray(statusBar.sections) && statusBar.sections.length > 0) {
    const sections = statusBar.sections.map(normalizeSection);
    return {
      layout: statusBar.layout ?? "classic",
      sections,
    };
  }

  // Migrate legacy format
  const migrated = migrateLegacyStatusLine(legacy);
  if (migrated && migrated.length > 0) {
    return { layout: "classic", sections: migrated };
  }

  // Defaults
  return { layout: "classic", sections: buildDefaultSections() };
}

function normalizeSection(section: StatusSectionConfig): StatusSectionConfig {
  const id = section.id;
  if (!isValidSectionId(id)) {
    throw new Error(
      `Unknown status bar section id "${id}". Valid ids: ${STATUS_SECTION_IDS.join(", ")}`,
    );
  }
  return {
    id,
    line: section.line ?? DEFAULT_LINE[id],
    enabled: section.enabled ?? true,
    priority: section.priority ?? DEFAULT_PRIORITY[id],
    color: section.color,
  };
}

export function isValidSectionId(id: string): boolean {
  return STATUS_SECTION_IDS.includes(id as (typeof STATUS_SECTION_IDS)[number]);
}

export function isValidPriority(p: string): p is SectionPriority {
  return p === "critical" || p === "high" || p === "normal" || p === "low" || p === "ambient";
}

export function isValidLayout(l: string): l is "classic" | "two-line" {
  return l === "classic" || l === "two-line";
}

/**
 * Validate a `ui.statusBar` config block. Throws on invalid input.
 */
export function validateStatusBarConfig(
  statusBar: unknown,
  configPath: string,
): void {
  if (typeof statusBar !== "object" || statusBar === null) {
    throw new Error(`ui.statusBar must be an object in ${configPath}`);
  }

  const sb = statusBar as Partial<StatusBarConfig>;

  if (sb.layout !== undefined && !isValidLayout(sb.layout)) {
    throw new Error(
      `ui.statusBar.layout must be "classic" or "two-line" in ${configPath}`,
    );
  }

  if (sb.sections !== undefined) {
    if (!Array.isArray(sb.sections)) {
      throw new Error(`ui.statusBar.sections must be an array in ${configPath}`);
    }

    const seenIds = new Set<string>();
    for (const section of sb.sections) {
      if (typeof section !== "object" || section === null) {
        throw new Error(`ui.statusBar.sections[] entries must be objects in ${configPath}`);
      }
      const s = section as Partial<StatusSectionConfig>;
      if (typeof s.id !== "string" || !isValidSectionId(s.id)) {
        throw new Error(
          `ui.statusBar.sections[].id must be one of ${STATUS_SECTION_IDS.join(", ")} in ${configPath}`,
        );
      }
      if (seenIds.has(s.id)) {
        throw new Error(`Duplicate status bar section id "${s.id}" in ${configPath}`);
      }
      seenIds.add(s.id);

      if (s.line !== undefined && s.line !== 1 && s.line !== 2) {
        throw new Error(`ui.statusBar.sections[].line must be 1 or 2 in ${configPath}`);
      }
      if (s.enabled !== undefined && typeof s.enabled !== "boolean") {
        throw new Error(`ui.statusBar.sections[].enabled must be boolean in ${configPath}`);
      }
      if (s.priority !== undefined && !isValidPriority(s.priority)) {
        throw new Error(
          `ui.statusBar.sections[].priority must be critical, high, normal, low, or ambient in ${configPath}`,
        );
      }
      if (s.color !== undefined && typeof s.color !== "string") {
        throw new Error(`ui.statusBar.sections[].color must be a string in ${configPath}`);
      }
    }
  }
}

// Re-export for external consumers
export { LEGACY_RUNTIME_ONLY };
