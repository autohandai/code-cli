/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Web search and URL fetching capabilities for up-to-date information
 * about packages, dependencies, documentation, and changelogs.
 */

import * as https from 'https';
import * as http from 'http';
import { existsSync } from 'fs';
import { spawn } from 'child_process';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOptions {
  maxResults?: number;
  searchType?: 'general' | 'packages' | 'docs' | 'changelog';
  /** Override the default search provider */
  provider?: 'brave' | 'duckduckgo' | 'parallel' | 'google' | 'browser-profile' | 'exa';
  signal?: AbortSignal;
}

export interface FetchUrlOptions {
  selector?: string;
  maxLength?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class WebActionAbortedError extends Error {
  constructor(message = 'Web action aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new WebActionAbortedError();
}

function isAbortError(error: unknown): boolean {
  return error instanceof WebActionAbortedError || (
    error instanceof Error && error.name === 'AbortError'
  );
}

function rethrowAbort(error: unknown): void {
  if (isAbortError(error)) throw error;
}

/** Search provider configuration */
export interface SearchConfig {
  provider: 'brave' | 'duckduckgo' | 'parallel' | 'google' | 'browser-profile' | 'exa';
  braveApiKey?: string;
  parallelApiKey?: string;
  exaApiKey?: string;
}

/** Global search configuration - set by the agent at startup */
let globalSearchConfig: SearchConfig = {
  provider: 'browser-profile'
};

/**
 * Configure the global search provider settings
 */
export function configureSearch(config: Partial<SearchConfig>): void {
  globalSearchConfig = { ...globalSearchConfig, ...config };
}

/**
 * Get the current search configuration
 */
export function getSearchConfig(): SearchConfig {
  return { ...globalSearchConfig };
}

/**
 * Check if a reliable search provider is configured.
 *
 * DuckDuckGo (the default) is unreliable — it frequently returns CAPTCHA
 * challenges and timeouts. It should NOT count as "configured" for the
 * purpose of offering the web_search tool to the LLM.
 *
 * Returns true when:
 * - browser-profile is selected AND Chrome/Chromium is available
 * - Exa is selected AND has an API key
 * - Brave is selected AND has an API key
 * - Parallel is selected AND has an API key
 * - Google is selected (no key required, more reliable than DDG)
 */
export function isSearchConfigured(): boolean {
  const config = getSearchConfig();
  const braveKey = config.braveApiKey ?? process.env.BRAVE_SEARCH_API_KEY;
  const parallelKey = config.parallelApiKey ?? process.env.PARALLEL_API_KEY;
  const exaKey = config.exaApiKey ?? process.env.EXA_API_KEY;

  switch (config.provider) {
    case 'browser-profile':
      return !!findChromePath(); // Available if Chrome/Chromium is installed
    case 'exa':
      return !!exaKey;
    case 'brave':
      return !!braveKey;
    case 'parallel':
      return !!parallelKey;
    case 'google':
      return true; // Google scraping doesn't need an API key
    case 'duckduckgo':
    default:
      return false; // Unreliable — don't count as configured
  }
}

/**
 * Detect system Chrome/Chromium installation path.
 * Checks platform-specific locations in priority order.
 * Returns null if no Chrome installation is found.
 */
export function findChromePath(): string | null {
  const platform = process.platform;

  const paths: string[] = [];

  if (platform === 'darwin') {
    paths.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    );
  }

  if (platform === 'linux') {
    paths.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    );
  }

