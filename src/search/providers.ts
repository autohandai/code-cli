import type { SearchProvider } from '../types.js';

export const SEARCH_PROVIDERS = ['autohand', 'browser-profile', 'exa', 'google', 'brave', 'duckduckgo', 'parallel'] as const satisfies readonly SearchProvider[];
export const SEARCH_PROVIDER_OPTIONS = [
  { value: 'autohand', label: 'Autohand Web Search', description: 'Included with Lite and above; uses your signed-in account' },
  { value: 'browser-profile', label: 'Browser Profile', description: 'Uses connected Chromium or your Chrome/Brave profile; no API key' },
  { value: 'exa', label: 'Exa.ai', description: 'Requires your Exa API key' },
  { value: 'brave', label: 'Brave Search', description: 'Requires your Brave API key' },
  { value: 'parallel', label: 'Parallel.ai', description: 'Requires your Parallel API key' },
  { value: 'google', label: 'Google', description: 'No API key; automated requests may be blocked by CAPTCHA' },
  { value: 'duckduckgo', label: 'DuckDuckGo', description: 'No API key; automated requests may be blocked by CAPTCHA' },
] as const satisfies ReadonlyArray<{ value: SearchProvider; label: string; description: string }>;
