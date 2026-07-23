/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import crypto from 'node:crypto';
import { promises as nodeFs } from 'node:fs';
import fs from 'fs-extra';
import path from 'node:path';
import { AUTOHAND_PATHS } from '../constants.js';
import {
  atomicRemoveFile,
  atomicWriteJson,
  withFileLock,
} from '../utils/atomicFile.js';
import type {
  MobileHandoffClientLike,
  MobileSessionTurnState,
  MobileSessionTurnStatus,
  MobileWorkUpdatePayload,
} from './MobileHandoffClient.js';

const REPORT_VERSION = 1;
const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const REPORT_LOCK_WAIT_MS = 1_000;

type DeliveryStatus =
  | 'pending'
  | 'auth_blocked'
  | 'acknowledged'
  | 'permanent'
  | 'not_applicable';

interface DeliveryLeg {
  status: DeliveryStatus;
  retryAt?: string;
}

interface PersistedTerminalReport {
  version: typeof REPORT_VERSION;
  id: string;
  deviceId: string;
  sessionId: string;
  pairingId: string;
  workId: string;
  status: Exclude<MobileSessionTurnStatus, 'running'>;
  startedAt?: string;
  completedAt: string;
  createdAt: string;
  updatedAt: string;
  work: DeliveryLeg;
  event: DeliveryLeg;
}

export interface MobileTerminalReportInput {
  workId: string;
  status: Exclude<MobileSessionTurnStatus, 'running'>;
  startedAt?: string;
  completedAt: string;
  updateClaimedWork: boolean;
  /** These values are permitted for the first live request but are never persisted. */
  prompt?: string;
  output?: string;
  error?: string;
}

export interface MobileTerminalReporterOptions {
  client: MobileHandoffClientLike;
  token: string;
  apiBaseUrl: string;
  owner: {
    profileId: string;
    accountId: string;
  };
  deviceId: string;
  sessionId: string;
  pairingId: string;
  outboxRoot?: string;
  retryDelayMs?: number;
  maxEntries?: number;
  maxAgeMs?: number;
  now?: () => number;
}

export interface MobileTerminalFlushOptions {
  /** A newly authenticated relay may retry auth-blocked and scheduled records immediately. */
  ignoreSchedule?: boolean;
}

export interface MobileTerminalReporterLike {
  report(input: MobileTerminalReportInput): Promise<void>;
  flush(options?: MobileTerminalFlushOptions): Promise<void>;
}

interface LiveTerminalPayloads {
  work: MobileWorkUpdatePayload;
  event: MobileSessionTurnState;
}

type DeliveryTarget = 'work' | 'event';
type FailureKind = 'auth_blocked' | 'permanent' | 'retryable';

function stableHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isTerminalStatus(value: unknown): value is PersistedTerminalReport['status'] {
  return value === 'completed' || value === 'failed' || value === 'cancelled';
}

function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return value === 'pending'
    || value === 'auth_blocked'
    || value === 'acknowledged'
    || value === 'permanent'
    || value === 'not_applicable';
}

function isDeliveryLeg(value: unknown): value is DeliveryLeg {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<DeliveryLeg>;
  return isDeliveryStatus(candidate.status)
    && (candidate.retryAt === undefined || typeof candidate.retryAt === 'string');
}

function parsePersistedReport(value: unknown): PersistedTerminalReport | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const report = value as Partial<PersistedTerminalReport>;
  if (
    report.version !== REPORT_VERSION
    || typeof report.id !== 'string'
    || typeof report.deviceId !== 'string'
    || typeof report.sessionId !== 'string'
    || typeof report.pairingId !== 'string'
    || typeof report.workId !== 'string'
    || !isTerminalStatus(report.status)
    || (report.startedAt !== undefined && typeof report.startedAt !== 'string')
    || typeof report.completedAt !== 'string'
    || typeof report.createdAt !== 'string'
    || typeof report.updatedAt !== 'string'
    || !isDeliveryLeg(report.work)
    || !isDeliveryLeg(report.event)
  ) {
    return null;
  }
  return report as PersistedTerminalReport;
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined;
  const value = (error as { status?: unknown }).status;
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function errorRetryAfterMs(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('retryAfterMs' in error)) return undefined;
  const value = (error as { retryAfterMs?: unknown }).retryAfterMs;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function classifyFailure(error: unknown): FailureKind {
  const status = errorStatus(error);
  if (status === 401 || status === 403) return 'auth_blocked';
  if (status !== undefined && status >= 400 && status < 500) {
    if (status === 408 || status === 425 || status === 429) return 'retryable';
    return 'permanent';
  }
  return 'retryable';
}

