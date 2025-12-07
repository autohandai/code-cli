# Conventional Commits Guide

This project follows [Conventional Commits](https://www.conventionalcommits.org/) for automated versioning and changelog generation.

## Commit Message Format

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

## Types

- **feat**: A new feature (triggers MINOR version bump)
- **fix**: A bug fix (triggers PATCH version bump)
- **docs**: Documentation only changes
- **style**: Changes that don't affect code meaning (formatting, etc)
- **refactor**: Code change that neither fixes a bug nor adds a feature
- **perf**: Performance improvements
- **test**: Adding or updating tests
- **chore**: Maintenance tasks, dependency updates, etc

## Breaking Changes

To trigger a MAJOR version bump, use `!` or `BREAKING CHANGE:`:

```bash
# Option 1: ! in type
feat!: remove support for Node 16

# Option 2: BREAKING CHANGE footer
feat: update API structure

BREAKING CHANGE: API endpoints have changed from v1 to v2 format
```

## Examples

### Feature (0.1.0 → 0.2.0)
```bash
git commit -m "feat: add sub-agents parallel execution"
git commit -m "feat(agents): implement markdown-based agent definitions"
```

### Bug Fix (0.1.0 → 0.1.1)
```bash
git commit -m "fix: resolve command palette crash on ESC"
git commit -m "fix(session): prevent race condition in session save"
```

### Breaking Change (0.1.0 → 1.0.0)
```bash
git commit -m "feat!: redesign configuration file structure"

# Or with body:
git commit -m "feat: update agent API

BREAKING CHANGE: Agent constructor now requires OpenRouterClient as first parameter"
```

### Chore (no version bump in changelog)
```bash
git commit -m "chore: update dependencies"
git commit -m "chore(deps): bump zod to 4.1.12"
git commit -m "docs: update installation guide"
```

## Scopes (Optional)

Use scopes to specify which part of the codebase is affected:

- `agents` - Sub-agents system
- `session` - Session management
- `ui` - User interface components
- `core` - Core agent logic
- `tools` - Tool system
- `config` - Configuration
- `deps` - Dependencies

## Release Channels

### Main Branch (Stable Releases)
```bash
git checkout main
git merge beta  # After beta testing
git push
# → Triggers release: v1.2.3
```

### Beta Branch (Beta Releases)
```bash
git checkout beta
git merge alpha
git push
# → Triggers release: v1.2.3-beta.202511221100
```

### Alpha Branch (Alpha Releases)
```bash
git checkout alpha
git commit -m "feat: experimental feature"
git push
# → Triggers release: v1.2.3-alpha.20251122110530
```

## Multi-line Commits

For detailed changes:

```bash
git commit -m "feat(agents): add parallel execution support

- Implement AgentDelegator class
- Add delegate_task and delegate_parallel tools
- Support up to 5 concurrent agents
- Add /agents command to list available agents

Closes #42"
```

## Workflow

1. **Development**: Work on feature branch
2. **Alpha**: Merge to `alpha` → triggers alpha release
3. **Beta**: Merge `alpha` to `beta` → triggers beta release  
4. **Release**: Merge `beta` to `main` → triggers stable release

## Manual Release

You can also trigger a release manually via GitHub Actions:

1. Go to Actions → Release
2. Click "Run workflow"
3. Select version (or leave empty for auto)
4. Select channel (alpha/beta/release)
5. Click "Run workflow"
