import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { PeerProcessDriver } from '../drivers/peer-process-driver.js';

interface TimingSummary { p50: number; p95: number; p99: number; }
export interface PeerBenchmarkResult {
  peers: number;
  payloadBytes: number;
  samples: number;
  coldAcceptanceMs: TimingSummary;
  warmAcceptanceMs: TimingSummary;
  inboxReadMs: TimingSummary;
  lost: number;
  duplicates: number;
  failures: number;
  processMetrics: unknown[];
}

function timings(values: number[]): TimingSummary {
  const ordered = [...values].sort((a, b) => a - b);
  const at = (percentile: number) => ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * percentile))] ?? 0;
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99) };
}

export async function measurePeerCommunication(options: { peers: number; payloadBytes: number; samples: number }): Promise<PeerBenchmarkResult> {
  const root = await mkdtemp(path.join(tmpdir(), 'ah-peer-bench-'));
  const workspaceRoot = path.join(root, 'workspace');
  await mkdir(workspaceRoot);
  const processes: PeerProcessDriver[] = [];
  const cold: number[] = [];
  const warm: number[] = [];
  const reads: number[] = [];
  const routes = new Set<string>();
  const seen = new Set<string>();
  let failures = 0;
  let duplicates = 0;
  try {
    for (let index = 0; index < options.peers; index++) {
      const peer = new PeerProcessDriver();
      processes.push(peer);
      await peer.launch({ home: path.join(root, 'home'), workspaceRoot, alias: `worker-${index}` });
    }
    const content = 'x'.repeat(options.payloadBytes);
    for (let index = 0; index < options.samples; index++) {
      const sender = processes[index % processes.length];
      const receiver = processes[(index + 1) % processes.length];
      const route = `${sender.self.peerId}/${receiver.self.peerId}`;
      const messageId = `benchmark-${index}`;
      try {
        const start = performance.now();
        await sender.request('send', { to: receiver.self.peerId, content, messageId });
        (routes.has(route) ? warm : cold).push(performance.now() - start);
        routes.add(route);
        const readStart = performance.now();
        const inbox = await receiver.request<{ messages: Array<{ messageId: string }> }>('messages');
        reads.push(performance.now() - readStart);
        for (const message of inbox.messages) {
          if (seen.has(message.messageId)) duplicates++;
          seen.add(message.messageId);
        }
      } catch { failures++; }
    }
    const processMetrics = await Promise.all(processes.map(peer => peer.request('metrics')));
    return { ...options, coldAcceptanceMs: timings(cold), warmAcceptanceMs: timings(warm), inboxReadMs: timings(reads), lost: options.samples - failures - seen.size, duplicates, failures, processMetrics };
  } finally {
    await Promise.allSettled(processes.map(peer => peer.close()));
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv.includes('--run')) {
  const results: PeerBenchmarkResult[] = [];
  for (const peers of [2, 10, 50]) {
    for (const payloadBytes of [128, 1_024, 8_000]) {
      results.push(await measurePeerCommunication({ peers, payloadBytes, samples: peers * 4 }));
    }
  }
  process.stdout.write(`${JSON.stringify({ measuredAt: new Date().toISOString(), platform: process.platform, results }, null, 2)}\n`);
}
