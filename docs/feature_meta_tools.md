# Dynamic Meta-Tools & External Agent Integration

This document describes the dynamic meta-tool creation feature and external agent support in Autohand CLI.

## Overview

Autohand now supports two powerful extensibility features:

1. **Dynamic Meta-Tool Creation**: Create new tools on-the-fly that persist across sessions
2. **External Agent Support**: Load agents from external CLI tools (Claude Code, Gemini CLI, etc.)

---

## 1. Dynamic Meta-Tool Creation

### What are Meta-Tools?

Meta-tools are user-defined or agent-defined tools that extend Autohand's capabilities. They wrap shell commands with parameter substitution, making them reusable across sessions.

### Creating a Meta-Tool

Use the `create_meta_tool` action to define a new tool:

```json
{
  "type": "create_meta_tool",
  "name": "analyze_imports",
  "description": "Analyze import statements in a file",
  "parameters": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "File path to analyze"
      }
    },
    "required": ["path"]
  },
  "handler": "grep -E '^import|^from' {{path}}"
}
```

### Tool Definition Schema

Meta-tools are saved as JSON files in `~/.autohand/tools/{name}.json`:

```json
{
  "name": "analyze_imports",
  "description": "Analyze import statements in a file",
  "parameters": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "File path to analyze"
      }
    },
    "required": ["path"]
  },
  "handler": "grep -E '^import|^from' {{path}}",
  "createdAt": "2025-12-16T10:30:00.000Z",
  "source": "agent"
}
```

### Handler Templates

The `handler` field is a shell command template that supports parameter substitution using `{{param}}` syntax:

| Syntax | Description |
|--------|-------------|
| `{{path}}` | Replaces with the `path` parameter value |
| `{{query}}` | Replaces with the `query` parameter value |
| `{{limit}}` | Replaces with the `limit` parameter value |

**Example Handlers:**

```bash
# Count lines in a file
wc -l {{path}}

# Search for pattern in file
grep -n "{{pattern}}" {{path}}

# List files with extension
find {{directory}} -name "*.{{extension}}"

# Git log for author
git log --author="{{author}}" -n {{count}}
```

### Execution Flow

1. Agent calls `create_meta_tool` with the definition
2. System validates the name doesn't conflict with built-in tools
3. Basic security checks on the handler (blocks dangerous patterns)
4. Tool is saved to `~/.autohand/tools/{name}.json`
5. Tool is registered in the current session immediately
6. On future sessions, tool is auto-loaded from disk

### Using a Meta-Tool

Once created, the meta-tool can be invoked like any built-in tool:

```json
{
  "type": "analyze_imports",
  "path": "src/index.ts"
}
```

### Common Use Cases

1. **Code Analysis Tools**
   ```json
   {
     "name": "find_todos",
     "description": "Find TODO comments in codebase",
     "parameters": {"type": "object", "properties": {"path": {"type": "string"}}},
     "handler": "grep -rn 'TODO\\|FIXME' {{path}}"
   }
   ```

2. **Build/Test Shortcuts**
   ```json
   {
     "name": "quick_test",
     "description": "Run tests for a specific file",
     "parameters": {"type": "object", "properties": {"file": {"type": "string"}}},
     "handler": "bun test {{file}}"
   }
   ```

3. **Git Helpers**
   ```json
   {
     "name": "recent_changes",
     "description": "Show recent changes by author",
     "parameters": {"type": "object", "properties": {"author": {"type": "string"}, "days": {"type": "number"}}},
     "handler": "git log --author='{{author}}' --since='{{days}} days ago' --oneline"
   }
   ```

---

## 2. External Agent Support

### Overview

Autohand can load agent definitions from external paths, enabling integration with agents from other CLI tools like Claude Code, Gemini CLI, or Aider.

### Configuration

Add external agent paths to your config file (`~/.autohand/config.json` or `~/.autohand/config.yaml`):

**JSON:**
```json
{
  "externalAgents": {
    "enabled": true,
    "paths": [
      "~/.claude/agents",
      "~/.gemini/agents",
      "~/.aider/agents"
    ]
  }
}
```

**YAML:**
```yaml
externalAgents:
  enabled: true
  paths:
    - ~/.claude/agents
    - ~/.gemini/agents
    - ~/.aider/agents
```

### Supported Formats

#### JSON Format

Standard JSON agent definition:

