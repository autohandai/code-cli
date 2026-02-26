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
  provider?: 'brave' | 'duckduckgo' | 'parallel' | 'google';
}

/** Search provider configuration */
export interface SearchConfig {
  provider: 'brave' | 'duckduckgo' | 'parallel' | 'google';
  braveApiKey?: string;
  parallelApiKey?: string;
}

/** Global search configuration - set by the agent at startup */
let globalSearchConfig: SearchConfig = {
  provider: 'google'
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
 * - Brave is selected AND has an API key
 * - Parallel is selected AND has an API key
 * - Google is selected (no key required, more reliable than DDG)
 */
export function isSearchConfigured(): boolean {
  const config = getSearchConfig();
  const braveKey = config.braveApiKey ?? process.env.BRAVE_SEARCH_API_KEY;
  const parallelKey = config.parallelApiKey ?? process.env.PARALLEL_API_KEY;

  switch (config.provider) {
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
async function chromeHeadlessFetch(url: string, timeout = 20000): Promise<string> {
  const chromePath = findChromePath();
  if (!chromePath) {
    throw new Error(
      'Google Chrome or Chromium not found. Install Chrome or configure a different search provider with /search.'
    );
  }

  return new Promise((resolve, reject) => {
    const args = [
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
    ];

    let stdout = '';
    let stderr = '';
    let killed = false;

    const proc = spawn(chromePath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
    });

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
      // Safety limit: 500KB
      if (stdout.length > 500000) {
        killed = true;
        proc.kill('SIGTERM');
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (killed) {
        resolve(stdout.slice(0, 500000));
        return;
      }
      if (code !== 0 && code !== null) {
        reject(new Error(`Chrome exited with code ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      resolve(stdout);
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to launch Chrome: ${err.message}`));
    });
  });
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
async function simpleFetch(url: string, options: { timeout?: number; maxLength?: number; headers?: Record<string, string> } = {}): Promise<string> {
  const timeout = options.timeout ?? 10000;
  const maxLength = options.maxLength ?? 50000;

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const defaultHeaders: Record<string, string> = {
      'User-Agent': 'Autohand-CLI/1.0 (https://autohand.ai)',
      'Accept': 'text/html,application/json,text/plain,*/*',
      'Accept-Language': 'en-US,en;q=0.9'
    };

    const req = protocol.get(url, {
      timeout,
      headers: options.headers ?? defaultHeaders
    }, (res) => {
      // Handle redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        simpleFetch(res.headers.location, options).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        return;
      }

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
        if (data.length > maxLength) {
          res.destroy();
          resolve(data.slice(0, maxLength) + '\n... (truncated)');
        }
      });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
  });
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
 * - Google HTML scraping (no API key, reliable default)
 * - Brave Search API (requires API key)
 * - DuckDuckGo HTML (may be blocked by CAPTCHA)
 * - Parallel.ai Search API (requires API key)
 */
export async function webSearch(query: string, options: WebSearchOptions = {}): Promise<WebSearchResult[]> {
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
  const provider = options.provider ?? globalSearchConfig.provider;

  // Get API keys from config or environment
  const braveApiKey = globalSearchConfig.braveApiKey ?? process.env.BRAVE_SEARCH_API_KEY;
  const parallelApiKey = globalSearchConfig.parallelApiKey ?? process.env.PARALLEL_API_KEY;

  switch (provider) {
    case 'brave':
      if (!braveApiKey) {
        throw new Error(
          'Brave Search requires an API key. Configure it with /search or set BRAVE_SEARCH_API_KEY environment variable. ' +
          'Get a free API key at: https://brave.com/search/api/'
        );
      }
      return braveSearch(enhancedQuery, braveApiKey, maxResults);

    case 'parallel':
      if (!parallelApiKey) {
        throw new Error(
          'Parallel.ai Search requires an API key. Configure it with /search or set PARALLEL_API_KEY environment variable. ' +
          'Get an API key at: https://platform.parallel.ai'
        );
      }
      return parallelSearch(enhancedQuery, parallelApiKey, maxResults);

    case 'google':
      return googleSearch(enhancedQuery, maxResults);

    case 'duckduckgo':
    default:
      return duckduckgoSearch(enhancedQuery, maxResults);
  }
}

/**
 * Search using Google via headless Chrome (no API key required).
 * Uses the system Chrome installation to render JS-heavy search pages.
 * Falls back to HTTP scraping if Chrome is not installed.
 */
async function googleSearch(query: string, maxResults: number): Promise<WebSearchResult[]> {
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${maxResults}&hl=en`;

  // Strategy 1: Headless Chrome (renders JS, most reliable)
  const chromePath = findChromePath();
  if (chromePath) {
    try {
      const html = await chromeHeadlessFetch(searchUrl, 25000);
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
      }
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
async function duckduckgoSearch(query: string, maxResults: number): Promise<WebSearchResult[]> {
  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const html = await simpleFetch(searchUrl, { timeout: 15000, maxLength: 100000 });

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
    throw new Error(`DuckDuckGo search failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Search using Parallel.ai API
 */
async function parallelSearch(query: string, apiKey: string, maxResults: number): Promise<WebSearchResult[]> {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      objective: query,
      search_queries: [query],
      max_results: maxResults,
      excerpts: {
        max_chars_per_result: 500
      }
    });

    const options = {
      hostname: 'api.parallel.ai',
      port: 443,
      path: '/v1beta/search',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'x-api-key': apiKey,
        'parallel-beta': 'search-extract-2025-10-10'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Parallel.ai API error: HTTP ${res.statusCode} - ${data}`));
          return;
        }

        try {
          const json = JSON.parse(data);

          // Parse Parallel.ai response format
          const results: WebSearchResult[] = [];

          if (json.results && Array.isArray(json.results)) {
            for (const result of json.results.slice(0, maxResults)) {
              results.push({
                title: result.title || result.url || 'Untitled',
                url: result.url || '',
                snippet: result.excerpt || result.content?.slice(0, 300) || ''
              });
            }
          } else if (json.search_results && Array.isArray(json.search_results)) {
            // Alternative response format
            for (const result of json.search_results.slice(0, maxResults)) {
              results.push({
                title: result.title || result.url || 'Untitled',
                url: result.url || '',
                snippet: result.snippet || result.description || ''
              });
            }
          }

          resolve(results);
        } catch (parseError) {
          reject(new Error(`Failed to parse Parallel.ai response: ${parseError instanceof Error ? parseError.message : String(parseError)}`));
        }
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Parallel.ai request timed out'));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Search using Brave Search API
 */
async function braveSearch(query: string, apiKey: string, maxResults: number): Promise<WebSearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;

  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey
      }
    }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`Brave Search API error: HTTP ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);

          if (json.web?.results) {
            const results: WebSearchResult[] = json.web.results.slice(0, maxResults).map((r: any) => ({
              title: r.title || '',
              url: r.url || '',
              snippet: r.description || ''
            }));
            resolve(results);
          } else {
            resolve([]);
          }
        } catch (parseError) {
          reject(new Error(`Failed to parse Brave Search response: ${parseError instanceof Error ? parseError.message : String(parseError)}`));
        }
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Brave Search request timed out'));
    });
  });
}

