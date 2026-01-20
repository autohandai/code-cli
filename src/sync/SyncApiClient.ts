/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sync API Client for communicating with Cloudflare R2 via API
 */
import type { SyncManifest, SyncApiConfig, SyncApiResponse, SyncResult } from './types.js';

const DEFAULT_BASE_URL = 'https://api.autohand.ai';
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const DEFAULT_MAX_TOTAL_SIZE = 100 * 1024 * 1024; // 100MB
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000; // 1 second base delay
const MAX_FILES_PER_REQUEST = 100; // API limit for files array

export class SyncApiClient {
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxFileSize: number;
  private readonly maxTotalSize: number;
  private readonly maxRetries: number;
  private readonly retryDelay: number;

  constructor(config?: SyncApiConfig) {
    this.baseUrl = config?.baseUrl || DEFAULT_BASE_URL;
    this.timeout = config?.timeout || DEFAULT_TIMEOUT;
    this.maxFileSize = config?.maxFileSize || DEFAULT_MAX_FILE_SIZE;
    this.maxTotalSize = config?.maxTotalSize || DEFAULT_MAX_TOTAL_SIZE;
    this.maxRetries = config?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelay = config?.retryDelay ?? DEFAULT_RETRY_DELAY;
  }

  /**
   * Execute a fetch request with retry logic and rate limit handling
   */
  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    timeoutMs: number = this.timeout
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Handle rate limiting (429)
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : this.retryDelay * Math.pow(2, attempt);

          if (attempt < this.maxRetries - 1) {
            await this.sleep(waitTime);
            continue;
          }
          throw new Error('Rate limited: too many requests');
        }

        // Handle server errors with retry (500, 502, 503, 504)
        if (response.status >= 500 && attempt < this.maxRetries - 1) {
          await this.sleep(this.retryDelay * Math.pow(2, attempt));
          continue;
        }

        return response;
      } catch (error) {
        clearTimeout(timeoutId);
        lastError = error as Error;

        // Don't retry on abort (timeout)
        if ((error as Error).name === 'AbortError') {
          throw new Error('Request timeout');
        }

        // Retry on network errors
        if (attempt < this.maxRetries - 1) {
          await this.sleep(this.retryDelay * Math.pow(2, attempt));
          continue;
        }
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  /**
   * Sleep for a specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get the remote sync manifest for a user
   * Returns null if no sync data exists
   */
  async getRemoteManifest(token: string): Promise<SyncManifest | null> {
    const response = await this.fetchWithRetry(
      `${this.baseUrl}/v1/sync/manifest`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.status === 404) {
      return null; // No sync data yet
    }

    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error');
      throw new Error(`API error: ${response.status} ${error}`);
    }

    const data = (await response.json()) as SyncApiResponse;
    return data.manifest || null;
  }

  /**
   * Upload sync manifest and request pre-signed URLs for file uploads
   * Batches requests to stay within API limits (max 100 files per request)
   */
  async initiateUpload(
    token: string,
    manifest: SyncManifest,
    filePaths: string[]
  ): Promise<{ uploadUrls: Record<string, string> }> {
    // Batch files into chunks of MAX_FILES_PER_REQUEST
    const batches: string[][] = [];
    for (let i = 0; i < filePaths.length; i += MAX_FILES_PER_REQUEST) {
      batches.push(filePaths.slice(i, i + MAX_FILES_PER_REQUEST));
    }

    // Make requests for each batch and merge results
    const allUploadUrls: Record<string, string> = {};

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const response = await this.fetchWithRetry(
        `${this.baseUrl}/v1/sync/upload`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            // Only include manifest on first batch
            ...(batchIndex === 0 ? { manifest } : {}),
            files: batch,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text().catch(() => 'Unknown error');
        throw new Error(`API error: ${response.status} ${error}`);
      }

      const data = (await response.json()) as SyncApiResponse;
      const batchUrls = data.uploadUrls || {};

      // Merge batch URLs into result
      Object.assign(allUploadUrls, batchUrls);
    }

    return {
      uploadUrls: allUploadUrls,
    };
  }

  /**
   * Upload a file to a pre-signed URL
   */
  async uploadFile(uploadUrl: string, content: Buffer): Promise<void> {
    if (content.length > this.maxFileSize) {
      throw new Error(`File exceeds max size of ${this.maxFileSize} bytes`);
    }

    const response = await this.fetchWithRetry(
      uploadUrl,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': content.length.toString(),
        },
        body: new Uint8Array(content),
      }
    );

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }
  }

  /**
   * Complete the upload and finalize the manifest
   */
  async completeUpload(token: string, manifest: SyncManifest): Promise<SyncResult> {
    try {
      const response = await this.fetchWithRetry(
        `${this.baseUrl}/v1/sync/complete`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ manifest }),
        }
      );

      if (!response.ok) {
        const error = await response.text().catch(() => 'Unknown error');
        return {
          success: false,
          uploaded: 0,
          downloaded: 0,
          conflicts: 0,
          error: `API error: ${response.status} ${error}`,
        };
      }

      return {
        success: true,
        uploaded: manifest.files.length,
        downloaded: 0,
        conflicts: 0,
      };
    } catch (error) {
      return {
        success: false,
        uploaded: 0,
        downloaded: 0,
        conflicts: 0,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Request pre-signed URLs for file downloads
   * Batches requests to stay within API limits (max 100 files per request)
   */
  async initiateDownload(token: string, filePaths: string[]): Promise<{ downloadUrls: Record<string, string> }> {
    // Batch files into chunks of MAX_FILES_PER_REQUEST
    const batches: string[][] = [];
    for (let i = 0; i < filePaths.length; i += MAX_FILES_PER_REQUEST) {
      batches.push(filePaths.slice(i, i + MAX_FILES_PER_REQUEST));
    }

    // Make requests for each batch and merge results
    const allDownloadUrls: Record<string, string> = {};

    for (const batch of batches) {
      const response = await this.fetchWithRetry(
        `${this.baseUrl}/v1/sync/download`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ files: batch }),
        }
      );

      if (!response.ok) {
        const error = await response.text().catch(() => 'Unknown error');
        throw new Error(`API error: ${response.status} ${error}`);
      }

      const data = (await response.json()) as SyncApiResponse;
      const batchUrls = data.downloadUrls || {};

      // Merge batch URLs into result
      Object.assign(allDownloadUrls, batchUrls);
    }

    return {
      downloadUrls: allDownloadUrls,
    };
  }

  /**
   * Download a file from a pre-signed URL
   */
  async downloadFile(downloadUrl: string): Promise<Buffer> {
    const response = await this.fetchWithRetry(
      downloadUrl,
      { method: 'GET' }
    );

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Delete sync data for a user
   */
  async deleteSyncData(token: string): Promise<boolean> {
    try {
      const response = await this.fetchWithRetry(
        `${this.baseUrl}/v1/sync`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Health check for the sync API
   */
  async healthCheck(): Promise<boolean> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      clearTimeout(timeoutId);
      return false;
    }
  }

  /**
   * Get size limits
   */
  get limits() {
    return {
      maxFileSize: this.maxFileSize,
      maxTotalSize: this.maxTotalSize,
    };
  }
}

// Singleton instance
let instance: SyncApiClient | null = null;

export function getSyncApiClient(config?: SyncApiConfig): SyncApiClient {
  if (!instance) {
    instance = new SyncApiClient(config);
  }
  return instance;
}

export function resetSyncApiClient(): void {
  instance = null;
}
