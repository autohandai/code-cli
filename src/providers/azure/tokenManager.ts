/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AzureAuthMethod } from '../../types.js';

const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes
const IMDS_ENDPOINT = 'http://169.254.169.254/metadata/identity/oauth2/token';
const COGNITIVE_SCOPE = 'https://cognitiveservices.azure.com/.default';

interface TokenRequest {
  authMethod: AzureAuthMethod;
  apiKey?: string;
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

export class AzureTokenManager {
  private cache: CachedToken | null = null;

  async getToken(request: TokenRequest): Promise<string> {
    if (request.authMethod === 'api-key') {
      if (!request.apiKey) {
        throw new Error('API key is required for api-key authentication.');
      }
      return request.apiKey;
    }

    if (this.cache && !this.isTokenExpired()) {
      return this.cache.token;
    }

    if (request.authMethod === 'entra-id') {
      return this.acquireEntraIdToken(request);
    }

    if (request.authMethod === 'managed-identity') {
      return this.acquireManagedIdentityToken();
    }

    throw new Error(`Unsupported auth method: ${request.authMethod}`);
  }

  async getAuthHeaders(request: TokenRequest): Promise<Record<string, string>> {
    if (request.authMethod === 'api-key') {
      const key = await this.getToken(request);
      return { 'api-key': key };
    }

    const token = await this.getToken(request);
    return { Authorization: `Bearer ${token}` };
  }

  private async acquireEntraIdToken(request: TokenRequest): Promise<string> {
    if (!request.tenantId) {
      throw new Error('tenantId is required for Entra ID authentication.');
    }
    if (!request.clientId) {
      throw new Error('clientId is required for Entra ID authentication.');
    }
    if (!request.clientSecret) {
      throw new Error('clientSecret is required for Entra ID authentication.');
    }

    const url = `https://login.microsoftonline.com/${request.tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: request.clientId,
      client_secret: request.clientSecret,
      scope: COGNITIVE_SCOPE
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as Record<string, string>;
      const description = error.error_description || error.error || `HTTP ${response.status}`;
      throw new Error(`Entra ID authentication failed: ${description}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    this.cacheToken(data.access_token, data.expires_in);
    return data.access_token;
  }

  private async acquireManagedIdentityToken(): Promise<string> {
    const url = `${IMDS_ENDPOINT}?api-version=2018-02-01&resource=https://cognitiveservices.azure.com`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Metadata: 'true' }
      });
    } catch {
      throw new Error(
        'Managed Identity token acquisition failed. ' +
        'This auth method only works inside Azure VMs, App Service, or containers with managed identity enabled.'
      );
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as Record<string, string>;
      throw new Error(
        `Managed Identity token error (${response.status}): ${error.error_description || error.error || 'Unknown'}`
      );
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    this.cacheToken(data.access_token, data.expires_in);
    return data.access_token;
  }

  private cacheToken(token: string, expiresInSeconds: number): void {
    this.cache = {
      token,
      expiresAt: Date.now() + (expiresInSeconds * 1000)
    };
  }

  private isTokenExpired(): boolean {
    if (!this.cache) return true;
    return Date.now() >= this.cache.expiresAt - EXPIRY_BUFFER_MS;
  }
}
