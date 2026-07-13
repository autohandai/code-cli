# Web Search Agent Tool

Autohand includes a powerful web search tool that allows the AI agent to search the internet for up-to-date information about packages, documentation, changelogs, and more.

## Supported Providers

| Provider | API Key Required | Free Tier | Best For |
|----------|-----------------|-----------|----------|
| **Browser Profile** | No | Unlimited | Default; searches through connected Chromium with the current profile |
| **Google** | No | Unlimited | Local Chrome/HTTP fallback when browser-profile is unavailable |
| **Exa.ai** | Yes | Provider plan | Neural search and research |
| **DuckDuckGo** | No | Unlimited | Quick searches (may be rate-limited) |
| **Brave Search** | Yes | 2,000 queries/month | Reliable, fast searches |
| **Parallel.ai** | Yes | Contact for pricing | Deep research, cross-referenced facts |

## Configuration

### Method 1: CLI Flag

Set the search provider when starting Autohand:

```bash
# Use the current connected Chromium profile (default)
autohand --search-engine browser-profile

# Use Brave Search
autohand --search-engine brave

# Use Parallel.ai
autohand --search-engine parallel

# Use DuckDuckGo
autohand --search-engine duckduckgo
```

### Method 2: Environment Variables

Set API keys via environment variables:

```bash
# Brave Search API key
export BRAVE_SEARCH_API_KEY=your-brave-api-key

# Parallel.ai API key
export PARALLEL_API_KEY=your-parallel-api-key
```

Add to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.) for persistence.

### Method 3: Interactive Configuration

Use the `/search` command during a session:

```
/search
```

This opens an interactive menu to:
1. Select your preferred search provider
2. Enter API keys (securely stored in config)
3. View current configuration status

### Method 4: Config File

Edit `~/.autohand/config.json` directly:

```json
{
  "search": {
    "provider": "brave",
    "braveApiKey": "BSA-xxxxxxxxxxxxxxxxxxxxxxxx",
    "parallelApiKey": "par-xxxxxxxxxxxxxxxxxxxxxxxx"
  }
}
```

## Provider Details

### Browser Profile

Browser Profile is the default and requires no search API key. When Chromium is connected, Autohand navigates that browser session and extracts results using the current profile. If no bridge is connected, it falls back to a local Chrome/Chromium installation. Choose another provider at any time with `/search`, `--search-engine`, or the config file.

### DuckDuckGo

**Pros:**
- No API key required
- No cost
- Privacy-focused

**Cons:**
- May return CAPTCHA challenges for automated requests
- Rate limiting can occur
- Less reliable for heavy usage

**When to use:** Quick, occasional searches where reliability isn't critical.

### Brave Search

**Pros:**
- Reliable and fast
- Good result quality
- Generous free tier (2,000 queries/month)
- No CAPTCHA issues

**Cons:**
- Requires API key registration

**Getting an API Key:**
1. Visit [https://brave.com/search/api/](https://brave.com/search/api/)
2. Sign up for a free account
3. Generate an API key from the dashboard
4. Configure in Autohand using any method above

**When to use:** Primary search provider for most use cases.

### Parallel.ai

**Pros:**
- Deep research capabilities
- Cross-referenced facts with minimal hallucination
- Purpose-built for AI agents
- SOC-II Type 2 certified

**Cons:**
- Requires API key
- May have usage costs

**Getting an API Key:**
1. Visit [https://platform.parallel.ai](https://platform.parallel.ai)
2. Create an account
3. Generate an API key
4. Configure in Autohand using any method above

**When to use:** Complex research tasks requiring high accuracy and depth.

## Search Types

The `web_search` tool supports different search types to optimize results:

| Type | Description | Use Case |
|------|-------------|----------|
| `general` | Standard web search | Default for most queries |
| `packages` | Package/library search | Finding npm, PyPI, crates packages |
| `docs` | Documentation search | Finding guides, API docs, tutorials |
| `changelog` | Release notes search | Finding version changes, updates |

Example tool usage by the agent:
```json
{
  "tool": "web_search",
  "query": "react 19 new features",
  "search_type": "changelog",
  "max_results": 5
}
```

## Troubleshooting

### "DuckDuckGo blocked this search with a CAPTCHA challenge"

DuckDuckGo has detected automated access. Solutions:
1. Switch to Brave Search: `autohand --search-engine brave`
2. Configure via `/search` command
3. Wait and retry later (temporary rate limiting)

### "Brave Search requires an API key"

You need to configure a Brave API key:
1. Get a free key at [https://brave.com/search/api/](https://brave.com/search/api/)
2. Set it: `export BRAVE_SEARCH_API_KEY=your-key`
3. Or use `/search` to configure interactively

### "Parallel.ai Search requires an API key"

You need to configure a Parallel.ai API key:
1. Get a key at [https://platform.parallel.ai](https://platform.parallel.ai)
2. Set it: `export PARALLEL_API_KEY=your-key`
3. Or use `/search` to configure interactively

### "No search results found"

Possible causes:
- Query too specific or unusual
- Provider rate limiting
- Network issues

Solutions:
- Try a different search provider
- Simplify the search query
- Check network connectivity

### Direct URL fetch fails

`fetch_url` resolves relative redirects and, when Chromium is connected, retries failed direct requests through that browser session. This is useful for JavaScript-heavy documentation sites and pages that require the current browser context.

## Priority Order

When determining which search provider to use, Autohand follows this priority:

1. **CLI flag** (`--search-engine`) - highest priority
2. **Config file** (`~/.autohand/config.json`)
3. **Environment variables** (for API keys only)
4. **Default** (`browser-profile`, no API key required)

## Security Notes

- API keys stored in `~/.autohand/config.json` are not encrypted
- Use environment variables for shared/CI environments
- Never commit API keys to version control
- Parallel.ai is SOC-II Type 2 certified for enterprise security requirements

## Related Commands

| Command | Description |
|---------|-------------|
| `/search` | Configure search provider interactively |
| `/status` | View current configuration including search provider |
| `/help` | List all available commands |

## API Reference

### configureSearch(config)

Programmatically configure the search provider:

```typescript
import { configureSearch } from './actions/web.js';

configureSearch({
  provider: 'brave',
  braveApiKey: 'your-api-key',
});
```

### getSearchConfig()

Get the current search configuration:

```typescript
import { getSearchConfig } from './actions/web.js';

const config = getSearchConfig();
// { provider: 'brave', braveApiKey: '...' }
```

### webSearch(query, options)

Perform a web search:

```typescript
import { webSearch } from './actions/web.js';

const results = await webSearch('typescript async await', {
  maxResults: 5,
  searchType: 'docs',
  provider: 'brave', // optional override
});

// Returns: WebSearchResult[]
// [{ title: '...', url: '...', snippet: '...' }, ...]
```
