import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AgentAction, ToolExecutionContext } from '../types.js';
import type { ToolDefinition } from './toolManager.js';
import type { PeerClient } from '../session/peers/PeerMessaging.js';
import { PeerError } from '../session/peers/PeerProtocol.js';
import { type ResourceCoordinatorClient, resourceOperationSchema } from '../session/peers/ResourceCoordinator.js';

export const PEER_TOOL_NAMES = new Set(['list_peers', 'send_peer_message', 'peer_messages', 'coordinate_resource']);
const identifier = z.string().min(1).max(256).refine(value => !/[\x00-\x1f\x7f]/.test(value));
const listSchema = z.object({ type: z.literal('list_peers'), scope: z.enum(['workspace', 'repository', 'machine']).optional(), query: z.string().max(256).optional(), cursor: z.string().max(2_048).optional() }).strict();
const sendSchema = z.object({ type: z.literal('send_peer_message'), to: identifier, content: z.string().min(1), topic: z.string().max(256).optional(), replyTo: identifier.optional() }).strict();
const messagesSchema = z.object({ type: z.literal('peer_messages'), after: z.string().regex(/^\d+$/).optional(), from: identifier.optional(), replyTo: identifier.optional(), messageId: identifier.optional(), waitMs: z.number().int().min(0).max(30_000).optional() }).strict();

export const PEER_TOOL_DEFINITIONS: ToolDefinition[] = [
  { name: 'list_peers', description: 'Discover live local root sessions and exact child runs within the authorized scope. Returns opaque peer IDs and safe display metadata. Defaults to the workspace; explicitly select repository or machine scope when authorized.', parameters: { type: 'object', properties: {
    scope: { type: 'string', enum: ['workspace', 'repository', 'machine'], description: 'Authorized directory scope; default workspace.' },
    query: { type: 'string', description: 'Filter aliases, project names and peer IDs.' }, cursor: { type: 'string', description: 'Opaque continuation cursor from the same scope and query.' },
  } } },
  { name: 'send_peer_message', description: 'Send external collaboration input to an exact peer ID from list_peers. This is a side effect. Returns durable acceptance, not proof of consumption or execution. Sender identity and retry ID are runtime-owned. A reply must reference a message received from the exact target.', parameters: { type: 'object', required: ['to', 'content'], properties: {
    to: { type: 'string', description: 'Opaque peer ID from discovery; no PIDs, paths or broadcast.' }, content: { type: 'string', description: 'Nonempty message, at most 8000 UTF-8 bytes.' },
    topic: { type: 'string', description: 'Optional conversation label.' }, replyTo: { type: 'string', description: 'Original incoming message ID when replying.' },
  } } },
  { name: 'peer_messages', description: 'Read your own durable inbox and receipt/resource events. Reading message content records consumption. An optional event-driven wait lasts at most 30 seconds, consumes no provider calls and returns a normal timedOut result. Never reads another principal’s inbox.', parameters: { type: 'object', properties: {
    after: { type: 'string', description: 'Durable event cursor from the previous result.' }, from: { type: 'string', description: 'Filter by exact sender peer ID.' },
    replyTo: { type: 'string', description: 'Filter replies to an original message.' }, messageId: { type: 'string', description: 'Filter one message and its events.' },
    waitMs: { type: 'integer', description: 'Zero for an immediate read; up to 30000 for a bounded wait.' },
  } } },
  { name: 'coordinate_resource', description: 'Coordinate a capacity-one resource without killing running commands. status requires resource; request requires resource and reason; grant/release/cancel_request require requestId; set_controller requires resource, controller, participants and profile. Grants and policy changes require separate control authority. A running or starting reservation remains occupied until its process lifetime is resolved.', parameters: { type: 'object', required: ['operation'], properties: {
    operation: { type: 'string', enum: ['status', 'request', 'grant', 'release', 'cancel_request', 'set_controller'], description: 'Discriminated coordination operation; only fields for that operation are accepted.' },
    resource: { type: 'string', description: 'Canonical machine/name or repository/common-directory-id/name.' }, reason: { type: 'string', description: 'Required nonempty explanation for request.' },
    requestId: { type: 'string', description: 'Stable request ticket for request retries, grant, release or cancellation.' }, epoch: { type: 'integer', description: 'Optional expected policy epoch for grant or set_controller.' },
    controller: { type: 'string', description: 'Exact authorized controller peer ID for set_controller.' }, participants: { type: 'array', items: { type: 'string' }, description: 'Exact enrolled peer IDs for set_controller.' },
    profile: { type: 'string', enum: ['strict', 'build'], description: 'strict gates every participating process launch; build gates documented build/test commands.' },
  } } },
];

