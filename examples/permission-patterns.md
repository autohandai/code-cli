# Permission Pattern Examples

This document demonstrates how to use the new prefix pattern functionality in the PermissionManager.

## Overview

The PermissionManager now supports prefix-based permissions that allow you to grant access to tools based on command prefixes or directory patterns. This is useful for allowing repeated operations in specific directories or with specific command families.

## Pattern Types

### 1. Tool Wildcard Patterns
Allow all operations for a specific tool:

```typescript
// Allow all write_file operations
permissionManager.addToAllowList('write_file:*');

// Allow all read_file operations
permissionManager.addToAllowList('read_file:*');

// Allow all npm commands
permissionManager.addToAllowList('run_command:npm:*');
```

### 2. Prefix Patterns
Allow operations that start with a specific prefix:

```typescript
// Allow all git commands
permissionManager.addToAllowList('run_command:git:*');

// Allow all write operations in src directory
permissionManager.addToAllowList('write_file:src:*');

// Allow all npm run commands
permissionManager.addToAllowList('run_command:npm run:*');
```

### 3. Workspace-relative Patterns
Allow operations in specific workspace directories:

```typescript
// Allow write operations in src directory
permissionManager.addToAllowList('write_file:src/*');

// Allow write operations in tests directory
permissionManager.addToAllowList('write_file:tests/*');

// Allow write operations in docs directory
permissionManager.addToAllowList('write_file:docs/*');

// Allow write operations in utils directory
permissionManager.addToAllowList('write_file:utils/*');
```

## Utility Methods

The PermissionManager provides utility methods for creating common patterns:

### Static Pattern Creation Methods

```typescript
import { PermissionManager } from './src/permissions/PermissionManager.js';

// Create prefix patterns
const gitPattern = PermissionManager.createPrefixPattern('run_command', 'git');
// Returns: 'run_command:git:*'

const srcPattern = PermissionManager.createPrefixPattern('write_file', 'src');
// Returns: 'write_file:src:*'

// Create workspace patterns
const srcWorkspacePattern = PermissionManager.createWorkspacePattern('write_file', 'src');
// Returns: 'write_file:src/*'

// Create tool wildcard patterns
const writeFilePattern = PermissionManager.createToolWildcardPattern('write_file');
// Returns: 'write_file:*'
```

### Instance Methods for Adding Patterns

```typescript
const permissionManager = new PermissionManager({
  workspaceRoot: '/path/to/project'
});

// Add prefix pattern
permissionManager.addPrefixPattern('run_command', 'git');
// Equivalent to: permissionManager.addToAllowList('run_command:git:*');

// Add workspace pattern
permissionManager.addWorkspacePattern('write_file', 'src');
// Equivalent to: permissionManager.addToAllowList('write_file:src/*');

// Add tool wildcard pattern
permissionManager.addToolWildcardPattern('read_file');
// Equivalent to: permissionManager.addToAllowList('read_file:*');
```

## Common Use Cases

### Development Workflow Permissions

```typescript
// Allow common development commands
permissionManager.addPrefixPattern('run_command', 'npm');
permissionManager.addPrefixPattern('run_command', 'git');
permissionManager.addPrefixPattern('run_command', 'bun');

// Allow file operations in source directories
permissionManager.addWorkspacePattern('write_file', 'src');
permissionManager.addWorkspacePattern('write_file', 'tests');
permissionManager.addWorkspacePattern('write_file', 'docs');

// Allow reading configuration files
permissionManager.addToolWildcardPattern('read_file');
```

### Build and Deployment Permissions

```typescript
// Allow build commands
permissionManager.addPrefixPattern('run_command', 'npm run build');
permissionManager.addPrefixPattern('run_command', 'npm run test');
permissionManager.addPrefixPattern('run_command', 'npm run lint');

// Allow operations in build directory
permissionManager.addWorkspacePattern('write_file', 'build');
permissionManager.addWorkspacePattern('write_file', 'dist');
```

### Security Considerations

Prefix patterns still respect the security blacklist. Even with permissive patterns, sensitive operations remain blocked:

```typescript
// This won't override security restrictions
permissionManager.addToolWildcardPattern('write_file');
// Still blocked: write_file:.env, write_file:.git/config, etc.

permissionManager.addPrefixPattern('run_command', 'sudo');
// Still blocked: sudo commands due to security blacklist
```

## Pattern Matching Rules

1. **Prefix boundaries**: Patterns like `src:*` match `src`, `src/components`, `src/utils/helpers.ts` but not `srcFile.ts`

2. **Workspace patterns**: Patterns like `src/*` match files within the `src` directory relative to the workspace root

3. **Command prefixes**: Patterns like `npm:*` match `npm`, `npm install`, `npm run build` but not `npm-cli`

4. **Security first**: Security blacklist always takes precedence over allow patterns

## Examples in Configuration

### JSON Configuration

```json
{
  "permissions": {
    "mode": "interactive",
    "allowList": [
      "write_file:src/*",
      "write_file:tests/*",
      "write_file:docs/*",
      "run_command:npm:*",
      "run_command:git:*",
      "run_command:bun:*",
      "read_file:*"
    ],
    "rememberSession": true
  }
}
```

### Programmatic Setup

```typescript
const permissionManager = new PermissionManager({
  workspaceRoot: process.cwd(),
  settings: {
    mode: 'interactive',
    allowList: [
      'write_file:src/*',
      'write_file:tests/*',
      'run_command:npm:*',
      'run_command:git:*'
    ]
  }
});

// Or use utility methods
permissionManager.addWorkspacePattern('write_file', 'src');
permissionManager.addWorkspacePattern('write_file', 'tests');
permissionManager.addPrefixPattern('run_command', 'npm');
permissionManager.addPrefixPattern('run_command', 'git');
```

## Testing Your Patterns

You can test your permission patterns using the `checkPermission` method:

```typescript
const context = {
  tool: 'write_file',
  path: 'src/components/Button.tsx'
};

const decision = permissionManager.checkPermission(context);
console.log(decision.allowed); // true if pattern matches
console.log(decision.reason); // 'allow_list' if allowed by pattern
```
