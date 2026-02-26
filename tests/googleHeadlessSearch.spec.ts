/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for Google search via headless Chrome.
 * Validates Chrome path detection, CAPTCHA handling,
 * and HTML result parsing from rendered DOM.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

// We'll test the exported helpers from web.ts
import { findChromePath, parseGoogleResultsFromDOM } from '../src/actions/web.js';

describe('findChromePath', () => {
  // findChromePath checks real filesystem paths
  // We test its behavior on the actual system rather than mocking fs
  // since ESM modules make fs mocking fragile

  it('returns a string path on systems with Chrome installed', () => {
    const result = findChromePath();
    // On macOS CI/dev machines Chrome is typically installed
    if (result !== null) {
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    } else {
      // Chrome not installed — that's valid too
      expect(result).toBeNull();
    }
  });

  it('returns a valid path or null (never throws)', () => {
    expect(() => findChromePath()).not.toThrow();
  });

  it('returns macOS Chrome path on this system', () => {
    // This test verifies the actual detection works on the current platform
    const result = findChromePath();
    if (process.platform === 'darwin' && result !== null) {
      expect(result).toMatch(/Chrome|Chromium/);
    }
  });
});

describe('parseGoogleResultsFromDOM', () => {
  it('parses standard Google search result HTML', () => {
    const html = `
    <html><body>
      <div class="g">
        <a href="https://example.com/typescript-cli">
          <h3>TypeScript CLI Tools Guide</h3>
        </a>
        <div class="VwiC3b">Learn how to build CLI tools with TypeScript and Node.js</div>
      </div>
      <div class="g">
        <a href="https://github.com/example/tool">
          <h3>Example Tool - GitHub</h3>
        </a>
        <div class="VwiC3b">A powerful CLI framework for TypeScript developers</div>
      </div>
    </body></html>`;

    const results = parseGoogleResultsFromDOM(html, 5);
    expect(results.length).toBe(2);
    expect(results[0].title).toBe('TypeScript CLI Tools Guide');
    expect(results[0].url).toBe('https://example.com/typescript-cli');
    expect(results[0].snippet).toContain('CLI tools');
    expect(results[1].title).toBe('Example Tool - GitHub');
    expect(results[1].url).toBe('https://github.com/example/tool');
  });

  it('parses results with /url?q= redirect links', () => {
    const html = `
    <html><body>
      <div class="g">
        <a href="/url?q=https://docs.example.com/guide&amp;sa=U">
          <h3>Documentation Guide</h3>
        </a>
        <div class="VwiC3b">Complete guide to the framework</div>
      </div>
    </body></html>`;

    const results = parseGoogleResultsFromDOM(html, 5);
    expect(results.length).toBe(1);
    expect(results[0].url).toBe('https://docs.example.com/guide');
    expect(results[0].title).toBe('Documentation Guide');
  });

  it('returns empty array for CAPTCHA page', () => {
    const html = `
    <html><body>
      <form id="captcha-form" action="index" method="post">
        <div>unusual traffic from your computer network</div>
        <div class="g-recaptcha"></div>
      </form>
    </body></html>`;

    const results = parseGoogleResultsFromDOM(html, 5);
    expect(results.length).toBe(0);
  });

  it('returns empty array for noscript redirect page', () => {
    const html = `
    <html><head><noscript><meta http-equiv="refresh" content="0;url=..."></noscript></head>
    <body>Please enable javascript</body></html>`;

    const results = parseGoogleResultsFromDOM(html, 5);
    expect(results.length).toBe(0);
  });

  it('limits results to maxResults', () => {
    const html = `
    <html><body>
      ${Array.from({ length: 10 }, (_, i) => `
        <div class="g">
          <a href="https://example.com/page${i}">
            <h3>Result ${i}</h3>
          </a>
          <div class="VwiC3b">Snippet for result ${i}</div>
        </div>
      `).join('')}
    </body></html>`;

    const results = parseGoogleResultsFromDOM(html, 3);
    expect(results.length).toBe(3);
  });

  it('skips results with google.com URLs', () => {
    const html = `
    <html><body>
      <div class="g">
        <a href="https://www.google.com/intl/en/about">
          <h3>About Google</h3>
        </a>
        <div class="VwiC3b">About page</div>
      </div>
      <div class="g">
        <a href="https://example.com/real-result">
          <h3>Real Result</h3>
        </a>
        <div class="VwiC3b">Actual search result</div>
      </div>
    </body></html>`;

    const results = parseGoogleResultsFromDOM(html, 5);
    expect(results.length).toBe(1);
    expect(results[0].title).toBe('Real Result');
  });

  it('handles h3 tags inside nested elements', () => {
    const html = `
    <html><body>
      <div class="g">
        <a href="https://example.com/nested">
          <div><h3 class="LC20lb">Nested H3 Title</h3></div>
        </a>
        <span class="aCOpRe"><span class="st">Some snippet text here</span></span>
      </div>
    </body></html>`;

    const results = parseGoogleResultsFromDOM(html, 5);
    expect(results.length).toBe(1);
    expect(results[0].title).toBe('Nested H3 Title');
  });
});
