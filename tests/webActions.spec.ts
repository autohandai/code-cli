/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { formatSearchResults, formatPackageInfo, type WebSearchResult, type PackageInfo } from '../src/actions/web.js';

describe('Web Actions', () => {
  describe('formatSearchResults', () => {
    it('formats empty results', () => {
      const result = formatSearchResults([]);
      expect(result).toBe('No results found.');
    });

    it('formats search results with snippets', () => {
      const results: WebSearchResult[] = [
        { title: 'React Docs', url: 'https://react.dev', snippet: 'A library for building user interfaces' },
        { title: 'Vue Docs', url: 'https://vuejs.org', snippet: 'The Progressive JavaScript Framework' }
      ];
      const formatted = formatSearchResults(results);
      expect(formatted).toContain('1. **React Docs**');
      expect(formatted).toContain('https://react.dev');
      expect(formatted).toContain('A library for building user interfaces');
      expect(formatted).toContain('2. **Vue Docs**');
    });

    it('formats results without snippets', () => {
      const results: WebSearchResult[] = [
        { title: 'Test', url: 'https://test.com', snippet: '' }
      ];
      const formatted = formatSearchResults(results);
      expect(formatted).toContain('1. **Test**');
      expect(formatted).toContain('https://test.com');
    });
  });

  describe('formatPackageInfo', () => {
    it('formats basic npm package info', () => {
      const info: PackageInfo = {
        registry: 'npm',
        name: 'lodash',
        version: '4.17.21',
        description: 'A modern JavaScript utility library'
      };
      const formatted = formatPackageInfo(info);
      expect(formatted).toContain('**lodash** v4.17.21 (npm)');
      expect(formatted).toContain('A modern JavaScript utility library');
    });

    it('formats PyPI package info', () => {
      const info: PackageInfo = {
        registry: 'pypi',
        name: 'requests',
        version: '2.31.0',
        description: 'Python HTTP for Humans',
        license: 'Apache-2.0'
      };
      const formatted = formatPackageInfo(info);
      expect(formatted).toContain('**requests** v2.31.0 (PyPI)');
      expect(formatted).toContain('License: Apache-2.0');
    });

    it('formats Cargo crate info', () => {
      const info: PackageInfo = {
        registry: 'crates',
        name: 'serde',
        version: '1.0.193',
        description: 'A generic serialization/deserialization framework',
        authors: ['Erick Tryzelaar', 'David Tolnay']
      };
      const formatted = formatPackageInfo(info);
      expect(formatted).toContain('**serde** v1.0.193 (crates.io)');
      expect(formatted).toContain('Authors: Erick Tryzelaar, David Tolnay');
    });

    it('formats package with homepage and license', () => {
      const info: PackageInfo = {
        registry: 'npm',
        name: 'express',
        version: '4.18.2',
        description: 'Fast web framework',
        homepage: 'https://expressjs.com',
        license: 'MIT'
      };
      const formatted = formatPackageInfo(info);
      expect(formatted).toContain('Homepage: https://expressjs.com');
      expect(formatted).toContain('License: MIT');
    });

    it('formats package with dependencies', () => {
      const info: PackageInfo = {
        registry: 'npm',
        name: 'test-pkg',
        version: '1.0.0',
        description: 'Test',
        dependencies: {
          'lodash': '^4.17.0',
          'axios': '^1.0.0'
        }
      };
      const formatted = formatPackageInfo(info);
      expect(formatted).toContain('Dependencies:');
      expect(formatted).toContain('lodash: ^4.17.0');
      expect(formatted).toContain('axios: ^1.0.0');
    });

    it('truncates long dependency lists', () => {
      const deps: Record<string, string> = {};
      for (let i = 0; i < 15; i++) {
        deps[`dep-${i}`] = '^1.0.0';
      }
      const info: PackageInfo = {
        registry: 'npm',
        name: 'test-pkg',
        version: '1.0.0',
        description: 'Test',
        dependencies: deps
      };
      const formatted = formatPackageInfo(info);
      expect(formatted).toContain('... and 5 more');
    });
  });
});