function legIsComplete(leg: DeliveryLeg): boolean {
  return leg.status === 'acknowledged'
    || leg.status === 'permanent'
    || leg.status === 'not_applicable';
}

function legIsDue(leg: DeliveryLeg, now: number, ignoreSchedule: boolean): boolean {
  if (legIsComplete(leg)) return false;
  if (leg.status === 'auth_blocked') return ignoreSchedule;
  if (ignoreSchedule || !leg.retryAt) return true;
  const retryAt = Date.parse(leg.retryAt);
  return Number.isNaN(retryAt) || retryAt <= now;
}

export class MobileTerminalReporter implements MobileTerminalReporterLike {
  private readonly client: MobileHandoffClientLike;
  private readonly token: string;
  private readonly deviceId: string;
  private readonly sessionId: string;
  private readonly pairingId: string;
  private readonly scopeDirectory: string;
  private readonly retryDelayMs: number;
  private readonly maxEntries: number;
  private readonly maxAgeMs: number;
  private readonly now: () => number;
  private activeFlush: Promise<void> | null = null;

  constructor(options: MobileTerminalReporterOptions) {
    this.client = options.client;
    this.token = options.token;
    this.deviceId = options.deviceId;
    this.sessionId = options.sessionId;
    this.pairingId = options.pairingId;
    const profileId = options.owner.profileId.trim();
    const accountId = options.owner.accountId.trim();
    if (!profileId || !accountId) {
      throw new Error('Mobile terminal reports require verified profile and account IDs');
    }
    const scope = stableHash(
      `${options.apiBaseUrl.replace(/\/+$/, '')}\0${profileId}\0${accountId}`,
    );
    this.scopeDirectory = path.join(options.outboxRoot ?? AUTOHAND_PATHS.mobileTerminalReports, scope);
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.maxAgeMs = Math.max(1, options.maxAgeMs ?? DEFAULT_MAX_AGE_MS);
    this.now = options.now ?? Date.now;
  }

  async report(input: MobileTerminalReportInput): Promise<void> {
    const createdAt = new Date(this.now()).toISOString();
    const id = stableHash(`${this.sessionId}\0${input.workId}`);
    const reportPath = path.join(this.scopeDirectory, `${id}.json`);
    const report: PersistedTerminalReport = {
      version: REPORT_VERSION,
      id,
      deviceId: this.deviceId,
      sessionId: this.sessionId,
      pairingId: this.pairingId,
      workId: input.workId,
      status: input.status,
      ...(input.startedAt ? { startedAt: input.startedAt } : {}),
      completedAt: input.completedAt,
      createdAt,
      updatedAt: createdAt,
      work: { status: input.updateClaimedWork ? 'pending' : 'not_applicable' },
      event: { status: 'pending' },
    };
    const live: LiveTerminalPayloads = {
      work: {
        status: input.status,
        completedAt: input.completedAt,
        ...(input.error ? { error: input.error } : {}),
        payload: { deliveryState: input.status, executionState: input.status },
      },
      event: {
        workId: input.workId,
        status: input.status,
        ...(input.prompt ? { prompt: input.prompt } : {}),
        ...(input.startedAt ? { startedAt: input.startedAt } : {}),
        completedAt: input.completedAt,
        ...(input.output ? { output: input.output } : {}),
        ...(input.error ? { error: input.error } : {}),
      },
    };

    let created = false;
    await this.ensurePrivateDirectory();
    await withFileLock(`${reportPath}.lock`, async () => {
      if (!await fs.pathExists(reportPath)) {
        await atomicWriteJson(reportPath, report);
        created = true;
      }
    }, { waitTimeoutMs: REPORT_LOCK_WAIT_MS });
    await this.prune();
    await this.deliverReport(reportPath, false, created ? live : undefined);
  }

  flush(options: MobileTerminalFlushOptions = {}): Promise<void> {
    if (this.activeFlush) return this.activeFlush;
    const flush = this.flushInternal(options).finally(() => {
      if (this.activeFlush === flush) this.activeFlush = null;
    });
    this.activeFlush = flush;
    return flush;
  }

  private async flushInternal(options: MobileTerminalFlushOptions): Promise<void> {
    await this.ensurePrivateDirectory();
    await this.prune();
    const reportPaths = await this.reportPaths();
    for (const reportPath of reportPaths) {
      await this.deliverReport(reportPath, options.ignoreSchedule === true);
    }
  }

