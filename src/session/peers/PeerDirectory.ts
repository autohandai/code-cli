import path from 'node:path';
import { ActiveAgentRegistry, type ActiveAgentRecord } from '../ActiveAgentRegistry.js';
import { isPeerObject, PeerError, PEER_CAPABILITIES, type PeerAdvertisement, type PeerDescriptor, type PeerScope } from './PeerProtocol.js';
import { assertPeerScope, defaultPeerAlias, peerIdFor, peerScopeIncludes, resolvePeerScope, safePeerLabel, type PeerScopeIdentity } from './PeerScope.js';

export interface PeerListQuery { scope?: PeerScope; query?: string; cursor?: string; }
export interface PeerListResult { peers: PeerDescriptor[]; nextCursor?: string; }
export interface PeerRoute { descriptor: PeerDescriptor; advertisement?: PeerAdvertisement; scope: PeerScopeIdentity; policyScope: PeerScope; }

interface PeerDirectoryOptions {
  registry: ActiveAgentRegistry;
  self: () => PeerDescriptor;
  scope: () => PeerScopeIdentity;
  policyScope: PeerScope;
  pageSize: number;
  localPeers: () => PeerDescriptor[];
  queryChildren: (advertisement: PeerAdvertisement) => Promise<unknown>;
}

export class PeerDirectory {
  private readonly known = new Map<string, PeerRoute>();
  private readonly snapshots = new Map<PeerScope, PeerDescriptor[]>();

  constructor(private readonly options: PeerDirectoryOptions) {}

  cached(scope: PeerScope = 'workspace'): PeerDescriptor[] { return structuredClone(this.snapshots.get(scope) ?? []); }

  async advertisement(instanceId: string): Promise<PeerAdvertisement | undefined> {
    return (await this.options.registry.listActive()).find(record => record.communication?.instanceId === instanceId)?.communication;
  }

  async authenticatedRoute(instanceId: string, publicKey: string): Promise<PeerRoute> {
    const record = (await this.options.registry.listActive()).find(candidate => candidate.communication?.instanceId === instanceId && candidate.communication.publicKey === publicKey);
    if (!record) throw new PeerError('AUTHENTICATION_FAILED', 'The authenticated incarnation is no longer published.');
    const route = await this.recordRoute(record);
    this.assertMutualScope(route);
    this.remember(route);
    return route;
  }

  async list(query: PeerListQuery = {}, principal = this.options.self().peerId, allowed = this.options.policyScope): Promise<PeerListResult> {
    const scope = query.scope ?? 'workspace';
    assertPeerScope(scope, allowed);
    if (query.query !== undefined && (typeof query.query !== 'string' || query.query.length > 256)) throw new PeerError('INVALID_PARAMS', 'Peer directory query is too long.');
    const search = query.query?.toLowerCase() ?? '';
    const offset = this.readCursor(query.cursor, scope, search);
    const routes = await this.refresh(scope);
    this.snapshots.set(scope, routes.map(route => route.descriptor));
    const peers = routes.map(route => route.descriptor).filter(peer => peer.peerId !== principal
      && (!search || `${peer.alias} ${peer.project} ${peer.peerId}`.toLowerCase().includes(search)))
      .sort((left, right) => left.peerId.localeCompare(right.peerId));
    const start = offset ? peers.findIndex(peer => peer.peerId > offset) : 0;
    const page = start < 0 ? [] : peers.slice(start, start + this.options.pageSize);
    const more = start >= 0 && start + page.length < peers.length;
    return { peers: structuredClone(page), ...(more ? { nextCursor: Buffer.from(JSON.stringify([scope, search, page.at(-1)!.peerId])).toString('base64url') } : {}) };
  }

