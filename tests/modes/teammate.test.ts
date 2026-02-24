import { describe, it, expect } from 'vitest';
import { parseTeammateOptions } from '../../src/modes/teammate.js';

describe('parseTeammateOptions', () => {
  it('should parse all required options', () => {
    const argv = [
      'node', 'autohand',
      '--mode', 'teammate',
      '--team', 'code-cleanup',
      '--name', 'hunter',
      '--agent', 'code-cleaner',
      '--lead-session', 'session-123',
    ];
    const opts = parseTeammateOptions(argv);
    expect(opts).toEqual({
      teamName: 'code-cleanup',
      name: 'hunter',
      agentName: 'code-cleaner',
      leadSessionId: 'session-123',
      model: undefined,
      workspacePath: undefined,
    });
  });

  it('should parse optional model and path', () => {
    const argv = [
      'node', 'autohand',
      '--mode', 'teammate',
      '--team', 'test-team',
      '--name', 'tester',
      '--agent', 'tester',
      '--lead-session', 'session-456',
      '--model', 'anthropic/claude-3.5-sonnet',
      '--path', '/tmp/workspace',
    ];
    const opts = parseTeammateOptions(argv);
    expect(opts?.model).toBe('anthropic/claude-3.5-sonnet');
    expect(opts?.workspacePath).toBe('/tmp/workspace');
  });

  it('should return null when required options are missing', () => {
    const argv = ['node', 'autohand', '--mode', 'teammate', '--team', 'test'];
    expect(parseTeammateOptions(argv)).toBeNull();
  });

  it('should return null when no teammate flags are present', () => {
    const argv = ['node', 'autohand'];
    expect(parseTeammateOptions(argv)).toBeNull();
  });
});
