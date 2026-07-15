# Agentic extension builder and Pi compatibility

Status: COMPLETE

## Objective

Make Autohand extension authoring agentic: ship a built-in `$extension-builder` skill that can create or extend declarative extensions from a user description, adapt Pi and pi-mono packages without executing untrusted TypeScript, install the result, and remain independently installable through the Autohand community registry and `npx skills` / skills.sh ecosystem.

## Completion contract

- The built CLI discovers `$extension-builder` from packaged built-in skills.
- Exact `$extension-builder` mentions activate and inject its instructions in the same turn.
- Extension API v1 accepts tools, agents, and portable Agent Skills while preserving strict paths, conflict rejection, no install-time code execution, canonical permissions, and atomic lifecycle operations.
- Valid Pi Agent Skills can be reused directly; Pi TypeScript capability adaptation has an explicit, evidence-backed compatibility matrix and never silently drops behavior.
- Unit, integration, built-artifact Tuistory, lint, typecheck, and full proof pass.
- `extension-builder` exists in `autohandai/community-skills`, passes its registry validator, is installable by Autohand's skill installer, and is discoverable/installable through skills.sh's `npx skills` flow.
- Every repository change is committed with the required co-author trailer, and published external state is verified after push or merge.

## Implementation slices

1. [x] Add failing coverage for extension skill contributions, runtime refresh, exact `$` mention injection, built-in skill packaging, and built-CLI discovery.
2. [x] Extend the manifest, schema, registry, service, CLI output, and runtime skill registry for `contributes.skills`.
3. [x] Author the built-in `extension-builder` skill with focused Autohand and Pi references.
4. [x] Document authoring, installation, security, Pi mapping, and the same-turn `$extension-builder` workflow.
5. [x] Run the focused Tuistory scenario, complete regression suites, lint, build, full proof, and package-content verification.
6. [x] Add and validate the matching curated community skill and registry metadata.
7. [x] Merge the community registry publication, run the canonical `npx skills` install flow, and verify the live skills.sh catalog entry.
8. [x] Commit and publish the validated CLI implementation without including unrelated local work.

## Validation evidence

- `bun run proof`: 470 unit test files passed, 2 skipped; 7,102 tests passed, 26 skipped; ESM, CJS, and declarations built; 3 Tuistory files and all 33 real-terminal scenarios passed.
- Package dry-runs included `SKILL.md`, `agents/openai.yaml`, and both references in the npm artifact.
- The TypeScript SDK wrapper passed its `prepublishOnly` gate with 65 tests, typecheck, build, and lint.
- The public Autohand catalog contained 1,129 skills and installed `extension-builder` with all four files into a clean project as source `community`.
- The canonical `npx skills add https://github.com/autohandai/community-skills --skill extension-builder -a codex -y` flow succeeded.
- Community registry pull requests 5, 6, and 7 were merged; the public skills.sh page is live.
- The CLI implementation was committed with the required co-author trailer and published in `autohandai/code-cli` pull request 422.

## Future improvements

- Add a first-class dry-run adaptation report format for Pi packages after real-world conversion examples establish a stable contract.
- Consider signed remote extension bundles only after immutable source pinning, provenance, and trust policy are designed.
- Expand the declarative API only for capabilities that can retain the current permission and no-install-execution guarantees.
- Add compatibility fixtures from maintained Pi packages as upstream licenses and semantics permit.
