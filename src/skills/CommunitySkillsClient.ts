/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * CommunitySkillsClient - API client for community skills operations
 * Follows the pattern established by TelemetryClient for offline-first design
 */
import fs from 'fs-extra';
import path from 'node:path';
import { AUTOHAND_HOME } from '../constants.js';
import type { ProjectAnalysis } from './autoSkill.js';

// ============ Types ============

export interface CommunitySkillsConfig {
  apiBaseUrl: string;
  enabled: boolean;
  deviceId?: string;
  queueDir?: string;
  timeout?: number;
  maxRetries?: number;
}

export interface SkillFilters {
  languages?: string[];
  frameworks?: string[];
  patterns?: string[];
  search?: string;
  curated?: boolean;
  featured?: boolean;
  limit?: number;
  offset?: number;
}

export interface CommunitySkillPackage {
  id: string;
  name: string;
  description: string;
  body?: string;
  allowedTools?: string;
  categories?: string[];
  tags?: string[];
  languages?: string[];
  frameworks?: string[];
  patterns?: string[];
  license?: string;
  version?: string;
  isCurated?: boolean;
  isFeatured?: boolean;
  downloadCount?: number;
  rating?: number;
}

export interface SkillSuggestion {
  skill: CommunitySkillPackage;
  relevanceScore: number;
  matchReason: string;
}

export interface BackupPayload {
  name: string;
  description: string;
  body: string;
  allowedTools?: string;
  originalSource: string;
  originalPath?: string;
  metadata?: Record<string, string>;
}

export interface BackupEntry {
  name: string;
  description: string;
  allowedTools?: string;
  originalSource: string;
  originalPath?: string;
  metadata?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
}

export interface SkillSubmission {
  name: string;
  description: string;
  body: string;
  allowedTools?: string;
  categories?: string[];
  tags?: string[];
  languages?: string[];
  frameworks?: string[];
  patterns?: string[];
  license?: string;
  author?: string;
}

interface QueuedOperation {
  type: 'backup' | 'submit';
  payload: unknown;
  timestamp: number;
  retries: number;
}

// ============ Client ============

export class CommunitySkillsClient {
  private readonly apiBaseUrl: string;
  private readonly enabled: boolean;
  private readonly deviceId: string;
  private readonly queueDir: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private queue: QueuedOperation[] = [];
  private queueLoaded = false;

  constructor(config: CommunitySkillsConfig) {
    this.apiBaseUrl = config.apiBaseUrl.replace(/\/$/, '');
    this.enabled = config.enabled;
    this.deviceId = config.deviceId || this.loadDeviceId();
    this.queueDir = config.queueDir || path.join(AUTOHAND_HOME, 'community-skills');
    this.timeout = config.timeout || 10000;
    this.maxRetries = config.maxRetries || 3;
  }

