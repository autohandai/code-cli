/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { resolveAutohandHome } from '../constants.js';
import { createBridgeClient, createTools, type SquadBridge } from './vendor/runtime.mjs';
import { DEFAULT_BRIDGE_URL, parseBridgeUrl } from './vendor/control-plane.mjs';

const MemberSchema = z.object({ id: z.string(), name: z.string().nullable().optional(), role: z.string().nullable().optional(), presence: z.string(), lastWorkspace: z.string().nullable().optional() });
export type SquadMember = z.infer<typeof MemberSchema>;
const ReceiptSchema = z.object({ member_id: z.string(), message_id: z.string(), status: z.string(), paused: z.boolean(), pauseReason: z.string(), workspace: z.string() });
const ConversationSchema = z.object({ messages: z.array(z.object({ role: z.string(), body: z.string() })), live: z.boolean() });

export async function resolveSquadBridgeUrl(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (env.AUTOHAND_SQUAD_BRIDGE_URL) return parseBridgeUrl(env.AUTOHAND_SQUAD_BRIDGE_URL);
  const home = env.AUTOHAND_SQUAD_HOME || path.join(resolveAutohandHome({ environment: env }), 'squad');
  let text: string;
  try { text = await readFile(path.join(home, 'web-server.json'), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return DEFAULT_BRIDGE_URL;
  }
  const record = z.object({ url: z.string() }).parse(JSON.parse(text));
  return parseBridgeUrl(record.url);
}

export class SquadConnection {
  private selectedId?: string;
  private readonly bridge?: SquadBridge;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: { bridge?: SquadBridge; env?: NodeJS.ProcessEnv } = {}) {
    this.bridge = options.bridge;
    this.env = options.env ?? process.env;
  }

  get selectedMemberId(): string | undefined { return this.selectedId; }

  private async tools() {
    if (this.env.AUTOHAND_SQUAD_TEAM_TOKEN || this.env.AUTOHAND_SQUAD_MEMBER || this.env.AUTOHAND_SQUAD_TEAM_URL) throw new Error('This CLI is a managed Squad member. Use its existing member MCP connection.');
    return createTools(this.bridge ?? createBridgeClient(await resolveSquadBridgeUrl(this.env)));
  }

  async listMembers(): Promise<SquadMember[]> {
    const tools = await this.tools();
    return z.object({ members: z.array(MemberSchema) }).parse(await tools.list_members()).members;
  }

  private async resolveMember(query: string): Promise<SquadMember> {
    const members = await this.listMembers();
    const exact = members.find(member => member.id === query);
    const matches = exact ? [exact] : members.filter(member => member.name?.toLowerCase() === query.toLowerCase());
    if (matches.length !== 1) throw new Error(matches.length ? 'Several agents have that name. Select by member ID.' : `Squad agent "${query}" was not found. Use /squad agents.`);
    return matches[0];
  }

  async select(query: string): Promise<SquadMember> {
    const member = await this.resolveMember(query);
    this.selectedId = member.id;
    return member;
  }

  async sendTo(query: string, text: string) {
    const member = await this.resolveMember(query);
    return this.send(text, member.id);
  }

  clearSelection(): void { this.selectedId = undefined; }

  async send(text: string, memberId = this.selectedId) {
    if (!memberId) throw new Error('Select a Squad agent with /squad select, or use /message squad <agent-id> <text>.');
    const tools = await this.tools();
    return ReceiptSchema.parse(await tools.message_member({ member_id: memberId, text }));
  }

  async history(memberId = this.selectedId) {
    if (!memberId) throw new Error('Select a Squad agent with /squad select first.');
    const tools = await this.tools();
    return ConversationSchema.parse(await tools.get_conversation({ member_id: memberId }));
  }

  async queue(memberId = this.selectedId) {
    if (!memberId) throw new Error('Select a Squad agent with /squad select first.');
    const tools = await this.tools();
    return tools.get_member_queue({ member_id: memberId });
  }
}