/**
 * Fetch and extract content from a URL
 */
export async function fetchUrl(url: string, options: { selector?: string; maxLength?: number } = {}): Promise<string> {
  const maxLength = options.maxLength ?? 30000;

  try {
    const content = await simpleFetch(url, { timeout: 15000, maxLength: maxLength * 2 });

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
export async function getNpmInfo(packageName: string, version?: string): Promise<PackageInfo> {
  try {
    const url = version
      ? `https://registry.npmjs.org/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`
      : `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`;

    const content = await simpleFetch(url, { timeout: 10000 });
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
    throw new Error(`Failed to get npm info for ${packageName}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get PyPI package information (Python)
 */
export async function getPyPIInfo(packageName: string, version?: string): Promise<PackageInfo> {
  try {
    const url = version
      ? `https://pypi.org/pypi/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}/json`
      : `https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`;

    const content = await simpleFetch(url, { timeout: 10000 });
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
    throw new Error(`Failed to get PyPI info for ${packageName}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get Cargo package information (Rust - crates.io)
 */
export async function getCargoInfo(packageName: string, version?: string): Promise<PackageInfo> {
  try {
    const url = `https://crates.io/api/v1/crates/${encodeURIComponent(packageName)}`;
    const content = await simpleFetch(url, { timeout: 10000 });
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
    throw new Error(`Failed to get Cargo info for ${packageName}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get RubyGems package information (Ruby)
 */
export async function getRubyGemsInfo(packageName: string, version?: string): Promise<PackageInfo> {
  try {
    const url = version
      ? `https://rubygems.org/api/v1/versions/${encodeURIComponent(packageName)}.json`
      : `https://rubygems.org/api/v1/gems/${encodeURIComponent(packageName)}.json`;

    const content = await simpleFetch(url, { timeout: 10000 });
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
    throw new Error(`Failed to get RubyGems info for ${packageName}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get Go module information (pkg.go.dev)
 */
export async function getGoModuleInfo(modulePath: string, _version?: string): Promise<PackageInfo> {
  try {
    // Go proxy API
    const url = `https://proxy.golang.org/${encodeURIComponent(modulePath)}/@latest`;
    const content = await simpleFetch(url, { timeout: 10000 });
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
    throw new Error(`Failed to get Go module info for ${modulePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Universal package info getter - auto-detects registry or uses specified one
 */
export async function getPackageInfo(
  packageName: string,
  options: { registry?: PackageRegistry; version?: string } = {}
): Promise<PackageInfo> {
  const registry = options.registry || detectRegistry(packageName);

  switch (registry) {
    case 'npm':
      return getNpmInfo(packageName, options.version);
    case 'pypi':
      return getPyPIInfo(packageName, options.version);
    case 'crates':
      return getCargoInfo(packageName, options.version);
    case 'rubygems':
      return getRubyGemsInfo(packageName, options.version);
    case 'go':
      return getGoModuleInfo(packageName, options.version);
    default:
      // Default to npm
      return getNpmInfo(packageName, options.version);
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
