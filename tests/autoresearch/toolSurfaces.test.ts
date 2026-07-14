/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOL_DEFINITIONS } from '../../src/core/toolManager.js';

describe('autoresearch ledger tool surfaces', () => {
  it('exposes replay and analysis tools while keeping existing lifecycle tools compatible', () => {
    const definitions = new Map(DEFAULT_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));

    expect(definitions.has('init_experiment')).toBe(true);
    expect(definitions.has('run_experiment')).toBe(true);
    expect(definitions.has('log_experiment')).toBe(true);
    expect(definitions.has('replay_experiment')).toBe(true);
    expect(definitions.has('analyze_experiments')).toBe(true);

    expect(definitions.get('init_experiment')?.parameters.properties).toMatchObject({
      secondaryObjectives: { type: 'array' },
      constraints: { type: 'array' },
      sampling: { type: 'object' },
      retention: { type: 'object' },
      environmentAllowlist: { type: 'array' },
    });
    expect(definitions.get('log_experiment')?.parameters.required).toEqual(['description']);
    expect(definitions.get('replay_experiment')?.parameters.required).toEqual(['attemptId']);
    expect(definitions.get('analyze_experiments')?.parameters.properties.operation.enum)
      .toEqual(['history', 'rescore', 'compare', 'pareto', 'pin', 'unpin', 'prune']);
  });
});
