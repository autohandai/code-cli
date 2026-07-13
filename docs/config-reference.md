# Autohand Configuration Reference

Complete reference for all configuration options in `~/.autohand/config.json` (or `.toml`/`.yaml`/`.yml`).

> **Tip:** Most settings below can be changed interactively using the `/settings` command instead of editing the file manually.

Localized references:

- [English](./config-reference.md)
- [日本語](./config-reference_ja.md)
- [简体中文](./config-reference_zh.md)
- [繁體中文](./config-reference_zh-tw.md)
- [한국어](./config-reference_ko.md)
- [Deutsch](./config-reference_de.md)
- [Español](./config-reference_es.md)
- [Français](./config-reference_fr.md)
- [Italiano](./config-reference_it.md)
- [Polski](./config-reference_pl.md)
- [Русский](./config-reference_ru.md)
- [Português (Brasil)](./config-reference_ptBR.md)
- [Türkçe](./config-reference_tr.md)
- [Čeština](./config-reference_cs.md)
- [Magyar](./config-reference_hu.md)
- [हिन्दी](./config-reference_hi.md)
- [Bahasa Indonesia](./config-reference_id.md)

## Table of Contents

- [Configuration File Location](#configuration-file-location)
- [Environment Variables](#environment-variables)
- [Bare Mode](#bare-mode)
- [Provider Settings](#provider-settings)
- [Workspace Settings](#workspace-settings)
- [UI Settings](#ui-settings)
- [Agent Settings](#agent-settings)
- [Permissions Settings](#permissions-settings)
- [Patch Mode](#patch-mode)
- [Network Settings](#network-settings)
- [Telemetry Settings](#telemetry-settings)
- [External Agents](#external-agents)
- [Skills System](#skills-system)
- [API Settings](#api-settings)
- [Authentication Settings](#authentication-settings)
- [Community Skills Settings](#community-skills-settings)
- [Share Settings](#share-settings)
- [Settings Sync](#settings-sync)
- [Hooks Settings](#hooks-settings)
- [MCP Settings](#mcp-settings)
- [Chrome Extension Settings](#chrome-extension-settings)
- [Complete Example](#complete-example)

---

## Configuration File Location

Autohand looks for configuration in this order:

1. `AUTOHAND_CONFIG` environment variable (custom path)
2. `~/.autohand/config.toml`
3. `~/.autohand/config.yaml`
4. `~/.autohand/config.yml`
5. `~/.autohand/config.json` (default)

You can also override the base directory:

```bash
export AUTOHAND_HOME=/custom/path  # Changes ~/.autohand to /custom/path
```

---

## Environment Variables

| Variable                               | Description                                      | Example                          |
| -------------------------------------- | ------------------------------------------------ | -------------------------------- |
| `AUTOHAND_HOME`                        | Base directory for all Autohand data             | `/custom/path`                   |
| `AUTOHAND_CONFIG`                      | Custom config file path                          | `/path/to/config.toml`           |
| `AUTOHAND_MODELS_CATALOG`              | Custom provider model catalog path               | `/path/to/models.json`           |
| `AUTOHAND_API_URL`                     | API endpoint (overrides config)                  | `https://api.autohand.ai`        |
| `AUTOHAND_SECRET`                      | Company/team secret key                          | `sk-xxx`                         |
| `AUTOHAND_PERMISSION_CALLBACK_URL`     | URL for permission callback (experimental)       | `http://localhost:3000/callback` |
| `AUTOHAND_PERMISSION_CALLBACK_TIMEOUT` | Timeout for permission callback in ms            | `5000`                           |
| `AUTOHAND_NON_INTERACTIVE`             | Run in non-interactive mode                      | `1`                              |
| `AUTOHAND_YES`                         | Auto-confirm all prompts                         | `1`                              |
| `AUTOHAND_NO_BANNER`                   | Disable startup banner                           | `1`                              |
| `AUTOHAND_STREAM_TOOL_OUTPUT`          | Stream tool output in real-time                  | `1`                              |
| `AUTOHAND_DEBUG`                       | Enable debug logging                             | `1`                              |
| `AUTOHAND_THINKING_LEVEL`              | Set reasoning depth level                        | `normal`                         |
| `AUTOHAND_CLIENT_NAME`                 | Client/editor identifier (set by ACP extensions) | `zed`                            |
| `AUTOHAND_CLIENT_VERSION`              | Client version (set by ACP extensions)           | `0.169.0`                        |
| `AUTOHAND_CODE`                        | Environment detection flag (set automatically)   | `1`                              |
| `AUTOHAND_CODE_SIMPLE`                 | Enable bare mode without passing `--bare`        | `1`                              |

### Thinking Level

The `AUTOHAND_THINKING_LEVEL` environment variable controls the depth of reasoning the model uses:

| Value      | Description                                                           |
| ---------- | --------------------------------------------------------------------- |
| `none`     | Direct responses without visible reasoning                            |
| `normal`   | Standard reasoning depth (default)                                    |
| `extended` | Deep reasoning for complex tasks, shows more detailed thought process |

This is typically set by ACP client extensions (like Zed) through the config dropdown.

```bash
# Example: Use extended thinking for complex tasks
AUTOHAND_THINKING_LEVEL=extended autohand --prompt "refactor this module"
```

---

## Bare Mode

Bare mode starts Autohand with only explicitly requested context and runtime integrations. Enable it with either:

```bash
autohand --bare
AUTOHAND_CODE_SIMPLE=1 autohand
```

When `--bare` is passed, Autohand also sets `AUTOHAND_CODE_SIMPLE=1` for the running process.

Bare mode disables automatic startup and interactive integrations:

- hooks and hook notifications
- LSP startup
- plugin sync, plugin auto-loading, and meta-tool auto-loading
- attribution, telemetry, session sync, auto-reporting, and background pings
- automatic memory/session bootstrap context
- background prompt suggestions, update checks, feature flag fetches, and model metadata prefetches
- keychain and browser OAuth authentication fallback
- automatic `AGENTS.md` and provider-instruction discovery
- all slash commands, including a bare `/` typed in the prompt

Slash-shaped absolute file paths, such as `/Users/alex/project/file.ts`, are still treated as normal prompt text. Command-shaped slash input, such as `/help`, `/model`, or `/mcp`, prints `Slash commands are disabled in bare mode.` and is not executed.

Authentication in bare mode is explicit only. Autohand reads `AUTOHAND_API_KEY` first, then `auth.apiKeyHelper` if configured. It does not read keychain credentials or start OAuth/browser login. Third-party providers continue to use their provider-specific API keys and configuration.

These explicit inputs remain available in bare mode:

| Input                         | Description                                                               |
| ----------------------------- | ------------------------------------------------------------------------- |
| `--system-prompt <value>`     | Replace the system prompt with inline text or a path-like value           |
| `--system-prompt-file <path>` | Replace the system prompt with file contents                              |
| `--append-system-prompt <value>` | Append inline text or a path-like value to the system prompt           |
| `--append-system-prompt-file <path>` | Append file contents to the system prompt                         |
| `--add-dir <path...>`         | Add explicit directories to workspace scope                               |
| `--mcp-config <path>`         | Load an explicit MCP config file                                          |
| `--settings`                  | Open settings directly from the CLI flag                                  |
| `--config <path>`             | Use an explicit Autohand config file                                      |
| `--agents <json\|path>`       | Load explicit inline agents JSON or an explicit agents directory          |
| `--plugin-dir <path>`         | Load an explicit plugin/meta-tool directory                               |

---

## Provider Settings

### `provider`

Active LLM provider to use.

| Value          | Description                  |
| -------------- | ---------------------------- |
| `"openrouter"` | OpenRouter API (default)     |
| `"ollama"`     | Local Ollama instance        |
| `"llamacpp"`   | Local llama.cpp server       |
| `"openai"`     | OpenAI API directly          |
| `"mlx"`        | MLX on Apple Silicon (local) |
| `"llmgateway"` | LLM Gateway unified API      |
| `"deepseek"`   | DeepSeek API                 |
| `"zai"`        | Z.ai GLM API                 |
| `"sakana"`     | Sakana.AI Fugu API           |
| `"bedrock"`    | AWS Bedrock                  |
| `"custom:<id>"` | User-defined OpenAI-compatible provider from `customProviders` |

### Provider model catalog

Autohand stores bundled provider model lists in `src/providers/models.json` and copies that file to `dist/providers/models.json` in packaged builds. Provider pickers, ACP/RPC model discovery, and static provider fallbacks read from this catalog instead of hardcoded TypeScript arrays.

To add or update bundled model choices, edit the relevant provider entry in `models.json`:

```json
{
  "providers": {
    "nvidia": {
      "defaultModel": "z-ai/glm-5.1",
      "models": [
        "z-ai/glm-5.1",
        { "id": "nvidia/new-model", "displayName": "New Model" }
      ]
    }
  }
}
```

For a local override without changing the installed package, create `~/.autohand/models.json` or set `AUTOHAND_MODELS_CATALOG=/path/to/models.json`. Override entries are merged ahead of bundled entries and deduplicated by model id. OpenRouter and other providers with live model APIs still try live discovery first, then merge or fall back to catalog entries.

### `openrouter`

OpenRouter provider configuration.

```json
{
  "openrouter": {
    "apiKey": "sk-or-v1-xxx",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "your-modelcard-id-here",
    "contextWindow": 262144
  }
}
```

| Field           | Type   | Required | Default                        | Description                                                                 |
| --------------- | ------ | -------- | ------------------------------ | --------------------------------------------------------------------------- |
| `apiKey`        | string | Yes      | -                              | Your OpenRouter API key                                                     |
| `baseUrl`       | string | No       | `https://openrouter.ai/api/v1` | API endpoint                                                                |
| `model`         | string | Yes      | -                              | Model identifier (e.g., `your-modelcard-id-here`)                           |
| `contextWindow` | number | No       | Auto                           | Exact model context window. Autohand fills this from OpenRouter when known. |

### `zai`

Z.ai provider configuration.

```json
{
  "zai": {
    "apiKey": "your-zai-api-key",
    "baseUrl": "https://api.z.ai/api/paas/v4",
    "model": "glm-5.2",
    "contextWindow": 1000000
  }
}
```

| Field           | Type   | Required | Default                        | Description                                                                      |
| --------------- | ------ | -------- | ------------------------------ | -------------------------------------------------------------------------------- |
| `apiKey`        | string | Yes      | -                              | Your Z.ai API key                                                                |
| `baseUrl`       | string | No       | `https://api.z.ai/api/paas/v4` | API endpoint                                                                     |
| `model`         | string | Yes      | `glm-5.2`                     | Model identifier, for example `glm-5.2`, `glm-5.1`, or `glm-4.5`                 |
| `contextWindow` | number | No       | Auto                           | Exact model context window. Autohand infers 1M for GLM-5.2 and 200K for GLM-5.1. |

### `sakana`

Sakana.AI provider configuration. The API is OpenAI-compatible and uses `https://api.sakana.ai/v1` as its base URL.

```json
{
  "sakana": {
    "apiKey": "your-sakana-api-key",
    "baseUrl": "https://api.sakana.ai/v1",
    "model": "fugu",
    "contextWindow": 1000000
  }
}
```

| Field           | Type   | Required | Default                       | Description                                                       |
| --------------- | ------ | -------- | ----------------------------- | ----------------------------------------------------------------- |
| `apiKey`        | string | Yes      | -                             | Your Sakana API key                                               |
| `baseUrl`       | string | No       | `https://api.sakana.ai/v1`    | API endpoint                                                      |
| `model`         | string | Yes      | `fugu`                        | Model identifier, for example `fugu` or `fugu-ultra`              |
| `contextWindow` | number | No       | Auto                          | Exact model context window. Autohand infers 1M for Fugu models.   |

### `customProviders`

Custom providers let users bring an OpenAI-compatible endpoint without a code change or a new bundled provider. Add the provider under `customProviders`, then select it with `provider: "custom:<id>"`. The same flow is available from `/model` with **New provider...**. During setup, Autohand verifies the base URL, authentication, and selected model through the OpenAI-compatible `/models` endpoint before saving the provider.

```json
{
  "provider": "custom:acme",
  "customProviders": {
    "acme": {
      "id": "acme",
      "displayName": "Acme AI",
      "apiFormat": "openai-compatible",
      "baseUrl": "https://api.acme.example/v1",
      "apiKey": "acme-api-key",
      "apiKeyRequired": true,
      "model": "acme-code-1",
      "contextWindow": 256000,
      "reasoningEffort": "high",
      "models": [
        {
          "id": "acme-code-1",
          "label": "Acme Code 1",
          "contextWindow": 256000,
          "reasoningEffort": "high"
        }
      ]
    }
  }
}
```

For local OpenAI-compatible servers that do not require auth, set `apiKeyRequired` to `false` and omit `apiKey`.

| Field             | Type    | Required | Default | Description |
| ----------------- | ------- | -------- | ------- | ----------- |
| `id`              | string  | Yes      | -       | Stable provider id. It must match the object key and is selected as `custom:<id>`. |
| `displayName`     | string  | Yes      | -       | Name shown in `/model` and provider settings. |
| `apiFormat`       | string  | Yes      | -       | Must be `openai-compatible`. |
| `baseUrl`         | string  | Yes      | -       | Endpoint root such as `https://api.example.com/v1`. Autohand verifies `/models` and calls `/chat/completions`. |
| `apiKey`          | string  | Conditional | -    | Bearer token for hosted endpoints. Required when `apiKeyRequired` is true. |
| `apiKeyRequired`  | boolean | No       | `true`  | Set false for local or already-authenticated gateways. |
| `model`           | string  | Yes      | -       | Active model id. |
| `contextWindow`   | number  | No       | Auto    | Exact context window for token budgeting, status, telemetry, and sync metadata. |
| `reasoningEffort` | string  | No       | -       | Optional `none`, `low`, `medium`, `high`, or `xhigh`. Sent as `reasoning_effort` for custom OpenAI-compatible requests. |
| `models`          | array   | No       | -       | Optional model picker entries with per-model context and reasoning metadata. |

### `ollama`

Ollama provider configuration.

```json
{
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "port": 11434,
    "model": "llama3.2"
  }
}
```

| Field     | Type   | Required | Default                  | Description                                |
| --------- | ------ | -------- | ------------------------ | ------------------------------------------ |
| `baseUrl` | string | No       | `http://localhost:11434` | Ollama server URL                          |
| `port`    | number | No       | `11434`                  | Server port (alternative to baseUrl)       |
| `model`   | string | Yes      | -                        | Model name (e.g., `llama3.2`, `codellama`) |

### `llamacpp`

llama.cpp server configuration.

```json
{
  "llamacpp": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "default"
  }
}
```

| Field     | Type   | Required | Default                 | Description          |
| --------- | ------ | -------- | ----------------------- | -------------------- |
| `baseUrl` | string | No       | `http://localhost:8080` | llama.cpp server URL |
| `port`    | number | No       | `8080`                  | Server port          |
| `model`   | string | Yes      | -                       | Model identifier     |

### `openai`

OpenAI API configuration.

```json
{
  "openai": {
    "authMode": "api-key",
    "apiKey": "sk-xxx",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-5.4"
  }
}
```

OpenAI can also use your ChatGPT subscription via Autohand's built-in OpenAI sign-in flow:

```json
{
  "openai": {
    "authMode": "chatgpt",
    "baseUrl": "https://api.openai.com/v1",
    "contextWindow": 1050000,
    "model": "gpt-5.4",
    "chatgptAuth": {
      "accessToken": "...",
      "refreshToken": "...",
      "accountId": "..."
    }
  }
}
```

| Field           | Type   | Required               | Default                     | Description                                                               |
| --------------- | ------ | ---------------------- | --------------------------- | ------------------------------------------------------------------------- |
| `authMode`      | string | No                     | `api-key`                   | Authentication mode: `api-key` or `chatgpt`                               |
| `apiKey`        | string | Yes for `api-key` mode | -                           | OpenAI API key                                                            |
| `baseUrl`       | string | No                     | `https://api.openai.com/v1` | API endpoint                                                              |
| `model`         | string | Yes                    | -                           | Model name (e.g., `gpt-5.4`, `gpt-5.4-mini`)                              |
| `contextWindow` | number | No                     | Auto                        | Exact model context window. Set this to override stale local assumptions. |
| `chatgptAuth`   | object | Yes for `chatgpt` mode | -                           | Stored ChatGPT/Codex auth tokens and account id                           |

### `mlx`

MLX provider for Apple Silicon Macs (local inference).

```json
{
  "mlx": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "mlx-community/Llama-3.2-3B-Instruct-4bit"
  }
}
```

| Field     | Type   | Required | Default                 | Description          |
| --------- | ------ | -------- | ----------------------- | -------------------- |
| `baseUrl` | string | No       | `http://localhost:8080` | MLX server URL       |
| `port`    | number | No       | `8080`                  | Server port          |
| `model`   | string | Yes      | -                       | MLX model identifier |

### `llmgateway`

LLM Gateway unified API configuration. Provides access to multiple LLM providers through a single API.

```json
{
  "llmgateway": {
    "apiKey": "your-llmgateway-api-key",
    "baseUrl": "https://api.llmgateway.io/v1",
    "model": "gpt-4o"
  }
}
```

| Field     | Type   | Required | Default                        | Description                                               |
| --------- | ------ | -------- | ------------------------------ | --------------------------------------------------------- |
| `apiKey`  | string | Yes      | -                              | LLM Gateway API key                                       |
| `baseUrl` | string | No       | `https://api.llmgateway.io/v1` | API endpoint                                              |
| `model`   | string | Yes      | -                              | Model name (e.g., `gpt-4o`, `claude-3-5-sonnet-20241022`) |

**Getting an API Key:**
Visit [llmgateway.io/dashboard](https://llmgateway.io/dashboard) to create an account and get your API key.

**Supported Models:**
LLM Gateway supports models from multiple providers including:

- OpenAI: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`
`claude-3-5-haiku-20241022`
- Google: `gemini-1.5-pro`, `gemini-1.5-flash`

### `deepseek`

DeepSeek provider configuration. The API is OpenAI-compatible and uses `https://api.deepseek.com` as its base URL.

```json
{
  "deepseek": {
    "apiKey": "your-deepseek-api-key",
    "baseUrl": "https://api.deepseek.com",
    "model": "deepseek-v4-flash"
  }
}
```

| Field     | Type   | Required | Default                    | Description                                                    |
| --------- | ------ | -------- | -------------------------- | -------------------------------------------------------------- |
| `apiKey`  | string | Yes      | -                          | DeepSeek API key                                               |
| `baseUrl` | string | No       | `https://api.deepseek.com` | API endpoint                                                   |
| `model`   | string | Yes      | -                          | Model name, for example `deepseek-v4-flash` or `deepseek-v4-pro` |

### `bedrock`

AWS Bedrock provider configuration. `converse` is the default mode and uses the AWS SDK credential chain. OpenAI-compatible modes use Bedrock API keys and Bedrock OpenAI-compatible endpoints.

```json
{
  "bedrock": {
    "apiMode": "converse",
    "authMode": "aws-credentials",
    "profile": "enterprise-prod",
    "region": "us-east-1",
    "model": "anthropic.claude-3-5-sonnet-20241022-v2:0"
  }
}
```

```yaml
provider: bedrock
bedrock:
  apiMode: openai-chat
  authMode: bedrock-api-key
  apiKey: bedrock-api-key
  region: us-east-1
  model: openai.gpt-oss-120b-1:0
```

```toml
provider = "bedrock"

[bedrock]
apiMode = "openai-responses"
authMode = "bedrock-api-key"
apiKey = "bedrock-api-key"
region = "us-west-2"
endpoint = "https://vpce-abc123.bedrock-runtime.us-west-2.vpce.amazonaws.com/openai/v1"
model = "arn:aws:bedrock:us-west-2:123456789012:inference-profile/us.anthropic.claude-3-5-sonnet-20241022-v2:0"
```

| Field      | Type   | Required | Default | Description |
| ---------- | ------ | -------- | ------- | ----------- |
| `model`    | string | Yes      | -       | Bedrock model ID, inference profile ID, or ARN |
| `region`   | string | Yes      | `AWS_REGION`, then `AWS_DEFAULT_REGION`, then `us-east-1` in setup | AWS region |
| `apiMode`  | string | No       | `converse` | `converse`, `openai-chat`, or `openai-responses` |
| `authMode` | string | No       | `aws-credentials` for `converse`, `bedrock-api-key` for OpenAI-compatible modes | Authentication mode |
| `profile`  | string | No       | -       | Optional AWS profile for credential-chain auth |
| `endpoint` | string | No       | Derived from mode and region | Custom/private Bedrock endpoint |
| `apiKey`   | string | Yes for OpenAI-compatible modes | - | Bedrock API key. Do not use OpenAI API keys. |

Run `aws configure sso` or set `AWS_PROFILE=enterprise-prod autohand` for profile-based AWS auth. IAM role, container, and instance metadata credentials are supported by the AWS SDK. Enable model access in the AWS console before using a model.

---

## Workspace Settings

```json
{
  "workspace": {
    "defaultRoot": "/path/to/projects",
    "allowDangerousOps": false
  }
}
```

| Field               | Type    | Default           | Description                                       |
| ------------------- | ------- | ----------------- | ------------------------------------------------- |
| `defaultRoot`       | string  | Current directory | Default workspace when none specified             |
| `allowDangerousOps` | boolean | `false`           | Allow destructive operations without confirmation |

### Workspace Safety

Autohand automatically blocks operation in dangerous directories to prevent accidental damage:

- **Filesystem roots** (`/`, `C:\`, `D:\`, etc.)
- **Home directories** (`~`, `/Users/<user>`, `/home/<user>`, `C:\Users\<user>`)
- **System directories** (`/etc`, `/var`, `/System`, `C:\Windows`, etc.)
- **WSL Windows mounts** (`/mnt/c`, `/mnt/c/Users/<user>`)

This check cannot be bypassed. If you try to run autohand in a dangerous directory, you'll see an error and must specify a safe project directory.

```bash
# This will be blocked
cd ~ && autohand
# Error: Unsafe Workspace Directory

# This works
cd ~/projects/my-app && autohand
```

See [Workspace Safety](./workspace-safety.md) for full details.

---

## UI Settings

```json
{
  "ui": {
    "theme": "dark",
    "customThemes": {
      "company": {
        "colors": {
          "accent": "#7c3aed",
          "success": "#22c55e"
        }
      }
    },
    "autoConfirm": false,
    "readFileCharLimit": 300,
    "silentToolOutput": false,
    "activityVerbs": ["Compiling", "Parsing", "Reviewing"],
    "activityVerbsEnabled": true,
    "activitySymbol": "✳",
    "statusLine": {
      "showProviderModel": true,
      "showContext": true,
      "showCommandHint": true,
      "showPullRequest": true,
      "showSessionLines": false,
      "showQueue": true,
      "showActiveStatus": true,
      "showActiveMetrics": true,
      "showCancelHint": true
    },
    "showCompletionNotification": true,
    "showThinking": true,
    "terminalBell": true,
    "checkForUpdates": true,
    "updateCheckInterval": 24
  }
}
```

| Field                        | Type   | Default | Description                                                                                    |
| ---------------------------- | ------ | ------- | ---------------------------------------------------------------------------------------------- |
| `theme`                      | string | `"dark"` | Color theme for terminal output. Built-ins include `dark`, `light`, `dracula`, `sandy`, `tui`, `github-dark`, `cappadocia`, `rio`, and `australia`. Legacy `turkey` and `brazil` values still load as aliases. |
| `customThemes`               | object | `{}`    | Inline custom theme definitions keyed by theme name. Set `theme` to the same key to use one.   |
| `autoConfirm`                | boolean | `false` | Skip confirmation prompts for safe operations                                                  |
| `readFileCharLimit`          | number | `300`   | Max characters to display from read/find tool output (full content is still sent to the model) |
| `silentToolOutput`           | boolean | `false` | Hide tool output blocks in the terminal while still preserving tool results for the model/session |
| `activityVerbs`              | string or string[] | built-in pool | Custom activity verb or verb pool for the working indicator, rendered as `Verb...` |
| `activityVerbsEnabled`       | boolean | `true`  | Show rotating activity verbs like `Compiling...` while the agent is working |
| `activitySymbol`             | string | `"✳"`   | Symbol shown before the activity verb in activity indicator output |
| `statusLine.showProviderModel` | boolean | `true`  | Show the active provider and model in the composer status line |
| `statusLine.showContext`       | boolean | `true`  | Show the context percentage in the composer status line |
| `statusLine.showCommandHint`   | boolean | `true`  | Show command, mention, skill, and terminal-entry hints in the composer status line |
| `statusLine.showPullRequest`   | boolean | `true`  | Show the associated pull request number, or `PR #123` when no PR is associated |
| `statusLine.showSessionLines`  | boolean | `false` | Show lines added and removed during the current session |
| `statusLine.showQueue`         | boolean | `true`  | Show queued request counts in the status line |
| `statusLine.showActiveStatus`  | boolean | `true`  | Show active turn status text while the agent is working |
| `statusLine.showActiveMetrics` | boolean | `true`  | Show elapsed time and token metrics while the agent is working |
| `statusLine.showCancelHint`    | boolean | `true`  | Show the Esc cancel hint while the agent is working |
| `completionReportEnabled`    | boolean | `true`  | Ask the model to include a concise completion report after completed action turns |
| `showCompletionNotification` | boolean | `true`  | Show system notification when task completes                                                   |
| `showThinking`               | boolean | `true`  | Display LLM's reasoning/thought process                                                        |
| `terminalBell`               | boolean | `true`  | Ring terminal bell when task completes (shows badge on terminal tab/dock)                      |
| `checkForUpdates`            | boolean | `true`  | Check for CLI updates on startup                                                               |
| `updateCheckInterval`        | number | `24`    | Hours between update checks (uses cached result within interval)                               |

Custom themes can override any semantic color token. Missing tokens are inherited from the dark theme:

```json
{
  "ui": {
    "theme": "company",
    "customThemes": {
      "company": {
        "vars": {
          "brand": "#7c3aed",
          "brandSoft": "#a78bfa"
        },
        "colors": {
          "accent": "brand",
          "borderAccent": "brandSoft",
          "mdHeading": "brand"
        }
      }
    }
  }
}
```

Note: `readFileCharLimit` and `silentToolOutput` only affect terminal display. Full content is still sent to the model and stored in tool messages. When tool output is visible in the interactive Ink UI, non-ignored file changes inside the active workspace are captured around every LLM tool batch and rendered as Added, Edited, or Deleted diffs, including changes made by shell, meta, and MCP tools.

You can toggle silent tool output without editing the file:

```bash
autohand config set silent_tool_output true
autohand config set silent_tool_output false
```

You can toggle rotating activity verbs without editing the file:

```bash
autohand config set verbs activity true
autohand config set verbs activity false
```

Customize the verbs in the config file when you want a fixed status label or a small project-specific rotation:

```json
{
  "ui": {
    "activityVerbs": "Compiling"
  }
}
```

```json
{
  "ui": {
    "activityVerbs": ["Indexing", "Reviewing", "Testing"],
    "activitySymbol": ">"
  }
}
```

`activityVerbs` accepts either a single string or a non-empty string array. When `activityVerbsEnabled` is `false`, Autohand falls back to `Working...` instead of rotating through custom or built-in verbs.

You can toggle completion reports, including the structured `SITREP` prompt, without editing the file:

```bash
autohand config set sitrep true
autohand config set sitrep false
```

### Terminal Bell

When `terminalBell` is enabled (default), Autohand rings the terminal bell (`\x07`) when a task completes. This triggers:

- **Badge on terminal tab** - Shows a visual indicator that work is done
- **Dock icon bounce** - Gets your attention when terminal is in background (macOS)
- **Sound** - If terminal sounds are enabled in your terminal settings

Terminal-specific settings:

- **macOS Terminal**: Preferences > Profiles > Advanced > Bell (Visual/Audible)
- **iTerm2**: Preferences > Profiles > Terminal > Notifications
- **VS Code Terminal**: Settings > Terminal > Integrated: Enable Bell

To disable:

```json
{
  "ui": {
    "terminalBell": false
  }
}
```

### Ink Renderer

Autohand uses the Ink 7 + React 19 renderer by default for interactive terminals. The legacy `ui.useInkRenderer` config field is ignored so old config files cannot force the plain terminal composer. Ink provides:

- **Flicker-free output**: All UI updates are batched through React reconciliation
- **Working queue feature**: Type instructions while the agent works
- **Better input handling**: No conflicts between readline handlers
- **Composable UI**: Foundation for future advanced UI features

Emergency fallback for terminal compatibility:

```bash
AUTOHAND_LEGACY_UI=1 autohand
```

Note: This feature is experimental and may have edge cases. The default ora-based UI remains stable and fully functional.

### Update Check

When `checkForUpdates` is enabled (default), Autohand checks for new releases on startup:

```
> Autohand v0.6.8 (abc1234) ✓ Up to date
```

If an update is available:

```
> Autohand v0.6.7 (abc1234) ⬆ Update available: v0.6.8
  ↳ Run: curl -fsSL https://autohand.ai/install.sh | sh
```

How it works:

- Fetches latest release from GitHub API
- Caches result in `~/.autohand/version-check.json`
- Only checks once per `updateCheckInterval` hours (default: 24)
- Non-blocking: startup continues even if check fails

To disable:

```json
{
  "ui": {
    "checkForUpdates": false
  }
}
```

Or via environment variable:

```bash
export AUTOHAND_SKIP_UPDATE_CHECK=1
```

---

## Agent Settings

Control agent behavior and iteration limits.

```json
{
  "agent": {
    "maxIterations": 100,
    "enableRequestQueue": true,
    "toolSelectionCache": true,
    "autoMemory": true,
    "idleLogoutEnabled": true,
    "debug": false
  }
}
```

| Field                | Type    | Default | Description                                                                    |
| -------------------- | ------- | ------- | ------------------------------------------------------------------------------ |
| `maxIterations`      | number  | `100`   | Maximum tool iterations per user request before stopping                       |
| `enableRequestQueue` | boolean | `true`  | Allow users to type and queue requests while agent is working                  |
| `toolSelectionCache` | boolean | `true`  | Cache local per-turn tool schema selection for equivalent tool-selection input |
| `autoMemory`         | boolean | `true`  | Extract and save durable user/project memories after successful interactive turns |
| `idleLogoutEnabled`  | boolean | `true`  | Log out authenticated interactive sessions after the idle timeout              |
| `debug`              | boolean | `false` | Enable verbose debug output (logs agent internal state to stderr)              |

### Tool Schema Selection

Autohand does not send every full tool schema on every LLM request. The system prompt includes a compact tool capability catalog, and each request exposes only a small set of concrete schemas selected from:

- Core discovery tools such as `tool_search`, `read_file`, `fff_find`, and `fff_grep`
- Intent-matched tools for editing, verification, git, browser, web, dependency, or project-tracking work
- Tools requested through recent `tool_search` calls or explicitly mentioned by name

This avoids the large upfront context cost of sending all tool schemas before the user intent is known. `toolSelectionCache` controls only the local selector cache for equivalent turns; it does not perform a pre-user LLM warmup and does not force a large cached prompt prefix.

To disable the local selector cache:

```json
{
  "agent": {
    "toolSelectionCache": false
  }
}
```

To keep authenticated long-running agent sessions alive while they wait for work:

```json
{
  "agent": {
    "idleLogoutEnabled": false
  }
}
```

For a single process, use `autohand --no-idle-logout` or set `AUTOHAND_NO_IDLE_LOGOUT=1`.

### Debug Mode

Enable debug mode to see verbose logging of agent internal state (react loop iterations, prompt building, session details). Output goes to stderr to avoid interfering with normal output.

Three ways to enable debug mode (in order of precedence):

1. **CLI flag**: `autohand -d` or `autohand --debug`
2. **Environment variable**: `AUTOHAND_DEBUG=1`
3. **Config file**: Set `agent.debug: true`

### Request Queue

When `enableRequestQueue` is enabled, you can continue typing messages while the agent processes a previous request. Your input will be queued and processed automatically when the current task completes.

- Type your message and press Enter to add it to the queue
- The status line shows how many requests are queued
- Requests are processed in FIFO (first-in, first-out) order
- Maximum queue size is 10 requests

---

## Permissions Settings

Fine-grained control over tool permissions.

```json
{
  "permissions": {
    "mode": "interactive",
    "whitelist": [
      "run_command:npm *",
      "run_command:bun *",
      "run_command:git status"
    ],
    "blacklist": ["run_command:rm -rf *", "run_command:sudo *"],
    "rules": [
      {
        "tool": "run_command",
        "pattern": "npm test",
        "action": "allow"
      }
    ],
    "rememberSession": true
  }
}
```

### `mode`

| Value            | Description                                           |
| ---------------- | ----------------------------------------------------- |
| `"interactive"`  | Prompt for approval on dangerous operations (default) |
| `"unrestricted"` | No prompts, allow everything                          |
| `"restricted"`   | Deny all dangerous operations                         |

### `whitelist`

Array of tool patterns that never require approval.

```json
["run_command:npm *", "run_command:bun test"]
```

### `blacklist`

Array of tool patterns that are always blocked.

```json
["run_command:rm -rf /", "run_command:sudo *"]
```

### `rules`

Fine-grained permission rules.

| Field     | Type      | Description                                 |
| --------- | --------- | ------------------------------------------- | ---------- | -------------- |
| `tool`    | string    | Tool name to match                          |
| `pattern` | string    | Optional pattern to match against arguments |
| `action`  | `"allow"` | `"deny"`                                    | `"prompt"` | Action to take |

### `rememberSession`

| Type    | Default | Description                                 |
| ------- | ------- | ------------------------------------------- |
| boolean | `true`  | Remember approval decisions for the session |

### Local Project Permissions

Each project can have its own permission settings that override the global config. These are stored in `.autohand/settings.local.json` in your project root.

When you approve a file operation (edit, write, delete), it's automatically saved to this file so you won't be asked again for the same operation in this project.

```json
{
  "version": 1,
  "permissions": {
    "whitelist": [
      "apply_patch:src/components/Button.tsx",
      "write_file:package.json",
      "run_command:bun test"
    ]
  }
}
```

**How it works:**

- When you approve an operation, it's saved to `.autohand/settings.local.json`
- Next time, the same operation will be auto-approved
- Local project settings are merged with global settings (local takes priority)
- Add `.autohand/settings.local.json` to `.gitignore` to keep personal settings private

**Pattern format:**

- `tool_name:path` - For file operations (e.g., `apply_patch:src/file.ts`)
- `tool_name:command args` - For commands (e.g., `run_command:npm test`)

### Viewing Permissions

You can view your current permission settings in two ways:

**CLI Flag (Non-interactive):**

```bash
autohand --permissions
```

This displays:

- Current permission mode (interactive, unrestricted, restricted)
- Workspace and config file paths
- All approved patterns (whitelist)
- All denied patterns (blacklist)
- Summary statistics

**Interactive Command:**

```
/permissions
```

In interactive mode, the `/permissions` command provides the same information plus options to:

- Remove items from the whitelist
- Remove items from the blacklist
- Clear all saved permissions

---

## Patch Mode

Patch mode allows you to generate a shareable git-compatible patch without modifying your workspace files. This is useful for:

- Code review before applying changes
- Sharing AI-generated changes with team members
- Creating reproducible change sets
- CI/CD pipelines that need to capture changes without applying them

### Usage

```bash
# Generate patch to stdout
autohand --prompt "add user authentication" --patch

# Save to file
autohand --prompt "add user authentication" --patch --output auth.patch

# Pipe to file (alternative)
autohand --prompt "refactor api handlers" --patch > refactor.patch
```

### Behavior

When `--patch` is specified:

- **Auto-confirm**: All confirmations are automatically accepted (`--yes` implied)
- **No prompts**: No approval prompts are shown (`--unrestricted` implied)
- **Preview only**: Changes are captured but NOT written to disk
- **Security enforced**: Blacklisted operations (`.env`, SSH keys, dangerous commands) are still blocked

### Applying Patches

Recipients can apply the patch using standard git commands:

```bash
# Check what would be applied (dry-run)
git apply --check changes.patch

# Apply the patch
git apply changes.patch

# Apply with 3-way merge (handles conflicts better)
git apply -3 changes.patch

# Apply and stage changes
git apply --index changes.patch

# Reverse a patch
git apply -R changes.patch
```

### Patch Format

The generated patch follows git's unified diff format:

```diff
diff --git a/src/auth.ts b/src/auth.ts
new file mode 100644
--- /dev/null
+++ b/src/auth.ts
@@ -0,0 +1,15 @@
+export function authenticate(user: string, password: string) {
+  // Implementation here
+}

diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,5 +1,7 @@
 import express from 'express';
+import { authenticate } from './auth';

 const app = express();
+app.use(authenticate);
```

### Exit Codes

| Code | Meaning                                             |
| ---- | --------------------------------------------------- |
| `0`  | Success, patch generated                            |
| `1`  | Error (missing `--prompt`, permission denied, etc.) |

### Combining with Other Flags

```bash
# Use specific model
autohand --prompt "optimize queries" --patch --model gpt-4o

# Specify workspace
autohand --prompt "add tests" --patch --path ./my-project

# Use custom config
autohand --prompt "refactor" --patch --config ~/.autohand/work.json
```

### Team Workflow Example

```bash
# Developer A: Generate patch for a feature
autohand --prompt "implement user dashboard with charts" --patch --output dashboard.patch

# Share via git (create PR with just the patch file)
git checkout -b patch/dashboard
git add dashboard.patch
git commit -m "Add dashboard feature patch"
git push

# Developer B: Review and apply
git fetch origin patch/dashboard
git apply dashboard.patch
# Run tests, review code, then commit
git add -A && git commit -m "feat: add user dashboard with charts"
```

---

## Network Settings

```json
{
  "network": {
    "maxRetries": 3,
    "timeout": 30000,
    "retryDelay": 1000
  }
}
```

| Field        | Type   | Default | Max | Description                            |
| ------------ | ------ | ------- | --- | -------------------------------------- |
| `maxRetries` | number | `3`     | `5` | Retry attempts for failed API requests |
| `timeout`    | number | `30000` | -   | Request timeout in milliseconds        |
| `retryDelay` | number | `1000`  | -   | Delay between retries in milliseconds  |

---

## Telemetry Settings

Telemetry is **disabled by default** (opt-in). Enable it to help improve Autohand.

```json
{
  "telemetry": {
    "enabled": false,
    "apiBaseUrl": "https://api.autohand.ai",
    "batchSize": 20,
    "flushIntervalMs": 60000,
    "maxQueueSize": 500,
    "maxRetries": 3,
    "enableSessionSync": true,
    "companySecret": ""
  }
}
```

| Field               | Type    | Default                   | Description                                   |
| ------------------- | ------- | ------------------------- | --------------------------------------------- |
| `enabled`           | boolean | `false`                   | Enable/disable telemetry (opt-in)             |
| `apiBaseUrl`        | string  | `https://api.autohand.ai` | Telemetry API endpoint                        |
| `batchSize`         | number  | `20`                      | Number of events to batch before auto-flush   |
| `flushIntervalMs`   | number  | `60000`                   | Flush interval in milliseconds (1 minute)     |
| `maxQueueSize`      | number  | `500`                     | Maximum queue size before dropping old events |
| `maxRetries`        | number  | `3`                       | Retry attempts for failed telemetry requests  |
| `enableSessionSync` | boolean | `true`                    | Sync sessions to cloud for team features when telemetry is enabled |
| `companySecret`     | string  | `""`                      | Company secret for API authentication         |

Provider/model telemetry includes the active provider id, model id, and available non-secret metadata such as custom provider display name, API format, reasoning effort, and context window. API keys and bearer tokens are never included.

---

## External Agents

Load custom agent definitions from external directories.

```json
{
  "externalAgents": {
    "enabled": true,
    "paths": ["~/.autohand/agents", "/team/shared/agents"]
  }
}
```

| Field     | Type     | Default | Description                     |
| --------- | -------- | ------- | ------------------------------- |
| `enabled` | boolean  | `false` | Enable external agent loading   |
| `paths`   | string[] | `[]`    | Directories to load agents from |

---

## Skills System

Skills are instruction packages that provide specialized instructions to the AI agent. They work like on-demand `AGENTS.md` files that can be activated for specific tasks.

### Skill Discovery Locations

Skills are discovered from multiple locations, with later sources taking precedence:

| Location                                 | Source ID          | Description                               |
| ---------------------------------------- | ------------------ | ----------------------------------------- |
| `~/.codex/skills/**/SKILL.md`            | `codex-user`       | User-level Codex skills (recursive)       |
| `~/.claude/skills/*/SKILL.md`            | `claude-user`      | User-level Claude skills (one level)      |
| `~/.autohand/skills/**/SKILL.md`         | `autohand-user`    | User-level Autohand skills (recursive)    |
| `<project>/.claude/skills/*/SKILL.md`    | `claude-project`   | Project-level Claude skills (one level)   |
| `<project>/.autohand/skills/**/SKILL.md` | `autohand-project` | Project-level Autohand skills (recursive) |

### Auto-Copy Behavior

Skills discovered from Codex or Claude locations are automatically copied to the corresponding Autohand location:

- `~/.codex/skills/` and `~/.claude/skills/` → `~/.autohand/skills/`
- `<project>/.claude/skills/` → `<project>/.autohand/skills/`

Existing skills in Autohand locations are never overwritten.

### SKILL.md Format

Skills use YAML frontmatter followed by markdown content:

```markdown
---
name: my-skill-name
description: Brief description of the skill
license: MIT
compatibility: Works with Node.js 18+
allowed-tools: read_file write_file run_command
metadata:
  author: your-name
  version: "1.0.0"
---

# My Skill

Detailed instructions for the AI agent...
```

| Field           | Required | Max Length | Description                                |
| --------------- | -------- | ---------- | ------------------------------------------ |
| `name`          | Yes      | 64 chars   | Lowercase alphanumeric with hyphens only   |
| `description`   | Yes      | 1024 chars | Brief description of the skill             |
| `license`       | No       | -          | License identifier (e.g., MIT, Apache-2.0) |
| `compatibility` | No       | 500 chars  | Compatibility notes                        |
| `allowed-tools` | No       | -          | Space-delimited list of allowed tools      |
| `metadata`      | No       | -          | Additional key-value metadata              |

### Input Prefixes

Autohand supports special prefixes in the input prompt:

| Prefix | Description                    | Example                            |
| ------ | ------------------------------ | ---------------------------------- |
| `/`    | Slash commands                 | `/help`, `/model`, `/quit`, `/exit` |
| `@`    | File mentions (autocomplete)   | `@src/index.ts`                    |
| `$`    | Skill mentions (autocomplete)  | `$frontend-design`, `$code-review` |
| `!`    | Run terminal commands directly | `! git status`, `! ls -la`         |

**Skill Mentions (`$`):**

- Type `$` followed by characters to see available skills with autocomplete
- Tab accepts the top suggestion (e.g., `$frontend-design`)
- Skills are discovered from `~/.autohand/skills/` and `<project>/.autohand/skills/`
- Activated skills are attached to the prompt as special instructions for the current session
- Preview panel shows skill metadata (name, description, activation state)

**Shell Commands (`!`):**

- Commands run in your current working directory
- Output displays directly in terminal
- Does not go to the LLM
- 30 second timeout
- Returns to prompt after execution

### Slash Commands

#### `/skills` - Package Manager

| Command                         | Description                                |
| ------------------------------- | ------------------------------------------ |
| `/skills`                       | List all available skills                  |
| `/skills use <name>`            | Activate a skill for the current session   |
| `/skills deactivate <name>`     | Deactivate a skill                         |
| `/skills info <name>`           | Show detailed skill information            |
| `/skills install`               | Browse and install from community registry |
| `/skills install @<slug>`       | Install a community skill by slug          |
| `/skills search <query>`        | Search the community skills registry       |
| `/skills trending`              | Show trending community skills             |
| `/skills remove <slug>`         | Uninstall a community skill                |
| `/skills new`                   | Create a new skill interactively           |
| `/skills feedback <slug> <1-5>` | Rate a community skill                     |

#### `/learn` - LLM-Powered Skill Advisor

| Command         | Description                                                      |
| --------------- | ---------------------------------------------------------------- |
| `/learn`        | Analyze project and recommend skills (quick scan)                |
| `/learn deep`   | Deep-scan project (reads source files) for more targeted results |
| `/learn update` | Re-analyze project and regenerate outdated LLM-generated skills  |

`/learn` uses a two-phase LLM flow:

1. **Phase 1 - Analyze + Rank + Audit**: Scans your project structure, audits installed skills for redundancy/conflicts, and ranks community skills by relevance (0-100).
2. **Phase 2 - Generate** (conditional): If no community skill scores above 60, offers to generate a custom skill tailored to your project.

Generated skills include metadata (`agentskill-source: llm-generated`, `agentskill-project-hash`) so `/learn update` can detect when your codebase changes and regenerate stale skills.

### Auto-Skill Generation (`--auto-skill`)

The `--auto-skill` CLI flag generates skills without the interactive advisor flow:

```bash
autohand --auto-skill
```

This will:

1. Analyze your project structure (package.json, requirements.txt, etc.)
2. Detect languages, frameworks, and patterns
3. Generate 3 relevant skills using LLM
4. Save skills to `<project>/.autohand/skills/`

For a more targeted, interactive experience, use `/learn` inside a session instead.

Detected patterns include:

- **Languages**: TypeScript, JavaScript, Python, Rust, Go
- **Frameworks**: React, Next.js, Vue, Express, Flask, Django
- **Patterns**: CLI tools, testing, monorepo, Docker, CI/CD

---

## API Settings

Backend API configuration for team features.

```json
{
  "api": {
    "baseUrl": "https://api.autohand.ai",
    "companySecret": "sk-team-xxx"
  }
}
```

| Field           | Type   | Default                   | Description                             |
| --------------- | ------ | ------------------------- | --------------------------------------- |
| `baseUrl`       | string | `https://api.autohand.ai` | API endpoint                            |
| `companySecret` | string | -                         | Team/company secret for shared features |

Can also be set via environment variables:

- `AUTOHAND_API_URL` → `api.baseUrl`
- `AUTOHAND_SECRET` → `api.companySecret`

---

## Authentication Settings

Authentication and user session configuration.

```json
{
  "auth": {
    "token": "your-auth-token",
    "user": {
      "id": "user-id",
      "email": "user@example.com",
      "name": "User Name",
      "avatar": "https://example.com/avatar.png"
    },
    "expiresAt": "2025-12-31T23:59:59Z"
  }
}
```

| Field         | Type   | Default | Description                                  |
| ------------- | ------ | ------- | -------------------------------------------- |
| `token`       | string | -       | Authentication token for API access          |
| `user`        | object | -       | Authenticated user information               |
| `user.id`     | string | -       | User ID                                      |
| `user.email`  | string | -       | User email address                           |
| `user.name`   | string | -       | User display name                            |
| `user.avatar` | string | -       | User avatar URL (optional)                   |
| `expiresAt`   | string | -       | Token expiration timestamp (ISO 8601 format) |

---

## Community Skills Settings

Configuration for community skills discovery and management.

```json
{
  "communitySkills": {
    "enabled": true,
    "showSuggestionsOnStartup": true,
    "autoBackup": true
  }
}
```

| Field                      | Type    | Default | Description                                                   |
| -------------------------- | ------- | ------- | ------------------------------------------------------------- |
| `enabled`                  | boolean | `true`  | Enable community skills features                              |
| `showSuggestionsOnStartup` | boolean | `true`  | Show skill suggestions on startup when no vendor skills exist |
| `autoBackup`               | boolean | `true`  | Automatically backup discovered vendor skills to API          |

---

## Share Settings

Configuration for session sharing via `/share` command. Sessions are hosted at [autohand.link](https://autohand.link).

```json
{
  "share": {
    "enabled": true
  }
}
```

| Field     | Type    | Default | Description                         |
| --------- | ------- | ------- | ----------------------------------- |
| `enabled` | boolean | `true`  | Enable/disable the `/share` command |

### YAML Format

```yaml
share:
  enabled: true
```

### Disabling Session Sharing

If you want to disable session sharing for security or privacy reasons:

```json
{
  "share": {
    "enabled": false
  }
}
```

When disabled, running `/share` will display:

```
Session sharing is disabled.
To enable, set share.enabled: true in your config file.
```

---

## Settings Sync

Autohand can sync your configuration across devices for logged-in users. Settings are stored securely in Cloudflare R2 and encrypted before upload.

```json
{
  "sync": {
    "enabled": true,
    "interval": 300000,
    "exclude": [],
    "includeTelemetry": false,
    "includeFeedback": false
  }
}
```

| Field              | Type     | Default         | Description                                        |
| ------------------ | -------- | --------------- | -------------------------------------------------- |
| `enabled`          | boolean  | `true` (logged) | Enable/disable settings sync                       |
| `interval`         | number   | `300000`        | Sync interval in milliseconds (default: 5 minutes) |
| `exclude`          | string[] | `[]`            | Glob patterns to exclude from sync                 |
| `includeTelemetry` | boolean  | `false`         | Sync telemetry data (requires user consent)        |
| `includeFeedback`  | boolean  | `false`         | Sync feedback data (requires user consent)         |

### CLI Flag

```bash
# Disable sync for this session
autohand --sync-settings=false

# Enable sync (default for logged users)
autohand --sync-settings
```

### What Gets Synced

By default, these items are synced for logged-in users:

- **Configuration** (`config.json`) - API keys are encrypted before upload
- **Custom agents** (`agents/`)
- **Community skills** (`community-skills/`)
- **User hooks** (`hooks/`)
- **Memory** (`memory/`)
- **Project knowledge** (`projects/`)
- **Session history** (`sessions/`)
- **Shared content** (`share/`)
- **Custom skills** (`skills/`)

### What Doesn't Sync (By Default)

- **Device ID** (`device-id`) - Unique per device
- **Error logs** (`error.log`) - Local only
- **Version cache** (`version-*.json`) - Local cache files

### Consent-Based Sync

These items require explicit opt-in in your config:

- **Telemetry data** - Set `sync.includeTelemetry: true` to sync
- **Feedback data** - Set `sync.includeFeedback: true` to sync

```json
{
  "sync": {
    "enabled": true,
    "includeTelemetry": true,
    "includeFeedback": true
  }
}
```

### Conflict Resolution

When conflicts occur (same file modified on multiple devices), the **cloud version wins**. This ensures consistency when logging in on new devices.

### Security

API keys and other sensitive data in `config.json` are encrypted using your authentication token before upload. They can only be decrypted with your credentials.

**What's encrypted:**

- Fields named `apiKey`
- Fields ending with `Key`, `Token`, `Secret`
- The `password` field

### How It Works

1. **On startup**: If you're logged in, the sync service starts automatically
2. **Every 5 minutes**: Settings are compared with cloud storage
3. **Cloud wins**: Remote changes are downloaded first
4. **Local uploads**: New local changes are uploaded
5. **On exit**: Sync service stops gracefully

### Excluding Files

You can exclude specific files or patterns from sync:

```json
{
  "sync": {
    "enabled": true,
    "exclude": ["custom-local-config.json", "temp/*"]
  }
}
```

### YAML Format

```yaml
sync:
  enabled: true
  interval: 300000
  exclude: []
  includeTelemetry: false
  includeFeedback: false
```

---

## MCP Settings

Configure MCP (Model Context Protocol) servers to extend Autohand with external tools.

```json
{
  "mcp": {
    "enabled": true,
    "servers": [
      {
        "name": "filesystem",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        "env": {},
        "autoConnect": true
      },
      {
        "name": "context7",
        "transport": "http",
        "url": "https://mcp.context7.com/mcp",
        "headers": {
          "CONTEXT7_API_KEY": "ctx7sk-your-api-key"
        },
        "autoConnect": true
      }
    ]
  }
}
```

### `mcp.enabled`

- **Type**: `boolean`
- **Default**: `true`
- **Description**: Enable or disable all MCP support. When `false`, no servers are connected at startup and MCP tools are unavailable.

### `mcp.servers`

- **Type**: `McpServerConfigEntry[]`
- **Default**: `[]`
- **Description**: Array of MCP server configurations.

### Server Entry Fields

| Field         | Type                             | Required       | Default | Description                                                   |
| ------------- | -------------------------------- | -------------- | ------- | ------------------------------------------------------------- |
| `name`        | `string`                         | Yes            | -       | Unique server identifier                                      |
| `transport`   | `"stdio"` \| `"sse"` \| `"http"` | Yes            | -       | Transport type                                                |
| `command`     | `string`                         | Yes (stdio)    | -       | Command to start the server process                           |
| `args`        | `string[]`                       | No             | `[]`    | Arguments for the command                                     |
| `url`         | `string`                         | Yes (sse/http) | -       | Server endpoint URL                                           |
| `headers`     | `Record<string, string>`         | No             | `{}`    | Custom HTTP headers for http/sse transport (e.g. auth tokens) |
| `env`         | `Record<string, string>`         | No             | `{}`    | Environment variables passed to the server                    |
| `autoConnect` | `boolean`                        | No             | `true`  | Whether to auto-connect on startup                            |

> Servers connect asynchronously in the background during startup without blocking the prompt. Use `/mcp` to manage servers interactively, or `/mcp add` to browse the community registry or add custom servers.

> For full MCP documentation, see [docs/mcp.md](mcp.md).

---

## Hooks Settings

Configuration for lifecycle hooks that run shell commands on agent events. See [Hooks Documentation](./hooks.md) for full details.

```json
{
  "hooks": {
    "enabled": true,
    "hooks": [
      {
        "event": "pre-tool",
        "command": "echo \"Running tool: $HOOK_TOOL\" >> ~/.autohand/hooks.log",
        "description": "Log all tool executions",
        "enabled": true
      },
      {
        "event": "file-modified",
        "command": "./scripts/on-file-change.sh",
        "description": "Custom file change handler",
        "filter": { "path": ["src/**/*.ts"] }
      },
      {
        "event": "post-response",
        "command": "curl -X POST https://api.example.com/webhook -d '{\"tokens\": $HOOK_TOKENS}'",
        "description": "Track token usage",
        "async": true
      }
    ]
  }
}
```

### `hooks`

| Field     | Type    | Default | Description                       |
| --------- | ------- | ------- | --------------------------------- |
| `enabled` | boolean | `true`  | Enable/disable all hooks globally |
| `hooks`   | array   | `[]`    | Array of hook definitions         |

### Hook Definition

| Field         | Type    | Required | Default | Description                      |
| ------------- | ------- | -------- | ------- | -------------------------------- |
| `event`       | string  | Yes      | -       | Event to hook into               |
| `command`     | string  | Yes      | -       | Shell command to execute         |
| `description` | string  | No       | -       | Description for `/hooks` display |
| `enabled`     | boolean | No       | `true`  | Whether hook is active           |
| `timeout`     | number  | No       | `5000`  | Timeout in milliseconds          |
| `async`       | boolean | No       | `false` | Run without blocking             |
| `filter`      | object  | No       | -       | Filter by tool or path           |

### Hook Events

| Event           | When Fired                            |
| --------------- | ------------------------------------- |
| `pre-tool`      | Before any tool executes              |
| `post-tool`     | After tool completes                  |
| `file-modified` | When file is created/modified/deleted |
| `pre-prompt`    | Before sending to LLM                 |
| `post-response` | After LLM responds                    |
| `session-error` | When error occurs                     |

### Environment Variables

When hooks execute, these environment variables are available:

| Variable         | Description                 |
| ---------------- | --------------------------- |
| `HOOK_EVENT`     | Event name                  |
| `HOOK_WORKSPACE` | Workspace root path         |
| `HOOK_TOOL`      | Tool name (tool events)     |
| `HOOK_ARGS`      | JSON-encoded tool args      |
| `HOOK_SUCCESS`   | true/false (post-tool)      |
| `HOOK_PATH`      | File path (file-modified)   |
| `HOOK_TOKENS`    | Tokens used (post-response) |

---

## Chrome Extension Settings

Control the Autohand Chrome extension integration. See the full guide at [Autohand in Chrome](./autohand-in-chrome.md).

```json
{
  "chrome": {
    "extensionId": "your-extension-id",
    "enabledByDefault": false,
    "browser": "auto",
    "userDataDir": "/path/to/chrome/user-data",
    "profileDirectory": "Default",
    "installUrl": "https://autohand.ai/chrome"
  }
}
```

| Key                | Type      | Default  | Description                                                               |
| ------------------ | --------- | -------- | ------------------------------------------------------------------------- |
| `extensionId`      | `string`  | —        | Installed Chrome extension ID for direct handoff                          |
| `enabledByDefault` | `boolean` | `false`  | Start browser bridge automatically with the CLI                           |
| `browser`          | `string`  | `"auto"` | Preferred Chromium browser: `auto`, `chrome`, `chromium`, `brave`, `edge` |
| `userDataDir`      | `string`  | —        | Browser user data directory to target the correct profile                 |
| `profileDirectory` | `string`  | —        | Browser profile directory name (e.g., `"Default"`, `"Profile 1"`)         |
| `installUrl`       | `string`  | —        | Fallback URL when the extension ID is not configured                      |

### CLI Flags

```bash
autohand --chrome          # Start with browser bridge enabled
autohand --no-chrome       # Start with browser bridge disabled
```

### Slash Commands

```
/chrome                    # Open Chrome integration panel
/chrome disconnect         # Close the browser bridge connection
```

---

## Complete Example

### JSON Format (`~/.autohand/config.json`)

```json
{
  "provider": "openrouter",
  "openrouter": {
    "apiKey": "sk-or-v1-your-key-here",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "your-modelcard-id-here"
  },
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "model": "llama3.2"
  },
  "workspace": {
    "defaultRoot": "~/projects",
    "allowDangerousOps": false
  },
  "ui": {
    "theme": "dark",
    "autoConfirm": false,
    "showCompletionNotification": true,
    "showThinking": true,
    "terminalBell": true,
    "checkForUpdates": true,
    "updateCheckInterval": 24
  },
  "agent": {
    "maxIterations": 100,
    "enableRequestQueue": true,
    "toolSelectionCache": true,
    "idleLogoutEnabled": true,
    "debug": false
  },
  "permissions": {
    "mode": "interactive",
    "whitelist": ["run_command:npm *", "run_command:bun *"],
    "blacklist": ["run_command:rm -rf /"],
    "rememberSession": true
  },
  "network": {
    "maxRetries": 3,
    "timeout": 30000,
    "retryDelay": 1000
  },
  "telemetry": {
    "enabled": false,
    "apiBaseUrl": "https://api.autohand.ai",
    "batchSize": 20,
    "flushIntervalMs": 60000,
    "maxQueueSize": 500,
    "maxRetries": 3,
    "enableSessionSync": true
  },
  "externalAgents": {
    "enabled": false,
    "paths": []
  },
  "api": {
    "baseUrl": "https://api.autohand.ai"
  },
  "auth": {
    "token": "your-auth-token",
    "user": {
      "id": "user-id",
      "email": "user@example.com",
      "name": "User Name"
    }
  },
  "communitySkills": {
    "enabled": true,
    "showSuggestionsOnStartup": true,
    "autoBackup": true
  },
  "share": {
    "enabled": true
  },
  "sync": {
    "enabled": true,
    "interval": 300000,
    "includeTelemetry": false,
    "includeFeedback": false
  }
}
```

### YAML Format (`~/.autohand/config.yaml`)

```yaml
provider: openrouter

openrouter:
  apiKey: sk-or-v1-your-key-here
  baseUrl: https://openrouter.ai/api/v1
  model: your-modelcard-id-here

ollama:
  baseUrl: http://localhost:11434
  model: llama3.2

workspace:
  defaultRoot: ~/projects
  allowDangerousOps: false

ui:
  theme: dark
  autoConfirm: false
  showCompletionNotification: true
  showThinking: true
  terminalBell: true
  checkForUpdates: true
  updateCheckInterval: 24

agent:
  maxIterations: 100
  enableRequestQueue: true
  toolSelectionCache: true
  idleLogoutEnabled: true
  debug: false

permissions:
  mode: interactive
  whitelist:
    - "run_command:npm *"
    - "run_command:bun *"
  blacklist:
    - "run_command:rm -rf /"
  rememberSession: true

network:
  maxRetries: 3
  timeout: 30000
  retryDelay: 1000

telemetry:
  enabled: false
  apiBaseUrl: https://api.autohand.ai
  batchSize: 20
  flushIntervalMs: 60000
  maxQueueSize: 500
  maxRetries: 3
  enableSessionSync: true

externalAgents:
  enabled: false
  paths: []

api:
  baseUrl: https://api.autohand.ai

auth:
  token: your-auth-token
  user:
    id: user-id
    email: user@example.com
    name: User Name

communitySkills:
  enabled: true
  showSuggestionsOnStartup: true
  autoBackup: true

share:
  enabled: true

sync:
  enabled: true
  interval: 300000
  includeTelemetry: false
  includeFeedback: false
```

### TOML Format (`~/.autohand/config.toml`)

```toml
provider = "openrouter"

[openrouter]
apiKey = "sk-or-v1-your-key-here"
baseUrl = "https://openrouter.ai/api/v1"
model = "your-modelcard-id-here"

[ollama]
baseUrl = "http://localhost:11434"
model = "llama3.2"

[workspace]
defaultRoot = "~/projects"
allowDangerousOps = false

[ui]
theme = "dark"
autoConfirm = false
showCompletionNotification = true
showThinking = true
terminalBell = true
checkForUpdates = true
updateCheckInterval = 24

[ui.customThemes.company.vars]
brand = "#7c3aed"
brandSoft = "#a78bfa"

[ui.customThemes.company.colors]
accent = "brand"
borderAccent = "brandSoft"
mdHeading = "brand"

[agent]
maxIterations = 100
enableRequestQueue = true
toolSelectionCache = true
idleLogoutEnabled = true
debug = false

[permissions]
mode = "interactive"
whitelist = ["run_command:npm *", "run_command:bun *"]
blacklist = ["run_command:rm -rf /"]
rememberSession = true
```

---

## Directory Structure

Autohand stores data in `~/.autohand/` (or `$AUTOHAND_HOME`):

```
~/.autohand/
├── config.json          # Main configuration
├── config.toml          # Alternative TOML config
├── config.yaml          # Alternative YAML config
├── device-id            # Unique device identifier
├── error.log            # Error log
├── feedback.log         # Feedback submissions
├── sessions/            # Session history
├── projects/            # Project knowledge base
├── memory/              # User-level memory
├── commands/            # Custom commands
├── agents/              # Agent definitions
├── tools/               # Custom meta-tools
├── feedback/            # Feedback state
└── telemetry/           # Telemetry data
    ├── queue.json
    └── session-sync-queue.json
```

**Project-level directory** (in your workspace root):

```
<project>/.autohand/
├── settings.local.json  # Local project permissions (gitignore this)
├── memory/              # Project-specific memory
├── skills/              # Project-specific skills
└── tools/               # Project-specific meta-tools
```

---

## CLI Flags (Override Config)

These flags override config file settings:

### Core Flags

| Flag                          | Description                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `-v, --version`               | Output the current version                                                                     |
| `-p, --prompt [text]`         | Run a single instruction in command mode                                                       |
| `--path <path>`               | Override workspace root                                                                        |
| `--config <path>`             | Use custom config file                                                                         |
| `--model <model>`             | Override model                                                                                 |
| `--temperature <n>`           | Set sampling temperature (0-1)                                                                  |
| `--thinking [level]`          | Set thinking/reasoning depth (none, normal, extended)                                          |
| `-y, --yes`                   | Auto-confirm prompts                                                                           |
| `--dry-run`                   | Preview without executing                                                                      |
| `-d, --debug`                 | Enable verbose debug output                                                                    |
| `--bare`                      | Minimal explicit mode; also sets `AUTOHAND_CODE_SIMPLE=1` and disables slash commands          |

### Permissions & Safety

| Flag                          | Description                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--unrestricted`              | No approval prompts                                                                            |
| `--restricted`                | Deny dangerous operations                                                                      |
| `--permissions`               | Display current permission settings and exit                                                   |
| `--no-idle-logout`            | Disable authenticated idle logout for long-running agent sessions                              |
| `--yolo [pattern]`            | Auto-approve tool calls matching pattern (e.g., `allow:read,write` or `deny:delete`)           |
| `--timeout <seconds>`         | Timeout in seconds for auto-approve mode                                                       |

### Git & Worktree

| Flag                          | Description                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--worktree [name]`           | Run session in isolated git worktree (optional worktree/branch name)                           |
| `--tmux`                      | Launch in a dedicated tmux session (implies `--worktree`; cannot be used with `--no-worktree`) |
| `--no-worktree`               | Disable git worktree isolation in auto-mode                                                    |
| `-c, --auto-commit`           | Auto-commit changes after completing tasks                                                     |
| `--patch`                     | Generate git patch without applying changes                                                    |
| `--output <file>`             | Output file for patch (used with --patch)                                                      |

### Auto-Mode

| Flag                          | Description                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--auto-mode [prompt]`        | Enable interactive auto-mode, or start a standalone loop with an inline task                   |
| `--max-iterations <n>`        | Max auto-mode iterations (default: 50)                                                         |
| `--completion-promise <text>` | Completion marker text (default: "DONE")                                                       |
| `--checkpoint-interval <n>`   | Git commit every N iterations (default: 5)                                                     |
| `--max-runtime <m>`           | Max runtime in minutes (default: 120)                                                          |
| `--max-cost <d>`              | Max API cost in dollars (default: 10)                                                          |
| `--interactive-on-complete`   | After auto-mode ends, hand off directly to interactive mode (TTY only)                         |

### Skills & Learning

| Flag                          | Description                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--auto-skill`                | Auto-generate skills based on project analysis (see also `/learn` for interactive advisor)     |
| `--learn`                     | Run `/learn` skill advisor non-interactively (analyze and install recommended skills)          |
| `--learn-update`              | Re-analyze project and regenerate outdated LLM-generated skills non-interactively              |
| `--skill-install [name]`      | Install a community skill (opens browser if no name provided)                                  |
| `--project`                   | Install skill to project level (with --skill-install)                                          |

### Authentication & Account

| Flag                          | Description                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--login`                     | Sign in to your Autohand account                                                               |
| `--logout`                    | Sign out of your Autohand account                                                              |
| `--sync-settings`             | Enable/disable settings sync (default: true for logged users)                                  |

### Setup & Info

| Flag                          | Description                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--setup`                     | Run the setup wizard to configure or reconfigure Autohand                                      |
| `--about`                     | Show information about Autohand (version, links, contribution info)                            |
| `--feedback`                  | Submit feedback to the Autohand team                                                           |
| `--settings`                  | Configure Autohand settings (same as `/settings` in interactive mode)                          |

### Workspace & Directories

| Flag                          | Description                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--add-dir <path...>`         | Add additional directories to workspace scope (can be used multiple times)                     |

### Run Modes

| Flag                          | Description                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--mode <mode>`               | Run mode: interactive (default), rpc, or acp                                                   |
| `--acp`                       | Shorthand for --mode acp (Agent Client Protocol over stdio)                                    |
| `--teammate-mode <mode>`      | Team display mode: auto, in-process, or tmux                                                   |

### UI & Language

| Flag                          | Description                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--display-language <locale>` | Set display language (e.g., en, id, zh-cn, fr, de, ja)                                         |
| `--search-engine <provider>`  | Set web search provider (browser-profile, exa, google, brave, duckduckgo, parallel)             |
| `--cc, --context-compact`     | Enable context compaction (default: on)                                                        |
| `--no-cc, --no-context-compact` | Disable context compaction                                                                    |

### Chrome Integration

| Flag                          | Description                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--chrome`                    | Enable Chrome browser integration (same as `/chrome`)                                          |
| `--no-chrome`                 | Disable Chrome browser integration                                                             |

### System Prompt

| Flag                          | Description                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `--sys-prompt <value>`        | Replace entire system prompt (inline string or file path)                                      |
| `--append-sys-prompt <value>` | Append to system prompt (inline string or file path)                                           |
| `--system-prompt <value>`     | Replace entire system prompt (inline string or file path)                                      |
| `--system-prompt-file <path>` | Replace entire system prompt with file contents                                                |
| `--append-system-prompt <value>` | Append to system prompt (inline string or file path)                                        |
| `--append-system-prompt-file <path>` | Append file contents to system prompt                                                  |
| `--mcp-config <path>`         | Load an explicit MCP config file                                                               |
| `--agents <json\|path>`       | Load explicit inline agents JSON or an explicit agents directory                               |
| `--plugin-dir <path>`         | Load an explicit plugin/meta-tool directory                                                    |

### Experiment Switch Commands

| Command                               | Description                                      |
| ------------------------------------- | ------------------------------------------------ |
| `autohand experiments list`              | List local and remote feature ids, source, lifecycle stage, and state |
| `autohand experiments status <feature>`  | Show one feature switch, config path or remote metadata, and state |
| `autohand experiments refresh`           | Download remote feature flags from the Autohand API |
| `autohand experiments enable <feature>`  | Enable a config-backed feature switch            |
| `autohand experiments disable <feature>` | Disable a config-backed feature switch           |

Remote feature flags are fetched from `/v1/feature-flags/evaluate`, cached at `~/.autohand/feature-flags.json`, and refreshed after the API-provided TTL expires. Use `features.environment` to select a remote flag environment and `features.remoteOverrides` for local opt-outs of user-overridable remote flags.

`cli_usage_v2` is an experimental feature switch for the project token activity dashboard shown by `/usage`, `/usage weekly`, and `/usage monthly` (config path `features.cliUsageV2`, default on). Disable it with `autohand experiments disable cli_usage_v2`.

`usage_v2` is the legacy model, provider, context, and usage-limits dashboard plus the enhanced `/status` Usage tab. Enable it with `autohand experiments enable usage_v2`.

`token_usage_status` is an experimental feature switch (config path `features.tokenUsageStatus`, default off) that shows real-time token usage in the working status line — cumulative tokens up (`↑`) and down (`↓`) plus context-window occupancy, e.g. `↑15.7k ↓3.2k · context: 6.0% (15.7k/262.1k)`. The context window is resolved per model across all providers. Enable it with `autohand experiments enable token_usage_status`.

---

## Slash Commands

Autohand provides a rich set of slash commands for interactive use. Type `/` in the REPL to see suggestions.

### Session Management

| Command       | Description                                           |
| ------------- | ----------------------------------------------------- |
| `/quit`       | Exit the current session                              |
| `/exit`       | Exit the current session                              |
| `/new`        | Start fresh conversation (with memory extraction)     |
| `/clear`      | Clear conversation with automatic memory extraction   |
| `/session`    | Show current session details                          |
| `/sessions`   | List past sessions                                    |
| `/resume`     | Resume a previous session                             |
| `/history`    | Browse session history with pagination                |
| `/undo`       | Revert git changes and last turn                      |
| `/export`     | Export session to markdown/JSON/HTML                  |
| `/share`      | Share current session                                 |
| `/status`     | Show session status                                   |
| `/usage`      | Show project token activity by day, week, or month    |

### Model & Provider

| Command       | Description                                           |
| ------------- | ----------------------------------------------------- |
| `/model`      | Switch or configure LLM model                         |
| `/cc`         | Compact context manually                              |

### Project Setup

| Command       | Description                                           |
| ------------- | ----------------------------------------------------- |
| `/init`       | Create `AGENTS.md` file in current directory          |
| `/setup`      | Run the setup wizard to configure Autohand            |
| `/add-dir`    | Add directories to workspace scope                    |

### Agents & Teams

| Command       | Description                                           |
| ------------- | ----------------------------------------------------- |
| `/agents`     | List available sub-agents                             |
| `/agents-new` | Create a new agent via wizard                         |
| `/squad`      | Open/manage the standalone Autohand Squad runtime     |
| `/team`       | Manage team for parallel work                         |
| `/tasks`      | Manage tasks in team                                  |
| `/message`    | Send message to teammate                              |

### Skills

| Command          | Description                                        |
| ---------------- | -------------------------------------------------- |
| `/skills`        | List and manage skills                             |
| `/skills-new`    | Create new skill                                   |
| `/learn`         | Learn and install recommended skills               |

### Memory & Settings

| Command       | Description                                           |
| ------------- | ----------------------------------------------------- |
| `/memory`     | View and manage stored memories                       |
| `/settings`   | Configure Autohand settings                           |
| `/statusline` | Configure composer status-line fields                 |
| `/experiments` | Toggle experimental feature switches                  |
| `/sync`       | Sync settings across devices                          |
| `/import`     | Import sessions, settings, MCP, memory, skills, and hooks from supported agents |

### Permissions & Hooks

| Command       | Description                                           |
| ------------- | ----------------------------------------------------- |
| `/permissions`| Manage tool permissions                               |
| `/hooks`      | Manage lifecycle hooks                                |

### Authentication

| Command       | Description                                           |
| ------------- | ----------------------------------------------------- |
| `/login`      | Authenticate with Autohand API                        |
| `/logout`     | Log out of Autohand account                           |

### Tools & Utilities

| Command       | Description                                           |
| ------------- | ----------------------------------------------------- |
| `/search`     | Search the web                                        |
| `/formatters` | List available code formatters                        |
| `/lint`       | List available code linters                          |
| `/completion` | Generate shell completion scripts                     |
| `/plan`       | Create implementation plan                            |
| `/review`     | Perform code review                                   |
| `/pr-review`  | Review a pull request                                 |

### IDE Integration

| Command       | Description                                           |
| ------------- | ----------------------------------------------------- |
| `/ide`        | Detect and connect to running IDEs                    |

### MCP (Model Context Protocol)

| Command       | Description                                           |
| ------------- | ----------------------------------------------------- |
| `/mcp`        | Interactive MCP server manager                        |

### Automation

| Command       | Description                                           |
| ------------- | ----------------------------------------------------- |
| `/automode`   | Start autonomous coding mode                          |
| `/repeat`     | Schedule recurring jobs                               |
| `/yolo`       | Toggle yolo mode (auto-approve tools)                 |

### Chrome Integration

| Command       | Description                                           |
| ------------- | ----------------------------------------------------- |
| `/chrome`     | Enable Chrome browser integration                     |

### UI & Display

| Command       | Description                                           |
| ------------- | ----------------------------------------------------- |
| `/help`       | Display available slash commands and tips             |
| `/about`      | Show information about Autohand                       |
| `/theme`      | Change color theme                                    |
| `/language`   | Change display language                               |
| `/feedback`   | Send feedback to the Autohand team                    |

---

## System Prompt Customization

Autohand allows you to customize the system prompt used by the AI agent. This is useful for specialized workflows, custom instructions, or integration with other systems.

### CLI Flags

| Flag                          | Description                                 |
| ----------------------------- | ------------------------------------------- |
| `--sys-prompt <value>`        | Replace the entire system prompt            |
| `--append-sys-prompt <value>` | Append content to the default system prompt |

Both flags accept either:

- **Inline string**: Direct text content
- **File path**: Path to a file containing the prompt (auto-detected)

### File Path Detection

A value is treated as a file path if it:

- Starts with `./`, `../`, `/`, or `~/`
- Starts with a Windows drive letter (e.g., `C:\`)
- Ends with `.txt`, `.md`, or `.prompt`
- Contains path separators without spaces

Otherwise, it's treated as an inline string.

### `--sys-prompt` (Complete Replacement)

When provided, this **completely replaces** the default system prompt. The agent will NOT load:

- Default Autohand instructions
- AGENTS.md project instructions
- User/project memories
- Active skills

```bash
# Inline string
autohand --sys-prompt "You are a Python expert. Be concise." --prompt "Write hello world"

# From file
autohand --sys-prompt ./custom-prompt.txt --prompt "Explain this code"

# Home directory
autohand --sys-prompt ~/.autohand/prompts/python-expert.md --prompt "Debug this function"
```

**Example custom prompt file (`custom-prompt.txt`):**

```
You are a specialized Python debugging assistant.

Rules:
- Focus only on Python code
- Always explain the root cause
- Suggest fixes with code examples
- Be concise and direct
```

### `--append-sys-prompt` (Add to Default)

When provided, this **appends** content to the full default system prompt. The agent will still load:

- Default Autohand instructions
- AGENTS.md project instructions
- User/project memories
- Active skills

The appended content is added at the very end.

```bash
# Inline string
autohand --append-sys-prompt "Always use TypeScript instead of JavaScript" --prompt "Create a function"

# From file
autohand --append-sys-prompt ./team-guidelines.md --prompt "Add error handling"
```

**Example append file (`team-guidelines.md`):**

```
## Team Guidelines

- Use 2-space indentation
- Prefer functional patterns
- Add JSDoc comments to public APIs
- Run tests before committing
```

### Precedence

When both flags are provided:

1. `--sys-prompt` takes full precedence
2. `--append-sys-prompt` is ignored

```bash
# --append-sys-prompt is ignored in this case
autohand --sys-prompt "Custom only" --append-sys-prompt "This is ignored"
```

### Use Cases

| Use Case                          | Recommended Flag      |
| --------------------------------- | --------------------- |
| Custom agent persona              | `--sys-prompt`        |
| Minimal instructions              | `--sys-prompt`        |
| Add team guidelines               | `--append-sys-prompt` |
| Add project conventions           | `--append-sys-prompt` |
| Integration with external systems | `--sys-prompt`        |
| Specialized debugging             | `--sys-prompt`        |

### Error Handling

| Scenario          | Behavior                 |
| ----------------- | ------------------------ |
| Empty value       | Error                    |
| File not found    | Treated as inline string |
| Empty file        | Error                    |
| File > 1MB        | Error                    |
| Permission denied | Error                    |
| Directory path    | Error                    |

### Examples

```bash
# Python expert mode
autohand --sys-prompt "You are a Python expert. Only write Python code." \
  --prompt "Create a web scraper"

# TypeScript enforcement
autohand --append-sys-prompt "Always use TypeScript, never JavaScript." \
  --prompt "Create a REST API"

# CI/CD integration (non-interactive)
autohand --sys-prompt ./ci-prompt.txt \
  --prompt "Fix the failing tests" \
  --unrestricted \
  --patch

# Custom team workflow
autohand --append-sys-prompt ~/.company/coding-standards.md \
  --prompt "Refactor this module"
```

---

## Multi-Directory Support

Autohand can work with multiple directories beyond the main workspace. This is useful when your project has dependencies, shared libraries, or related projects in different directories.

### CLI Flag

Use `--add-dir` to add additional directories (can be used multiple times):

```bash
# Add a single additional directory
autohand --add-dir /path/to/shared-lib

# Add multiple directories
autohand --add-dir /path/to/lib1 --add-dir /path/to/lib2

# With unrestricted mode (auto-approve writes to all directories)
autohand --add-dir /path/to/shared-lib --unrestricted
```

### Interactive Command

Use `/add-dir` during an interactive session:

```
/add-dir              # Show current directories
/add-dir /path/to/dir # Add a new directory
```

### Safety Restrictions

The following directories cannot be added:

- Home directory (`~` or `$HOME`)
- Root directory (`/`)
- System directories (`/etc`, `/var`, `/usr`, `/bin`, `/sbin`)
- Windows system directories (`C:\Windows`, `C:\Program Files`)
- Windows user directories (`C:\Users\username`)
- WSL Windows mounts (`/mnt/c`, `/mnt/c/Windows`)
