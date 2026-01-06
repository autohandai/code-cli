# Workspace Safety

Autohand includes safety features to prevent accidental operations in dangerous directories. This protection helps ensure the AI agent operates within a safe, bounded scope.

## Overview

When you start autohand, it checks the workspace directory to ensure it's safe for AI-assisted operations. If you try to run autohand in a dangerous directory (like your home folder or system root), it will display a warning and exit immediately.

## Protected Directories

Autohand will refuse to start in these locations:

### Filesystem Roots

- `/` (Unix/Linux/macOS root)
- `C:\`, `D:\`, etc. (Windows drive roots)

### Home Directories

- `~` or `/Users/<username>` (macOS)
- `~` or `/home/<username>` (Linux)
- `C:\Users\<username>` (Windows)

### System Directories

**Unix/Linux:**
- `/etc` - System configuration
- `/var` - Variable data
- `/usr` - User programs
- `/opt` - Optional packages
- `/bin`, `/sbin` - System binaries
- `/lib`, `/lib64` - System libraries
- `/root` - Root user home
- `/sys`, `/proc`, `/dev` - Virtual filesystems
- `/boot` - Boot files

**macOS:**
- `/System` - macOS system files
- `/Library` - System-wide libraries
- `/Applications` - Installed applications
- `/private` - Private system data
- `/Volumes` - Mounted volumes

**Windows:**
- `C:\Windows` - Windows system files
- `C:\Program Files` - 64-bit programs
- `C:\Program Files (x86)` - 32-bit programs
- `C:\ProgramData` - Application data

**WSL (Windows Subsystem for Linux):**
- `/mnt/c`, `/mnt/d`, etc. - Windows drive mounts
- `/mnt/c/Users/<username>` - Windows home in WSL

## Why This Matters

Running an AI coding agent in your home directory or system root is dangerous for several reasons:

### 1. Scope Creep
The agent might modify files outside your intended project. With access to your entire home directory, a simple "update the config file" instruction could affect any dotfile.

### 2. Destructive Potential
A single misunderstood command could affect all your files. The broader the workspace, the more potential for damage.

### 3. Configuration Files
Important dotfiles like `.bashrc`, `.zshrc`, `.gitconfig`, `.ssh/config`, and others could be modified or deleted accidentally.

### 4. System Stability
Modifying system directories can break your operating system, requiring repair or reinstallation.

### 5. Security Risks
Sensitive files in your home directory (SSH keys, credentials, personal documents) should not be accessible to automated tools unless explicitly needed.

## Proper Usage

Always run autohand from a specific project directory:

```bash
# Good - specific project directory
cd ~/projects/my-app
autohand

# Good - using --path flag to specify project
autohand --path ~/projects/my-app

# Good - subdirectory of a larger project
cd ~/projects/monorepo/packages/frontend
autohand
```

### Examples of Blocked Usage

```bash
# Bad - home directory (will be blocked)
cd ~
autohand
# Error: Unsafe Workspace Directory

# Bad - root (will be blocked)
cd /
autohand
# Error: Unsafe Workspace Directory

# Bad - system directory (will be blocked)
autohand --path /etc
# Error: Unsafe Workspace Directory

# Bad - using --path to specify home
autohand --path ~
# Error: Unsafe Workspace Directory
```

## What Happens When Blocked

When you try to start autohand in a dangerous directory, you'll see a warning like this:

```
┌───────────────────────────────────────────────────────────────┐
│  ⚠️  Unsafe Workspace Directory                                │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  You're trying to run autohand in:                            │
│  /Users/username                                              │
│                                                               │
│  This is your home directory. Running an AI agent here        │
│  could modify files across your entire user account.          │
│                                                               │
│  Please navigate to a specific project folder:                │
│                                                               │
│    cd ~/projects/my-app                                       │
│    autohand                                                   │
│                                                               │
│  Or specify a path directly:                                  │
│                                                               │
│    autohand --path ~/projects/my-app                          │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

The application will exit immediately with a non-zero exit code. You must specify a safe workspace to proceed.

## Edge Cases Handled

The safety check handles various edge cases:

| Edge Case | Behavior |
|-----------|----------|
| Trailing slashes (`/Users/name/`) | Normalized and checked |
| Path traversal (`../../..`) | Resolved and checked |
| Symlinks to dangerous dirs | Resolved and checked |
| Case variations (Windows/macOS) | Case-insensitive check |
| Double slashes (`//Users/name`) | Normalized and checked |
| Dot notation (`./` or `/.`) | Resolved and checked |
| Environment variables (`$HOME`) | Expanded and checked |

## Runtime Protections

The workspace safety check runs **once at startup**. During operation, autohand has additional runtime protections:

1. **Path Escape Detection** - All file operations verify paths stay within the workspace
2. **Dangerous Command Blocking** - Commands like `rm -rf /`, `sudo`, etc. are blocked
3. **Permission System** - Fine-grained control over what operations are allowed
4. **Secret Detection** - Prevents committing credentials and API keys

## Technical Details

The safety checker (`src/startup/workspaceSafety.ts`) performs these checks:

1. **Normalize path** - Resolve symlinks, remove trailing slashes, make absolute
2. **Check filesystem root** - Block `/`, `C:\`, etc.
3. **Check home directory** - Block exact match with `os.homedir()`
4. **Check parent of home** - Block directories like `/Users` or `/home`
5. **Check system directories** - Platform-specific dangerous paths
6. **Check WSL mounts** - Windows drives in WSL

## No Override

This safety check cannot be bypassed. There is no `--force` or `--allow-dangerous` flag. This is intentional - the risks of operating in dangerous directories outweigh any convenience benefit.

If you need to perform operations in system directories, use appropriate system tools directly rather than an AI coding agent.

## Related Documentation

- [Configuration Reference](./config-reference.md) - Workspace and permission settings
- [Permissions](./config-reference.md#permissions-settings) - Fine-grained operation control
- [Hooks](./hooks.md) - Lifecycle hooks for custom automation
