import { describe, expect, it } from 'vitest';
import { measurePeerCommunication } from '../../../src/testing/scenarios/peerCommunicationBenchmark.js';

describe('peer benchmark measurement contract', () => {
  it('measures real acceptance and consumption separately and counts loss and duplicates', async () => {
    const result = await measurePeerCommunication({ peers: 2, payloadBytes: 128, samples: 6 });
    expect(result).toMatchObject({ peers: 2, payloadBytes: 128, samples: 6, lost: 0, duplicates: 0, failures: 0 });
    expect(result.coldAcceptanceMs.p50).toBeGreaterThan(0);
    expect(result.warmAcceptanceMs.p50).toBeGreaterThan(0);
    expect(result.inboxReadMs.p50).toBeGreaterThan(0);
    expect(result.processMetrics).toHaveLength(2);
  });
});