  async resolve(target: string, principal = this.options.self().peerId, allowed = this.options.policyScope, retainOfflineIntent = false): Promise<PeerRoute> {
    if (typeof target !== 'string' || !target || target.length > 256) throw new PeerError('UNKNOWN_TARGET', 'Choose a peer identity or a unique alias from discovery.');
    let found: PeerRoute | undefined;
    try { found = target.startsWith('peer-') ? await this.exactRoute(target) : undefined; }
    catch (error) {
      if (!retainOfflineIntent || !(error instanceof PeerError) || error.code !== 'PEER_OFFLINE') throw error;
      found = this.known.get(target);
      if (!found) throw error;
    }
    const routes = found ? [] : await this.refresh(allowed);
    found ??= routes.find(route => route.descriptor.peerId === target);
    if (!found && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(target)) {
      const matches = routes.filter(route => route.descriptor.peerId !== principal && route.descriptor.alias === target);
      if (matches.length > 1) throw new PeerError('AMBIGUOUS_TARGET', 'Several peers use this alias. Select an exact peer ID.');
      found = matches[0];
    }
    if (!found) throw new PeerError(target.startsWith('peer-') ? 'PEER_OFFLINE' : 'UNKNOWN_TARGET', 'This exact target is unavailable. Refresh the directory and select a live peer.');
    if (!peerScopeIncludes(allowed, this.options.scope(), found.scope)) throw new PeerError('SCOPE_DENIED', 'The target is outside the delegated scope.');
    this.assertMutualScope(found);
    return structuredClone(found);
  }

  private async exactRoute(target: string): Promise<PeerRoute | undefined> {
    const local = this.options.localPeers().find(peer => peer.peerId === target);
    if (local) return this.localRoute(local);
    const known = this.known.get(target);
    if (known?.descriptor.instanceId === this.options.self().instanceId) throw new PeerError('TARGET_ENDED', 'The selected run has ended.');
    const records = await this.options.registry.listActive();
    const record = records.find(candidate => candidate.communication && (known
      ? candidate.communication.instanceId === known.descriptor.instanceId
      : peerIdFor(candidate.communication.instanceId) === target));
    if (!record) {
      if (known) throw new PeerError('PEER_OFFLINE', 'The selected process incarnation is no longer published.');
      return undefined;
    }
    const root = await this.recordRoute(record);
    this.assertMutualScope(root);
    if (!known?.descriptor.runId) { this.remember(root); return root; }
    const result = await this.options.queryChildren(root.advertisement!);
    if (isPeerObject(result) && Array.isArray(result.peers) && result.peers.length <= 256) {
      for (const value of result.peers) {
        const descriptor = this.childDescriptor(value, root);
        if (descriptor?.peerId === target) {
          const route = { ...root, descriptor };
          this.remember(route);
          return route;
        }
      }
    }
    throw new PeerError('TARGET_ENDED', 'The owning root no longer publishes the selected run.');
  }

  localRoute(descriptor: PeerDescriptor, advertisement?: PeerAdvertisement): PeerRoute {
    return { descriptor, advertisement, scope: this.options.scope(), policyScope: this.options.policyScope };
  }

  remember(route: PeerRoute): void {
    this.known.delete(route.descriptor.peerId);
    this.known.set(route.descriptor.peerId, structuredClone(route));
    while (this.known.size > 4_096) this.known.delete(this.known.keys().next().value!);
  }

  private async refresh(scope: PeerScope): Promise<PeerRoute[]> {
    const self = this.options.self();
    const local = this.options.localPeers().map(descriptor => this.localRoute(descriptor));
    const records = await this.options.registry.listActive();
    const roots = await Promise.all(records.filter(record => record.communication?.instanceId !== self.instanceId).map(record => this.recordRoute(record)));
    for (const route of roots) this.remember(route);
    const eligible = roots.filter(route => peerScopeIncludes(scope, this.options.scope(), route.scope));
    const children: PeerRoute[] = [];
    for (let index = 0; index < eligible.length; index += 4) {
      await Promise.all(eligible.slice(index, index + 4).map(async root => {
        if (!root.advertisement || root.advertisement.protocol !== 1 || !peerScopeIncludes(root.policyScope, root.scope, this.options.scope())) return;
        try {
          const result = await this.options.queryChildren(root.advertisement);
          if (!isPeerObject(result) || !Array.isArray(result.peers) || result.peers.length > 256) return;
          for (const value of result.peers) {
            const descriptor = this.childDescriptor(value, root);
            if (descriptor) children.push({ ...root, descriptor });
          }
        } catch { /* Presence remains useful when an endpoint is temporarily unavailable. */ }
      }));
    }
    const routes = [...local, ...eligible, ...children];
    for (const route of routes) this.remember(route);
    return routes;
  }

