# Autohand AI models

## Hosted models

Hosted models share your plan's credit allowance, rate limits, and token budgets. Switching models does not reset usage or create a separate allowance. Team and Enterprise usage counts against the authenticated member's quota. BYOK requests use the external provider's billing.

| Model ID | Label | Context tokens |
| --- | --- | --- |
| fantail | Fantail | 262,144 |
| moa | Moa | 1,048,576 |
| gpt-5.6-luna | GPT-5.6 Luna | 1,050,000 |
| deepseek-v4-flash | DeepSeek V4 Flash | 1,048,576 |
| gpt-6-sol | GPT-6 Sol | 1,050,000 |
| grok-4.7 | Grok 4.7 | 500,000 |
| qwen3.8-27b | qwen3.8-27b | 262,144 |
| weka | Weka (decisions API) | 32,000 |

## Access by plan

| Plan | Included models |
| --- | --- |
| Free | Fantail |
| Lite | Fantail, GPT-5.6 Luna, DeepSeek V4 Flash, Weka (API/Console) |
| Pro | Fantail, GPT-5.6 Luna, DeepSeek V4 Flash, Weka (API/Console), Moa, GPT-6 Sol |
| Pro+ | Fantail, GPT-5.6 Luna, DeepSeek V4 Flash, Weka (API/Console), Moa, GPT-6 Sol, Grok 4.7, qwen3.8-27b |
| Max | Fantail, GPT-5.6 Luna, DeepSeek V4 Flash, Weka (API/Console), Moa, GPT-6 Sol, Grok 4.7, qwen3.8-27b |
| Team | Fantail, GPT-5.6 Luna, DeepSeek V4 Flash, Weka (API/Console), Moa, GPT-6 Sol, Grok 4.7, qwen3.8-27b |
| Enterprise | Fantail, GPT-5.6 Luna, DeepSeek V4 Flash, Weka (API/Console), Moa, GPT-6 Sol, Grok 4.7, qwen3.8-27b |

## Selecting a model

Select the Autohand AI provider, sign in or configure an Autohand API key, then run /model. The picker loads models allowed by your account. The authenticated GET /v1/models endpoint returns the same plan-filtered catalog. Weka uses /v1/decisions and is not available in CLI chat.

Use gpt-6-sol for openai/gpt-6-sol, grok-4.7 for xai/grok-4.7, and qwen3.8-27b for @cf/qwen/qwen3.8-27b. Provider-qualified names are also accepted. Auto selects within your existing entitlement.

```text
/model
```

Flux-2 image generation uses `/v1/images/generations` and a separate image allowance.