  if (platform === 'win32') {
    const programFiles = process.env.PROGRAMFILES ?? 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
    const localAppData = process.env.LOCALAPPDATA ?? '';
    paths.push(
      `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
      `${localAppData}\\Google\\Chrome\\Application\\chrome.exe`,
    );
  }

  for (const p of paths) {
    if (existsSync(p)) {
      return p;
    }
  }

  return null;
}

/**
 * Parse Google search results from rendered DOM HTML.
 * Handles multiple Google result page layouts.
 *
 * Returns empty array if the page is a CAPTCHA or noscript redirect.
 */
export function parseGoogleResultsFromDOM(html: string, maxResults: number): WebSearchResult[] {
  // Detect CAPTCHA or block pages
  if (
    html.includes('unusual traffic') ||
    html.includes('captcha-form') ||
    html.includes('g-recaptcha') ||
    html.includes('sorry/index')
  ) {
    return [];
  }

  // Detect noscript redirect (no JS rendered)
  if (html.includes('<noscript') && !html.includes('class="g"')) {
    return [];
  }

  const results: WebSearchResult[] = [];

  // Strategy 1: Parse <div class="g"> result blocks (standard Google layout)
  // Each block contains an <a> with href and an <h3> with the title
  const gBlockRegex = /<div\s+class="g"[^>]*>([\s\S]*?)(?=<div\s+class="g"|<footer|$)/gi;
  let blockMatch;

  while ((blockMatch = gBlockRegex.exec(html)) !== null && results.length < maxResults) {
    const block = blockMatch[1];

    // Extract URL — either direct https:// or /url?q= redirect
    let url: string | null = null;
    const urlMatch = block.match(/<a[^>]*href="(\/url\?q=([^&"]+)|https?:\/\/[^"]+)"[^>]*>/i);
    if (urlMatch) {
      if (urlMatch[2]) {
        // /url?q= redirect
        url = decodeURIComponent(urlMatch[2]);
      } else {
        url = urlMatch[1];
      }
    }

    // Skip Google's own URLs
    if (!url || url.includes('google.com') || !url.startsWith('http')) {
      continue;
    }

    // Extract title from <h3>
    const titleMatch = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    const title = titleMatch ? htmlToText(titleMatch[1]).trim() : '';

    if (!title) continue;

    // Extract snippet — look for common snippet class patterns
    let snippet = '';
    const snippetMatch = block.match(
      /class="(?:VwiC3b|st|aCOpRe|s3v9rd)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span)>/i
    );
    if (snippetMatch) {
      snippet = htmlToText(snippetMatch[1]).trim().slice(0, 300);
    }

    results.push({ title, url, snippet });
  }

  // Strategy 2: Fallback — scan for <a> with <h3> children anywhere in the doc
  if (results.length === 0) {
    const linkH3Regex = /<a[^>]*href="(\/url\?q=(https?:\/\/[^&"]+)[^"]*|https?:\/\/[^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/gi;
    let match;
    while ((match = linkH3Regex.exec(html)) !== null && results.length < maxResults) {
      const url = match[2] ? decodeURIComponent(match[2]) : match[1];
      const title = htmlToText(match[3]).trim();

      if (!url || !title || url.includes('google.com') || !url.startsWith('http')) continue;

      results.push({ title, url, snippet: '' });
    }
  }

  return results;
}

/**
 * Execute headless Chrome to render a URL and return the DOM.
 * Uses --headless=new --dump-dom for modern headless mode.
 */
async function executeChromeDom(
  chromePath: string,
  args: string[],
  timeout: number,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);

  return new Promise((resolve, reject) => {
    const proc = spawn(chromePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let terminationReason: 'abort' | 'timeout' | 'truncated' | undefined;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener('abort', handleAbort);
    };

    const finish = (error?: Error, result?: string): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(result ?? '');
    };

    const terminate = (reason: 'abort' | 'timeout' | 'truncated'): void => {
      if (settled || terminationReason) return;
      terminationReason = reason;
      proc.kill('SIGTERM');
      forceKillTimer = setTimeout(() => {
        forceKillTimer = undefined;
        if (!settled) proc.kill('SIGKILL');
      }, 1000);
      forceKillTimer.unref?.();
    };

    function handleAbort(): void {
      terminate('abort');
    }

    const timeoutTimer = setTimeout(() => terminate('timeout'), timeout);
    timeoutTimer.unref?.();
    signal?.addEventListener('abort', handleAbort, { once: true });

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
      if (stdout.length > 500000) terminate('truncated');
    });
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    proc.on('close', (code) => {
      if (terminationReason === 'abort') {
        finish(new WebActionAbortedError());
      } else if (terminationReason === 'timeout') {
        finish(new Error(`Chrome request timed out after ${timeout}ms`));
      } else if (terminationReason === 'truncated') {
        finish(undefined, stdout.slice(0, 500000));
      } else if (code !== 0 && code !== null) {
        finish(new Error(`Chrome exited with code ${code}: ${stderr.slice(0, 500)}`));
      } else {
        finish(undefined, stdout);
      }
    });
    proc.on('error', (error) => {
      if (terminationReason === 'abort') finish(new WebActionAbortedError());
      else finish(new Error(`Failed to launch Chrome: ${error.message}`));
    });
  });
}

async function chromeHeadlessFetch(url: string, timeout = 20000, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  const chromePath = findChromePath();
  if (!chromePath) {
    throw new Error(
      'Google Chrome or Chromium not found. Install Chrome or configure a different search provider with /search.'
    );
  }

  return executeChromeDom(chromePath, [
    '--headless=new',
    '--dump-dom',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-sync',
    '--no-first-run',
    '--mute-audio',
    url,
  ], timeout, signal);
}

export interface NpmPackageInfo {
  name: string;
  version: string;
  description: string;
  homepage?: string;
  repository?: string;
  license?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  keywords?: string[];
  maintainers?: Array<{ name: string; email?: string }>;
}

/**
 * Simple HTTP/HTTPS fetch that works without external dependencies
 */
interface SimpleRequestOptions {
  timeout?: number;
  maxLength?: number;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: string;
  signal?: AbortSignal;
}

interface SimpleResponse {
  body: string;
  statusCode?: number;
  statusMessage?: string;
  location?: string;
}

async function simpleRequest(url: string, options: SimpleRequestOptions = {}): Promise<SimpleResponse> {
  const timeout = options.timeout ?? 10000;
  const maxLength = options.maxLength ?? 50000;
  throwIfAborted(options.signal);

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const defaultHeaders: Record<string, string> = {
      'User-Agent': 'Autohand-CLI/1.0 (https://autohand.ai)',
      'Accept': 'text/html,application/json,text/plain,*/*',
      'Accept-Language': 'en-US,en;q=0.9'
    };

    let settled = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      options.signal?.removeEventListener('abort', handleAbort);
    };
    const finishResolve = (response: SimpleResponse): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(response);
    };
    const finishReject = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const req = protocol.request(url, {
      method: options.method ?? 'GET',
      headers: options.headers ?? defaultHeaders
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        if (settled) return;
        data += chunk;
        if (data.length > maxLength) {
          res.destroy();
          finishResolve({
            body: data.slice(0, maxLength) + '\n... (truncated)',
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            location: res.headers.location,
          });
        }
      });
      res.on('end', () => finishResolve({
        body: data,
        statusCode: res.statusCode,
        statusMessage: res.statusMessage,
        location: res.headers.location,
      }));
      res.on('error', (error) => finishReject(error));
    });

    function handleAbort(): void {
      const error = new WebActionAbortedError();
      req.destroy(error);
      finishReject(error);
    }

    options.signal?.addEventListener('abort', handleAbort, { once: true });
    req.on('error', (error) => finishReject(error));
    if (timeout > 0) timeoutTimer = setTimeout(() => {
      const error = new Error('Request timed out');
      req.destroy(error);
      finishReject(error);
    }, timeout);
    timeoutTimer?.unref?.();
    req.end(options.body);
  });
}

async function simpleFetch(url: string, options: SimpleRequestOptions = {}): Promise<string> {
  const response = await simpleRequest(url, options);
  if (
    response.statusCode &&
    response.statusCode >= 300 &&
    response.statusCode < 400 &&
    response.location
  ) {
    const redirectedUrl = new URL(response.location, url).toString();
    return simpleFetch(redirectedUrl, { ...options, method: 'GET', body: undefined });
  }
  if (response.statusCode && response.statusCode >= 400) {
    throw new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`);
  }
  return response.body;
}

