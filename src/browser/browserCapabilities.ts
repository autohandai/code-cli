/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const BROWSER_PROTOCOL_VERSION = 2 as const;

export const BROWSER_V2_TOOL_NAMES = [
  'browser_snapshot',
  'browser_wait_for',
  'browser_get_runtime_state',
  'browser_handle_dialog',
  'browser_wait_for_download',
  'browser_inspect_form',
  'browser_fill_form',
  'browser_validate_form',
  'browser_submit_form',
  'browser_reset_form',
  'browser_go_back',
  'browser_go_forward',
  'browser_reload',
  'browser_open_tab',
  'browser_close_tab',
  'browser_switch_tab',
  'browser_group_tabs',
  'browser_hover',
  'browser_drag',
  'browser_select_option',
  'browser_upload_file',
  'browser_read_page_interactive',
  'browser_read_page_all',
  'browser_get_selected_text',
  'browser_extract_links',
  'browser_click',
  'browser_type',
] as const;

export type BrowserV2ToolName = (typeof BROWSER_V2_TOOL_NAMES)[number];

export interface BrowserCapabilities {
  protocolVersion: number;
  extensionVersion: string;
  tools: string[];
}

export interface BrowserCapabilitiesResult {
  enabled: boolean;
  protocolVersion: 1 | 2;
  tools: BrowserV2ToolName[];
}

const supportedTools = new Set<string>(BROWSER_V2_TOOL_NAMES);

function parseCapabilities(value: unknown): BrowserCapabilities | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.protocolVersion !== BROWSER_PROTOCOL_VERSION
    || typeof candidate.extensionVersion !== 'string'
    || candidate.extensionVersion.trim().length === 0
    || !Array.isArray(candidate.tools)
    || !candidate.tools.every((tool) => typeof tool === 'string')
  ) {
    return null;
  }
  return {
    protocolVersion: candidate.protocolVersion,
    extensionVersion: candidate.extensionVersion,
    tools: candidate.tools,
  };
}

export function negotiateBrowserCapabilities(
  value: unknown,
  featureEnabled: boolean,
): BrowserCapabilitiesResult {
  const capabilities = parseCapabilities(value);
  if (!featureEnabled || !capabilities) {
    return { enabled: false, protocolVersion: 1, tools: [] };
  }
  const tools = BROWSER_V2_TOOL_NAMES.filter((tool) =>
    capabilities.tools.includes(tool) && supportedTools.has(tool)
  );
  return {
    enabled: true,
    protocolVersion: BROWSER_PROTOCOL_VERSION,
    tools,
  };
}
