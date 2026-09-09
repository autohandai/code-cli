import { createInterface } from 'node:readline';
import { PeerMessaging } from '../../session/peers/PeerMessaging.js';
import { ResourceCoordinator } from '../../session/peers/ResourceCoordinator.js';
import type { ResourceOperation } from '../../session/peers/ResourceCoordinator.js';

const [home, workspaceRoot, alias] = process.argv.slice(2);
if (!home || !workspaceRoot || !alias) throw new Error('Expected home, workspace and alias');
const messaging = new PeerMessaging({
  home, workspaceRoot, alias, sessionId: alias,
  policy: { enabled: true, scope: 'machine', idleBehavior: 'notify' },
  limits: { rateBurst: 100, ratePerSecond: 100 },
});
await messaging.start();
const resources = new ResourceCoordinator({
  directory: `${home}/peer-resources`,
  principal: { peerId: messaging.self.peerId, instanceId: messaging.self.instanceId },
  canControl: true,
  isPrincipalAlive: async principal => principal.peerId === messaging.self.peerId || (await messaging.list({ scope: 'machine' })).peers.some(peer => peer.peerId === principal.peerId),
});
process.stdout.write(`${JSON.stringify({ ready: messaging.self })}\n`);
const reader = createInterface({ input: process.stdin });
for await (const line of reader) {
  const request = JSON.parse(line) as { id: string; method: string; params: Record<string, unknown> };
  try {
    let result: unknown;
    if (request.method === 'send') {
      result = await messaging.send({ to: String(request.params.to), content: String(request.params.content), messageId: typeof request.params.messageId === 'string' ? request.params.messageId : undefined });
    } else if (request.method === 'messages') {
      result = await messaging.messages({ consume: request.params.consume !== false });
    } else if (request.method === 'status') {
      result = await messaging.status(String(request.params.messageId));
    } else if (request.method === 'list') {
      result = await messaging.list({ scope: 'machine' });
    } else if (request.method === 'metrics') {
      result = { resources: process.resourceUsage(), memory: process.memoryUsage(), messaging: await messaging.diagnostics() };
    } else if (request.method === 'resource') {
      result = await resources.coordinate(request.params as unknown as ResourceOperation);
    } else if (request.method === 'shutdown') {
      await resources.close();
      await messaging.stop();
      process.stdout.write(`${JSON.stringify({ id: request.id, result: true })}\n`);
      reader.close();
      break;
    } else {
      throw new Error(`Unknown fixture operation ${request.method}`);
    }
    process.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ id: request.id, error: { message: error instanceof Error ? error.message : String(error), code: typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined } })}\n`);
  }
}
await resources.close();
await messaging.stop();
