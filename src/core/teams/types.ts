/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

// --- Team Member ---

export const TeamMemberStatusSchema = z.enum(['spawning', 'working', 'idle', 'shutdown']);
export type TeamMemberStatus = z.infer<typeof TeamMemberStatusSchema>;

export const TeamMemberSchema = z.object({
  name: z.string().min(1),
  agentName: z.string().min(1),
  pid: z.number().int().positive(),
  status: TeamMemberStatusSchema,
  model: z.string().optional(),
});
export type TeamMember = z.infer<typeof TeamMemberSchema>;

// --- Team ---

export const TeamStatusSchema = z.enum(['active', 'completed']);
export type TeamStatus = z.infer<typeof TeamStatusSchema>;

export const TeamSchema = z.object({
  name: z.string().min(1),
  createdAt: z.string(),
  leadSessionId: z.string(),
  status: TeamStatusSchema,
  members: z.array(TeamMemberSchema),
  sourceProfile: z.string().optional(),
});
export type Team = z.infer<typeof TeamSchema>;

// --- Task ---

export const TaskStatusSchema = z.enum(['pending', 'in_progress', 'completed']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TeamTaskSchema = z.object({
  id: z.string().min(1),
  subject: z.string().min(1),
  description: z.string(),
  status: TaskStatusSchema,
  owner: z.string().optional(),
  blockedBy: z.array(z.string()),
  createdAt: z.string(),
  completedAt: z.string().optional(),
});
export type TeamTask = z.infer<typeof TeamTaskSchema>;

// --- Project Profile ---

export const SignalTypeSchema = z.enum([
  'dead-code',
  'todo',
  'missing-docs',
  'missing-tests',
  'security-concern',
  'lint-issues',
  'stale-deps',
]);
export type SignalType = z.infer<typeof SignalTypeSchema>;

export const SeveritySchema = z.enum(['low', 'medium', 'high']);
export type Severity = z.infer<typeof SeveritySchema>;

export const ProjectSignalSchema = z.object({
  type: SignalTypeSchema,
  severity: SeveritySchema,
  count: z.number().int().nonnegative(),
  locations: z.array(z.string()),
});
export type ProjectSignal = z.infer<typeof ProjectSignalSchema>;

export const ProjectProfileSchema = z.object({
  repoRoot: z.string(),
  languages: z.array(z.string()),
  frameworks: z.array(z.string()),
  structure: z.object({
    hasDocs: z.boolean(),
    hasTests: z.boolean(),
    hasCI: z.boolean(),
  }),
  signals: z.array(ProjectSignalSchema),
  generatedAgents: z.array(z.string()),
  analyzedAt: z.string(),
});
export type ProjectProfile = z.infer<typeof ProjectProfileSchema>;

// --- JSON-RPC Messages ---

export interface TeamRpcRequest {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params: Record<string, unknown>;
}

export interface TeamRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params: Record<string, unknown>;
}

export type TeammateIncoming =
  | { method: 'team.assignTask'; params: { task: TeamTask } }
  | { method: 'team.message'; params: { from: string; content: string } }
  | { method: 'team.shutdown'; params: { reason: string } }
  | { method: 'team.updateContext'; params: { tasks: TeamTask[] } };

export type TeammateOutgoing =
  | { method: 'team.ready'; params: { name: string } }
  | { method: 'team.taskUpdate'; params: { taskId: string; status: TaskStatus; result?: string } }
  | { method: 'team.message'; params: { to: string; content: string } }
  | { method: 'team.idle'; params: { lastTask?: string } }
  | { method: 'team.shutdownAck'; params: Record<string, never> }
  | { method: 'team.log'; params: { level: string; text: string } };