  /**
   * Load device ID from filesystem
   */
  private loadDeviceId(): string {
    const deviceIdPath = path.join(AUTOHAND_HOME, 'device-id');
    try {
      if (fs.existsSync(deviceIdPath)) {
        return fs.readFileSync(deviceIdPath, 'utf-8').trim();
      }
    } catch {
      // Ignore
    }
    return `anon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Load queue from disk
   */
  private loadQueue(): void {
    if (this.queueLoaded) return;
    this.queueLoaded = true;

    const queuePath = path.join(this.queueDir, 'queue.json');
    try {
      if (fs.existsSync(queuePath)) {
        this.queue = fs.readJsonSync(queuePath);
      }
    } catch {
      this.queue = [];
    }
  }

  /**
   * Save queue to disk
   */
  private saveQueue(): void {
    try {
      fs.ensureDirSync(this.queueDir);
      fs.writeJsonSync(path.join(this.queueDir, 'queue.json'), this.queue);
    } catch {
      // Ignore write errors
    }
  }

  /**
   * Add operation to offline queue
   */
  private addToQueue(type: 'backup' | 'submit', payload: unknown): void {
    this.loadQueue();
    this.queue.push({
      type,
      payload,
      timestamp: Date.now(),
      retries: 0,
    });
    // Limit queue size
    if (this.queue.length > 100) {
      this.queue = this.queue.slice(-100);
    }
    this.saveQueue();
  }

  /**
   * Make authenticated API request
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<{ ok: boolean; data?: T; error?: string }> {
    if (!this.enabled) {
      return { ok: false, error: 'Community skills disabled' };
    }

    const url = `${this.apiBaseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.deviceId}`,
      'X-Device-ID': this.deviceId,
      ...(options.headers as Record<string, string> || {}),
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json() as T & { success?: boolean; error?: string };

      if (!response.ok) {
        return { ok: false, error: data.error || `HTTP ${response.status}` };
      }

      return { ok: true, data };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Request failed';
      return { ok: false, error };
    }
  }

  // ============ Community Skills Operations ============

  /**
   * List community skills with optional filters
   */
  async listSkills(filters?: SkillFilters): Promise<CommunitySkillPackage[]> {
    const params = new URLSearchParams();

    if (filters?.languages?.length) {
      params.set('languages', filters.languages.join(','));
    }
    if (filters?.frameworks?.length) {
      params.set('frameworks', filters.frameworks.join(','));
    }
    if (filters?.patterns?.length) {
      params.set('patterns', filters.patterns.join(','));
    }
    if (filters?.search) {
      params.set('search', filters.search);
    }
    if (filters?.curated) {
      params.set('curated', 'true');
    }
    if (filters?.featured) {
      params.set('featured', 'true');
    }
    if (filters?.limit) {
      params.set('limit', String(filters.limit));
    }
    if (filters?.offset) {
      params.set('offset', String(filters.offset));
    }

    const query = params.toString();
    const endpoint = `/v1/community-skills${query ? `?${query}` : ''}`;

    const result = await this.request<{ skills: CommunitySkillPackage[] }>(endpoint);

    return result.ok ? (result.data?.skills || []) : [];
  }

  /**
   * Download a skill by name
   */
  async downloadSkill(name: string): Promise<{
    success: boolean;
    skill?: CommunitySkillPackage;
    error?: string;
  }> {
    const result = await this.request<{ skill: CommunitySkillPackage }>(
      `/v1/community-skills/${encodeURIComponent(name)}/download`
    );

    if (result.ok && result.data?.skill) {
      return { success: true, skill: result.data.skill };
    }

    return { success: false, error: result.error || 'Failed to download skill' };
  }

  /**
   * Get skill suggestions based on project analysis
   */
  async getSuggestions(analysis: ProjectAnalysis): Promise<SkillSuggestion[]> {
    const params = new URLSearchParams();

    if (analysis.languages.length) {
      params.set('languages', analysis.languages.join(','));
    }
    if (analysis.frameworks.length) {
      params.set('frameworks', analysis.frameworks.join(','));
    }
    if (analysis.patterns.length) {
      params.set('patterns', analysis.patterns.join(','));
    }

    const query = params.toString();
    const endpoint = `/v1/community-skills/suggestions${query ? `?${query}` : ''}`;

    const result = await this.request<{ suggestions: SkillSuggestion[] }>(endpoint);

    return result.ok ? (result.data?.suggestions || []) : [];
  }

  /**
   * Submit a skill for community review
   */
  async submitSkill(skill: SkillSubmission): Promise<{
    success: boolean;
    id?: string;
    pending?: boolean;
    error?: string;
  }> {
    const result = await this.request<{
      success: boolean;
      id?: string;
      pending?: boolean;
      error?: string;
    }>('/v1/community-skills', {
      method: 'POST',
      body: JSON.stringify(skill),
    });

    if (result.ok && result.data?.success) {
      return {
        success: true,
        id: result.data.id,
        pending: result.data.pending,
      };
    }

    // Queue for later if network error
    if (!result.ok && result.error?.includes('fetch')) {
      this.addToQueue('submit', skill);
    }

    return { success: false, error: result.error || result.data?.error };
  }

  // ============ Backup Operations ============

  /**
   * Backup a skill to the API
   */
  async backupSkill(skill: BackupPayload): Promise<boolean> {
    const result = await this.request<{ success: boolean; backed: number }>(
      '/v1/skills-backup',
      {
        method: 'POST',
        body: JSON.stringify({
          deviceId: this.deviceId,
          skills: [skill],
        }),
      }
    );

    if (result.ok && result.data?.backed) {
      return true;
    }

    // Queue for later if failed
    this.addToQueue('backup', skill);
    return false;
  }

  /**
   * Backup multiple skills at once
   */
  async backupAllSkills(skills: BackupPayload[]): Promise<{
    backed: number;
    failed: number;
  }> {
    if (skills.length === 0) {
      return { backed: 0, failed: 0 };
    }

    const result = await this.request<{
      success: boolean;
      backed: number;
      skipped: number;
    }>('/v1/skills-backup', {
      method: 'POST',
      body: JSON.stringify({
        deviceId: this.deviceId,
        skills,
      }),
    });

    if (result.ok) {
      return {
        backed: result.data?.backed || 0,
        failed: result.data?.skipped || 0,
      };
    }

    // Queue all for later
    for (const skill of skills) {
      this.addToQueue('backup', skill);
    }

    return { backed: 0, failed: skills.length };
  }

  /**
   * List backed up skills for this device
   */
  async listBackups(): Promise<BackupEntry[]> {
    const result = await this.request<{ backups: BackupEntry[] }>(
      `/v1/skills-backup/${encodeURIComponent(this.deviceId)}`
    );

    return result.ok ? (result.data?.backups || []) : [];
  }

  /**
   * Restore skills from backup
   */
  async restoreBackups(): Promise<{
    count: number;
    skills: Array<BackupPayload & { name: string }>;
  }> {
    const result = await this.request<{
      count: number;
      skills: Array<BackupPayload & { name: string }>;
    }>('/v1/skills-backup/restore', {
      method: 'POST',
      body: JSON.stringify({ deviceId: this.deviceId }),
    });

    if (result.ok && result.data) {
      return {
        count: result.data.count,
        skills: result.data.skills,
      };
    }

    return { count: 0, skills: [] };
  }

  // ============ Queue Management ============

  /**
   * Get queue status
   */
  getQueueStatus(): { pending: number; oldestItem: string | null } {
    this.loadQueue();
    return {
      pending: this.queue.length,
      oldestItem: this.queue.length > 0
        ? new Date(this.queue[0].timestamp).toISOString()
        : null,
    };
  }

  /**
   * Flush pending queue operations
   */
  async flushQueue(): Promise<{ sent: number; failed: number }> {
    this.loadQueue();

    if (this.queue.length === 0) {
      return { sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;
    const remaining: QueuedOperation[] = [];

    for (const op of this.queue) {
      if (op.retries >= this.maxRetries) {
        failed++;
        continue;
      }

      let success = false;

      if (op.type === 'backup') {
        const payload = op.payload as BackupPayload;
        const result = await this.request<{ success: boolean; backed: number }>(
          '/v1/skills-backup',
          {
            method: 'POST',
            body: JSON.stringify({
              deviceId: this.deviceId,
              skills: [payload],
            }),
          }
        );
        success = result.ok && (result.data?.backed || 0) > 0;
      } else if (op.type === 'submit') {
        const result = await this.request<{ success: boolean }>(
          '/v1/community-skills',
          {
            method: 'POST',
            body: JSON.stringify(op.payload),
          }
        );
        success = result.ok && result.data?.success === true;
      }

      if (success) {
        sent++;
      } else {
        op.retries++;
        remaining.push(op);
      }
    }

    this.queue = remaining;
    this.saveQueue();

    return { sent, failed };
  }

  /**
   * Clear the queue
   */
  clearQueue(): void {
    this.queue = [];
    this.saveQueue();
  }
}
