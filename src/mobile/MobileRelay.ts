/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { MobileHandoffClientLike } from './MobileHandoffClient.js';

interface MobileRelayOptions {
  client: MobileHandoffClientLike;
  token: string;
  deviceId: string;
  sessionId: string;
  pairingId?: string;
  mode: 'queue' | 'steer';
  pollIntervalMs: number;
  enqueueInstruction: (instruction: string) => void;
  onError?: (error: Error) => void;
}

let activeRelay: {
  deviceId: string;
  timer: ReturnType<typeof setInterval>;
  polling: boolean;
} | null = null;

export function startMobileRelay(options: MobileRelayOptions): void {
  stopMobileRelay();

  activeRelay = {
    deviceId: options.deviceId,
    timer: setInterval(() => {
      void pollOnce(options);
    }, Math.max(options.pollIntervalMs, 1_000)),
    polling: false,
  };

  activeRelay.timer.unref?.();
  void pollOnce(options);
}

export function stopMobileRelay(): void {
  if (!activeRelay) return;
  clearInterval(activeRelay.timer);
  activeRelay = null;
}

async function pollOnce(options: MobileRelayOptions): Promise<void> {
  if (!activeRelay || activeRelay.deviceId !== options.deviceId || activeRelay.polling) {
    return;
  }

  activeRelay.polling = true;
  try {
    try {
      await options.client.sendRelayHeartbeat(options.token, {
        sessionId: options.sessionId,
        deviceId: options.deviceId,
        pairingId: options.pairingId,
        mode: options.mode,
      });
    } catch (error) {
      options.onError?.(error as Error);
    }

    const work = await options.client.claimWork(options.token, options.deviceId);
    if (work?.prompt) {
      options.enqueueInstruction(work.prompt);
    }
  } catch (error) {
    options.onError?.(error as Error);
  } finally {
    if (activeRelay?.deviceId === options.deviceId) {
      activeRelay.polling = false;
    }
  }
}
