# Release Autohand Code

The release pipeline is `.github/workflows/release.yml`. Use Node.js 24 and the Bun version declared in `package.json` for local validation and CI.

## Prepare a stable release

1. Commit the intended source changes and run focused tests, lint, typecheck, build, and `bun run proof`. Verify the real terminal scenarios for changed interactive behavior. An interrupted proof or a focused replay does not establish a passing complete proof.
2. After the health check passes, set the package version, update `CHANGELOG.md`, and add curated notes at `docs/changelog/whats-new-<version>.md`. Generate and inspect the final notes with `.github/generate-release-notes.mjs`.
3. Open the release pull request and satisfy the repository's Main ruleset and required review. Preserve linear main history using an allowed merge method. The optional `full-proof` PR label runs the complete proof on a clean GitHub runner with two isolated terminal workers and a 90-minute job budget. Ordinary terminal runs remain serial; test assertions and individual deadlines are unchanged.
4. Dispatch the stable release from the approved commit on main:

```sh
gh workflow run release.yml --ref main -f version=0.9.11 -f channel=release
```

If the workflow has been disabled by a maintainer, it must be enabled for an authorized release before dispatch. Enabling it also enables its main-push trigger. A push to main produces an **alpha**, not a stable release; a stable release requires manual dispatch with `channel=release`.

## Required credentials

Configure secrets in GitHub repository settings; keep their values out of source and logs:

- `CSC_LINK`, `CSC_KEY_PASSWORD`, and `APPLE_TEAM_ID` for the Developer ID signing identity.
- `APPLE_API_KEY`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER` for Apple notarization.
- `AHTRACES_REPO_TOKEN` to read the pinned private ahtraces component.
- `NPM_TOKEN` for npm publication.
- `TAP_GITHUB_TOKEN` for the production Homebrew tap update.

Every release channel requires Apple credentials. Missing credentials stop publication; there is no unsigned stable fallback. A configured secret name alone does not prove that its value works: the signing and notarization jobs provide that evidence.

## Validation and publication

The pipeline validates the requested version, runs unit and built terminal tests in separate shards, builds the platform matrix, signs and notarizes macOS artifacts, and verifies the transported macOS artifacts on native runners. It then publishes GitHub assets and checksums, updates the stable Homebrew tap, and publishes npm with the appropriate dist-tag (`latest` for stable or `alpha` for alpha).

The installer compatibility workflow uses a read-only GitHub token for alpha release metadata, while public installs continue to work without a token. Discovery retains API errors and uses bounded connection/retry timeouts.

Linux validation jobs install ripgrep explicitly because backend-specific search tests require the real executable. Filesystem-walk fallback tests remain separate. MLX HTTP transport tests use a supported-runtime fixture while dedicated provider tests retain the unsupported-platform guard. Windows first-run checks assert the same approved orientation prompt as the Unix installer.

Terminal regression tests should wait for observable screen or output conditions. For working-state repaint checks, hold the mock model response until the expected refresh appears, then release it and check completion and the retained draft. A fixed sleep does not establish that an elapsed-status update occurred on a shared runner.

Before calling a release published, inspect the completed workflow, GitHub release assets and checksums, the npm version and dist-tag, and the Homebrew formula. Keep exact source, artifact, signing, native-runtime, and publication evidence separate. A draft release or an uploaded local package is not a published stable release.

See [workflow details](../.github/workflows/README.md) for the platform matrix and component pins.
