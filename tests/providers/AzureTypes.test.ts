/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { ProviderName, AzureSettings, AzureAuthMethod, AutohandConfig } from '../../src/types';

describe('Azure types', () => {
  it('should accept "azure" as a valid ProviderName', () => {
    const name: ProviderName = 'azure';
    expect(name).toBe('azure');
  });

  it('should define AzureAuthMethod as union of api-key, entra-id, managed-identity', () => {
    const methods: AzureAuthMethod[] = ['api-key', 'entra-id', 'managed-identity'];
    expect(methods).toHaveLength(3);
  });

  it('should define AzureSettings with all required Azure fields', () => {
    const settings: AzureSettings = {
      model: 'gpt-4o',
      apiKey: 'test-key',
      resourceName: 'my-resource',
      deploymentName: 'gpt-4o',
      apiVersion: '2024-10-21',
      authMethod: 'api-key'
    };
    expect(settings.resourceName).toBe('my-resource');
    expect(settings.deploymentName).toBe('gpt-4o');
    expect(settings.apiVersion).toBe('2024-10-21');
    expect(settings.authMethod).toBe('api-key');
  });

  it('should allow AzureSettings with Entra ID fields', () => {
    const settings: AzureSettings = {
      model: 'gpt-4o',
      authMethod: 'entra-id',
      resourceName: 'my-resource',
      deploymentName: 'gpt-4o',
      tenantId: 'tenant-123',
      clientId: 'client-456',
      clientSecret: 'secret-789'
    };
    expect(settings.tenantId).toBe('tenant-123');
    expect(settings.clientId).toBe('client-456');
    expect(settings.clientSecret).toBe('secret-789');
  });

  it('should allow azure config in AutohandConfig', () => {
    const config: AutohandConfig = {
      provider: 'azure',
      azure: {
        model: 'gpt-4o',
        resourceName: 'test',
        deploymentName: 'gpt-4o',
        apiKey: 'key',
        authMethod: 'api-key'
      }
    };
    expect(config.provider).toBe('azure');
    expect(config.azure?.resourceName).toBe('test');
  });
});