  private async recordRoute(record: ActiveAgentRecord): Promise<PeerRoute> {
    const advertisement = record.communication;
    const scope = advertisement?.workspaceId ? { workspaceId: advertisement.workspaceId, repositoryId: advertisement.repositoryId }
      : await resolvePeerScope(record.workspaceRoot).catch(() => ({ workspaceId: path.resolve(record.workspaceRoot) }));
    const instanceId = advertisement?.instanceId ?? `legacy-${record.sessionId}-${record.pid}`;
    return {
      advertisement, scope, policyScope: advertisement?.scope ?? 'workspace',
      descriptor: {
        peerId: peerIdFor(instanceId), instanceId, sessionId: record.sessionId,
        alias: safePeerLabel(advertisement?.alias ?? defaultPeerAlias(record.projectName, instanceId)),
        project: safePeerLabel(record.projectName), kind: 'root', activity: safePeerLabel(record.activity?.phase ?? record.status),
        availability: !advertisement ? 'presence_only' : advertisement.protocol !== 1 ? 'unsupported' : 'available',
        capabilities: advertisement?.protocol === 1 ? [...advertisement.capabilities] : [],
      },
    };
  }

  private childDescriptor(value: unknown, root: PeerRoute): PeerDescriptor | undefined {
    if (!isPeerObject(value) || typeof value.runId !== 'string' || value.runId.length > 256 || !value.runId
      || value.instanceId !== root.descriptor.instanceId || value.peerId !== peerIdFor(root.descriptor.instanceId, value.runId)
      || typeof value.alias !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value.alias)
      || typeof value.activity !== 'string' || !Array.isArray(value.capabilities)
      || !value.capabilities.every(cap => PEER_CAPABILITIES.includes(cap as typeof PEER_CAPABILITIES[number]))) return undefined;
    const capabilities = root.descriptor.capabilities.filter(cap => (value.capabilities as unknown[]).includes(cap));
    return { peerId: value.peerId as string, instanceId: root.descriptor.instanceId, sessionId: root.descriptor.sessionId, runId: value.runId,
      alias: safePeerLabel(value.alias), project: root.descriptor.project, kind: 'run', activity: safePeerLabel(value.activity),
      capabilities, availability: capabilities.includes('message.receive') ? 'available' : 'presence_only' };
  }

  private assertMutualScope(route: PeerRoute): void {
    if (!peerScopeIncludes(this.options.policyScope, this.options.scope(), route.scope)
      || !peerScopeIncludes(route.policyScope, route.scope, this.options.scope())) throw new PeerError('SCOPE_DENIED', 'Sender and recipient policies do not both authorize this scope.');
  }

  private readCursor(value: string | undefined, scope: PeerScope, query: string): string | undefined {
    if (value === undefined) return undefined;
    try {
      if (value.length > 2_048 || !/^[\w-]+$/.test(value)) throw new Error();
      const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString());
      if (!Array.isArray(parsed) || parsed.length !== 3 || parsed[0] !== scope || parsed[1] !== query || typeof parsed[2] !== 'string' || !/^peer-[a-f0-9]{32}$/.test(parsed[2])) throw new Error();
      return parsed[2];
    } catch { throw new PeerError('INVALID_PARAMS', 'Invalid peer directory cursor or changed scope/query.'); }
  }
}
