/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseYoloPattern,
  isToolAllowedByYolo,
  YoloTimer,
  type YoloPattern,
} from '../src/permissions/yoloMode.js';

describe('YOLO Mode', () => {
  // ========================================================================
  // parseYoloPattern
  // ========================================================================
  describe('parseYoloPattern', () => {
    it('parses "allow:*" as allow-all wildcard', () => {
      const result = parseYoloPattern('allow:*');
      expect(result).toEqual({ mode: 'allow', tools: ['*'] });
    });

    it('parses "allow:read,write,search" as specific allow list', () => {
      const result = parseYoloPattern('allow:read,write,search');
      expect(result).toEqual({ mode: 'allow', tools: ['read', 'write', 'search'] });
    });

    it('parses "deny:delete,run_command" as specific deny list', () => {
      const result = parseYoloPattern('deny:delete,run_command');
      expect(result).toEqual({ mode: 'deny', tools: ['delete', 'run_command'] });
    });

    it('parses "true" as allow-all shorthand', () => {
      const result = parseYoloPattern('true');
      expect(result).toEqual({ mode: 'allow', tools: ['*'] });
    });

    it('throws on empty string', () => {
      expect(() => parseYoloPattern('')).toThrow();
    });

    it('parses single tool in allow mode', () => {
      const result = parseYoloPattern('allow:read_file');
      expect(result).toEqual({ mode: 'allow', tools: ['read_file'] });
    });

    it('parses single tool in deny mode', () => {
      const result = parseYoloPattern('deny:delete_path');
      expect(result).toEqual({ mode: 'deny', tools: ['delete_path'] });
    });

    it('trims whitespace from tool names', () => {
      const result = parseYoloPattern('allow: read , write , search ');
      expect(result).toEqual({ mode: 'allow', tools: ['read', 'write', 'search'] });
    });
  });

  // ========================================================================
  // isToolAllowedByYolo
  // ========================================================================
  describe('isToolAllowedByYolo', () => {
    it('allow:* allows everything', () => {
      const pattern: YoloPattern = { mode: 'allow', tools: ['*'] };
      expect(isToolAllowedByYolo('read_file', pattern)).toBe(true);
      expect(isToolAllowedByYolo('write_file', pattern)).toBe(true);
      expect(isToolAllowedByYolo('delete_path', pattern)).toBe(true);
      expect(isToolAllowedByYolo('run_command', pattern)).toBe(true);
    });

    it('allow:specific allows only listed tools', () => {
      const pattern: YoloPattern = { mode: 'allow', tools: ['read_file', 'write_file'] };
      expect(isToolAllowedByYolo('read_file', pattern)).toBe(true);
      expect(isToolAllowedByYolo('write_file', pattern)).toBe(true);
      expect(isToolAllowedByYolo('delete_path', pattern)).toBe(false);
      expect(isToolAllowedByYolo('run_command', pattern)).toBe(false);
    });

    it('deny:specific denies only listed tools, allows rest', () => {
      const pattern: YoloPattern = { mode: 'deny', tools: ['delete_path', 'run_command'] };
      expect(isToolAllowedByYolo('read_file', pattern)).toBe(true);
      expect(isToolAllowedByYolo('write_file', pattern)).toBe(true);
      expect(isToolAllowedByYolo('delete_path', pattern)).toBe(false);
      expect(isToolAllowedByYolo('run_command', pattern)).toBe(false);
    });

    it('deny:* denies everything', () => {
      const pattern: YoloPattern = { mode: 'deny', tools: ['*'] };
      expect(isToolAllowedByYolo('read_file', pattern)).toBe(false);
      expect(isToolAllowedByYolo('write_file', pattern)).toBe(false);
    });
  });

  // ========================================================================
  // YoloTimer
  // ========================================================================
  describe('YoloTimer', () => {
    let now: number;

    beforeEach(() => {
      now = 1_000_000;
      vi.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('is active within timeout duration', () => {
      const timer = new YoloTimer(60);
      expect(timer.isActive()).toBe(true);
    });

    it('is inactive after timeout expires', () => {
      const timer = new YoloTimer(10);
      now += 11_000; // 11 seconds later
      expect(timer.isActive()).toBe(false);
    });

    it('returns remaining seconds correctly', () => {
      const timer = new YoloTimer(60);
      expect(timer.remainingSeconds()).toBe(60);

      now += 30_000;
      expect(timer.remainingSeconds()).toBe(30);

      now += 35_000;
      expect(timer.remainingSeconds()).toBe(0);
    });

    it('returns 0 remaining when expired', () => {
      const timer = new YoloTimer(5);
      now += 10_000;
      expect(timer.remainingSeconds()).toBe(0);
    });

    it('0 seconds timeout means instant expire', () => {
      const timer = new YoloTimer(0);
      expect(timer.isActive()).toBe(false);
      expect(timer.remainingSeconds()).toBe(0);
    });

    it('handles large timeout values', () => {
      const timer = new YoloTimer(3600); // 1 hour
      expect(timer.isActive()).toBe(true);
      expect(timer.remainingSeconds()).toBe(3600);

      now += 1_800_000; // 30 minutes
      expect(timer.isActive()).toBe(true);
      expect(timer.remainingSeconds()).toBe(1800);
    });
  });
});
