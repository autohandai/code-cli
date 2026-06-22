# Autohand LLM Providers Guide

Autohand supports multiple LLM providers, giving you flexibility to choose between cloud-hosted APIs and local inference options. This guide covers setup, configuration, and best practices for each provider.

## Table of Contents

- [Quick Start](#quick-start)
- [Provider Comparison](#provider-comparison)
- [Cloud Providers](#cloud-providers)
  - [OpenRouter](#openrouter)
  - [OpenAI](#openai)
  - [LLM Gateway](#llm-gateway)
  - [DeepSeek](#deepseek)
  - [AWS Bedrock](#aws-bedrock)
  - [Z.ai](#zai)
  - [Sakana.AI](#sakanaai)
  - [Custom OpenAI-Compatible Providers](#custom-openai-compatible-providers)
- [Local Providers](#local-providers)
  - [Ollama](#ollama)
  - [llama.cpp](#llamacpp)
  - [MLX (Apple Silicon)](#mlx-apple-silicon)
- [Switching Providers](#switching-providers)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

The fastest way to get started is with OpenRouter (the default provider):

```bash
# Run setup wizard
autohand --setup

# Or manually configure
cat > ~/.autohand/config.json << 'EOF'
{
  "provider": "openrouter",
  "openrouter": {
    "apiKey": "sk-or-v1-your-key-here",
    "model": "your-modelcard-id-here"
  }
}
EOF
```

---

## Provider Comparison

| Provider        | Type  | Cost        | Latency | Best For                                        |
| --------------- | ----- | ----------- | ------- | ----------------------------------------------- |
| **OpenRouter**  | Cloud | Pay-per-use | Low     | Access to 100+ models, recommended default      |
| **OpenAI**      | Cloud | Pay-per-use | Low     | Direct OpenAI access, GPT-5, o3 models          |
| **LLM Gateway** | Cloud | Pay-per-use | Low     | Unified API for multiple providers              |
| **DeepSeek**    | Cloud | Pay-per-use | Low     | DeepSeek V4 Flash and V4 Pro models             |
| **AWS Bedrock** | Cloud | Pay-per-use | Low     | Enterprise AWS credential-chain and Bedrock APIs |
| **Z.ai**        | Cloud | Pay-per-use | Low     | GLM-5.2/5.1 long-context models, CogView image generation |
| **Sakana.AI**   | Cloud | Pay-per-use | Medium  | Sakana Fugu multi-agent coding and reasoning models |
| **Custom**      | Cloud/local | Varies | Varies | Any OpenAI-compatible `/chat/completions` endpoint |
| **Ollama**      | Local | Free        | Medium  | Privacy-focused, offline work                   |
| **llama.cpp**   | Local | Free        | Low     | Performance-focused local inference             |
| **MLX**         | Local | Free        | Low     | Apple Silicon optimized                         |

---

## Cloud Providers

### OpenRouter

OpenRouter provides a unified API to access 100+ models from various providers (Anthropic via Azure Foundry Models, OpenAI, Google, Meta, etc.) with a single API key.

**Setup:**

1. Get your API key at [openrouter.ai/keys](https://openrouter.ai/keys)
2. Configure Autohand:

```json
{
  "provider": "openrouter",
  "openrouter": {
    "apiKey": "sk-or-v1-your-key-here",
    "model": "your-modelcard-id-here"
  }
}
```

**Popular Models:**
| Model | Description |
|-------|-------------|
| `your-modelcard-id-here` | Best balance of speed and capability |
| `anthropic/claude-5-opus` | Most capable Claude model |
| `openai/gpt-5` | OpenAI's flagship model |
| `google/gemini-3.0-pro` | Google's latest model |
| `meta-llama/llama-3.1-70b-instruct` | Open-source alternative |

**Switching Models:**

```
/model anthropic/claude-5-opus
```

---

### OpenAI

Direct access to OpenAI's API for GPT-5, o3, and other OpenAI models.

**Setup:**

1. Choose one of these authentication methods:
2. API key: get your key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
3. ChatGPT subscription: sign in through Autohand's built-in OpenAI device login flow when prompted
4. Configure Autohand:

```json
{
  "provider": "openai",
  "openai": {
    "authMode": "api-key",
    "apiKey": "sk-your-openai-key",
    "model": "gpt-5.4"
  }
}
```

Or use ChatGPT auth:

```json
{
  "provider": "openai",
  "openai": {
    "authMode": "chatgpt",
    "model": "gpt-5.4"
  }
}
```

**Available Models:**
| Model | Description |
|-------|-------------|
| `gpt-5` | Flagship multimodal model |
| `gpt-5-mini` | Faster, cheaper alternative |
| `gpt-4-turbo` | Previous generation flagship |
| `o1-preview` | Advanced reasoning model |
| `o1-mini` | Faster reasoning model |

---

### LLM Gateway

LLM Gateway provides a unified API for multiple LLM providers with a single integration point. It's OpenAI-compatible and supports models from OpenAI, Anthropic, Google, and more.

**Setup:**

1. Create an account at [llmgateway.io](https://llmgateway.io)
2. Get your API key from the [dashboard](https://llmgateway.io/dashboard)
3. Configure Autohand:

```json
{
  "provider": "llmgateway",
  "llmgateway": {
    "apiKey": "your-llmgateway-api-key",
    "model": "gpt-5"
  }
}
```

**Supported Models:**
| Model | Provider |
|-------|----------|
| `gpt-5` | OpenAI |
| `gpt-5-mini` | OpenAI |
| `gpt-4-turbo` | OpenAI |
| `claude-5-sonnet` | Anthropic |
| `claude-5-haiku` | Anthropic |
| `gemini-3.0-pro` | Google |
| `gemini-3.0-flash` | Google |

**Benefits:**

- Single API key for multiple providers
- Unified billing and usage tracking
- OpenAI-compatible API format
- Automatic failover between providers

**Example Usage:**

```bash
# Using with curl (for testing)
curl -X POST https://api.llmgateway.io/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -d '{
    "model": "gpt-5",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

---

### DeepSeek

DeepSeek provides an OpenAI-compatible chat completions API for DeepSeek V4 Flash, V4 Pro, and the legacy `deepseek-chat` / `deepseek-reasoner` model IDs.

**Setup:**

1. Get your API key at [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys)
2. Configure Autohand:

```json
{
  "provider": "deepseek",
  "deepseek": {
    "apiKey": "your-deepseek-api-key",
    "model": "deepseek-v4-flash"
  }
}
```

**Available Models:**

| Model                 | Description                                      |
| --------------------- | ------------------------------------------------ |
| `deepseek-v4-flash`   | Current fast V4 model, recommended default       |
| `deepseek-v4-pro`     | Current stronger V4 model                        |
| `deepseek-chat`       | Legacy non-thinking alias, deprecated 2026-07-24 |
| `deepseek-reasoner`   | Legacy thinking alias, deprecated 2026-07-24     |

**Example Usage:**

```bash
curl -X POST "https://api.deepseek.com/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -d '{
    "model": "deepseek-v4-flash",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

### AWS Bedrock

AWS Bedrock is available as `bedrock` for enterprise AWS customers. Autohand supports three inference modes:

| Mode | Choose When |
| --- | --- |
| `converse` | Default Bedrock-native mode using AWS credential-chain auth and Bedrock Runtime `Converse`. |
| `openai-chat` | You are migrating OpenAI Chat Completions clients to Bedrock OpenAI-compatible endpoints. |
| `openai-responses` | You are migrating OpenAI Responses clients to Bedrock OpenAI-compatible endpoints. |

For `converse`, configure AWS credentials outside Autohand. Autohand never stores AWS access key IDs or secret access keys. Good setup paths include:

```bash
aws configure sso
AWS_PROFILE=enterprise-prod autohand
```

IAM roles, container credentials, and instance metadata also work through the AWS SDK credential chain. Before using a model, enable access for that model in the AWS Bedrock console for the selected region.

**Converse with AWS profile:**

```json
{
  "provider": "bedrock",
  "bedrock": {
    "apiMode": "converse",
    "authMode": "aws-credentials",
    "profile": "enterprise-prod",
    "region": "us-east-1",
    "model": "anthropic.claude-3-5-sonnet-20241022-v2:0"
  }
}
```

**OpenAI Chat Completions with Bedrock API key:**

```yaml
provider: bedrock
bedrock:
  apiMode: openai-chat
  authMode: bedrock-api-key
  apiKey: bedrock-api-key
  region: us-east-1
  model: openai.gpt-oss-120b-1:0
```

**OpenAI Responses with Bedrock API key and private endpoint:**

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

Security note: Bedrock API keys are not OpenAI API keys. Never point Bedrock config at OpenAI base URLs.

**Troubleshooting:**

| Symptom | Fix |
| --- | --- |
| Missing AWS credentials | Run `aws configure sso`, set `AWS_PROFILE`, or run Autohand on AWS infrastructure with an IAM role. |
| Missing region | Set `bedrock.region`, `AWS_REGION`, or `AWS_DEFAULT_REGION`. |
| Invalid Bedrock API key | Use a Bedrock API key only with `openai-chat` or `openai-responses`. |
| Model access not enabled | Enable the model in the AWS Bedrock console for the selected region. |
| Model not available in region | Switch `region`, choose a regional model, or use an inference profile or ARN. |
| Unsupported API mode | Use `converse` for Bedrock-native models, or an OpenAI-compatible Bedrock model for OpenAI modes. |
| Throttling or quota | Wait and retry, or request a Bedrock quota increase. |
| Private endpoint/network failure | Check `endpoint`, VPC endpoint DNS, proxy, and AWS network policy. |

---

### Z.ai

Z.ai (Zhipu AI) provides access to the GLM family of models and CogView for image generation. The API is fully OpenAI-compatible.

**Setup:**

1. Get your API key at [platform.z.ai](https://platform.z.ai/keys)
2. Configure Autohand:

```json
{
  "provider": "zai",
  "zai": {
    "apiKey": "your-zai-api-key",
    "model": "glm-5.2"
  }
}
```

**Popular Models:**

| Model              | Description                                                                     |
| ------------------ | ------------------------------------------------------------------------------- |
| `glm-5.2`          | Latest flagship GLM model for project-scale coding, 1M context, 128K max output |
| `glm-5.1`          | Flagship long-horizon model, 200K context, 128K max output                      |
| `glm-4.5`          | Previous-generation GLM model, strong reasoning                                 |
| `glm-4.5v`         | Vision-language model                                                           |
| `glm-4.5-air`      | Faster, lighter variant                                                         |
| `glm-4.5-prior`    | Priority access variant                                                         |
| `glm-4.5-flash`    | Low-latency model                                                               |
| `glm-4.5-air-2504` | April 2025 Air variant                                                          |
| `cogview-4.5`      | Image generation model                                                          |

GLM-5.2 and GLM-5.1 both support thinking mode, streaming output, function calling, context caching, structured output, and MCP.

**Example Usage:**

```bash
# Test with curl
curl -X POST "https://api.z.ai/api/paas/v4/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ZAI_API_KEY" \
  -d '{
    "model": "glm-5.2",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

### Sakana.AI

Sakana.AI provides Sakana Fugu through an OpenAI-compatible API. Fugu is a multi-agent system, but Autohand uses it like a standard hosted LLM through the Sakana API.

**Setup:**

1. Create a Sakana API key and store it securely.
2. Configure Autohand:

```json
{
  "provider": "sakana",
  "sakana": {
    "apiKey": "your-sakana-api-key",
    "baseUrl": "https://api.sakana.ai/v1",
    "model": "fugu"
  }
}
```

**Supported Models:**

| Model        | Description                                       |
| ------------ | ------------------------------------------------- |
| `fugu`       | Default Sakana Fugu model with provider routing   |
| `fugu-ultra` | Stronger Fugu model for complex, long-running work |

For complex `fugu-ultra` tasks, consider increasing the global network timeout in your Autohand config.

**Example Usage:**

```bash
export SAKANA_API_KEY=your-key

curl -X POST "https://api.sakana.ai/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SAKANA_API_KEY" \
  -d '{
    "model": "fugu",
    "messages": [{"role": "user", "content": "How many r are in strawberry?"}]
  }'
```

---

## Local Providers

### Ollama

Ollama makes it easy to run open-source LLMs locally. Great for privacy-conscious users or offline work.

**Setup:**

1. Install Ollama: [ollama.ai](https://ollama.ai)
2. Pull a model:
   ```bash
   ollama pull llama3.2
   ```
3. Configure Autohand:

```json
{
  "provider": "ollama",
  "ollama": {
    "model": "llama3.2"
  }
}
```

**Recommended Models:**
| Model | Size | Description |
|-------|------|-------------|
| `llama3.2` | 3B | Fast, good for simple tasks |
| `llama3.2:70b` | 70B | High quality, needs 64GB+ RAM |
| `codellama` | 7B-34B | Optimized for code |
| `mistral` | 7B | Good balance |
| `mixtral` | 47B | High quality mixture-of-experts |

**Custom Ollama Server:**

```json
{
  "provider": "ollama",
  "ollama": {
    "baseUrl": "http://192.168.1.100:11434",
    "model": "llama3.2"
  }
}
```

---

### llama.cpp

llama.cpp provides high-performance local inference with GGUF models.

**Setup:**

1. Build and run llama.cpp server:
   ```bash
   git clone https://github.com/ggerganov/llama.cpp
   cd llama.cpp
   make
   ./llama-server -m /path/to/model.gguf
   ```
2. Configure Autohand:

```json
{
  "provider": "llamacpp",
  "llamacpp": {
    "baseUrl": "http://localhost:8080",
    "model": "default"
  }
}
```

**Finding GGUF Models:**

- [Hugging Face GGUF Models](https://huggingface.co/models?search=gguf)
- Popular: `TheBloke/Llama-2-7B-GGUF`, `TheBloke/CodeLlama-13B-GGUF`

---

### MLX (Apple Silicon)

MLX is optimized for Apple Silicon Macs, providing fast local inference.

**Requirements:**

- macOS with Apple Silicon (M1/M2/M3)
- Python 3.10+

**Setup:**

1. Install MLX:
   ```bash
   pip install mlx-lm
   ```
2. Run the server:
   ```bash
   mlx_lm.server --model mlx-community/Llama-3.2-3B-Instruct-4bit
   ```
3. Configure Autohand:

```json
{
  "provider": "mlx",
  "mlx": {
    "model": "mlx-community/Llama-3.2-3B-Instruct-4bit"
  }
}
```

**Recommended Models:**
| Model | RAM | Description |
|-------|-----|-------------|
| `mlx-community/Llama-3.2-3B-Instruct-4bit` | 4GB | Fast, good for simple tasks |
| `mlx-community/Llama-3.2-8B-Instruct-4bit` | 8GB | Better quality |
| `mlx-community/Mistral-7B-Instruct-v0.2-4bit` | 8GB | Good balance |

---

## Switching Providers

### Interactive Mode

Use the `/model` command to switch providers or models:

```
/model                           # List available models
/model gpt-5                     # Switch to GPT-5
/model anthropic/claude-5-opus   # Switch to Claude Opus
```

When you pick `openai`, Autohand now lets you choose between `API key` and `ChatGPT account` authentication.

### CLI Flag

Override the default provider for a single session:

```bash
autohand --model gpt-5
```

### Editing Config

Update `~/.autohand/config.json`:

```json
{
  "provider": "llmgateway",
  "llmgateway": {
    "apiKey": "your-key",
    "model": "claude-5-sonnet"
  }
}
```

---

## Troubleshooting

### Authentication Errors

**Symptom:** "Authentication failed" or "Invalid API key"

**Solutions:**

1. Verify your API key is correct in the config
2. Check the key hasn't expired
3. Ensure you have credits/quota remaining

### Connection Errors

**Symptom:** "Unable to connect" or timeout errors

**Solutions:**

1. Check internet connection
2. Verify the base URL is correct
3. For local providers, ensure the server is running
4. Check firewall settings

### Model Not Found

**Symptom:** "Model not found" error

**Solutions:**

1. Verify the model name is spelled correctly
2. Check if you have access to the model (some require approval)
3. For local providers, ensure the model is downloaded

### Rate Limiting

**Symptom:** "Rate limit exceeded" errors

**Solutions:**

1. Wait and retry
2. Use a different model
3. Upgrade your API plan
4. Configure retry settings:

```json
{
  "network": {
    "maxRetries": 3,
    "retryDelay": 2000
  }
}
```

### Local Provider Performance

**Symptom:** Slow responses from local models

**Solutions:**

1. Use a smaller model (e.g., 7B instead of 70B)
2. Use quantized models (Q4, Q5, Q8)
3. Ensure you have sufficient RAM
4. For MLX, ensure you're on Apple Silicon
5. Close other memory-intensive applications

---

### Custom OpenAI-Compatible Providers

Use custom providers when a service exposes an OpenAI-compatible API but is not bundled into Autohand. This keeps the built-in provider list small while still supporting team gateways, private deployments, and new hosted providers.

From the TUI, run `/model`, choose **New provider...**, then enter:

- provider display name
- OpenAI-compatible base URL
- whether an API key is required
- model id
- optional context window and reasoning effort

Autohand verifies the base URL, API key, and selected model through the OpenAI-compatible `/models` endpoint before saving the provider. If `/models` returns model IDs, the selected model must be present in that list.

The saved config uses `provider: "custom:<id>"` and stores provider details under `customProviders`:

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
      "reasoningEffort": "high"
    }
  }
}
```

For local gateways without bearer auth:

```json
{
  "provider": "custom:local-openai",
  "customProviders": {
    "local-openai": {
      "id": "local-openai",
      "displayName": "Local OpenAI Proxy",
      "apiFormat": "openai-compatible",
      "baseUrl": "http://localhost:8080/v1",
      "apiKeyRequired": false,
      "model": "local-code-model",
      "contextWindow": 131072
    }
  }
}
```

Custom provider telemetry and session sync include the provider id, display name, API format, model id, reasoning effort, and context window when available. Secrets such as `apiKey` are not sent. When `reasoningEffort` is set, Autohand sends it to the provider as `reasoning_effort`.

You can remove a custom provider from `/model` by opening that provider's settings and choosing **Remove custom provider**.

---

## Environment Variables

Override config settings with environment variables:

```bash
# Set API keys
export OPENROUTER_API_KEY=sk-or-v1-xxx
export OPENAI_API_KEY=sk-xxx
export LLM_GATEWAY_API_KEY=your-key

# Override provider for session
AUTOHAND_PROVIDER=ollama autohand
```

---

## Network Configuration

All cloud providers support custom network settings:

```json
{
  "network": {
    "maxRetries": 3,
    "timeout": 30000,
    "retryDelay": 1000
  }
}
```

| Setting      | Default | Description                      |
| ------------ | ------- | -------------------------------- |
| `maxRetries` | 3       | Max retry attempts (capped at 5) |
| `timeout`    | 30000   | Request timeout in ms            |
| `retryDelay` | 1000    | Base delay between retries       |

Retries use exponential backoff: `retryDelay * 2^attempt`
