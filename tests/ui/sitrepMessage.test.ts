/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { parseSitrepText } from '../../src/ui/ink/SitrepMessage.js';

describe('parseSitrepText', () => {
  it('should parse standard SITREP format', () => {
    const text = `SITREP:
- Done: Added background parameter to shell tool
- Files: src/core/toolManager.ts, src/ui/shellCommand.ts
- Status: completed
- Next: Ready for testing`;

    const result = parseSitrepText(text);
    
    expect(result).not.toBeNull();
    expect(result!.done).toBe('Added background parameter to shell tool');
    expect(result!.files).toEqual(['src/core/toolManager.ts', 'src/ui/shellCommand.ts']);
    expect(result!.status).toBe('completed');
    expect(result!.next).toBe('Ready for testing');
  });

  it('should parse SITREP with single file', () => {
    const text = `SITREP:
- Done: Fixed the bug
- Files: src/utils.ts
- Status: completed
- Next: awaiting instructions`;

    const result = parseSitrepText(text);
    
    expect(result).not.toBeNull();
    expect(result!.done).toBe('Fixed the bug');
    expect(result!.files).toEqual(['src/utils.ts']);
  });

  it('should parse SITREP without files', () => {
    const text = `SITREP:
- Done: Analyzed the codebase
- Status: in-progress
- Next: Will implement the fix`;

    const result = parseSitrepText(text);
    
    expect(result).not.toBeNull();
    expect(result!.done).toBe('Analyzed the codebase');
    expect(result!.files).toEqual([]);
    expect(result!.status).toBe('in-progress');
  });

  it('should parse SITREP with blocked status', () => {
    const text = `SITREP:
- Done: Attempted to fix but found dependency issue
- Status: blocked
- Next: Need to update dependency first`;

    const result = parseSitrepText(text);
    
    expect(result).not.toBeNull();
    expect(result!.status).toBe('blocked');
  });

  it('should return null for non-SITREP text', () => {
    const text = `This is just regular text without SITREP.`;
    
    const result = parseSitrepText(text);
    
    expect(result).toBeNull();
  });

  it('should handle multi-line done text', () => {
    const text = `SITREP:
- Done: Implemented the feature with proper error handling and validation
- Status: completed`;

    const result = parseSitrepText(text);
    
    expect(result).not.toBeNull();
    expect(result!.done).toBe('Implemented the feature with proper error handling and validation');
  });

  it('should parse SITREP with verify section', () => {
    const text = `SITREP:
- Done: Added tests for the feature
- Files: tests/feature.test.ts
- Status: completed
- Next: Run tests to verify
- Verify: bun test tests/feature.test.ts`;

    const result = parseSitrepText(text);
    
    expect(result).not.toBeNull();
    expect(result!.verify).toBe('bun test tests/feature.test.ts');
  });

  it('should parse SITREP with bullet-point file list', () => {
    const text = `SITREP:
- Done: Updated multiple files
- Files:
- src/file1.ts
- src/file2.ts
- src/file3.ts
- Status: completed`;

    const result = parseSitrepText(text);
    
    expect(result).not.toBeNull();
    expect(result!.files).toEqual(['src/file1.ts', 'src/file2.ts', 'src/file3.ts']);
  });
});

describe('SITREP regex matching', () => {
  it('should match SITREP block in finalResponse', () => {
    const finalResponse = `Here's what I did:

SITREP:
- Done: Added the feature
- Files: src/test.ts
- Status: completed
- Next: Ready for review

Let me know if you have questions!`;

    const sitrepMatch = finalResponse.match(/SITREP:\s*\n([\s\S]*?)(?=\n\n|$)/);
    
    expect(sitrepMatch).not.toBeNull();
    expect(sitrepMatch![0]).toContain('SITREP:');
    expect(sitrepMatch![0]).toContain('- Done: Added the feature');
  });

  it('should match SITREP at end of response', () => {
    const finalResponse = `I completed the task.

SITREP:
- Done: All done
- Status: completed`;

    const sitrepMatch = finalResponse.match(/SITREP:\s*\n([\s\S]*?)(?=\n\n|$)/);
    
    expect(sitrepMatch).not.toBeNull();
  });

  it('should match SITREP with no trailing newline', () => {
    const finalResponse = `I completed the task.

SITREP:
- Done: All done
- Status: completed`;

    const sitrepMatch = finalResponse.match(/SITREP:\s*\n([\s\S]*?)(?=\n\n|$)/);
    
    expect(sitrepMatch).not.toBeNull();
    expect(sitrepMatch!.index).toBeGreaterThan(0);
  });
});