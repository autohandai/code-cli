# Document Factory

A trusted Autohand extension that seeds a **staff-level engineering document factory** through the `/factory` slash command.

The command returns a precise orchestration instruction that the agent executes with its sub-agent tools (`delegate_task` / `delegate_parallel`), producing, in strict dependency order:

1. **TRD** — Technical Requirements Document → `docs/trd.md`
2. **PRD** — Product Requirements Document → `docs/prd.md`
3. **Implementation Design** → `docs/implementation-design.md`
4. **TDD** — Test-Driven Development plan → `docs/tdd.md`
5. **Code** — the implementation → `src/`
6. **ADRs** — Architecture Decision Records → `docs/adr/`

## Why a seeded instruction?

Extension runtime slash commands cannot enqueue instructions into the agent session or spawn sub-agents directly. The documented boundary is that a command returns a string (or opens a view). `/factory` therefore returns a complete, staff-level orchestration instruction that the agent runs — including the sub-agent delegation contract, ordering constraints, TDD discipline, ADR convention, verification, and reporting requirements.

## Usage

```sh
# Full pipeline (default)
/factory

# Full pipeline for a named feature
/factory <feature-name>

# A single artifact (or a subset)
/factory trd
/factory prd
/factory design
/factory tdd
/factory code
/factory adr
/factory trd prd design
```

Aliases are accepted: `technical`/`requirements` → TRD, `product` → PRD, `implementation`/`impl` → design, `tests`/`test` → TDD, `architecture` → ADR.

## Install

```sh
autohand extensions validate ./examples/extensions/autohand.document-factory
autohand extensions install ./examples/extensions/autohand.document-factory --trust
autohand extensions show autohand.document-factory
autohand extensions doctor
```

`--trust` is required because the manifest declares `contributes.runtime`. Review `src/extension.ts` (and the compiled `dist/extension.mjs`) before trusting it.

## Remove

```sh
autohand extensions remove autohand.document-factory --yes
```

## Provenance

- Source: this repository (`examples/extensions/autohand.document-factory`).
- Runtime entrypoint: `dist/extension.mjs`, compiled from `src/extension.ts` with esbuild.
- No dependencies; no external network access; no long-lived resources.