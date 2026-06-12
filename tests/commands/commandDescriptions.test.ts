/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { metadata as planMetadata } from '../../src/commands/plan.js';
import { metadata as reviewMetadata } from '../../src/commands/review.js';
import { metadata as skillsMetadata } from '../../src/commands/skills.js';

describe('command descriptions', () => {
  it('uses action-oriented tips for review, plan, and skills', () => {
    expect(reviewMetadata.description).toBe('review your current changes and find issues');
    expect(planMetadata.description).toBe('plan and break down a complex task');
    expect(skillsMetadata.description).toBe('discover and install skills for your project');
  });
});