  private async deliverReport(
    reportPath: string,
    ignoreSchedule: boolean,
    live?: LiveTerminalPayloads,
  ): Promise<void> {
    await withFileLock(`${reportPath}.lock`, async () => {
      const report = await this.readReport(reportPath);
      if (!report) return;
      const now = this.now();
      const targets = (['work', 'event'] as const)
        .filter((target) => legIsDue(report[target], now, ignoreSchedule));
      if (targets.length === 0) return;

      const results = await Promise.all(targets.map(async (target) => {
        try {
          await this.deliverLeg(report, target, live);
          return { target, status: 'acknowledged' as const };
        } catch (error) {
          return {
            target,
            status: classifyFailure(error),
            retryAfterMs: errorRetryAfterMs(error),
          };
        }
      }));

      const updatedAt = new Date(this.now()).toISOString();
      for (const result of results) {
        if (result.status === 'acknowledged' || result.status === 'permanent') {
          report[result.target] = { status: result.status };
        } else if (result.status === 'auth_blocked') {
          report[result.target] = { status: 'auth_blocked' };
        } else {
          const delayMs = Math.max(this.retryDelayMs, result.retryAfterMs ?? 0);
          report[result.target] = {
            status: 'pending',
            retryAt: new Date(this.now() + delayMs).toISOString(),
          };
        }
      }
      report.updatedAt = updatedAt;

      if (legIsComplete(report.work) && legIsComplete(report.event)) {
        await atomicRemoveFile(reportPath);
      } else {
        await atomicWriteJson(reportPath, report);
      }
    }, { waitTimeoutMs: REPORT_LOCK_WAIT_MS });
  }

  private async deliverLeg(
    report: PersistedTerminalReport,
    target: DeliveryTarget,
    live?: LiveTerminalPayloads,
  ): Promise<void> {
    if (target === 'work') {
      if (!this.client.updateWork) throw new Error('Mobile work update transport unavailable');
      const payload = live?.work ?? {
        status: report.status,
        completedAt: report.completedAt,
        payload: { deliveryState: report.status, executionState: report.status },
      };
      await this.client.updateWork(this.token, report.deviceId, report.workId, payload);
      return;
    }

    if (!this.client.publishMobileEvent) throw new Error('Mobile event transport unavailable');
    const payload = live?.event ?? {
      workId: report.workId,
      status: report.status,
      ...(report.startedAt ? { startedAt: report.startedAt } : {}),
      completedAt: report.completedAt,
    };
    await this.client.publishMobileEvent(this.token, {
      sessionId: report.sessionId,
      deviceId: report.deviceId,
      pairingId: report.pairingId,
      requestId: report.workId,
      eventType: 'session_turn_state',
      payload,
    });
  }

  private async ensurePrivateDirectory(): Promise<void> {
    await nodeFs.mkdir(this.scopeDirectory, { recursive: true, mode: 0o700 });
    await nodeFs.chmod(path.dirname(this.scopeDirectory), 0o700);
    await nodeFs.chmod(this.scopeDirectory, 0o700);
  }

  private async readReport(reportPath: string): Promise<PersistedTerminalReport | null> {
    try {
      const parsed = JSON.parse(await fs.readFile(reportPath, 'utf8')) as unknown;
      return parsePersistedReport(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      return null;
    }
  }

  private async reportPaths(): Promise<string[]> {
    try {
      return (await fs.readdir(this.scopeDirectory))
        .filter((file) => file.endsWith('.json'))
        .map((file) => path.join(this.scopeDirectory, file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  private async prune(): Promise<void> {
    const now = this.now();
    const reports = await Promise.all((await this.reportPaths()).map(async (reportPath) => {
      const report = await this.readReport(reportPath);
      const stat = await fs.stat(reportPath).catch(() => null);
      const createdAt = report ? Date.parse(report.createdAt) : stat?.mtimeMs ?? now;
      return { reportPath, createdAt: Number.isNaN(createdAt) ? stat?.mtimeMs ?? now : createdAt };
    }));
    const retained = reports
      .filter(({ createdAt }) => now - createdAt <= this.maxAgeMs)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, this.maxEntries);
    const retainedPaths = new Set(retained.map(({ reportPath }) => reportPath));
    for (const { reportPath } of reports) {
      if (retainedPaths.has(reportPath)) continue;
      await withFileLock(`${reportPath}.lock`, () => atomicRemoveFile(reportPath), {
        waitTimeoutMs: REPORT_LOCK_WAIT_MS,
      });
    }
  }
}
