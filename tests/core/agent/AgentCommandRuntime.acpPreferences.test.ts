import { describe, expect, it, vi } from "vitest";
import { applyAgentAcpConfigOption } from "../../../src/core/agent/AgentCommandRuntime.js";
describe("Autohand ACP effort", () => {
  it("updates the live provider while isolating the session from the shared config", () => {
    const config = {provider:"autohandai",autohandai:{plan:"cloud",model:"moa",reasoningEffort:"high"}};
    const setReasoningEffort=vi.fn();
    const host={runtime:{config},llm:{setReasoningEffort}};
    applyAgentAcpConfigOption(host,"reasoning_effort","xhigh");
    expect(setReasoningEffort).toHaveBeenCalledWith("xhigh");
    expect(host.runtime.config.autohandai.reasoningEffort).toBe("xhigh");
    expect(config.autohandai.reasoningEffort).toBe("high");
    applyAgentAcpConfigOption(host,"reasoning_effort","invalid");
    expect(setReasoningEffort).toHaveBeenCalledTimes(1);
  });
});
