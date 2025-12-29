/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { IntentDetector } from '../../src/core/IntentDetector';
import type { Intent } from '../../src/core/IntentDetector';

describe('IntentDetector', () => {
  let detector: IntentDetector;

  beforeEach(() => {
    detector = new IntentDetector();
  });

  describe('detect()', () => {
    describe('diagnostic intent', () => {
      it('detects question words as diagnostic', () => {
        const questions = [
          'what is causing this error?',
          'why does this function return null?',
          'how does the auth flow work?',
          'where is the config stored?',
          'which module handles routing?'
        ];

        for (const q of questions) {
          const result = detector.detect(q);
          expect(result.intent).toBe('diagnostic');
        }
      });

      it('detects analysis verbs as diagnostic', () => {
        const instructions = [
          'explain the authentication flow',
          'analyze this error message',
          'review the code structure',
          'check if tests pass',
          'look at the database schema',
          'understand the API design',
          'find where errors are logged'
        ];

        for (const inst of instructions) {
          const result = detector.detect(inst);
          expect(result.intent).toBe('diagnostic');
        }
      });

      it('detects question mark as strong diagnostic signal', () => {
        const result = detector.detect('can you help with this?');
        expect(result.intent).toBe('diagnostic');
      });

      it('detects "tell me about" as diagnostic', () => {
        const result = detector.detect('tell me about the project structure');
        expect(result.intent).toBe('diagnostic');
      });
    });

    describe('implementation intent', () => {
      it('detects action verbs as implementation', () => {
        const actions = [
          'fix the login bug',
          'add a new endpoint',
          'create the user model',
          'implement authentication',
          'update the config file',
          'change the button color',
          'modify the API response',
          'refactor the service layer',
          'delete unused imports',
          'remove the deprecated function'
        ];

        for (const action of actions) {
          const result = detector.detect(action);
          expect(result.intent).toBe('implementation');
        }
      });

      it('detects imperative phrases as implementation', () => {
        const instructions = [
          'make it work with TypeScript',
          'set up the testing framework',
          'configure ESLint rules',
          'enable dark mode',
          'disable the feature flag'
        ];

        for (const inst of instructions) {
          const result = detector.detect(inst);
          expect(result.intent).toBe('implementation');
        }
      });

      it('detects "please add" as implementation', () => {
        const result = detector.detect('please add error handling');
        expect(result.intent).toBe('implementation');
      });

      it('detects "go ahead and" as implementation', () => {
        const result = detector.detect('go ahead and implement the feature');
        expect(result.intent).toBe('implementation');
      });
    });

    describe('mixed intent resolution', () => {
      it('resolves "fix the bug, but first explain why it happens" as implementation', () => {
        const result = detector.detect('fix the bug, but first explain why it happens');
        // "fix" should outweigh "explain"
        expect(result.intent).toBe('implementation');
      });

      it('resolves "explain and then fix" based on primary action', () => {
        const result1 = detector.detect('explain the issue then fix it');
        // Both present, implementation wins
        expect(result1.intent).toBe('implementation');
      });

      it('resolves "check if tests pass" as diagnostic', () => {
        const result = detector.detect('check if tests pass');
        expect(result.intent).toBe('diagnostic');
      });

      it('resolves "run the tests" as implementation', () => {
        const result = detector.detect('run the tests');
        // "run" is an action
        expect(result.intent).toBe('implementation');
      });
    });

    describe('confidence scoring', () => {
      it('returns higher confidence for clear implementation', () => {
        const result = detector.detect('fix the bug now');
        expect(result.confidence).toBeGreaterThan(0.5);
      });

      it('returns higher confidence for clear diagnostic', () => {
        const result = detector.detect('what is this code doing?');
        expect(result.confidence).toBeGreaterThan(0.5);
      });

      it('returns lower confidence for ambiguous input', () => {
        const result = detector.detect('help me with this');
        expect(result.confidence).toBeLessThan(0.5);
      });
    });

    describe('keyword extraction', () => {
      it('includes matched keywords in result', () => {
        const result = detector.detect('fix the authentication bug');
        expect(result.keywords).toContain('fix');
      });

      it('returns empty keywords for no matches', () => {
        const result = detector.detect('hello world');
        expect(result.keywords.length).toBe(0);
      });
    });

    describe('edge cases', () => {
      it('handles empty string', () => {
        const result = detector.detect('');
        expect(result.intent).toBeDefined();
        expect(result.confidence).toBe(0);
      });

      it('handles very long input', () => {
        const longInput = 'please '.repeat(1000) + 'fix the bug';
        const result = detector.detect(longInput);
        expect(result.intent).toBe('implementation');
      });

      it('handles special characters', () => {
        const result = detector.detect('fix the @#$% bug!!!');
        expect(result.intent).toBe('implementation');
      });

      it('is case insensitive', () => {
        const lower = detector.detect('fix the bug');
        const upper = detector.detect('FIX THE BUG');
        expect(lower.intent).toBe(upper.intent);
      });
    });
  });

  describe('getPermissions()', () => {
    it('returns restricted permissions for diagnostic', () => {
      const perms = detector.getPermissions('diagnostic');
      expect(perms.allowFileEdits).toBe(false);
      expect(perms.allowCommands).toBe('readonly');
      expect(perms.allowGitOperations).toBe(false);
    });

    it('returns full permissions for implementation', () => {
      const perms = detector.getPermissions('implementation');
      expect(perms.allowFileEdits).toBe(true);
      expect(perms.allowCommands).toBe('all');
      expect(perms.allowGitOperations).toBe(true);
    });
  });

  describe('isToolAllowed()', () => {
    describe('diagnostic mode', () => {
      it('allows read_file', () => {
        expect(detector.isToolAllowed('read_file', 'diagnostic')).toBe(true);
      });

      it('allows search', () => {
        expect(detector.isToolAllowed('search', 'diagnostic')).toBe(true);
      });

      it('allows list_tree', () => {
        expect(detector.isToolAllowed('list_tree', 'diagnostic')).toBe(true);
      });

      it('blocks write_file', () => {
        expect(detector.isToolAllowed('write_file', 'diagnostic')).toBe(false);
      });

      it('blocks apply_patch', () => {
        expect(detector.isToolAllowed('apply_patch', 'diagnostic')).toBe(false);
      });

      it('blocks delete_path', () => {
        expect(detector.isToolAllowed('delete_path', 'diagnostic')).toBe(false);
      });

      it('blocks git_commit', () => {
        expect(detector.isToolAllowed('git_commit', 'diagnostic')).toBe(false);
      });
    });

    describe('implementation mode', () => {
      it('allows all read tools', () => {
        expect(detector.isToolAllowed('read_file', 'implementation')).toBe(true);
        expect(detector.isToolAllowed('search', 'implementation')).toBe(true);
      });

      it('allows all write tools', () => {
        expect(detector.isToolAllowed('write_file', 'implementation')).toBe(true);
        expect(detector.isToolAllowed('apply_patch', 'implementation')).toBe(true);
        expect(detector.isToolAllowed('delete_path', 'implementation')).toBe(true);
      });

      it('allows git operations', () => {
        expect(detector.isToolAllowed('git_commit', 'implementation')).toBe(true);
        expect(detector.isToolAllowed('git_push', 'implementation')).toBe(true);
      });

      it('allows run_command', () => {
        expect(detector.isToolAllowed('run_command', 'implementation')).toBe(true);
      });
    });
  });
});
