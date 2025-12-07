# Multi-Provider LLM Support

## 1. Overview
Extend Autohand CLI to support multiple LLM providers beyond OpenRouter, including Ollama (local), llama.cpp (local), and OpenAI (cloud). Users can switch between providers and models seamlessly.

## 2. Objectives
- Support 4 providers: OpenRouter, Ollama, llama.cpp, OpenAI
- Auto-detect available local models (Ollama, llama.cpp)
- Unified configuration in `~/.autohand-cli/config.json`
- Seamless provider switching via `/model` command
- Provider-specific optimizations (streaming, context windows, etc.)

## 3. Providers

### 3.1. OpenRouter (Cloud)
- **Base URL**: `https://openrouter.ai/api/v1`
- **Auth**: API key required
- **Models**: User specifies model ID (e.g., `anthropic/claude-3.5-sonnet`)
- **Features**: Wide model selection, unified API

### 3.2. Ollama (Local)
- **Base URL**: `http://localhost:11434` (configurable port)
- **Auth**: None (local)
- **Models**: Auto-fetched from `/api/tags` endpoint
- **Features**: Free, private, local execution
- **Model Format**: `llama3.2:latest`, `mistral:7b`, etc.

### 3.3. llama.cpp (Local)
- **Base URL**: `http://localhost:8080` (configurable port)
- **Auth**: None (local)
- **Models**: Single model per server instance
- **Features**: Fastest local inference, low memory

### 3.4. OpenAI (Cloud)
- **Base URL**: `https://api.openai.com/v1`
- **Auth**: API key required
- **Models**: `gpt-4o`, `gpt-4-turbo`, `gpt-3.5-turbo`, etc.
- **Features**: Official OpenAI models, function calling

## 4. Configuration Schema

### config.json Structure
```json
{
  "provider": "ollama",
  "openrouter": {
    "apiKey": "sk-or-...",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "anthropic/claude-3.5-sonnet"
  },
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "model": "llama3.2:latest"
  },
  "llamacpp": {
    "baseUrl": "http://localhost:8080",
    "port": 8080,
    "model": "llama-3-8b"
  },
  "openai": {
    "apiKey": "sk-...",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-4o"
  }
}
```

## 5. Architecture

### 5.1. Provider Interface
All providers implement a common interface:

```typescript
interface LLMProvider {
  name: string;
  complete(request: LLMRequest): Promise<LLMResponse>;
  listModels(): Promise<string[]>;
  isAvailable(): Promise<boolean>;
}
```

### 5.2. Provider Factory
```typescript
class ProviderFactory {
  static create(config: AutohandConfig): LLMProvider;
}
```

### 5.3. Ollama API Integration
**List Models Endpoint:**
```bash
GET http://localhost:11434/api/tags
```

**Response:**
```json
{
  "models": [
    {
      "name": "llama3.2:latest",
      "modified_at": "2024-11-21T10:30:00Z",
      "size": 4661212864
    }
  ]
}
```

## 6. User Workflows

### 6.1. First-Time Setup
```bash
autohand
# Prompts: Which provider? openrouter/ollama/llamacpp/openai
# - If openrouter/openai: Ask for API key
# - If ollama: Check if running, list models
# - If llamacpp: Ask for port, detect model
```

### 6.2. Switch Provider
```bash
autohand
> /model
# Shows current provider
# Prompt: Change provider? (y/n)
# If yes: Select new provider → Select model
```

### 6.3. Switch Model (Same Provider)
```bash
autohand
> /model
# Keep provider: ollama
# Select from available models:
# 1. llama3.2:latest
# 2. mistral:7b
# 3. codellama:13b
```

## 7. Implementation Plan

### Phase 1: Provider Abstraction (TDD)
1. Write tests for `LLMProvider` interface
2. Implement `OpenRouterProvider` (existing)
3. Implement `OllamaProvider`
4. Implement `LlamaCppProvider`
5. Implement `OpenAIProvider`

### Phase 2: Configuration
1. Update `config.ts` to handle multi-provider
2. Implement `ProviderFactory`
3. Add provider validation

### Phase 3: Model Selection UI
1. Update `/model` command
2. Add provider selection prompt
3. Add model listing per provider
4. Handle Ollama model fetching

### Phase 4: Testing
1. Unit tests for each provider
2. Integration tests for provider switching
3. Mock Ollama API responses

## 8. Error Handling

### Ollama Not Running
```
❌ Ollama is not running.
Start it with: ollama serve
Or choose a different provider.
```

### llama.cpp Not Available
```
❌ llama.cpp server not found at http://localhost:8080
Start it with: ./server -m model.gguf
Or change the port in config.
```

### Invalid API Key
```
❌ OpenRouter API key is invalid.
Get a key at: https://openrouter.ai/keys
```

## 9. Testing Strategy

### Unit Tests
- Each provider's model listing
- API request formatting
- Error handling

### Integration Tests
- Provider switching
- Model selection flow
- Configuration persistence

### Mock Data
- Ollama `/api/tags` response
- OpenRouter model list
- Error responses

## 10. Future Enhancements
- Auto-detect Ollama installation
- Model download from within CLI (Ollama)
- Performance metrics per provider
- Cost tracking (cloud providers)
- Custom provider plugins
