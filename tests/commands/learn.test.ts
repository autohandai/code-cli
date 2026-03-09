/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { parseLearnArgs, metadata } from '../../src/commands/learn.js';

describe('learn command', () => {
  describe('metadata', () => {
    it('exports correct command name', () => {
      expect(metadata.command).toBe('/learn');
    });

    it('is implemented', () => {
      expect(metadata.implemented).toBe(true);
    });
  });

  describe('parseLearnArgs', () => {
    it('parses empty args as recommend subcommand', () => {
      const result = parseLearnArgs([]);
      expect(result.subcommand).toBe('recommend');
      expect(result.deep).toBeFalsy();
    });

    it('parses "update" subcommand', () => {
      const result = parseLearnArgs(['update']);
      expect(result.subcommand).toBe('update');
    });

    it('parses --deep flag with empty args', () => {
      const result = parseLearnArgs(['--deep']);
      expect(result.subcommand).toBe('recommend');
      expect(result.deep).toBe(true);
    });

    it('parses "update --deep" with both fields', () => {
      const result = parseLearnArgs(['update', '--deep']);
      expect(result.subcommand).toBe('update');
      expect(result.deep).toBe(true);
    });

    // Previously recognized subcommands (search, install, list, trending,
    // remove, feedback) have been migrated to /skills.
    // They now fall through to 'recommend'.

    it('treats "trending" as recommend (migrated to /skills)', () => {
      const result = parseLearnArgs(['trending']);
      expect(result.subcommand).toBe('recommend');
    });

    it('treats "remove" as recommend (migrated to /skills)', () => {
      const result = parseLearnArgs(['remove', 'seo-optimizer']);
      expect(result.subcommand).toBe('recommend');
    });

    it('treats "feedback" as recommend (migrated to /skills)', () => {
      const result = parseLearnArgs(['feedback', 'seo-optimizer', '5', 'Great skill']);
      expect(result.subcommand).toBe('recommend');
    });

    it('treats "@owner/name" as recommend (install migrated to /skills)', () => {
      const result = parseLearnArgs(['@anthropic/seo-optimizer']);
      expect(result.subcommand).toBe('recommend');
    });

    it('treats plain keyword as recommend (search migrated to /skills)', () => {
      const result = parseLearnArgs(['seo']);
      expect(result.subcommand).toBe('recommend');
    });

    it('treats multi-word keyword as recommend (search migrated to /skills)', () => {
      const result = parseLearnArgs(['react', 'hooks']);
      expect(result.subcommand).toBe('recommend');
    });

    it('parses "list" as recommend (list migrated to /skills)', () => {
      const result = parseLearnArgs(['list']);
      expect(result.subcommand).toBe('recommend');
    });
  });
});
