# Agent Skills System

Agent Skills are modular instruction packages that extend Autohand's AI agent with specialized workflows and domain expertise. Skills provide context-aware guidance, tool permissions, and structured approaches for common development tasks.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Skill Discovery](#skill-discovery)
- [SKILL.md Format](#skillmd-format)
- [Auto-Skill Generation](#auto-skill-generation)
- [Available Tools](#available-tools)
- [Creating World-Class Skills](#creating-world-class-skills)
- [Examples](#examples)
- [Best Practices](#best-practices)

---

## Overview

Skills work like on-demand `AGENTS.md` files that can be activated for specific tasks. Each skill contains:

- **Purpose statement** - What the skill does
- **Usage examples** - Concrete prompts showing how to use it
- **Workflow steps** - Actionable procedures for the agent
- **Tool permissions** - Which tools the skill can use

When activated, skills inject their instructions into the agent's context, providing specialized guidance for the task at hand.

---

## Quick Start

### List Available Skills

```bash
# In Autohand REPL
/skills
```

### Use a Skill

```bash
/skills use changelog-generator
```

### Create a New Skill

```bash
/skills new
```

### Auto-Generate Project Skills

```bash
autohand --auto-skill
```

---

## Skill Discovery

Skills are discovered from multiple locations, with later sources taking precedence:

| Location | Source ID | Description |
|----------|-----------|-------------|
| `~/.codex/skills/**/SKILL.md` | `codex-user` | User-level Codex skills (recursive) |
| `~/.claude/skills/*/SKILL.md` | `claude-user` | User-level Claude skills (one level) |
| `~/.autohand/skills/**/SKILL.md` | `autohand-user` | User-level Autohand skills (recursive) |
| `<project>/.claude/skills/*/SKILL.md` | `claude-project` | Project-level Claude skills (one level) |
| `<project>/.autohand/skills/**/SKILL.md` | `autohand-project` | Project-level Autohand skills (recursive) |

### Auto-Copy Behavior

Skills discovered from Codex or Claude locations are automatically copied to the corresponding Autohand location:

- `~/.codex/skills/` and `~/.claude/skills/` → `~/.autohand/skills/`
- `<project>/.claude/skills/` → `<project>/.autohand/skills/`

Existing skills in Autohand locations are never overwritten.

---

## SKILL.md Format

Skills use YAML frontmatter followed by markdown content:

```markdown
---
name: my-skill-name
description: Brief description of the skill (max 1024 chars)
license: MIT
compatibility: Works with Node.js 18+
allowed-tools: read_file write_file run_command git_status
metadata:
  author: your-name
  version: "1.0.0"
---

# My Skill

Detailed instructions for the AI agent...
```

### Frontmatter Fields

| Field | Required | Max Length | Description |
|-------|----------|------------|-------------|
| `name` | Yes | 64 chars | Lowercase alphanumeric with hyphens only |
| `description` | Yes | 1024 chars | Brief description of when to use this skill |
| `license` | No | - | License identifier (e.g., MIT, Apache-2.0) |
| `compatibility` | No | 500 chars | Compatibility notes |
| `allowed-tools` | No | - | Space-delimited list of allowed tools |
| `metadata` | No | - | Additional key-value metadata |

---

## Auto-Skill Generation

The `--auto-skill` flag analyzes your project and generates relevant skills based on the detected stack.

### Usage

```bash
autohand --auto-skill
```

### How It Works

1. **Project Analysis** - Scans for package.json, requirements.txt, Cargo.toml, go.mod
2. **Detection** - Identifies languages, frameworks, and patterns
3. **Platform Awareness** - Detects OS (macOS/Linux/Windows) for appropriate commands
4. **LLM Generation** - Creates 3 tailored skills with examples and tool permissions
5. **Save** - Writes skills to `<project>/.autohand/skills/`

### Detected Patterns

| Category | Detected Items |
|----------|----------------|
| **Languages** | TypeScript, JavaScript, Python, Rust, Go |
| **Frameworks** | React, Next.js, Vue, Angular, Svelte, Express, Fastify, NestJS, Flask, Django, FastAPI |
| **Patterns** | CLI tools, testing, monorepo, Docker, CI/CD, bundling, linting, database, API |
| **Package Managers** | npm, yarn, pnpm, bun, pip, cargo, go |
| **Environment** | Git repository, test framework, CI/CD pipelines |

### Example Output

```
$ autohand --auto-skill
Analyzing project structure...
Detected: typescript, javascript, react, nextjs, testing
Platform: darwin
Generating skills...
  ✓ nextjs-component-creator
    Tools: read_file, write_file, run_command
  ✓ typescript-test-generator
    Tools: read_file, write_file, run_command, search
  ✓ changelog-generator
    Tools: git_log, git_diff_range, read_file, write_file

✓ Generated 3 skills in .autohand/skills
  Use "/skills" to view and "/skills use <name>" to activate
```

---

## Available Tools

Skills can specify which tools they need via the `allowed-tools` field. Available tools by category:

### File Operations

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents |
| `write_file` | Write/create files |
| `append_file` | Append to existing files |
| `apply_patch` | Apply unified diff patches |
| `search` | Search for text patterns |
| `search_replace` | Search and replace in files |
| `search_with_context` | Search with surrounding context |
| `semantic_search` | AI-powered semantic search |
| `list_tree` | List directory structure |
| `file_stats` | Get file metadata |
| `create_directory` | Create directories |
| `delete_path` | Delete files/directories |
| `rename_path` | Rename/move files |
| `copy_path` | Copy files/directories |
| `multi_file_edit` | Edit multiple files atomically |

### Git Operations

| Tool | Description |
|------|-------------|
| `git_status` | Show working tree status |
| `git_diff` | Show uncommitted changes |
| `git_diff_range` | Show diff between commits |
| `git_log` | View commit history |
| `git_add` | Stage files |
| `git_commit` | Create commits |
| `git_branch` | List/create branches |
| `git_switch` | Switch branches |
| `git_stash` | Stash changes |
| `git_stash_list` | List stashes |
| `git_stash_pop` | Apply stashed changes |
| `git_merge` | Merge branches |
| `git_rebase` | Rebase branches |
| `git_cherry_pick` | Cherry-pick commits |
| `git_fetch` | Fetch from remote |
| `git_pull` | Pull changes |
| `git_push` | Push changes |
| `auto_commit` | Auto-generate commit message |

### Commands

| Tool | Description |
|------|-------------|
| `run_command` | Execute shell commands |
| `custom_command` | Run user-defined commands |

### Dependencies

| Tool | Description |
|------|-------------|
| `add_dependency` | Add project dependency |
| `remove_dependency` | Remove dependency |

### Memory

| Tool | Description |
|------|-------------|
| `save_memory` | Persist information |
| `recall_memory` | Retrieve saved information |

### Planning

| Tool | Description |
|------|-------------|
| `plan` | Create action plans |
| `todo_write` | Manage todo lists |

---

## Creating World-Class Skills

Great skills share these characteristics:

### 1. Clear Purpose

State exactly what the skill does and when to use it.

```markdown
# Changelog Generator

Transforms git commits into polished, user-friendly changelogs for releases.

## When to Use This Skill

- Preparing release notes
- Creating weekly update summaries
- Documenting changes for customers
```

### 2. Concrete Examples

Show exact prompts the user can try:

```markdown
## How to Use

```
Create a changelog from commits since v1.2.0
```

```
Generate release notes for the last 2 weeks
```

```
Summarize breaking changes since the last major version
```
```

### 3. Actionable Workflows

Provide numbered steps the agent should follow:

```markdown
## Workflow

1. Identify the commit range (tags, dates, or branch comparison)
2. Fetch commit history with `git_log`
3. Categorize commits by type:
   - **Features**: New functionality
   - **Fixes**: Bug corrections
   - **Breaking**: Incompatible changes
4. Transform technical commit messages into user-friendly language
5. Format as clean markdown with appropriate headers
```

### 4. Platform Awareness

Specify platform-specific commands when relevant:

```markdown
## Platform Commands

**macOS/Linux:**
```bash
npm run build && npm test
```

**Windows (PowerShell):**
```powershell
npm run build; npm test
```
```

### 5. Tool Permissions

Specify only the tools your skill needs:

```yaml
allowed-tools: git_log git_diff_range read_file write_file
```

---

## Examples

### Example 1: Changelog Generator

```markdown
---
name: changelog-generator
description: Creates user-facing changelogs from git commits. Use when preparing releases or documenting updates.
allowed-tools: git_log git_diff_range read_file write_file run_command
---

# Changelog Generator

Transforms git commits into polished, user-friendly changelogs.

## When to Use This Skill

- Preparing release notes
- Creating weekly update summaries
- Documenting changes for customers
- Comparing changes between versions

## How to Use

```
Create a changelog from commits since the last release
```

```
Generate release notes for version 2.5.0
```

```
What changed between v1.0.0 and v2.0.0?
```

## Workflow

1. Identify the commit range using tags, dates, or SHA
2. Fetch commit history with appropriate filtering
3. Categorize commits:
   - **Features** (`feat:`): New functionality
   - **Fixes** (`fix:`): Bug corrections
   - **Breaking** (`BREAKING CHANGE:`): Incompatible changes
   - **Docs** (`docs:`): Documentation updates
   - **Refactor** (`refactor:`): Code improvements
4. Transform technical commits into user-friendly language
5. Format as clean markdown with headers and bullet points
6. Highlight breaking changes prominently

## Output Format

```markdown
# Changelog

## [2.5.0] - 2024-12-23

### New Features
- Added dark mode support for all themes
- Users can now export data in CSV format

### Bug Fixes
- Fixed login timeout on slow connections
- Resolved issue with file uploads over 10MB

### Breaking Changes
- Removed deprecated `oldApi()` method - use `newApi()` instead
```

## Tips

- Run from repository root for accurate git access
- Use date ranges for focused changelogs
- Review output before publishing
- Consider your audience (developers vs end-users)
```

### Example 2: TypeScript Refactoring Guide

```markdown
---
name: typescript-refactoring
description: Guides TypeScript refactoring with type-safe patterns and best practices.
allowed-tools: read_file write_file search apply_patch run_command
---

# TypeScript Refactoring Guide

Provides patterns and step-by-step guidance for safe TypeScript refactoring.

## When to Use This Skill

- Extracting reusable functions or components
- Converting JavaScript to TypeScript
- Improving type safety
- Reducing code duplication
- Modernizing legacy patterns

## How to Use

```
Refactor this function to use generics
```

```
Extract the user validation logic into a separate module
```

```
Convert this file to strict TypeScript
```

## Workflow

1. **Analyze Current Code**
   - Read the file(s) to understand existing patterns
   - Identify type issues with `tsc --noEmit`

2. **Plan Changes**
   - List all files that need modification
   - Identify breaking changes to exports
   - Consider backward compatibility

3. **Make Changes**
   - Apply changes incrementally
   - Run type checker after each change
   - Update imports in dependent files

4. **Verify**
   - Run `tsc --noEmit` to check types
   - Run tests to confirm behavior unchanged
   - Review generated diffs

## Common Patterns

### Extract Function
```typescript
// Before
const result = items.filter(x => x.active).map(x => x.name);

// After
function getActiveNames<T extends { active: boolean; name: string }>(items: T[]): string[] {
  return items.filter(x => x.active).map(x => x.name);
}
```

### Add Type Guards
```typescript
function isUser(value: unknown): value is User {
  return typeof value === 'object' && value !== null && 'id' in value;
}
```

## Tips

- Enable `strict` mode in tsconfig for best type safety
- Use `unknown` instead of `any` when type is truly unknown
- Prefer interfaces for object shapes, types for unions
- Add JSDoc comments for complex types
```

### Example 3: Skill Creator

```markdown
---
name: skill-creator
description: Helps create new Autohand skills with proper structure and best practices.
allowed-tools: read_file write_file create_directory search
---

# Skill Creator

Guides you through creating effective, well-structured Autohand skills.

## When to Use This Skill

- Creating a new project-specific skill
- Converting workflow knowledge into reusable skills
- Sharing expertise with your team

## How to Use

```
Create a skill for generating API documentation
```

```
Help me make a skill for our deployment process
```

## Workflow

1. **Define Purpose**
   - What problem does this skill solve?
   - When should someone use it?

2. **Identify Tools**
   - Which tools does the workflow need?
   - Start minimal, add tools as needed

3. **Write Examples**
   - Create 2-3 concrete usage examples
   - Use real scenarios from your workflow

4. **Document Workflow**
   - Break down into numbered steps
   - Include decision points
   - Note platform differences if relevant

5. **Save Skill**
   - Save to `.autohand/skills/<name>/SKILL.md`
   - Test with `/skills use <name>`

## Skill Template

```markdown
---
name: your-skill-name
description: Brief description of when to use this skill
allowed-tools: read_file write_file run_command
---

# Your Skill Name

One paragraph explaining what this skill does.

## When to Use This Skill

- Scenario 1
- Scenario 2
- Scenario 3

## How to Use

\```
Example prompt 1
\```

\```
Example prompt 2
\```

## Workflow

1. First step
2. Second step
3. Third step

## Tips

- Helpful tip 1
- Helpful tip 2
```

## Tips

- Keep skills focused on one workflow
- Include real examples from your project
- Update skills as your workflow evolves
- Share skills via version control
```

---

## Best Practices

### Do

- **Be specific** - Clear purpose and concrete examples
- **Be actionable** - Numbered steps the agent can follow
- **Be minimal** - Only request necessary tools
- **Be platform-aware** - Note OS-specific commands
- **Include examples** - Show 2-3 real usage prompts

### Don't

- Don't create vague, generic skills
- Don't request all tools "just in case"
- Don't assume specific file paths exist
- Don't skip the workflow section
- Don't forget to test your skill

---

## Slash Commands Reference

| Command | Description |
|---------|-------------|
| `/skills` | List all available skills |
| `/skills use <name>` | Activate a skill for the current session |
| `/skills deactivate <name>` | Deactivate a skill |
| `/skills info <name>` | Show detailed skill information |
| `/skills new` | Create a new skill interactively |

---

## Related Documentation

- [Configuration Reference](./config-reference.md) - Full configuration options
- [CLI Usage](./cli-usage.md) - Command-line interface guide
