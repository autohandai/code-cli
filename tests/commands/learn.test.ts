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
    it('parses empty args as recommendations subcommand', () => {
      const result = parseLearnArgs([]);
      expect(result.subcommand).toBe('recommendations');
    });

    it('parses "trending" subcommand', () => {
      const result = parseLearnArgs(['trending']);
      expect(result.subcommand).toBe('trending');
    });

    it('parses "list" subcommand', () => {
      const result = parseLearnArgs(['list']);
      expect(result.subcommand).toBe('list');
    });

    it('parses "update" subcommand', () => {
      const result = parseLearnArgs(['update']);
      expect(result.subcommand).toBe('update');
    });

    it('parses "remove <slug>" subcommand', () => {
      const result = parseLearnArgs(['remove', 'seo-optimizer']);
      expect(result.subcommand).toBe('remove');
      expect(result.slug).toBe('seo-optimizer');
    });

    it('parses "feedback <slug> <rating>" subcommand', () => {
      const result = parseLearnArgs(['feedback', 'seo-optimizer', '5', 'Great skill']);
      expect(result.subcommand).toBe('feedback');
      expect(result.slug).toBe('seo-optimizer');
      expect(result.rating).toBe(5);
      expect(result.comment).toBe('Great skill');
    });

    it('parses "@owner/name" as direct install', () => {
      const result = parseLearnArgs(['@anthropic/seo-optimizer']);
      expect(result.subcommand).toBe('install');
      expect(result.slug).toBe('@anthropic/seo-optimizer');
    });

    it('parses plain keyword as search', () => {
      const result = parseLearnArgs(['seo']);
      expect(result.subcommand).toBe('search');
      expect(result.query).toBe('seo');
    });

    it('parses multi-word keyword as search', () => {
      const result = parseLearnArgs(['react', 'hooks']);
      expect(result.subcommand).toBe('search');
      expect(result.query).toBe('react hooks');
    });
  });
});
