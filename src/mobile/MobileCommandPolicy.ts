/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface MobileCommandPolicy {
  readonly subcommands: ReadonlySet<string>;
}

export type MobileComposerExecutableCommand =
  | '/plan'
  | '/goal'
  | '/deep-research'
  | '/autoresearch'
  | '/automode';

export type MobileCommandInvocationDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

const PLAN_SUBCOMMANDS = new Set(['on', 'off', 'status']);
const GOAL_SUBCOMMANDS = new Set(['writer', 'templates']);
const GOAL_CONTROL_WORDS = new Set([
  'writer',
  'write',
  'refine',
  'queue',
  'pause',
  'resume',
  'complete',
  'clear',
  'templates',
]);
const DEEP_RESEARCH_SUBCOMMANDS = new Set(['status']);
const AUTORESEARCH_SUBCOMMANDS = new Set(['status', 'history', 'pareto', 'off']);
const AUTORESEARCH_CONTROL_WORDS = new Set([
  'off',
  'clear',
  'export',
  'finalize',
  'status',
  'history',
  'replay',
  'rescore',
  'compare',
  'pareto',
  'pin',
  'unpin',
  'prune',
]);
const AUTOMODE_SUBCOMMANDS = new Set([
  'on',
  'off',
  'status',
  'pause',
  'resume',
  'cancel',
]);

const MOBILE_COMMAND_POLICIES: ReadonlyMap<string, MobileCommandPolicy> = new Map([
  ['/plan', { subcommands: PLAN_SUBCOMMANDS }],
  ['/goal', { subcommands: GOAL_SUBCOMMANDS }],
  ['/deep-research', { subcommands: DEEP_RESEARCH_SUBCOMMANDS }],
  ['/autoresearch', { subcommands: AUTORESEARCH_SUBCOMMANDS }],
  ['/automode', { subcommands: AUTOMODE_SUBCOMMANDS }],
]);

function rejected(reason: string): MobileCommandInvocationDecision {
  return { allowed: false, reason };
}

function validateArgumentEnvelope(args: readonly string[]): MobileCommandInvocationDecision {
  if (args.length > 64) return rejected('The mobile command has too many arguments.');
  let totalLength = 0;
  for (const arg of args) {
    if (
      typeof arg !== 'string'
      || !arg
      || arg !== arg.trim()
      || arg.length > 500
      || arg.includes('\0')
      || /[\r\n]/.test(arg)
    ) {
      return rejected('The mobile command contains an invalid argument.');
    }
    totalLength += arg.length;
  }
  return totalLength <= 4_000
    ? { allowed: true }
    : rejected('The mobile command arguments are too long.');
}

function exactSubcommand(
  command: string,
  args: readonly string[],
  subcommands: ReadonlySet<string>,
): MobileCommandInvocationDecision {
  if (args.length === 1 && subcommands.has(args[0].toLowerCase())) {
    return { allowed: true };
  }
  return rejected(`${command} requires an explicitly allowed mobile subcommand.`);
}

function validateGoal(args: readonly string[]): MobileCommandInvocationDecision {
  if (args.length === 0) {
    return rejected('/goal requires a goal objective or the writer shortcut.');
  }
  const first = args[0].toLowerCase();
  if (first === 'writer') return { allowed: true };
  if (first === 'templates') {
    return args.length === 1
      ? { allowed: true }
      : rejected('/goal templates does not accept additional mobile arguments.');
  }
  if (GOAL_CONTROL_WORDS.has(first)) {
    return rejected(`The /goal ${first} control is not available from mobile.`);
  }
  if (args.some((arg) => arg.startsWith('--'))) {
    return rejected('Goal template flags are not available from mobile.');
  }
  return { allowed: true };
}

function validateDeepResearch(args: readonly string[]): MobileCommandInvocationDecision {
  if (args.length === 0) {
    return rejected('/deep-research requires a topic or the status subcommand.');
  }
  if (args[0].toLowerCase() === 'status') {
    return args.length === 1
      ? { allowed: true }
      : rejected('/deep-research status does not accept additional mobile arguments.');
  }
  if (args.some((arg) => arg.startsWith('--'))) {
    return rejected('Deep-research flags are not available from mobile.');
  }
  return { allowed: true };
}

function validateAutoresearch(args: readonly string[]): MobileCommandInvocationDecision {
  if (args.length === 0) {
    return rejected('/autoresearch requires an objective or an allowed status/mode subcommand.');
  }
  const first = args[0].toLowerCase();
  if (AUTORESEARCH_SUBCOMMANDS.has(first)) {
    return args.length === 1
      ? { allowed: true }
      : rejected(`/autoresearch ${first} does not accept additional mobile arguments.`);
  }
  if (AUTORESEARCH_CONTROL_WORDS.has(first)) {
    return rejected(`The /autoresearch ${first} control is not available from mobile.`);
  }
  if (args.some((arg) => arg.startsWith('--'))) {
    return rejected('Auto-research flags and evaluator commands are not available from mobile.');
  }
  return { allowed: true };
}

export function isMobileCommandPermitted(
  command: string,
): command is MobileComposerExecutableCommand {
  return MOBILE_COMMAND_POLICIES.has(command);
}

export function isMobileSubcommandPermitted(command: string, subcommand: string): boolean {
  return MOBILE_COMMAND_POLICIES.get(command)?.subcommands.has(subcommand) === true;
}

export function validateMobileCommandInvocation(
  command: string,
  args: readonly string[],
): MobileCommandInvocationDecision {
  if (!isMobileCommandPermitted(command)) {
    return rejected(`Command ${command || '(blank)'} is not available from mobile.`);
  }
  const envelope = validateArgumentEnvelope(args);
  if (!envelope.allowed) return envelope;

  switch (command) {
    case '/plan':
      return exactSubcommand(command, args, PLAN_SUBCOMMANDS);
    case '/goal':
      return validateGoal(args);
    case '/deep-research':
      return validateDeepResearch(args);
    case '/autoresearch':
      return validateAutoresearch(args);
    case '/automode':
      return exactSubcommand(command, args, AUTOMODE_SUBCOMMANDS);
    default:
      return rejected(`Command ${command} is not available from mobile.`);
  }
}

export async function validateMobileCommandInvocationForWorkspace(
  command: string,
  args: readonly string[],
  workspaceRoot: string,
): Promise<MobileCommandInvocationDecision> {
  const decision = validateMobileCommandInvocation(command, args);
  if (!decision.allowed || command !== '/goal') return decision;
  const first = args[0]?.toLowerCase();
  if (!first || first === 'writer' || first === 'templates') return decision;

  try {
    const { listGoalTemplateMetadata } = await import('../goals/templates.js');
    const templates = await listGoalTemplateMetadata(workspaceRoot);
    const templateInvocation = templates.some((template) =>
      template.name === args[0] || template.aliases.includes(args[0])
    );
    return templateInvocation
      ? rejected('Goal templates are not executable from mobile; provide a plain objective instead.')
      : decision;
  } catch {
    return rejected('The CLI could not safely validate local goal templates.');
  }
}
