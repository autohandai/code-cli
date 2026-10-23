/**
 * Document Factory — trusted runtime entrypoint.
 *
 * Registers the `/factory` slash command. The command seeds a staff-level
 * engineering document factory instruction that the agent executes with its
 * sub-agent tools (delegate_task / delegate_parallel), producing, in order:
 *
 *   TRD → PRD → Implementation Design → TDD → Code → ADRs
 *
 * The runtime command itself cannot enqueue instructions into the agent
 * session or spawn sub-agents; it returns the orchestration instruction that
 * the user runs. This is the documented boundary for extension slash commands.
 */

import type { ExtensionRuntimeAPI } from '../../../../src/extensions/ExtensionRuntimeHost.js';

const ARTIFACTS = {
  trd: {
    label: 'Technical Requirements Document (TRD)',
    file: 'docs/trd.md',
  },
  prd: {
    label: 'Product Requirements Document (PRD)',
    file: 'docs/prd.md',
  },
  design: {
    label: 'Implementation Design',
    file: 'docs/implementation-design.md',
  },
  tdd: {
    label: 'Test-Driven Development plan (TDD)',
    file: 'docs/tdd.md',
  },
  code: {
    label: 'Implementation (Code)',
    file: 'src/',
  },
  adr: {
    label: 'Architecture Decision Records (ADRs)',
    file: 'docs/adr/',
  },
} as const;

type ArtifactKey = keyof typeof ARTIFACTS;

const ARTIFACT_KEYS: ArtifactKey[] = ['trd', 'prd', 'design', 'tdd', 'code', 'adr'];

const ARTIFACT_ALIASES: Record<string, ArtifactKey> = {
  trd: 'trd',
  technical: 'trd',
  requirements: 'trd',
  prd: 'prd',
  product: 'prd',
  design: 'design',
  implementation: 'design',
  impl: 'design',
  tdd: 'tdd',
  tests: 'tdd',
  test: 'tdd',
  code: 'code',
  adr: 'adr',
  adrs: 'adr',
  architecture: 'adr',
};

function resolveTargets(args: string[]): ArtifactKey[] | 'all' {
  const positional = args.filter((arg) => !arg.startsWith('-'));
  if (positional.length === 0) {
    return 'all';
  }
  const keys = positional.map((arg) => ARTIFACT_ALIASES[arg.toLowerCase()]).filter(Boolean);
  if (keys.length === 0) {
    return 'all';
  }
  return [...new Set(keys)];
}

function featureName(args: string[]): string {
  const positional = args.filter((arg) => !arg.startsWith('-'));
  const known = new Set(Object.keys(ARTIFACT_ALIASES));
  const feature = positional.find((arg) => !known.has(arg.toLowerCase()));
  return feature ?? 'the requested feature';
}

function artifactLine(key: ArtifactKey): string {
  const artifact = ARTIFACTS[key];
  return `- **${artifact.label}** → write to \`${artifact.file}\` (relative to the workspace root).`;
}

function orchestrationInstruction(feature: string, targets: ArtifactKey[] | 'all'): string {
  const scope = targets === 'all'
    ? 'the full pipeline'
    : targets.map((key) => ARTIFACTS[key].label).join(', ');

  const selected = targets === 'all' ? ARTIFACT_KEYS : targets;

  const lines = selected.map((key) => artifactLine(key)).join('\n');

  return [
    `You are acting as a **staff-level software engineer** running the Document Factory for: **${feature}**.`,
    '',
    `Scope: ${scope}. Produce the following artifacts in strict dependency order, each written to its declared path:`,
    '',
    lines,
    '',
    '## Execution contract',
    '',
    '1. **Orchestrate with sub-agents.** Use `delegate_task` (and `delegate_parallel` for independent artifacts) to assign each artifact to a focused specialist. Give each sub-agent a bounded objective, owned scope, acceptance criteria, relevant context, and required evidence. Synthesize the returned results yourself; delegation does not prove completion.',
    '2. **Order matters.** TRD must precede PRD; PRD must precede Implementation Design; Implementation Design must precede TDD; TDD must precede Code; ADRs are written as decisions are made and finalized last. Each downstream artifact must reference and stay consistent with its upstream inputs.',
    '3. **Staff-level quality.** Each document must be precise, testable, and actionable — no filler, no vague acceptance criteria, no hand-waving. Use strong types, explicit interfaces, and concrete examples.',
    '4. **TDD discipline.** Write the failing tests first, then implement the minimal code that makes them pass. Do not write code before the tests exist.',
    '5. **ADRs.** Record every significant architectural decision as an ADR in `docs/adr/` using the repo\'s ADR convention (numbered, dated, with Context / Decision / Consequences).',
    '6. **Verify.** After producing Code, run the build and the tests. Fix any failures you introduced before declaring success.',
    '7. **Report.** Finish with a concise summary of every artifact created, its path, the sub-agents used, and the checks that passed.',
    '',
    'Do not stop at scaffolding. Complete the full scope above, then report the actual outcome.',
  ].join('\n');
}

export async function activate(api: ExtensionRuntimeAPI) {
  api.commands.register({
    command: '/factory',
    description: 'Seed a staff-level document factory (TRD, PRD, Design, TDD, Code, ADRs) with sub-agents',
    execute(context) {
      const targets = resolveTargets(context.args);
      const feature = featureName(context.args);
      return orchestrationInstruction(feature, targets);
    },
  });

  return async () => {
    // No long-lived resources owned by this extension.
  };
}
