/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { getProviderConfig } from "../../src/config.js";
import { getFeatureState } from "../../src/features/featureRegistry.js";
import { ProviderFactory } from "../../src/providers/ProviderFactory.js";
import type { AutohandConfig, LoadedConfig } from "../../src/types.js";

describe("Bedrock provider config", () => {
  it("registers bedrock as a valid first-class provider", () => {
    expect(ProviderFactory.isValidProvider("bedrock")).toBe(true);
    expect(ProviderFactory.getProviderNames()).toContain("bedrock");
  });

  it("creates a BedrockProvider when bedrock is configured", () => {
    const provider = ProviderFactory.create({
      provider: "bedrock",
      bedrock: {
        model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
        region: "us-east-1",
      },
    });

    expect(provider.getName()).toBe("bedrock");
  });

  it("returns an unconfigured provider when bedrock config is missing", () => {
    const provider = ProviderFactory.create({ provider: "bedrock" });
    expect(provider.getName()).toBe("unconfigured");
  });

  it("normalizes converse defaults without requiring stored AWS access keys", () => {
    const result = getProviderConfig({
      provider: "bedrock",
      bedrock: {
        model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
        region: "us-west-2",
        profile: "enterprise-prod",
      },
    });

    expect(result).toMatchObject({
      model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      region: "us-west-2",
      profile: "enterprise-prod",
      apiMode: "converse",
      authMode: "aws-credentials",
      endpoint: "https://bedrock-runtime.us-west-2.amazonaws.com",
    });
    expect(result).not.toHaveProperty("accessKeyId");
    expect(result).not.toHaveProperty("secretAccessKey");
  });

  it("requires a Bedrock API key for OpenAI-compatible modes", () => {
    const config: AutohandConfig = {
      provider: "bedrock",
      bedrock: {
        model: "openai.gpt-oss-120b-1:0",
        region: "us-east-1",
        apiMode: "openai-chat",
        authMode: "bedrock-api-key",
      },
    };

    expect(getProviderConfig(config)).toBeNull();

    config.bedrock!.apiKey = "bedrock-api-key";
    expect(getProviderConfig(config)).toMatchObject({
      apiMode: "openai-chat",
      authMode: "bedrock-api-key",
      endpoint: "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1",
    });
  });

  it("keeps the aws_bedrock_provider feature enabled by default", () => {
    const config: LoadedConfig = {
      configPath: "/tmp/autohand-config.json",
      provider: "openrouter",
    };

    expect(getFeatureState(config, "aws_bedrock_provider")?.enabled).toBe(true);
  });
});