/**
 * Extract text content from HTML, removing scripts, styles, and tags
 */
function htmlToText(html: string): string {
  return html
    // Remove scripts and styles
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // Convert common block elements to newlines
    .replace(/<(\/?(p|div|br|h[1-6]|li|tr|td|th|blockquote|pre|hr))[^>]*>/gi, '\n')
    // Remove remaining tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-z]+;/gi, '')
    // Clean up whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Search the web using the configured search provider
 *
 * Supports:
 * - Browser Profile (uses user's Chrome/Chromium with cookies/login state)
 * - Exa.ai Search API (requires API key)
 * - Google HTML scraping (no API key, reliable default)
 * - Brave Search API (requires API key)
 * - DuckDuckGo HTML (may be blocked by CAPTCHA)
 * - Parallel.ai Search API (requires API key)
 */
export async function webSearch(query: string, options: WebSearchOptions = {}): Promise<WebSearchResult[]> {
  throwIfAborted(options.signal);
  const maxResults = options.maxResults ?? 5;
  const searchType = options.searchType ?? 'general';

  // Enhance query based on search type
  let enhancedQuery = query;
  switch (searchType) {
    case 'packages':
      enhancedQuery = `${query} npm package OR pypi package site:npmjs.com OR site:pypi.org`;
      break;
    case 'docs':
      enhancedQuery = `${query} documentation OR docs OR guide`;
      break;
    case 'changelog':
      enhancedQuery = `${query} changelog OR release notes OR what's new`;
      break;
  }

  // Use provider from options or fall back to global config
  let provider = options.provider ?? globalSearchConfig.provider;

  // Get API keys from config or environment
  const braveApiKey = globalSearchConfig.braveApiKey ?? process.env.BRAVE_SEARCH_API_KEY;
  const parallelApiKey = globalSearchConfig.parallelApiKey ?? process.env.PARALLEL_API_KEY;
  const exaApiKey = globalSearchConfig.exaApiKey ?? process.env.EXA_API_KEY;

  // Auto-fallback: if browser-profile selected but Chrome not available, use google
  if (provider === 'browser-profile' && !findChromePath()) {
    provider = 'google';
  }

  switch (provider) {
    case 'browser-profile':
      return browserProfileSearch(enhancedQuery, maxResults, options.signal);

    case 'exa':
      if (!exaApiKey) {
        throw new Error(
          'Exa.ai Search requires an API key. Configure it with /search or set EXA_API_KEY environment variable. ' +
          'Get an API key at: https://exa.ai'
        );
      }
      return exaSearch(enhancedQuery, exaApiKey, maxResults, options.signal);

    case 'brave':
      if (!braveApiKey) {
        throw new Error(
          'Brave Search requires an API key. Configure it with /search or set BRAVE_SEARCH_API_KEY environment variable. ' +
          'Get a free API key at: https://brave.com/search/api/'
        );
      }
      return braveSearch(enhancedQuery, braveApiKey, maxResults, options.signal);

    case 'parallel':
      if (!parallelApiKey) {
        throw new Error(
          'Parallel.ai Search requires an API key. Configure it with /search or set PARALLEL_API_KEY environment variable. ' +
          'Get an API key at: https://platform.parallel.ai'
        );
      }
      return parallelSearch(enhancedQuery, parallelApiKey, maxResults, options.signal);

    case 'google':
      return googleSearch(enhancedQuery, maxResults, options.signal);

    case 'duckduckgo':
    default:
      return duckduckgoSearch(enhancedQuery, maxResults, options.signal);
  }
}

/**
 * Search using Google via headless Chrome (no API key required).
 * Uses the system Chrome installation to render JS-heavy search pages.
 * Falls back to HTTP scraping if Chrome is not installed.
 */
async function googleSearch(query: string, maxResults: number, signal?: AbortSignal): Promise<WebSearchResult[]> {
  throwIfAborted(signal);
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${maxResults}&hl=en`;

  // Strategy 1: Headless Chrome (renders JS, most reliable)
  const chromePath = findChromePath();
  if (chromePath) {
    try {
      const html = await chromeHeadlessFetch(searchUrl, 25000, signal);
      const results = parseGoogleResultsFromDOM(html, maxResults);

      if (results.length > 0) {
        return results;
      }

      // CAPTCHA or empty results — Chrome rendered but Google blocked us
      if (html.includes('unusual traffic') || html.includes('captcha') || html.includes('g-recaptcha')) {
        throw new Error(
          'Google blocked this search with a CAPTCHA. Your IP may be rate-limited. ' +
          'Configure Brave Search (free 2K queries/month) with /search command: https://brave.com/search/api/'
        );
      }
    } catch (error) {
      rethrowAbort(error);
      // If Chrome failed entirely, try HTTP fallback
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('CAPTCHA') || msg.includes('blocked')) {
        throw error; // Don't retry — IP is flagged
      }
      // Chrome launch failure — fall through to HTTP
    }
  }

  // Strategy 2: Direct HTTP scraping (works when Google serves non-JS page)
  try {
    const html = await simpleFetch(searchUrl, {
      timeout: 15000,
      maxLength: 200000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal,
    });

    // Check for CAPTCHA / block
    if (html.includes('unusual traffic') || html.includes('captcha') || html.includes('sorry/index')) {
      throw new Error(
        'Google blocked this search request. ' +
        'Configure Brave Search (free 2K queries/month) with /search command: https://brave.com/search/api/'
      );
    }

    const results = parseGoogleResultsFromDOM(html, maxResults);
    if (results.length > 0) {
      return results;
    }
  } catch (error) {
    rethrowAbort(error);
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('blocked') || msg.includes('CAPTCHA')) {
      throw new Error(`Google search failed: ${msg}`);
    }
    // HTTP also failed — give a helpful error
  }

  // Both strategies failed
  const hasChrome = !!chromePath;
  throw new Error(
    `Google search failed: Could not retrieve results${hasChrome ? '' : ' (Chrome not installed)'}. ` +
    'Configure Brave Search for reliable results: /search → Brave (free 2K queries/month at https://brave.com/search/api/)'
  );
}

/**
 * Search using DuckDuckGo HTML (no API key required, but may be blocked)
 */
async function duckduckgoSearch(query: string, maxResults: number, signal?: AbortSignal): Promise<WebSearchResult[]> {
  throwIfAborted(signal);
  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const html = await simpleFetch(searchUrl, { timeout: 15000, maxLength: 100000, signal });

    // Check for bot detection CAPTCHA
    if (html.includes('anomaly-modal') || html.includes('bots use DuckDuckGo') || html.includes('cc=botnet')) {
      throw new Error(
        'DuckDuckGo blocked this search with a CAPTCHA challenge. ' +
        'Configure a different search provider with /search command. ' +
        'Options: brave (https://brave.com/search/api/) or parallel (https://platform.parallel.ai)'
      );
    }

    // Parse search results from HTML
    const results: WebSearchResult[] = [];
    const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([^<]*(?:<[^>]+>[^<]*)*)<\/a>/gi;

    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
      const url = match[1];
      const title = match[2].trim();
      const snippet = htmlToText(match[3]).slice(0, 300);

      if (url && title && !url.includes('duckduckgo.com')) {
        results.push({ title, url, snippet });
      }
    }

    // Fallback: try alternative parsing if no results
    if (results.length === 0) {
      const altRegex = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([^<]+)<\/a>/gi;
      while ((match = altRegex.exec(html)) !== null && results.length < maxResults) {
        const url = match[1];
        const title = match[2].trim();
        if (url && title && !url.includes('duckduckgo.com') && title.length > 5) {
          results.push({ title, url, snippet: '' });
        }
      }
    }

    if (results.length === 0) {
      throw new Error(
        'No search results found. DuckDuckGo may be rate-limiting requests. ' +
        'Configure a different search provider with /search command.'
      );
    }

    return results;
  } catch (error) {
    rethrowAbort(error);
    throw new Error(`DuckDuckGo search failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Search using Parallel.ai API
 */
async function parallelSearch(
  query: string,
  apiKey: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<WebSearchResult[]> {
  const postData = JSON.stringify({
    objective: query,
    search_queries: [query],
    max_results: maxResults,
    excerpts: { max_chars_per_result: 500 },
  });
  const response = await simpleRequest('https://api.parallel.ai/v1beta/search', {
    method: 'POST',
    body: postData,
    timeout: 30000,
    maxLength: 500000,
    signal,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(postData)),
      'x-api-key': apiKey,
      'parallel-beta': 'search-extract-2025-10-10',
    },
  });
  if (response.statusCode && response.statusCode >= 400) {
    throw new Error(`Parallel.ai API error: HTTP ${response.statusCode} - ${response.body}`);
  }

  let json: {
    results?: Array<{
      title?: string;
      url?: string;
      excerpt?: string;
      content?: string;
      snippet?: string;
      description?: string;
    }>;
    search_results?: Array<{
      title?: string;
      url?: string;
      excerpt?: string;
      content?: string;
      snippet?: string;
      description?: string;
    }>;
  };
  try {
    json = JSON.parse(response.body);
  } catch (parseError) {
    throw new Error(`Failed to parse Parallel.ai response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
  }

  const results: WebSearchResult[] = [];
  const source = Array.isArray(json.results)
    ? json.results
    : Array.isArray(json.search_results)
      ? json.search_results
      : [];
  for (const result of source.slice(0, maxResults)) {
    results.push({
      title: result.title || result.url || 'Untitled',
      url: result.url || '',
      snippet: result.excerpt || result.content?.slice(0, 300) || result.snippet || result.description || '',
    });
  }
  return results;
}

/**
 * Search using Brave Search API
 */
async function braveSearch(
  query: string,
  apiKey: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<WebSearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
  const response = await simpleRequest(url, {
    timeout: 15000,
    maxLength: 500000,
    signal,
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'identity',
      'X-Subscription-Token': apiKey,
    },
  });
  if (response.statusCode && response.statusCode >= 400) {
    throw new Error(`Brave Search API error: HTTP ${response.statusCode}`);
  }

  try {
    const json = JSON.parse(response.body) as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
    };
    return json.web?.results?.slice(0, maxResults).map((result) => ({
      title: result.title || '',
      url: result.url || '',
      snippet: result.description || '',
    })) ?? [];
  } catch (parseError) {
    throw new Error(`Failed to parse Brave Search response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
  }
}

/**
 * Search using Exa.ai API
 * https://exa.ai/docs/reference/search-api-guide
 */
async function exaSearch(
  query: string,
  apiKey: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<WebSearchResult[]> {
  const postData = JSON.stringify({
    query,
    numResults: maxResults,
    contents: {
      text: true
    }
  });

  const response = await simpleRequest('https://api.exa.ai/search', {
    method: 'POST',
    body: postData,
    timeout: 30000,
    maxLength: 1000000,
    signal,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Content-Length': String(Buffer.byteLength(postData)),
    },
  });
  if (response.statusCode && response.statusCode >= 400) {
    throw new Error(`Exa.ai API error: HTTP ${response.statusCode} - ${response.body}`);
  }

  try {
    const json = JSON.parse(response.body) as {
      results?: Array<{
        title?: string;
        url?: string;
        text?: string;
        highlight?: string;
      }>;
    };
    return Array.isArray(json.results)
      ? json.results.slice(0, maxResults).map((result) => ({
          title: result.title || result.url || 'Untitled',
          url: result.url || '',
          snippet: result.text?.slice(0, 300) || result.highlight?.slice(0, 300) || '',
        }))
      : [];
  } catch (parseError) {
    throw new Error(`Failed to parse Exa.ai response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
  }
}

/**
 * Search using user's browser profile via Chrome DevTools Protocol.
 * Leverages user's cookies, login state, and browsing history for reliable results.
 */
async function browserProfileSearch(
  query: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<WebSearchResult[]> {
  throwIfAborted(signal);
  const chromePath = findChromePath();
  if (!chromePath) {
    throw new Error(
      'No Chrome/Chromium browser found. Install Chrome or configure a different search provider with /search.'
    );
  }

  // Find a user profile to use
  const profile = await findBrowserProfile();
  throwIfAborted(signal);
  if (!profile) {
    // Fall back to headless search without profile
    return googleSearch(query, maxResults, signal);
  }

  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${maxResults}&hl=en`;
  const port = 9222 + Math.floor(Math.random() * 1000);

  try {
    const stdout = await executeChromeDom(chromePath, [
      `--remote-debugging-port=${port}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
      '--disable-background-networking',
      '--disable-sync',
      `--user-data-dir=${profile.userDataDir}`,
      `--profile-directory=${profile.profileDirectory}`,
      '--headless=new',
      '--dump-dom',
      searchUrl,
    ], 30000, signal);

    const results = parseGoogleResultsFromDOM(stdout, maxResults);
    const wasBlocked = stdout.includes('unusual traffic') ||
      stdout.includes('captcha') ||
      stdout.includes('g-recaptcha');
    if (!wasBlocked && results.length > 0) return results;
  } catch (error) {
    rethrowAbort(error);
  }

  return googleSearch(query, maxResults, signal);
}

/**
 * Detect user's browser profile to use for searching.
 * Returns the profile directory and user data dir for Chrome/Chromium/Brave/Edge.
 */
async function findBrowserProfile(): Promise<{ userDataDir: string; profileDirectory: string; browser: string } | null> {
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('fs-extra');
  const { pathExists } = fs;

  const homeDir = os.homedir();
  const platform = process.platform;

  // Define browser data roots by platform
  const browserRoots: Array<{ name: string; userDataDir: string }> = [];

  if (platform === 'darwin') {
    browserRoots.push(
      { name: 'Chrome', userDataDir: path.join(homeDir, 'Library', 'Application Support', 'Google', 'Chrome') },
      { name: 'Chromium', userDataDir: path.join(homeDir, 'Library', 'Application Support', 'Chromium') },
      { name: 'Brave', userDataDir: path.join(homeDir, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser') },
      { name: 'Edge', userDataDir: path.join(homeDir, 'Library', 'Application Support', 'Microsoft Edge') },
    );
  } else if (platform === 'linux') {
    browserRoots.push(
      { name: 'Chrome', userDataDir: path.join(homeDir, '.config', 'google-chrome') },
      { name: 'Chromium', userDataDir: path.join(homeDir, '.config', 'chromium') },
      { name: 'Brave', userDataDir: path.join(homeDir, '.config', 'BraveSoftware', 'Brave-Browser') },
      { name: 'Edge', userDataDir: path.join(homeDir, '.config', 'microsoft-edge') },
    );
  } else if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? '';
    browserRoots.push(
      { name: 'Chrome', userDataDir: path.join(localAppData, 'Google', 'Chrome', 'User Data') },
      { name: 'Chromium', userDataDir: path.join(localAppData, 'Chromium', 'User Data') },
      { name: 'Brave', userDataDir: path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data') },
      { name: 'Edge', userDataDir: path.join(localAppData, 'Microsoft', 'Edge', 'User Data') },
    );
  }

  // Find the first browser with a valid profile
  for (const browser of browserRoots) {
    if (!(await pathExists(browser.userDataDir))) {
      continue;
    }

    try {
      const entries = await fs.readdir(browser.userDataDir);
      const profiles = entries.filter((entry: string) =>
        entry === 'Default' || entry.startsWith('Profile ')
      );

      // Prefer Default profile, otherwise use first available
      const profileDirectory = profiles.includes('Default') ? 'Default' : profiles[0];
      if (profileDirectory) {
        return {
          userDataDir: browser.userDataDir,
          profileDirectory,
          browser: browser.name,
        };
      }
    } catch {
      // Continue to next browser
    }
  }

  return null;
}

/**
 * Fetch and extract content from a URL
 */
export async function fetchUrl(url: string, options: FetchUrlOptions = {}): Promise<string> {
  throwIfAborted(options.signal);
  const maxLength = options.maxLength ?? 30000;

  try {
    const content = await simpleFetch(url, {
      timeout: options.timeoutMs ?? 15000,
      maxLength: maxLength * 2,
      signal: options.signal,
    });

    // Check if it's JSON
    if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
      try {
        const json = JSON.parse(content);
        return JSON.stringify(json, null, 2).slice(0, maxLength);
      } catch {
        // Not valid JSON, continue as text
      }
    }

    // Convert HTML to text
    const text = htmlToText(content);
    return text.slice(0, maxLength);
  } catch (error) {
    rethrowAbort(error);
    throw new Error(`Failed to fetch URL: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Supported package registries
 */
export type PackageRegistry = 'npm' | 'pypi' | 'crates' | 'maven' | 'go' | 'rubygems';

export interface PackageInfo {
  registry: PackageRegistry;
  name: string;
  version: string;
  description: string;
  homepage?: string;
  repository?: string;
  license?: string;
  dependencies?: Record<string, string>;
  keywords?: string[];
  authors?: string[];
}

/**
 * Get npm package information from the registry
 */
export async function getNpmInfo(
  packageName: string,
  version?: string,
  signal?: AbortSignal,
): Promise<PackageInfo> {
  throwIfAborted(signal);
  try {
    const url = version
      ? `https://registry.npmjs.org/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`
      : `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`;

    const content = await simpleFetch(url, { timeout: 10000, signal });
    const data = JSON.parse(content);

    return {
      registry: 'npm',
      name: data.name,
      version: data.version,
      description: data.description || '',
      homepage: data.homepage,
      repository: typeof data.repository === 'string' ? data.repository : data.repository?.url,
      license: data.license,
      dependencies: data.dependencies,
      keywords: data.keywords,
      authors: data.maintainers?.map((m: any) => m.name || m.email)
    };
  } catch (error) {
    rethrowAbort(error);
    throw new Error(`Failed to get npm info for ${packageName}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get PyPI package information (Python)
 */
export async function getPyPIInfo(
  packageName: string,
  version?: string,
  signal?: AbortSignal,
): Promise<PackageInfo> {
  throwIfAborted(signal);
  try {
    const url = version
      ? `https://pypi.org/pypi/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}/json`
      : `https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`;

    const content = await simpleFetch(url, { timeout: 10000, signal });
    const data = JSON.parse(content);
    const info = data.info;

    return {
      registry: 'pypi',
      name: info.name,
      version: info.version,
      description: info.summary || '',
      homepage: info.home_page || info.project_url,
      repository: info.project_urls?.Repository || info.project_urls?.Source,
      license: info.license,
      dependencies: info.requires_dist?.reduce((acc: Record<string, string>, dep: string) => {
        const [name] = dep.split(/[<>=!;\s]/);
        acc[name] = dep;
        return acc;
      }, {}),
      keywords: info.keywords?.split(',').map((k: string) => k.trim()).filter(Boolean),
      authors: info.author ? [info.author] : []
    };
  } catch (error) {
    rethrowAbort(error);
    throw new Error(`Failed to get PyPI info for ${packageName}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get Cargo package information (Rust - crates.io)
 */
export async function getCargoInfo(
  packageName: string,
  version?: string,
  signal?: AbortSignal,
): Promise<PackageInfo> {
  throwIfAborted(signal);
  try {
    const url = `https://crates.io/api/v1/crates/${encodeURIComponent(packageName)}`;
    const content = await simpleFetch(url, { timeout: 10000, signal });
    const data = JSON.parse(content);
    const crate = data.crate;
    const ver = version
      ? data.versions?.find((v: any) => v.num === version)
      : data.versions?.[0];

    return {
      registry: 'crates',
      name: crate.name,
      version: ver?.num || crate.newest_version,
      description: crate.description || '',
      homepage: crate.homepage,
      repository: crate.repository,
      license: ver?.license,
      keywords: crate.keywords,
      authors: ver?.published_by?.name ? [ver.published_by.name] : []
    };
  } catch (error) {
    rethrowAbort(error);
    throw new Error(`Failed to get Cargo info for ${packageName}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get RubyGems package information (Ruby)
 */
export async function getRubyGemsInfo(
  packageName: string,
  version?: string,
  signal?: AbortSignal,
): Promise<PackageInfo> {
  throwIfAborted(signal);
  try {
    const url = version
      ? `https://rubygems.org/api/v1/versions/${encodeURIComponent(packageName)}.json`
      : `https://rubygems.org/api/v1/gems/${encodeURIComponent(packageName)}.json`;

    const content = await simpleFetch(url, { timeout: 10000, signal });
    const data = JSON.parse(content);

    // If fetching specific version, it returns an array
    const gem = Array.isArray(data)
      ? data.find((v: any) => v.number === version) || data[0]
      : data;

    return {
      registry: 'rubygems',
      name: gem.name || packageName,
      version: gem.version || gem.number,
      description: gem.info || gem.summary || '',
      homepage: gem.homepage_uri,
      repository: gem.source_code_uri,
      license: gem.licenses?.[0],
      keywords: [],
      authors: gem.authors ? [gem.authors] : []
    };
  } catch (error) {
    rethrowAbort(error);
    throw new Error(`Failed to get RubyGems info for ${packageName}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get Go module information (pkg.go.dev)
 */
export async function getGoModuleInfo(
  modulePath: string,
  _version?: string,
  signal?: AbortSignal,
): Promise<PackageInfo> {
  throwIfAborted(signal);
  try {
    // Go proxy API
    const url = `https://proxy.golang.org/${encodeURIComponent(modulePath)}/@latest`;
    const content = await simpleFetch(url, { timeout: 10000, signal });
    const data = JSON.parse(content);

    return {
      registry: 'go',
      name: modulePath,
      version: data.Version || 'latest',
      description: `Go module: ${modulePath}`,
      homepage: `https://pkg.go.dev/${modulePath}`,
      repository: modulePath.startsWith('github.com') ? `https://${modulePath}` : undefined,
      license: undefined, // Go proxy doesn't provide license info
      keywords: [],
      authors: []
    };
  } catch (error) {
    rethrowAbort(error);
    throw new Error(`Failed to get Go module info for ${modulePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Universal package info getter - auto-detects registry or uses specified one
 */
export async function getPackageInfo(
  packageName: string,
  options: { registry?: PackageRegistry; version?: string; signal?: AbortSignal } = {}
): Promise<PackageInfo> {
  throwIfAborted(options.signal);
  const registry = options.registry || detectRegistry(packageName);

  switch (registry) {
    case 'npm':
      return getNpmInfo(packageName, options.version, options.signal);
    case 'pypi':
      return getPyPIInfo(packageName, options.version, options.signal);
    case 'crates':
      return getCargoInfo(packageName, options.version, options.signal);
    case 'rubygems':
      return getRubyGemsInfo(packageName, options.version, options.signal);
    case 'go':
      return getGoModuleInfo(packageName, options.version, options.signal);
    default:
      // Default to npm
      return getNpmInfo(packageName, options.version, options.signal);
  }
}

/**
 * Detect package registry from package name patterns
 */
function detectRegistry(packageName: string): PackageRegistry {
  // Go modules typically start with domain
  if (packageName.includes('/') && (
    packageName.startsWith('github.com/') ||
    packageName.startsWith('golang.org/') ||
    packageName.startsWith('google.golang.org/')
  )) {
    return 'go';
  }

  // Rust crates often have underscores
  if (packageName.includes('_') && !packageName.startsWith('@')) {
    return 'crates';
  }

  // Default to npm for most cases
  return 'npm';
}

/**
 * Format web search results for display
 */
export function formatSearchResults(results: WebSearchResult[]): string {
  if (results.length === 0) {
    return 'No results found.';
  }

  return results.map((r, i) => {
    const lines = [`${i + 1}. **${r.title}**`, `   ${r.url}`];
    if (r.snippet) {
      lines.push(`   ${r.snippet}`);
    }
    return lines.join('\n');
  }).join('\n\n');
}

/**
 * Format package info for display (works with any registry)
 */
export function formatPackageInfo(info: PackageInfo): string {
  const registryLabels: Record<PackageRegistry, string> = {
    npm: 'npm',
    pypi: 'PyPI',
    crates: 'crates.io',
    maven: 'Maven',
    go: 'Go',
    rubygems: 'RubyGems'
  };

  const lines = [
    `**${info.name}** v${info.version} (${registryLabels[info.registry]})`,
    '',
    info.description || 'No description',
    ''
  ];

  if (info.homepage) {
    lines.push(`Homepage: ${info.homepage}`);
  }
  if (info.repository) {
    lines.push(`Repository: ${info.repository}`);
  }
  if (info.license) {
    lines.push(`License: ${info.license}`);
  }
  if (info.keywords?.length) {
    lines.push(`Keywords: ${info.keywords.join(', ')}`);
  }
  if (info.authors?.length) {
    lines.push(`Authors: ${info.authors.join(', ')}`);
  }

  if (info.dependencies && Object.keys(info.dependencies).length > 0) {
    lines.push('', 'Dependencies:');
    for (const [name, version] of Object.entries(info.dependencies).slice(0, 10)) {
      lines.push(`  - ${name}: ${version}`);
    }
    if (Object.keys(info.dependencies).length > 10) {
      lines.push(`  ... and ${Object.keys(info.dependencies).length - 10} more`);
    }
  }

  return lines.join('\n');
}

// Alias for backward compatibility
export const formatNpmInfo = formatPackageInfo;