export function validatePeerToolAction(action: AgentAction): string | undefined {
  if (!PEER_TOOL_NAMES.has(action.type)) return undefined;
  const { type, ...args } = action;
  const result = type === 'coordinate_resource' ? resourceOperationSchema.safeParse(args)
    : type === 'list_peers' ? listSchema.safeParse(action) : type === 'send_peer_message' ? sendSchema.safeParse(action) : messagesSchema.safeParse(action);
  return result.success ? undefined : `INVALID_PARAMS: ${type} rejected invalid or unauthorized fields: ${result.error.issues.map(issue => issue.message).join('; ')}`;
}

export function peerToolAvailable(tool: string, client?: PeerClient): boolean {
  if (!PEER_TOOL_NAMES.has(tool)) return true;
  if (!client?.policy.enabled) return false;
  if (tool === 'list_peers') return true;
  const capabilities = client.self.capabilities;
  if (tool === 'send_peer_message') return capabilities.includes('message.send');
  if (tool === 'peer_messages') return capabilities.includes('message.receive');
  return capabilities.includes('resource.request') || capabilities.includes('resource.control');
}

export async function executePeerTool(action: AgentAction, client: PeerClient | undefined, coordinator: ResourceCoordinatorClient | undefined, context?: ToolExecutionContext): Promise<string> {
  const validation = validatePeerToolAction(action);
  if (validation) throw new PeerError('INVALID_PARAMS', validation);
  if (!client?.policy.enabled) throw new PeerError('COMMUNICATION_DISABLED', 'Enable sessions.communication before using peer tools.');
  if (!peerToolAvailable(action.type, client)) throw new PeerError('CAPABILITY_DENIED', 'The runtime principal does not inherit this peer capability.');
  if (action.type === 'list_peers') {
    return JSON.stringify({ self: client.self, ...await client.list({ scope: action.scope, query: action.query, cursor: action.cursor }) });
  }
  if (action.type === 'send_peer_message') {
    const messageId = context?.toolCallId ? `tool-${createHash('sha256').update(JSON.stringify([client.self.peerId, context.toolCallId])).digest('hex')}` : undefined;
    const input = { to: action.to, content: action.content, topic: action.topic, replyTo: action.replyTo };
    const receipt = await client.send({ ...input, ...(messageId ? { messageId } : {}) }, { automatic: context?.peerAutomatic });
    if (['rejected', 'expired'].includes(receipt.state)) throw new PeerError('DELIVERY_UNKNOWN', `The durable receipt reports ${receipt.state}: ${receipt.outcome ?? 'message unavailable'}.`, { receipt });
    return JSON.stringify(receipt);
  }
  if (action.type === 'peer_messages') {
    const query = { after: action.after, from: action.from, replyTo: action.replyTo, messageId: action.messageId, waitMs: action.waitMs };
    const result = await client.messages({ ...query, signal: context?.signal, consume: false });
    if (result.messages.length) await client.consumeMessages(result.messages, messages => client.recordContext(messages));
    return JSON.stringify(result);
  }
  if (action.type === 'coordinate_resource') {
    if (!coordinator) throw new PeerError('CAPABILITY_DENIED', 'This principal has no bound resource coordinator.');
    if (['set_controller', 'grant'].includes(action.operation) && !client.self.capabilities.includes('resource.control')) throw new PeerError('CAPABILITY_DENIED', 'Resource control was not delegated to this principal.');
    const operation = Object.fromEntries(Object.entries(action).filter(([key]) => key !== 'type'));
    return JSON.stringify(await coordinator.coordinate(resourceOperationSchema.parse(operation)));
  }
  throw new PeerError('METHOD_NOT_FOUND', 'Unknown peer tool.');
}
