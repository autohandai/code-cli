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

export class SyncApiClient {
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxFileSize: number;
  private readonly maxTotalSize: number;

  constructor(config?: SyncApiConfig) {
    this.baseUrl = config?.baseUrl || DEFAULT_BASE_URL;
    this.timeout = config?.timeout || DEFAULT_TIMEOUT;
    this.maxFileSize = config?.maxFileSize || DEFAULT_MAX_FILE_SIZE;
    this.maxTotalSize = config?.maxTotalSize || DEFAULT_MAX_TOTAL_SIZE;
  }

  /**
   * Get the remote sync manifest for a user
   * Returns null if no sync data exists
   */
  async getRemoteManifest(token: string): Promise<SyncManifest | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/v1/sync/manifest`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 404) {
        return null; // No sync data yet
      }

      if (!response.ok) {
        const error = await response.text().catch(() => 'Unknown error');
        throw new Error(`API error: ${response.status} ${error}`);
      }

      const data = (await response.json()) as SyncApiResponse;
      return data.manifest || null;
    } catch (error) {
      clearTimeout(timeoutId);

      if ((error as Error).name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    }
  }

  /**
   * Upload sync manifest and request pre-signed URLs for file uploads
   */
  async initiateUpload(
    token: string,
    manifest: SyncManifest,
    filePaths: string[]
  ): Promise<{ uploadUrls: Record<string, string> }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/v1/sync/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          manifest,
          files: filePaths,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.text().catch(() => 'Unknown error');
        throw new Error(`API error: ${response.status} ${error}`);
      }

      const data = (await response.json()) as SyncApiResponse;
      return {
        uploadUrls: data.uploadUrls || {},
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if ((error as Error).name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    }
  }

  /**
   * Upload a file to a pre-signed URL
   */
  async uploadFile(uploadUrl: string, content: Buffer): Promise<void> {
    if (content.length > this.maxFileSize) {
      throw new Error(`File exceeds max size of ${this.maxFileSize} bytes`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': content.length.toString(),
        },
        body: new Uint8Array(content),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
      }
    } catch (error) {
      clearTimeout(timeoutId);

      if ((error as Error).name === 'AbortError') {
        throw new Error('Upload timeout');
      }
      throw error;
    }
  }

  /**
   * Complete the upload and finalize the manifest
   */
  async completeUpload(token: string, manifest: SyncManifest): Promise<SyncResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/v1/sync/complete`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ manifest }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

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
      clearTimeout(timeoutId);

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
   */
  async initiateDownload(token: string, filePaths: string[]): Promise<{ downloadUrls: Record<string, string> }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/v1/sync/download`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ files: filePaths }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.text().catch(() => 'Unknown error');
        throw new Error(`API error: ${response.status} ${error}`);
      }

      const data = (await response.json()) as SyncApiResponse;
      return {
        downloadUrls: data.downloadUrls || {},
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if ((error as Error).name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    }
  }

  /**
   * Download a file from a pre-signed URL
   */
  async downloadFile(downloadUrl: string): Promise<Buffer> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(downloadUrl, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      clearTimeout(timeoutId);

      if ((error as Error).name === 'AbortError') {
        throw new Error('Download timeout');
      }
      throw error;
    }
  }

  /**
   * Delete sync data for a user
   */
  async deleteSyncData(token: string): Promise<boolean> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/v1/sync`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
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
