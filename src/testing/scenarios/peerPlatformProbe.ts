import { PeerMessaging } from '../../session/peers/PeerMessaging.js';

const [home, workspaceRoot] = process.argv.slice(2);
if (!home || !workspaceRoot) throw new Error('Expected a temporary home and workspace');
const policy = { enabled: true, scope: 'workspace' as const, idleBehavior: 'notify' as const };
const sender = new PeerMessaging({ home, workspaceRoot, sessionId: 'probe-sender', alias: 'sender', policy });
const receiver = new PeerMessaging({ home, workspaceRoot, sessionId: 'probe-receiver', alias: 'receiver', policy });
try {
  await sender.start();
  await receiver.start();
  const content = '🦊'.repeat(2_000);
  const receipt = await sender.send({ to: receiver.self.peerId, content, messageId: 'platform-vector' });
  const inbox = await receiver.messages();
  const consumed = await sender.status(receipt.messageId);
  process.stdout.write(`${JSON.stringify({ platform: process.platform, runtime: process.versions.bun ? 'bun' : 'node', bytes: Buffer.byteLength(content), count: inbox.messages.length, contentMatches: inbox.messages[0]?.content === content, receipt: receipt.state, consumed: consumed.state, endpoint: receiver.getAdvertisement()?.endpoint, security: receiver.getSecurityEvidence() })}\n`);
} finally {
  await Promise.allSettled([sender.stop(), receiver.stop()]);
}
