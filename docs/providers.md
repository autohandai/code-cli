# Autohand LLM Providers Guide

Autohand supports multiple LLM providers, giving you flexibility to choose between cloud-hosted APIs and local inference options. This guide covers setup, configuration, and best practices for each provider.

## Table of Contents

- [Quick Start](#quick-start)
- [Provider Comparison](#provider-comparison)
- [Cloud Providers](#cloud-providers)
  - [OpenRouter](#openrouter)
  - [OpenAI](#openai)
  - [LLM Gateway](#llm-gateway)
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
    "model": "anthropic/claude-sonnet-4"
  }
}
EOF
```

---

## Provider Comparison

| Provider | Type | Cost | Latency | Best For |
|----------|------|------|---------|----------|
| **OpenRouter** | Cloud | Pay-per-use | Low | Access to 100+ models, recommended default |
| **OpenAI** | Cloud | Pay-per-use | Low | Direct OpenAI access, GPT-4o, o1 models |
| **LLM Gateway** | Cloud | Pay-per-use | Low | Unified API for multiple providers |
| **Ollama** | Local | Free | Medium | Privacy-focused, offline work |
| **llama.cpp** | Local | Free | Low | Performance-focused local inference |
| **MLX** | Local | Free | Low | Apple Silicon optimized |

---

## Cloud Providers

### OpenRouter

OpenRouter provides a unified API to access 100+ models from various providers (Anthropic, OpenAI, Google, Meta, etc.) with a single API key.

**Setup:**

1. Get your API key at [openrouter.ai/keys](https://openrouter.ai/keys)
2. Configure Autohand:

```json
{
  "provider": "openrouter",
  "openrouter": {
    "apiKey": "sk-or-v1-your-key-here",
    "model": "anthropic/claude-sonnet-4"
  }
}
```

**Popular Models:**
| Model | Description |
|-------|-------------|
| `anthropic/claude-sonnet-4` | Best balance of speed and capability |
| `anthropic/claude-3-opus` | Most capable Claude model |
| `openai/gpt-4o` | OpenAI's flagship model |
| `google/gemini-pro-1.5` | Google's latest model |
| `meta-llama/llama-3.1-70b-instruct` | Open-source alternative |

**Switching Models:**
```
/model anthropic/claude-3-opus
```

---

### OpenAI

Direct access to OpenAI's API for GPT-4o, o1, and other OpenAI models.

**Setup:**

1. Get your API key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Configure Autohand:

```json
{
  "provider": "openai",
  "openai": {
    "apiKey": "sk-your-openai-key",
    "model": "gpt-4o"
  }
}
```

**Available Models:**
| Model | Description |
|-------|-------------|
| `gpt-4o` | Flagship multimodal model |
| `gpt-4o-mini` | Faster, cheaper alternative |
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
    "model": "gpt-4o"
  }
}
```

**Supported Models:**
| Model | Provider |
|-------|----------|
| `gpt-4o` | OpenAI |
| `gpt-4o-mini` | OpenAI |
| `gpt-4-turbo` | OpenAI |
| `claude-3-5-sonnet-20241022` | Anthropic |
| `claude-3-5-haiku-20241022` | Anthropic |
| `gemini-1.5-pro` | Google |
| `gemini-1.5-flash` | Google |

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
    "model": "gpt-4o",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
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
/model gpt-4o                    # Switch to GPT-4o
/model anthropic/claude-3-opus   # Switch to Claude Opus
```

### CLI Flag

Override the default provider for a single session:

```bash
autohand --model gpt-4o
```

### Editing Config

Update `~/.autohand/config.json`:

```json
{
  "provider": "llmgateway",
  "llmgateway": {
    "apiKey": "your-key",
    "model": "claude-3-5-sonnet-20241022"
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

| Setting | Default | Description |
|---------|---------|-------------|
| `maxRetries` | 3 | Max retry attempts (capped at 5) |
| `timeout` | 30000 | Request timeout in ms |
| `retryDelay` | 1000 | Base delay between retries |

Retries use exponential backoff: `retryDelay * 2^attempt`
