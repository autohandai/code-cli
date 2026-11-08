import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIProvider } from "../../src/providers/OpenAIProvider.js";
import { AzureProvider } from "../../src/providers/AzureProvider.js";
import { OpenRouterProvider } from "../../src/providers/OpenRouterProvider.js";
import { limitToolSelection } from "../../src/core/toolFilter.js";
import type { LLMProvider } from "../../src/providers/LLMProvider.js";

const tools = Array.from({ length: 140 }, (_, i) => ({ name: `fixture_${i}`, description: "Fixture tool", parameters: { type: "object", properties: {} } }));
const providers: [string, () => LLMProvider][] = [
  ["openai", () => new OpenAIProvider({ model: "gpt-6.1-terra", apiKey: "fixture" })],
  ["azure", () => new AzureProvider({ model: "gpt-5.3-codex", apiKey: "fixture", resourceName: "fixture", deploymentName: "fixture" })],
  ["openrouter", () => new OpenRouterProvider({ model: "openai/gpt-6.1-terra", apiKey: "fixture" })],
];
afterEach(() => vi.restoreAllMocks());
describe("OpenAI-family tool limits", () => {
  it.each(providers)("sends 128 of 140 native tools through %s", async (_name, create) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "fixture", choices: [{ message: { content: "Done" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { headers: { "Content-Type": "application/json" } }));
    const provider = create();
    const messages = [{ role: "user" as const, content: "Read the project" }];
    const selected = limitToolSelection(tools, tools, messages, provider.getCapabilities?.().maxTools);
    await provider.complete({ messages, tools: selected, stream: false });
    const init = fetchSpy.mock.calls[0][1];
    const payload = JSON.parse(String(init?.body));
    expect(payload.tools).toHaveLength(128);
  });
  it("changes the OpenRouter limit with the model and leaves other vendors uncapped", () => {
    const provider = new OpenRouterProvider({ model: "anthropic/claude-sonnet-5", apiKey: "fixture" });
    expect(provider.getCapabilities().maxTools).toBeUndefined();
    provider.setModel("openai/gpt-6.1-terra");
    expect(provider.getCapabilities().maxTools).toBe(128);
    provider.setModel("anthropic/claude-sonnet-5");
    expect(provider.getCapabilities().maxTools).toBeUndefined();
  });
});
