# ADR: share project memory within a selected team account

Status: Accepted

## Context

Personal memory sync is keyed by user, and project memory lives in a local workspace. The Console's administrative view does not share those libraries with other agents. Teammates need a common source for coding conventions, architectural decisions and project lessons while personal preferences remain separate.

## Decision

Use a separate project event log keyed by the explicitly selected team account and a SHA-256 repository identity. Canonical Git origins identify repositories across local paths, branches and worktrees. Require current team membership on every API request; allow contributors to participate and enforce existing read-only permissions.

Reuse the existing memory event validation, merge, replay and projection. Conditional R2 writes merge concurrent contributions without replacing another member's history. Keep the CLI cache outside personal file sync, scoped to profile, account and repository. Seed only the local project's existing memories; never seed another team's cache or a user's personal library.

Refresh before each agent turn and after project mutations. Pin storage operations across asynchronous work and filesystem locks. Capture each deferred memory writer's account/project scope before its provider call and recheck it inside the write lock before saving project facts. Recheck account, credentials and repository before accepting network responses. Remove older shared-memory snapshots from system notes before inserting current context. Preserve historical user/assistant/tool messages and private preferences.

## Alternatives

- Pooling personal libraries would expose unrelated preferences and cannot reliably assign those entries to a repository.
- Identifying projects by local directory name would merge unrelated repositories and miss equivalent clones.
- Uploading shared data through personal sync would keep it user-owned and expose it after account changes.
- Replacing whole files on sync would lose concurrent writes and could resurrect deleted conventions.

## Consequences

Sharing activates only with an explicit team selection, authentication, enabled sync and a supported Git origin. Local-only projects and disconnected individual use continue with local memories. Offline shared writes remain pending; successful sync is eventually consistent. The log does not reconcile contradictory architectural decisions semantically. Personal entry ceilings apply to personal libraries; the separate project pool has a 10 MiB bound. Deploy the API before distributing the updated CLI.
