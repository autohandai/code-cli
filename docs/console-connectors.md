# Connectors from Autohand Console

Create a connector at [Console → Connectors](https://console.autohand.ai/connectors).
Sign in to Code with `/login` and enable settings sync. Code downloads connector
configuration at startup and on its background sync interval (five minutes by
default). To download immediately, run `/sync` and press **s**.

Downloaded connectors become available to the running agent without restarting.
Pausing a connector stops automatic connection; deleting it removes its managed
configuration on the next sync. Independently configured local servers remain.

## Select the same account

By default, Code uses the personal account associated with the signed-in user,
or the account attached to an account-scoped credential. For another account,
expand **Sync this account to Code** in Console and copy its account ID into
the existing `api` section of `~/.autohand/config.json`:

```json
{
  "api": { "accountId": "your-account-id" },
  "sync": { "enabled": true }
}
```

Merge these fields into your configuration, preserving the other settings. You
can also set `AUTOHAND_ACCOUNT_ID` when starting Code. The API checks account
membership and permissions; an account-scoped credential cannot select another
account.

## Available integrations

- **Parallel Search, Exa Search:** default public MCP endpoints; no API key
  required, subject to the provider's usage limits.
- **Linear, GitHub, Hugging Face, Coda, New Relic, Supabase:** enter the
  provider-specific token in Console. Its setup dialog links to the provider's
  credential instructions. New Relic defaults to its US endpoint; edit it for
  another region. Supabase supports `project_ref` and `read_only` URL parameters.
- **Notion, Granola, Sentry, Vercel, Prisma Postgres, Cloudflare:** after download,
  Code starts `npx -y mcp-remote@0.8.3` and opens the provider's authorization
  page. Approve access on each computer separately. Node.js and npx are required.
  Authorization and refresh tokens stay in the bridge's local `~/.mcp-auth`
  directory; they are not shared through Console. The authorization window is
  three minutes. Reconnect using `/mcp` if it expires before you finish.
- **Netlify:** Console stores your personal access token; Code runs the official
  `@netlify/mcp@1.15.1` package with `NETLIFY_PERSONAL_ACCESS_TOKEN`. Requires
  Node.js 22 or newer and npx.
- **PostgreSQL:** enter a connection URI. Code runs the community
  [Postgres MCP Pro](https://github.com/crystaldba/postgres-mcp) adapter with
  `uvx postgres-mcp --access-mode=restricted`, passing the URI through
  `DATABASE_URI`. Install uv and ensure that computer can reach your database.
- Existing **Atlassian**, **Figma desktop**, and custom HTTP/stdio configurations
  remain available.

## Credentials and synchronization

The API encrypts connector headers and environment values at rest. Browser
responses expose only whether credentials exist. An authenticated Code client
downloads the values into its local configuration to start the MCP connection.
Managed connector names are normalized to valid tool identifiers.

MCP settings use the dedicated connector API, so a stale generic settings
download cannot overwrite them or restore a deleted connector. Background sync
does not publish unrelated local MCP servers. Explicit user-level `autohand mcp`
configuration commands can publish local connector definitions.

Saving a configuration and successfully authorizing with a provider are separate
steps. Console's applied-client count confirms configuration delivery. Use
`/mcp list` in Code to inspect connection status and available tools.
