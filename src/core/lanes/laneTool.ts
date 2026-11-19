/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ToolDefinition, ToolParameters } from '../toolManager.js';
import { MAX_ACTIVE_LANES } from './feature.js';

const DELEGATE_TOOL_NAME = 'delegate_task';
const LANE_DESCRIPTION_SUFFIX = ' Set lane_name to run it as a background lane and get the tool result back immediately.';

const LANE_PROPERTIES: ToolParameters['properties'] = {
  lane_name: {
    type: 'string',
    description: 'Opens a lane: short kebab-case name (for example "selection-highlight"). The task then runs in the background and reports back when it finishes.',
  },
  lane_description: {
    type: 'string',
    description: 'One-line summary of the lane shown to the user, at most 80 characters. Only used with lane_name.',
  },
};

export function hasLaneOption(definition: ToolDefinition): boolean {
  return definition.name === DELEGATE_TOOL_NAME && definition.parameters?.properties.lane_name !== undefined;
}

/** Adds or removes the lane arguments of `delegate_task`; applying it twice changes nothing. */
export function withLaneOption(definition: ToolDefinition, enabled: boolean): ToolDefinition {
  if (definition.name !== DELEGATE_TOOL_NAME || !definition.parameters) return definition;
  const properties = Object.fromEntries(
    Object.entries(definition.parameters.properties).filter(([key]) => !(key in LANE_PROPERTIES)),
  );
  const description = definition.description.replace(LANE_DESCRIPTION_SUFFIX, '');
  return {
    ...definition,
    description: enabled ? `${description}${LANE_DESCRIPTION_SUFFIX}` : description,
    parameters: { ...definition.parameters, properties: enabled ? { ...properties, ...LANE_PROPERTIES } : properties },
  };
}

interface LaneToolRegistry {
  listAllDefinitions(): ToolDefinition[];
  register(definition: ToolDefinition): void;
}

/** Applies the current state of the `cli_lanes` experiment to the live `delegate_task` schema. */
export function syncLaneTool(toolManager: LaneToolRegistry, enabled: boolean): void {
  const definition = toolManager.listAllDefinitions().find(candidate => candidate.name === DELEGATE_TOOL_NAME);
  if (definition) toolManager.register(withLaneOption(definition, enabled));
}

/** Prompt guidance for lanes, present only when the advertised `delegate_task` can open one. */
export function lanesPromptSection(definitions: readonly ToolDefinition[]): string[] {
  if (!definitions.some(hasLaneOption)) return [];
  return [
    '### Lanes',
    'A lane is a named background agent that works on one task in parallel while this conversation continues. Open one only when the user asks for it, for example "open a new lane and fix the flaky test".',
    'To open a lane, call `delegate_task` with `agent_name`, a self-contained `task` (the lane does not see this conversation), `lane_name` (short kebab-case, for example `flaky-test`) and `lane_description` (one line).',
    `The call returns immediately. Tell the user the lane is open and continue; never wait for a lane, poll it, or redo its work. At most ${MAX_ACTIVE_LANES} lanes run at once and they share this working tree, so give parallel lanes separate files.`,
    'A finished lane reports back in a later message. Summarize that report for the user and verify its claims before relying on them.',
    '',
  ];
}