```json
{
  "description": "Expert code reviewer",
  "systemPrompt": "You are an expert code reviewer...",
  "tools": ["read_file", "search", "git_diff"],
  "model": "anthropic/claude-3.5-sonnet"
}
```

#### Markdown Format

Markdown files (`.md`) are parsed as agent definitions:

- **File name** becomes agent name (e.g., `code-reviewer.md` → `code-reviewer`)
- **First heading** becomes description
- **Full content** becomes system prompt
- **Tools**: All tools available by default

Example (`~/.claude/agents/code-reviewer.md`):
```markdown
# Code Reviewer

You are an expert code reviewer focusing on:
- Security vulnerabilities
- Performance issues
- Code style consistency
- Best practices

When reviewing code, always:
1. Start by understanding the context
2. Look for potential bugs
3. Suggest improvements
4. Praise good patterns
```

### Agent Loading Order

1. User agents from `~/.autohand/agents/` (source: `user`)
2. External agents from configured paths (source: `external`)

Note: If an agent with the same name exists in multiple locations, the first loaded wins.

### Using External Agents

External agents are available through the delegation tools:

```json
{
  "type": "delegate_task",
  "agent_name": "code-reviewer",
  "task": "Review the authentication module for security issues"
}
```

### Agent Sources

Each agent tracks its source:
- `builtin`: Core agents shipped with Autohand
- `user`: Agents from `~/.autohand/agents/`
- `external`: Agents from external paths

---

## 3. Security Considerations

### Meta-Tool Security

1. **Handler Validation**: Dangerous patterns are blocked:
   - `rm -rf /`
   - `dd if=`
   - `mkfs.`
   - Fork bombs (`:(){:|:&};:`)

2. **Name Conflicts**: Cannot override built-in tools

3. **Shell Escaping**: Parameter values are escaped to prevent injection

### External Agent Security

1. **Path Validation**: Only configured paths are scanned
2. **File Validation**: Only valid JSON/Markdown files are loaded
3. **Tool Restrictions**: Agents inherit permission system

---

## 4. API Reference

### create_meta_tool Action

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Tool name in snake_case |
| `description` | string | Yes | What the tool does |
| `parameters` | object | Yes | JSON Schema for parameters |
| `handler` | string | Yes | Shell command template |

### MetaToolDefinition Schema

```typescript
interface MetaToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: string;
  createdAt: string;
  source: 'agent' | 'user';
}
```

### ExternalAgentsConfig Schema

```typescript
interface ExternalAgentsConfig {
  enabled?: boolean;
  paths?: string[];
}
```

---

## 5. Examples

### Example 1: Create a Line Counter Tool

**Agent Request:**
```
Create a tool that counts lines in TypeScript files
```

**Tool Created:**
```json
{
  "name": "count_ts_lines",
  "description": "Count lines in TypeScript files",
  "parameters": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "Directory or file path"
      }
    },
    "required": ["path"]
  },
  "handler": "find {{path}} -name '*.ts' -exec wc -l {} + | tail -1"
}
```

### Example 2: Load Claude Code Agents

**Config:**
```yaml
externalAgents:
  enabled: true
  paths:
    - ~/.claude/agents
```

**Agent File (`~/.claude/agents/react-expert.md`):**
```markdown
# React Expert

Specialized in React.js development with deep knowledge of:
- Hooks (useState, useEffect, useMemo, useCallback)
- Context API and state management
- Performance optimization
- Testing with React Testing Library

Always suggest functional components over class components.
```

**Usage:**
```json
{
  "type": "delegate_task",
  "agent_name": "react-expert",
  "task": "Optimize the UserDashboard component for performance"
}
```

---

## 6. Troubleshooting

### Meta-tool not found after creation

Ensure the tool was saved successfully. Check `~/.autohand/tools/` for the JSON file.

### External agents not loading

1. Verify paths in config are correct
2. Check that `externalAgents.enabled` is `true`
3. Ensure agent files have valid JSON or Markdown format

### Handler execution fails

1. Test the command manually in terminal
2. Ensure all parameters are provided
3. Check for shell escaping issues

---

## 7. Best Practices

1. **Naming**: Use descriptive snake_case names (`analyze_deps`, `find_unused_exports`)
2. **Documentation**: Write clear descriptions for tools
3. **Parameters**: Define all parameters with descriptions
4. **Testing**: Test handlers manually before creating tools
5. **Safety**: Avoid creating tools with destructive operations
6. **Reusability**: Design tools for general use cases
