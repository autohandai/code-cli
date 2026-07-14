# GitHub Actions Workflows

This directory contains automated CI/CD workflows for the Autohand CLI project.

## Workflows

### 🚀 Release (`release.yml`)

**Triggers:**
- Push to `main` (alpha release)
- Manual workflow dispatch

**What it does:**
1. **Determines version** based on the selected release channel
   - Alpha bumps the patch from the latest stable tag and appends the short SHA
   - Stable releases use the current `package.json` version unless manually overridden

2. **Builds binaries** for all platforms:
   - macOS Apple Silicon (`autohand-macos-arm64`)
   - macOS Intel (`autohand-macos-x64`)
   - Linux x64 (`autohand-linux-x64`)
   - Linux ARM64 (`autohand-linux-arm64`)
   - Windows x64 (`autohand-windows-x64.exe`)

3. **Generates release notes** from the correct previous release tag

4. **Creates GitHub Release** with binaries attached

5. **Updates the public Homebrew tap** from the verified release archives (stable releases only)

6. **Publishes to npm** (stable releases only)

**Release Channels:**
- **main push** → `v1.2.4-alpha.abc1234` (next patch from the latest stable tag plus short SHA)
- **manual release** → `v1.2.3` (stable)

### ✅ CI (`ci.yml`)

**Triggers:**
- Pull requests to `main`, `beta`, `alpha`
- Push to any branch (except main, beta, alpha)

**What it does:**
1. Type checking
2. Build verification
3. Test execution
4. Multi-platform build test

### 🤖 Model catalog pull requests (`model-catalog-pr.yml`)

**Trigger:**
- A repository owner, member, or collaborator opens the **Add model catalog entry** issue form

**What it does:**
1. Reads the provider and model ID from the structured issue form
2. Validates the provider against `src/providers/models.json`
3. Rejects malformed IDs and reports duplicate models without changing the catalog
4. Appends the model while preserving provider defaults and existing model order
5. Pushes an issue-specific automation branch and opens a pull request against the default branch
6. Links the pull request from the issue for normal maintainer review

Optional display name, context-window, and reasoning-effort values produce a structured model entry. Requests without metadata preserve the provider's existing string/object entry style. The workflow never approves or merges its own pull request.

## Setup Requirements

### Repository Secrets

Add these secrets in GitHub Settings → Secrets → Actions:

1. **`NPM_TOKEN`** (required for npm publishing)
   ```bash
   # Generate at https://www.npmjs.com/settings/<your-username>/tokens
   # Type: Automation token
   ```

2. **`MODEL_CATALOG_PR_TOKEN`** (optional for model catalog pull requests)
   - Fine-grained token with repository Contents, Issues, and Pull requests read/write access
   - When omitted, the workflow uses the repository `GITHUB_TOKEN`
   - Configure this token when automated pull requests must trigger other GitHub Actions workflows

3. **`TAP_GITHUB_TOKEN`** (required for stable releases)
   - Fine-grained token with Contents read/write access to `autohandai/homebrew-code`
   - The tap repository must remain public so Homebrew users can install without GitHub credentials

### Repository Settings

1. **Enable Actions**
   - Settings → Actions → General
   - Allow all actions and reusable workflows

2. **Workflow Permissions**
   - Settings → Actions → General → Workflow permissions
   - ✅ Read and write permissions
   - ✅ Allow GitHub Actions to create pull requests

## Adding a provider model through an issue

1. Open **Issues → New issue → Add model catalog entry**.
2. Select one of the providers currently defined in `src/providers/models.json`.
3. Enter the provider's exact model card or API model ID.
4. Optionally add a display name, context window, and reasoning effort.
5. Submit the issue from an account associated with the repository as an owner, member, or collaborator.
6. Review and manually merge the pull request linked by the workflow.

The provider dropdown is covered by a repository test so catalog/provider drift fails CI. If the model already exists, the workflow comments on the issue and does not open an empty pull request.

## Usage

### Automatic Release (Recommended)

1. Make changes and commit with conventional commits:
   ```bash
   git commit -m "feat: add new feature"
   git commit -m "fix: resolve bug"
   ```

2. Merge to appropriate branch:
   ```bash
   # For alpha testing
   git checkout alpha
   git merge feature-branch
   git push

   # For beta testing
   git checkout beta
   git merge alpha
   git push

   # For stable release
   git checkout main
   git merge beta
   git push
   ```

3. GitHub Actions automatically:
   - Determines version
   - Builds binaries
   - Generates release notes
   - Creates release

### Manual Release

1. Go to: Actions → Release → Run workflow
2. Choose:
   - **Branch**: main or another release source branch
   - **Version**: Leave empty for auto, or specify (e.g., `1.2.3`)
   - **Channel**: alpha/release
3. Click "Run workflow"

## Version Strategy

### Semantic Versioning (SemVer)

Format: `MAJOR.MINOR.PATCH[-prerelease]`

- **MAJOR**: Breaking changes
- **MINOR**: New features
- **PATCH**: Bug fixes and small improvements

### Prerelease Tags

- **Alpha**: `1.2.4-alpha.abc1234` (next patch from the latest stable tag plus short SHA)
- **Release**: `1.2.3` (no suffix)

## Release Notes Generation

The workflow automatically generates release notes from commits and attaches them
to the GitHub Release. Stable releases compare against the previous stable tag, so
a release like `v0.9.2` compares against `v0.9.1` even if there was a same-commit
alpha tag such as `v0.9.2-alpha.<sha>`. Alpha releases compare against the
previous reachable release tag.

Commits are categorized as:

- ⚠️ **BREAKING CHANGES**: Breaking changes
- ✨ **Features**: New features
- 🐛 **Bug Fixes**: Bug fixes
- **Updates**: User-visible non-conventional commit subjects
- 🔧 **Maintenance**: Chores and maintenance

## Troubleshooting

### Build Fails

Check:
1. All dependencies are in `package.json`
2. TypeScript compiles without errors (`bun run typecheck`)
3. Bun version compatibility

### Release Not Created

Check:
1. The last commit is not a version bump commit (contains `chore(release):`)
2. Repository has write permissions enabled

### npm Publish Fails

Check:
1. `NPM_TOKEN` secret is set and valid
2. Package name is available on npm
3. Version doesn't already exist on npm

## Local Testing

Test the build locally before pushing:

```bash
# Build all platforms
bun run compile:all

# Test a specific platform
bun run compile:macos-arm64

# Verify binary
./binaries/autohand-macos-arm64 --help
```

## Monitoring

View workflow runs:
- Repository → Actions tab
- Click on workflow run to see logs
- Download artifacts from completed runs
