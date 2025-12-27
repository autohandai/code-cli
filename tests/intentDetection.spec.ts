/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';

/**
 * Test the intent detection logic that catches when the model says
 * "let me update X" but doesn't actually include the tool call.
 */

// Replicate the detection logic from agent.ts for testing
function expressesIntentToAct(text: string): boolean {
  if (!text) return false;

  const intentPatterns = [
    /\b(let me|i('ll| will)|now i('ll| will)|i('m| am) going to|let's|i need to|i should|i can now)\b.{0,30}\b(update|edit|modify|change|create|write|add|remove|delete|fix|refactor|implement|apply|patch)/i,
    /\b(updating|editing|modifying|creating|writing|adding|removing|fixing|refactoring|implementing)\b.{0,20}\b(the file|readme|config|code|function|component)/i,
    /\blet me (now )?make (the|these|those) (changes?|updates?|modifications?|edits?)/i,
    /\bi('ll| will) (proceed|go ahead|start|begin) (to|and|with) (update|edit|modify|change|create|write)/i,
    /\bnow (let me|i('ll| will)|i can) (update|edit|modify|create|write|add|fix)/i,
  ];

  for (const pattern of intentPatterns) {
    if (pattern.test(text)) {
      return true;
    }
  }

  return false;
}

describe('Intent Detection', () => {
  describe('expressesIntentToAct', () => {
    it('detects "let me update" phrases', () => {
      expect(expressesIntentToAct('Let me update the README.md file now')).toBe(true);
      expect(expressesIntentToAct('Let me now update the configuration')).toBe(true);
      expect(expressesIntentToAct('let me edit this file for you')).toBe(true);
    });

    it('detects "I will" phrases', () => {
      expect(expressesIntentToAct("I'll update the code now")).toBe(true);
      expect(expressesIntentToAct('I will modify the function')).toBe(true);
      expect(expressesIntentToAct("Now I'll create the new file")).toBe(true);
    });

    it('detects "I am going to" phrases', () => {
      expect(expressesIntentToAct("I'm going to update the tests")).toBe(true);
      expect(expressesIntentToAct('I am going to fix this bug')).toBe(true);
    });

    it('detects progressive action phrases', () => {
      expect(expressesIntentToAct('Now updating the README file')).toBe(true);
      expect(expressesIntentToAct('Creating the new component now')).toBe(true);
      expect(expressesIntentToAct('Modifying the config file')).toBe(true);
    });

    it('detects "let me make changes" phrases', () => {
      expect(expressesIntentToAct('Let me make the changes now')).toBe(true);
      expect(expressesIntentToAct('Let me now make these updates')).toBe(true);
      expect(expressesIntentToAct('Let me make those modifications')).toBe(true);
    });

    it('detects "proceed to update" phrases', () => {
      expect(expressesIntentToAct("I'll proceed to update the file")).toBe(true);
      expect(expressesIntentToAct('I will go ahead and modify it')).toBe(true);
      expect(expressesIntentToAct("I'll start to create the component")).toBe(true);
    });

    it('does NOT trigger on completed actions', () => {
      expect(expressesIntentToAct('I have updated the file')).toBe(false);
      expect(expressesIntentToAct('The changes have been applied')).toBe(false);
      expect(expressesIntentToAct('File successfully modified')).toBe(false);
      expect(expressesIntentToAct('Updated README.md with new content')).toBe(false);
    });

    it('does NOT trigger on analysis/explanation', () => {
      expect(expressesIntentToAct('The file contains a typo')).toBe(false);
      expect(expressesIntentToAct('I found 3 issues in the code')).toBe(false);
      expect(expressesIntentToAct('Here is what I discovered')).toBe(false);
      expect(expressesIntentToAct('Based on my analysis')).toBe(false);
    });

    it('does NOT trigger on questions', () => {
      expect(expressesIntentToAct('Should I update the file?')).toBe(false);
      expect(expressesIntentToAct('Would you like me to make changes?')).toBe(false);
    });

    it('handles empty/null input', () => {
      expect(expressesIntentToAct('')).toBe(false);
      expect(expressesIntentToAct(null as any)).toBe(false);
      expect(expressesIntentToAct(undefined as any)).toBe(false);
    });

    it('detects real-world failure cases', () => {
      // These are actual responses where the model said it would act but didn't
      expect(expressesIntentToAct(
        'Based on my analysis of the codebase, I can see several new features have been added. Let me now update the README.md to document these latest features:'
      )).toBe(true);

      expect(expressesIntentToAct(
        "I've analyzed the project structure. Now I'll create the new component file with the required functionality."
      )).toBe(true);

      expect(expressesIntentToAct(
        'Looking at the code, I can see the issue. Let me fix the bug in the authentication module.'
      )).toBe(true);
    });
  });
});
