# Model catalog updates

Autohand Code CLI ships a bundled model catalog and can layer newer model definitions over it without requiring a CLI release. The downloaded catalog uses the same provider-keyed model shape as Pi and is published at:

```text
https://code.autohand.ai/cli/models.json
```

## CLI behavior

At normal startup, Autohand checks for a catalog update when the last successful check is at least four hours old. A failed check enters a 15-minute retry backoff. Network, HTTP, validation, and write errors never prevent the CLI from starting.

The CLI resolves model definitions in this order:

1. `~/.autohand/models.json`, or the file selected by `AUTOHAND_MODELS_CATALOG`
2. the last valid downloaded catalog at `~/.autohand/model-catalog/models.json`
3. the catalog bundled with the installed CLI

Entries are merged by provider and model ID. This keeps local overrides authoritative, makes the downloaded catalog available offline after its first successful refresh, and preserves a working fallback when the public endpoint is unavailable or returns invalid data.

Refresh the catalog immediately with either CLI alias:

```bash
autohand update --models
autohand upgrade --models
```

Disable automatic startup network work for one session or for an environment:

```bash
autohand --offline
AUTOHAND_OFFLINE=1 autohand
```

`AUTOHAND_MODELS_URL` selects a different remote endpoint for development and controlled rollouts. Remote responses must be valid JSON, no larger than 5 MiB, and contain complete Pi-compatible model records. The updater uses ETags, writes the cache atomically with owner-only permissions, and retains the previous valid cache if a refresh fails.

## Public catalog shape

The published document is keyed first by provider and then by model ID. Each model is complete enough to be consumed independently:

```json
{
  "nvidia": {
    "nvidia/example-model": {
      "id": "nvidia/example-model",
      "name": "Example Model",
      "api": "openai-completions",
      "provider": "nvidia",
      "baseUrl": "https://integrate.api.nvidia.com/v1",
      "reasoning": true,
      "input": ["text"],
      "cost": {
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 131072,
      "maxTokens": 32768
    }
  }
}
```

The canonical GitHub source remains `src/providers/models.json`. It is intentionally compact and includes provider defaults used by Autohand. The publication workflow validates that source and derives the full Pi-compatible document.

## Publication lifecycle

GitHub is the source of truth for every release:

1. A model change lands on `main` in `src/providers/models.json`.
2. `publish-model-catalog.yml` generates and validates the full public catalog.
3. The workflow uploads an immutable revision under `cli/revisions/sha256-<digest>/`.
4. After the immutable objects succeed, it promotes `cli/models.json` and writes `cli/catalog.json` publication metadata.

The workflow also runs every four hours and can be dispatched manually. Scheduled runs republish only validated data from `main`; they do not discover or invent model definitions.

The website admin uses a review-first path:

1. An administrator edits a copy of the current GitHub catalog.
2. The website validates and stores an immutable draft at `cli/drafts/<id>.json` in R2.
3. The website dispatches `model-catalog-admin-pr.yml` with the Git blob SHA that was edited.
4. GitHub rejects stale drafts, validates the generated public document, and opens a pull request.
5. A maintainer reviews and merges the pull request. Only that merge can promote the public R2 catalog.

This keeps admin submissions reviewable and prevents the website, a stale browser tab, or a failed workflow from silently replacing the canonical catalog.

## Repository configuration

The publication workflows require these GitHub Actions secrets:

- `R2_ACCOUNT_ID`
- `R2_MODELS_BUCKET`
- `R2_MODELS_ACCESS_KEY_ID`
- `R2_MODELS_SECRET_ACCESS_KEY`
- `MODEL_CATALOG_PR_TOKEN` when the default `GITHUB_TOKEN` cannot create pull requests or trigger required checks

The R2 credentials should be scoped to the model-catalog bucket. The PR token should be fine-grained and restricted to this repository with Contents and Pull requests read/write access.

See `.github/workflows/README.md` for workflow setup and the website operations guide for the Pages bindings, admin secrets, Analytics Engine dataset, and custom domain.
