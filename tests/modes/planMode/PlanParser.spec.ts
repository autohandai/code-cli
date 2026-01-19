/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('PlanParser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parse', () => {
    it('should extract numbered plan from "Plan:" header', async () => {
      const { PlanParser } = await import('../../../src/modes/planMode/PlanParser.js');
      const parser = new PlanParser();

      const text = `Here's my analysis of the codebase.

Plan:
1. First step - do something
2. Second step - do another thing
3. Third step - final step

Let me know if you want to proceed.`;

      const plan = parser.parse(text);

      expect(plan).not.toBeNull();
      expect(plan!.steps).toHaveLength(3);
      expect(plan!.steps[0].number).toBe(1);
      expect(plan!.steps[0].description).toBe('First step - do something');
      expect(plan!.steps[1].number).toBe(2);
      expect(plan!.steps[2].number).toBe(3);
    });

    it('should extract numbered plan from "Implementation Plan:" header', async () => {
      const { PlanParser } = await import('../../../src/modes/planMode/PlanParser.js');
      const parser = new PlanParser();

      const text = `Implementation Plan:
1. Install dependencies
2. Create models
3. Add routes`;

      const plan = parser.parse(text);

      expect(plan).not.toBeNull();
      expect(plan!.steps).toHaveLength(3);
    });

    it('should handle numbered format with parentheses', async () => {
      const { PlanParser } = await import('../../../src/modes/planMode/PlanParser.js');
      const parser = new PlanParser();

      const text = `Plan:
1) Step one
2) Step two
3) Step three`;

      const plan = parser.parse(text);

      expect(plan).not.toBeNull();
      expect(plan!.steps).toHaveLength(3);
      expect(plan!.steps[0].description).toBe('Step one');
    });

    it('should handle "Steps:" header', async () => {
      const { PlanParser } = await import('../../../src/modes/planMode/PlanParser.js');
      const parser = new PlanParser();

      const text = `Steps:
1. Step one
2. Step two`;

      const plan = parser.parse(text);

      expect(plan).not.toBeNull();
      expect(plan!.steps).toHaveLength(2);
    });

    it('should handle "Action Plan:" header', async () => {
      const { PlanParser } = await import('../../../src/modes/planMode/PlanParser.js');
      const parser = new PlanParser();

      const text = `Action Plan:
1. Action one
2. Action two
3. Action three`;

      const plan = parser.parse(text);

      expect(plan).not.toBeNull();
      expect(plan!.steps).toHaveLength(3);
    });

    it('should return null for text without numbered plan', async () => {
      const { PlanParser } = await import('../../../src/modes/planMode/PlanParser.js');
      const parser = new PlanParser();

      const text = `This is just regular text.
It doesn't have a numbered plan.
Just some analysis.`;

      const plan = parser.parse(text);

      expect(plan).toBeNull();
    });

    it('should extract plan without header if at least 3 numbered items', async () => {
      const { PlanParser } = await import('../../../src/modes/planMode/PlanParser.js');
      const parser = new PlanParser();

      const text = `Here's what we need to do:
1. First thing
2. Second thing
3. Third thing`;

      const plan = parser.parse(text);

      expect(plan).not.toBeNull();
      expect(plan!.steps).toHaveLength(3);
    });

    it('should NOT extract plan with only 2 numbered items (needs at least 3)', async () => {
      const { PlanParser } = await import('../../../src/modes/planMode/PlanParser.js');
      const parser = new PlanParser();

      const text = `Here are two things:
1. First thing
2. Second thing`;

      const plan = parser.parse(text);

      expect(plan).toBeNull();
    });

    it('should initialize all steps with "pending" status', async () => {
      const { PlanParser } = await import('../../../src/modes/planMode/PlanParser.js');
      const parser = new PlanParser();

      const text = `Plan:
1. Step one
2. Step two
3. Step three`;

      const plan = parser.parse(text);

      expect(plan!.steps.every(s => s.status === 'pending')).toBe(true);
    });

    it('should generate unique plan ID', async () => {
      const { PlanParser } = await import('../../../src/modes/planMode/PlanParser.js');
      const parser = new PlanParser();

      const text = `Plan:
1. Step one
2. Step two
3. Step three`;

      const plan1 = parser.parse(text);
      const plan2 = parser.parse(text);

      expect(plan1!.id).toBeDefined();
      expect(plan2!.id).toBeDefined();
      expect(plan1!.id).not.toBe(plan2!.id);
    });

    it('should store raw text in plan', async () => {
      const { PlanParser } = await import('../../../src/modes/planMode/PlanParser.js');
      const parser = new PlanParser();

      const text = `Plan:
1. Step one
2. Step two
3. Step three`;

      const plan = parser.parse(text);

      expect(plan!.rawText).toContain('1. Step one');
      expect(plan!.rawText).toContain('2. Step two');
    });

    it('should set createdAt timestamp', async () => {
      const { PlanParser } = await import('../../../src/modes/planMode/PlanParser.js');
      const parser = new PlanParser();

      const beforeParse = Date.now();

      const text = `Plan:
1. Step one
2. Step two
3. Step three`;

      const plan = parser.parse(text);
      const afterParse = Date.now();

      expect(plan!.createdAt).toBeGreaterThanOrEqual(beforeParse);
      expect(plan!.createdAt).toBeLessThanOrEqual(afterParse);
    });

    it('should handle multi-line step descriptions', async () => {
      const { PlanParser } = await import('../../../src/modes/planMode/PlanParser.js');
      const parser = new PlanParser();

      const text = `Plan:
1. First step with details
2. Second step - this is a longer description that spans the line
3. Third step`;

      const plan = parser.parse(text);

      expect(plan!.steps).toHaveLength(3);
      expect(plan!.steps[1].description).toContain('Second step');
    });

    it('should handle steps with code or special characters', async () => {
      const { PlanParser } = await import('../../../src/modes/planMode/PlanParser.js');
      const parser = new PlanParser();

      const text = `Plan:
1. Create \`src/auth/jwt.ts\` with sign/verify helpers
2. Add JWT_SECRET to .env
3. Update routes/index.ts`;

      const plan = parser.parse(text);

      expect(plan!.steps).toHaveLength(3);
      expect(plan!.steps[0].description).toContain('`src/auth/jwt.ts`');
    });

    it('should handle "Todo:" header', async () => {
      const { PlanParser } = await import('../../../src/modes/planMode/PlanParser.js');
      const parser = new PlanParser();

      const text = `Todo:
1. Fix the bug
2. Add tests
3. Update docs`;

      const plan = parser.parse(text);

      expect(plan).not.toBeNull();
      expect(plan!.steps).toHaveLength(3);
    });

    it('should handle whitespace variations', async () => {
      const { PlanParser } = await import('../../../src/modes/planMode/PlanParser.js');
      const parser = new PlanParser();

      const text = `Plan:
  1. Step with leading whitespace
  2.  Step with extra space
  3.   Step with more space`;

      const plan = parser.parse(text);

      expect(plan).not.toBeNull();
      expect(plan!.steps).toHaveLength(3);
      expect(plan!.steps[0].description).toBe('Step with leading whitespace');
    });
  });
});
