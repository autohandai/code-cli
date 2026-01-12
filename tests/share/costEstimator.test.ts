/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  estimateCost,
  createUsageStats,
  formatCost,
  formatTokens,
  formatDuration,
} from '../../src/share/costEstimator';

describe('costEstimator', () => {
  describe('estimateCost', () => {
    it('should return 0 for 0 tokens', () => {
      expect(estimateCost(0)).toBe(0);
    });

    it('should return 0 for negative tokens', () => {
      expect(estimateCost(-100)).toBe(0);
    });

    it('should calculate cost for 1000 tokens', () => {
      // $0.003 per 1K tokens
      expect(estimateCost(1000)).toBe(0.003);
    });

    it('should calculate cost for 100K tokens', () => {
      // $0.003 * 100 = $0.30
      expect(estimateCost(100000)).toBe(0.3);
    });

    it('should round to 4 decimal places', () => {
      // 1500 tokens = $0.0045
      expect(estimateCost(1500)).toBe(0.0045);
    });
  });

  describe('createUsageStats', () => {
    it('should create usage stats with calculated cost', () => {
      const stats = createUsageStats(3000, 7000);

      expect(stats.inputTokens).toBe(3000);
      expect(stats.outputTokens).toBe(7000);
      expect(stats.totalTokens).toBe(10000);
      expect(stats.estimatedCost).toBe(0.03); // 10K tokens * $0.003
    });

    it('should handle zero tokens', () => {
      const stats = createUsageStats(0, 0);

      expect(stats.totalTokens).toBe(0);
      expect(stats.estimatedCost).toBe(0);
    });
  });

  describe('formatCost', () => {
    it('should format zero cost', () => {
      expect(formatCost(0)).toBe('$0.00');
    });

    it('should format small costs with 4 decimals', () => {
      expect(formatCost(0.0045)).toBe('$0.0045');
    });

    it('should format costs >= $0.01 with 2 decimals', () => {
      expect(formatCost(0.03)).toBe('$0.03');
      expect(formatCost(1.50)).toBe('$1.50');
    });

    it('should format large costs', () => {
      expect(formatCost(10.99)).toBe('$10.99');
    });
  });

  describe('formatTokens', () => {
    it('should format small numbers as-is', () => {
      expect(formatTokens(500)).toBe('500');
      expect(formatTokens(999)).toBe('999');
    });

    it('should format thousands with K suffix', () => {
      expect(formatTokens(1000)).toBe('1.0K');
      expect(formatTokens(1500)).toBe('1.5K');
      expect(formatTokens(125000)).toBe('125.0K');
    });

    it('should format millions with M suffix', () => {
      expect(formatTokens(1000000)).toBe('1.0M');
      expect(formatTokens(1500000)).toBe('1.5M');
    });
  });

  describe('formatDuration', () => {
    it('should format seconds', () => {
      expect(formatDuration(30)).toBe('30s');
      expect(formatDuration(59)).toBe('59s');
    });

    it('should format minutes', () => {
      expect(formatDuration(60)).toBe('1m');
      expect(formatDuration(90)).toBe('1m 30s');
      expect(formatDuration(300)).toBe('5m');
    });

    it('should format hours', () => {
      expect(formatDuration(3600)).toBe('1h');
      expect(formatDuration(3900)).toBe('1h 5m');
      expect(formatDuration(7200)).toBe('2h');
    });

    it('should handle edge cases', () => {
      expect(formatDuration(0)).toBe('0s');
      expect(formatDuration(3661)).toBe('1h 1m'); // Ignores remaining seconds
    });
  });
});
