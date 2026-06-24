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

3. **Generates changelog** from commit history

4. **Creates GitHub Release** with binaries attached

5. **Publishes to npm** (stable releases only)

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

## Setup Requirements

### Repository Secrets

Add these secrets in GitHub Settings → Secrets → Actions:

1. **`NPM_TOKEN`** (required for npm publishing)
   ```bash
   # Generate at https://www.npmjs.com/settings/<your-username>/tokens
   # Type: Automation token
   ```

### Repository Settings

1. **Enable Actions**
   - Settings → Actions → General
   - Allow all actions and reusable workflows

2. **Workflow Permissions**
   - Settings → Actions → General → Workflow permissions
   - ✅ Read and write permissions
   - ✅ Allow GitHub Actions to create pull requests

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
   - Generates changelog
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

## Changelog Generation

The workflow automatically generates changelogs from commits, categorizing them:

- ⚠️ **BREAKING CHANGES**: Breaking changes
- ✨ **Features**: New features
- 🐛 **Bug Fixes**: Bug fixes
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
