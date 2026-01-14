/**
 * Default hooks bundled with Autohand
 * These are installed on first run if no hooks exist
 */

import type { HookDefinition } from '../types.js';

/**
 * Default hooks that ship with Autohand
 */
export const DEFAULT_HOOKS: HookDefinition[] = [
  // === Logging Hooks ===
  {
    event: 'session-start',
    command: 'echo "Autohand session started: $HOOK_SESSION_TYPE"',
    description: 'Log session start',
    enabled: false,
  },
  {
    event: 'session-end',
    command: 'echo "Session ended ($HOOK_SESSION_END_REASON) - Duration: ${HOOK_DURATION}ms"',
    description: 'Log session end',
    enabled: false,
  },
  {
    event: 'stop',
    command: 'echo "Turn complete: $HOOK_TOKENS tokens, $HOOK_TOOL_CALLS_COUNT tool calls"',
    description: 'Log turn completion stats',
    enabled: false,
  },
  {
    event: 'file-modified',
    command: 'echo "File $HOOK_CHANGE_TYPE: $HOOK_PATH"',
    description: 'Log file changes',
    enabled: false,
    filter: {
      path: ['src/**/*', 'lib/**/*'],
    },
  },

  // === Sound Alert Hook ===
  {
    event: 'stop',
    command: '~/.autohand/hooks/sound-alert.sh',
    description: 'Play sound when task completes',
    enabled: false,
    async: true,
  },

  // === Auto-Format Hook ===
  {
    event: 'file-modified',
    command: '~/.autohand/hooks/auto-format.sh',
    description: 'Auto-format changed files with prettier/eslint',
    enabled: false,
    filter: {
      path: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.json', '**/*.css', '**/*.scss', '**/*.md'],
    },
  },

  // === Slack Notification Hook ===
  {
    event: 'stop',
    command: '~/.autohand/hooks/slack-notify.sh',
    description: 'Send Slack notification when task completes',
    enabled: false,
    async: true,
  },

  // === Git Auto-Stage Hook ===
  {
    event: 'file-modified',
    command: '~/.autohand/hooks/git-auto-stage.sh',
    description: 'Auto-stage modified files to git',
    enabled: false,
    filter: {
      path: ['src/**/*', 'lib/**/*', 'tests/**/*'],
    },
  },

  // === Security Guard Hook ===
  {
    event: 'pre-tool',
    command: '~/.autohand/hooks/security-guard.sh',
    description: 'Block dangerous commands and operations',
    enabled: false,
    matcher: '^(run_command|delete_path|write_file)$',
  },
];

/**
 * Smart commit hook script content
 * This is written to ~/.autohand/hooks/smart-commit.sh
 */
export const SMART_COMMIT_HOOK_SCRIPT = `#!/bin/bash
# Smart Commit Hook for Autohand
# Runs lint, test, and creates commit with LLM-generated message

# Prevent infinite recursion
if [ -n "$AUTOHAND_SMART_COMMIT_RUNNING" ]; then
  exit 0
fi

# Check for uncommitted changes
if [ -z "$(git status --porcelain 2>/dev/null)" ]; then
  exit 0
fi

export AUTOHAND_SMART_COMMIT_RUNNING=1

# Use autohand to handle the smart commit workflow
autohand --auto-commit -p "Complete the pending changes" -y
`;

/**
 * Smart commit stop hook definition
 */
export const SMART_COMMIT_HOOK: HookDefinition = {
  event: 'stop',
  command: '~/.autohand/hooks/smart-commit.sh',
  description: 'Auto lint, test, and commit with LLM message',
  enabled: false,
  async: true,
};

// ============================================================
// Hook Script Contents
// These are written to ~/.autohand/hooks/ on first run
// ============================================================

/**
 * Sound Alert Hook Script
 * Plays a system sound when a task completes
 * Cross-platform: macOS, Linux, Windows (WSL)
 */
export const SOUND_ALERT_SCRIPT = `#!/bin/bash
# Sound Alert Hook for Autohand
# Plays a sound when task completes

# Determine success/failure from environment or default to success
SUCCESS=true

play_sound() {
  case "$(uname -s)" in
    Darwin)
      # macOS: Use afplay with system sounds
      if [ "$SUCCESS" = true ]; then
        afplay /System/Library/Sounds/Glass.aiff 2>/dev/null || \\
        osascript -e 'beep' 2>/dev/null
      else
        afplay /System/Library/Sounds/Basso.aiff 2>/dev/null || \\
        osascript -e 'beep 2' 2>/dev/null
      fi
      ;;
    Linux)
      # Linux: Try various sound players
      if command -v paplay &>/dev/null; then
        paplay /usr/share/sounds/freedesktop/stereo/complete.oga 2>/dev/null
      elif command -v aplay &>/dev/null; then
        aplay /usr/share/sounds/sound-icons/glass-water.wav 2>/dev/null
      elif command -v speaker-test &>/dev/null; then
        speaker-test -t sine -f 1000 -l 1 &>/dev/null &
        sleep 0.2
        kill $! 2>/dev/null
      fi
      ;;
    MINGW*|MSYS*|CYGWIN*)
      # Windows: Use PowerShell
      powershell.exe -c "[console]::beep(1000,200)" 2>/dev/null
      ;;
  esac
}

play_sound
exit 0
`;

/**
 * Auto-Format Hook Script
 * Automatically formats changed files using prettier or eslint
 */
export const AUTO_FORMAT_SCRIPT = `#!/bin/bash
# Auto-Format Hook for Autohand
# Formats files on modification using prettier or eslint

FILE_PATH="$HOOK_PATH"
CHANGE_TYPE="$HOOK_CHANGE_TYPE"

# Skip if file was deleted
if [ "$CHANGE_TYPE" = "delete" ]; then
  exit 0
fi

# Skip if file doesn't exist
if [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

# Get file extension
EXT="\${FILE_PATH##*.}"

# Check for formatters and run them
format_file() {
  local file="$1"

  # Try prettier first (most common)
  if command -v npx &>/dev/null && [ -f "package.json" ]; then
    if npx prettier --check "$file" &>/dev/null 2>&1; then
      # Prettier is available, format the file
      npx prettier --write "$file" 2>/dev/null && return 0
    fi
  fi

  # Try eslint --fix for JS/TS files
  if [[ "$EXT" =~ ^(js|jsx|ts|tsx)$ ]]; then
    if command -v npx &>/dev/null && [ -f "package.json" ]; then
      npx eslint --fix "$file" 2>/dev/null && return 0
    fi
  fi

  # Try biome for supported files
  if command -v npx &>/dev/null; then
    npx @biomejs/biome format --write "$file" 2>/dev/null && return 0
  fi

  return 1
}

# Format the file (silently)
format_file "$FILE_PATH" 2>/dev/null

# Always exit successfully (formatting is optional)
exit 0
`;

/**
 * Slack Notification Hook Script
 * Sends a notification to Slack when task completes
 * Requires SLACK_WEBHOOK_URL environment variable
 */
export const SLACK_NOTIFY_SCRIPT = `#!/bin/bash
# Slack Notification Hook for Autohand
# Sends notification to Slack when task completes

# Check for webhook URL
if [ -z "$SLACK_WEBHOOK_URL" ]; then
  # No webhook configured, skip silently
  exit 0
fi

# Build message
TOKENS="\${HOOK_TOKENS:-0}"
TOOL_CALLS="\${HOOK_TOOL_CALLS_COUNT:-0}"
DURATION="\${HOOK_DURATION:-0}"
WORKSPACE="\${HOOK_WORKSPACE:-unknown}"

# Convert duration to human readable
if [ "$DURATION" -gt 60000 ]; then
  DURATION_STR="$((DURATION / 60000))m $((DURATION % 60000 / 1000))s"
elif [ "$DURATION" -gt 1000 ]; then
  DURATION_STR="$((DURATION / 1000))s"
else
  DURATION_STR="\${DURATION}ms"
fi

# Get project name from workspace
PROJECT_NAME=$(basename "$WORKSPACE")

# Create Slack message payload
PAYLOAD=$(cat <<EOF
{
  "blocks": [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "Autohand Task Completed",
        "emoji": true
      }
    },
    {
      "type": "section",
      "fields": [
        {
          "type": "mrkdwn",
          "text": "*Project:*\\n$PROJECT_NAME"
        },
        {
          "type": "mrkdwn",
          "text": "*Duration:*\\n$DURATION_STR"
        },
        {
          "type": "mrkdwn",
          "text": "*Tokens Used:*\\n$TOKENS"
        },
        {
          "type": "mrkdwn",
          "text": "*Tool Calls:*\\n$TOOL_CALLS"
        }
      ]
    }
  ]
}
EOF
)

# Send to Slack
curl -s -X POST -H 'Content-type: application/json' \\
  --data "$PAYLOAD" \\
  "$SLACK_WEBHOOK_URL" >/dev/null 2>&1

exit 0
`;

/**
 * Git Auto-Stage Hook Script
 * Automatically stages modified files to git
 */
export const GIT_AUTO_STAGE_SCRIPT = `#!/bin/bash
# Git Auto-Stage Hook for Autohand
# Automatically stages modified files to git

FILE_PATH="$HOOK_PATH"
CHANGE_TYPE="$HOOK_CHANGE_TYPE"

# Check if we're in a git repository
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  exit 0
fi

# Skip certain files that shouldn't be auto-staged
should_skip() {
  local file="$1"
  local basename=$(basename "$file")

  # Skip log/temp files
  case "$basename" in
    *.log|*.tmp|*.swp|*.bak)
      return 0
      ;;
  esac

  # Skip .env files (including .env, .env.local, .env.production, etc.)
  if [[ "$basename" == .env* ]]; then
    return 0
  fi

  # Skip certain directories
  case "$file" in
    *node_modules/*|*.git/*|*dist/*|*build/*|*coverage/*)
      return 0
      ;;
  esac

  return 1
}

# Check if file should be skipped
if should_skip "$FILE_PATH"; then
  exit 0
fi

# Stage the file based on change type
case "$CHANGE_TYPE" in
  create|modify)
    if [ -f "$FILE_PATH" ]; then
      git add "$FILE_PATH" 2>/dev/null
    fi
    ;;
  delete)
    git rm --cached "$FILE_PATH" 2>/dev/null || true
    ;;
esac

exit 0
`;

/**
 * Security Guard Hook Script
 * Blocks dangerous commands and operations
 * Returns exit code 2 to block execution
 */
export const SECURITY_GUARD_SCRIPT = `#!/bin/bash
# Security Guard Hook for Autohand
# Blocks dangerous commands and file operations
# Exit code 2 = block execution

# Read JSON input from stdin
INPUT=$(cat)

# Extract tool name and arguments
TOOL_NAME="$HOOK_TOOL"
TOOL_ARGS="$HOOK_ARGS"

# Also try to parse from JSON input for more details
if command -v jq &>/dev/null; then
  COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
  FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.path // empty' 2>/dev/null)
else
  COMMAND=""
  FILE_PATH=""
fi

# Dangerous command patterns
DANGEROUS_COMMANDS=(
  "rm -rf /"
  "rm -rf /*"
  "rm -rf ~"
  "rm -rf ~/*"
  "rm -rf ."
  "sudo rm"
  "chmod 777"
  "chmod -R 777"
  "> /dev/sda"
  "mkfs"
  "dd if="
)

# Patterns that need special regex matching (pipe symbol must be escaped as \| for literal match)
DANGEROUS_REGEX_PATTERNS=(
  ":[^[:space:]]*\\(\\)[[:space:]]*\\{"  # Fork bomb pattern: :(){
  "curl[[:space:]].*\\|[[:space:]]*sh"   # curl pipe to sh
  "curl[[:space:]].*\\|[[:space:]]*bash" # curl pipe to bash
  "wget[[:space:]].*\\|[[:space:]]*sh"   # wget pipe to sh
  "wget[[:space:]].*\\|[[:space:]]*bash" # wget pipe to bash
)

# Sensitive file patterns (should not be written/deleted)
SENSITIVE_FILES=(
  ".env"
  ".env.local"
  ".env.production"
  "*.pem"
  "*.key"
  "*_rsa"
  "id_rsa"
  "id_ed25519"
  "*.p12"
  "credentials.json"
  "secrets.json"
  "service-account*.json"
  ".npmrc"
  ".pypirc"
)

# Check for dangerous commands
check_dangerous_command() {
  local cmd="$1"

  # Check exact patterns
  for pattern in "\${DANGEROUS_COMMANDS[@]}"; do
    if [[ "$cmd" == *"$pattern"* ]]; then
      echo "BLOCKED: Dangerous command pattern detected: $pattern" >&2
      exit 2
    fi
  done

  # Check regex patterns
  for pattern in "\${DANGEROUS_REGEX_PATTERNS[@]}"; do
    if [[ "$cmd" =~ $pattern ]]; then
      echo "BLOCKED: Dangerous command pattern detected: $pattern" >&2
      exit 2
    fi
  done
}

# Check for sensitive files
check_sensitive_file() {
  local file="$1"
  local basename=$(basename "$file")

  for pattern in "\${SENSITIVE_FILES[@]}"; do
    if [[ "$basename" == $pattern ]] || [[ "$file" == *"$pattern"* ]]; then
      echo "BLOCKED: Operation on sensitive file: $file" >&2
      exit 2
    fi
  done
}

# Main security checks
case "$TOOL_NAME" in
  run_command)
    check_dangerous_command "$COMMAND"
    check_dangerous_command "$TOOL_ARGS"
    ;;
  write_file|delete_path)
    check_sensitive_file "$FILE_PATH"
    # Also check TOOL_ARGS for path
    if [ -n "$TOOL_ARGS" ]; then
      # Try to extract path from JSON args
      if command -v jq &>/dev/null; then
        ARG_PATH=$(echo "$TOOL_ARGS" | jq -r '.path // empty' 2>/dev/null)
        if [ -n "$ARG_PATH" ]; then
          check_sensitive_file "$ARG_PATH"
        fi
      fi
    fi
    ;;
esac

# All checks passed
exit 0
`;

/**
 * Map of script names to their content (bash/shell scripts)
 */
export const HOOK_SCRIPTS: Record<string, string> = {
  'smart-commit.sh': SMART_COMMIT_HOOK_SCRIPT,
  'sound-alert.sh': SOUND_ALERT_SCRIPT,
  'auto-format.sh': AUTO_FORMAT_SCRIPT,
  'slack-notify.sh': SLACK_NOTIFY_SCRIPT,
  'git-auto-stage.sh': GIT_AUTO_STAGE_SCRIPT,
  'security-guard.sh': SECURITY_GUARD_SCRIPT,
};

// ============================================================
// Windows PowerShell Scripts
// These are equivalents of the bash scripts for Windows users
// ============================================================

/**
 * Sound Alert Hook Script (PowerShell)
 */
export const SOUND_ALERT_SCRIPT_PS1 = `# Sound Alert Hook for Autohand (PowerShell)
# Plays a sound when task completes

param()

try {
    # Play system notification sound
    [System.Media.SystemSounds]::Asterisk.Play()
} catch {
    # Fallback to console beep
    [Console]::Beep(1000, 200)
}

exit 0
`;

/**
 * Auto-Format Hook Script (PowerShell)
 */
export const AUTO_FORMAT_SCRIPT_PS1 = `# Auto-Format Hook for Autohand (PowerShell)
# Formats files on modification using prettier or eslint

param()

$FilePath = $env:HOOK_PATH
$ChangeType = $env:HOOK_CHANGE_TYPE

# Skip if file was deleted
if ($ChangeType -eq "delete") {
    exit 0
}

# Skip if file doesn't exist
if (-not (Test-Path $FilePath)) {
    exit 0
}

# Get file extension
$Ext = [System.IO.Path]::GetExtension($FilePath).TrimStart('.')

# Try to format the file
function Format-File {
    param($File)

    # Try prettier first
    if (Test-Path "package.json") {
        try {
            npx prettier --write $File 2>$null
            if ($LASTEXITCODE -eq 0) { return $true }
        } catch {}
    }

    # Try eslint for JS/TS files
    if ($Ext -match "^(js|jsx|ts|tsx)$") {
        if (Test-Path "package.json") {
            try {
                npx eslint --fix $File 2>$null
                if ($LASTEXITCODE -eq 0) { return $true }
            } catch {}
        }
    }

    return $false
}

# Format the file (silently)
Format-File $FilePath | Out-Null

# Always exit successfully
exit 0
`;

/**
 * Slack Notification Hook Script (PowerShell)
 */
export const SLACK_NOTIFY_SCRIPT_PS1 = `# Slack Notification Hook for Autohand (PowerShell)
# Sends notification to Slack when task completes

param()

$WebhookUrl = $env:SLACK_WEBHOOK_URL

# Skip if no webhook configured
if (-not $WebhookUrl) {
    exit 0
}

$Tokens = if ($env:HOOK_TOKENS) { $env:HOOK_TOKENS } else { "0" }
$ToolCalls = if ($env:HOOK_TOOL_CALLS_COUNT) { $env:HOOK_TOOL_CALLS_COUNT } else { "0" }
$Duration = if ($env:HOOK_DURATION) { [int]$env:HOOK_DURATION } else { 0 }
$Workspace = if ($env:HOOK_WORKSPACE) { $env:HOOK_WORKSPACE } else { "unknown" }

# Convert duration to human readable
if ($Duration -gt 60000) {
    $DurationStr = "{0}m {1}s" -f [math]::Floor($Duration / 60000), [math]::Floor(($Duration % 60000) / 1000)
} elseif ($Duration -gt 1000) {
    $DurationStr = "{0}s" -f [math]::Floor($Duration / 1000)
} else {
    $DurationStr = "{0}ms" -f $Duration
}

$ProjectName = Split-Path $Workspace -Leaf

$Payload = @{
    blocks = @(
        @{
            type = "header"
            text = @{
                type = "plain_text"
                text = "Autohand Task Completed"
                emoji = $true
            }
        }
        @{
            type = "section"
            fields = @(
                @{ type = "mrkdwn"; text = "*Project:*\`n$ProjectName" }
                @{ type = "mrkdwn"; text = "*Duration:*\`n$DurationStr" }
                @{ type = "mrkdwn"; text = "*Tokens Used:*\`n$Tokens" }
                @{ type = "mrkdwn"; text = "*Tool Calls:*\`n$ToolCalls" }
            )
        }
    )
} | ConvertTo-Json -Depth 10

try {
    Invoke-RestMethod -Uri $WebhookUrl -Method Post -Body $Payload -ContentType "application/json" | Out-Null
} catch {}

exit 0
`;

/**
 * Git Auto-Stage Hook Script (PowerShell)
 */
export const GIT_AUTO_STAGE_SCRIPT_PS1 = `# Git Auto-Stage Hook for Autohand (PowerShell)
# Automatically stages modified files to git

param()

$FilePath = $env:HOOK_PATH
$ChangeType = $env:HOOK_CHANGE_TYPE

# Check if we're in a git repository
try {
    git rev-parse --is-inside-work-tree 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { exit 0 }
} catch {
    exit 0
}

# Files to skip
function Should-Skip {
    param($File)

    $BaseName = Split-Path $File -Leaf

    # Skip log/temp files
    if ($BaseName -match "\\.(log|tmp|swp|bak)$") { return $true }

    # Skip .env files
    if ($BaseName -like ".env*") { return $true }

    # Skip certain directories
    if ($File -match "(node_modules|\.git|dist|build|coverage)[/\\\\]") { return $true }

    return $false
}

if (Should-Skip $FilePath) {
    exit 0
}

# Stage the file based on change type
switch ($ChangeType) {
    { $_ -in "create", "modify" } {
        if (Test-Path $FilePath) {
            git add $FilePath 2>$null
        }
    }
    "delete" {
        git rm --cached $FilePath 2>$null
    }
}

exit 0
`;

/**
 * Security Guard Hook Script (PowerShell)
 */
export const SECURITY_GUARD_SCRIPT_PS1 = `# Security Guard Hook for Autohand (PowerShell)
# Blocks dangerous commands and file operations
# Exit code 2 = block execution

param()

$ToolName = $env:HOOK_TOOL
$ToolArgs = $env:HOOK_ARGS

# Read JSON input from stdin
$Input = [Console]::In.ReadToEnd()

# Try to parse JSON input
$Command = ""
$FilePath = ""
try {
    $JsonInput = $Input | ConvertFrom-Json
    $Command = $JsonInput.tool_input.command
    $FilePath = $JsonInput.tool_input.path
} catch {}

# Dangerous command patterns
$DangerousCommands = @(
    "rm -rf /",
    "rm -rf /*",
    "rm -rf ~",
    "rm -rf ~/*",
    "rm -rf .",
    "sudo rm",
    "chmod 777",
    "chmod -R 777",
    "> /dev/sda",
    "mkfs",
    "dd if=",
    "Remove-Item -Recurse -Force C:\\",
    "Remove-Item -Recurse -Force /",
    "Format-Volume"
)

# Sensitive file patterns
$SensitiveFiles = @(
    ".env",
    ".env.local",
    ".env.production",
    "*.pem",
    "*.key",
    "*_rsa",
    "id_rsa",
    "id_ed25519",
    "*.p12",
    "credentials.json",
    "secrets.json",
    "service-account*.json",
    ".npmrc",
    ".pypirc"
)

function Test-DangerousCommand {
    param($Cmd)

    foreach ($Pattern in $DangerousCommands) {
        if ($Cmd -like "*$Pattern*") {
            Write-Error "BLOCKED: Dangerous command pattern detected: $Pattern"
            exit 2
        }
    }
}

function Test-SensitiveFile {
    param($File)

    $BaseName = Split-Path $File -Leaf

    foreach ($Pattern in $SensitiveFiles) {
        if ($BaseName -like $Pattern -or $File -like "*$Pattern*") {
            Write-Error "BLOCKED: Operation on sensitive file: $File"
            exit 2
        }
    }
}

# Main security checks
switch ($ToolName) {
    "run_command" {
        Test-DangerousCommand $Command
        Test-DangerousCommand $ToolArgs
    }
    { $_ -in "write_file", "delete_path" } {
        Test-SensitiveFile $FilePath
        if ($ToolArgs) {
            try {
                $ArgsJson = $ToolArgs | ConvertFrom-Json
                if ($ArgsJson.path) {
                    Test-SensitiveFile $ArgsJson.path
                }
            } catch {}
        }
    }
}

# All checks passed
exit 0
`;

/**
 * Smart Commit Hook Script (PowerShell)
 */
export const SMART_COMMIT_HOOK_SCRIPT_PS1 = `# Smart Commit Hook for Autohand (PowerShell)
# Runs lint, test, and creates commit with LLM-generated message

param()

# Prevent infinite recursion
if ($env:AUTOHAND_SMART_COMMIT_RUNNING) {
    exit 0
}

# Check for uncommitted changes
$Status = git status --porcelain 2>$null
if (-not $Status) {
    exit 0
}

$env:AUTOHAND_SMART_COMMIT_RUNNING = "1"

# Use autohand to handle the smart commit workflow
autohand --auto-commit -p "Complete the pending changes" -y
`;

/**
 * Map of Windows PowerShell script names to their content
 */
export const HOOK_SCRIPTS_WINDOWS: Record<string, string> = {
  'smart-commit.ps1': SMART_COMMIT_HOOK_SCRIPT_PS1,
  'sound-alert.ps1': SOUND_ALERT_SCRIPT_PS1,
  'auto-format.ps1': AUTO_FORMAT_SCRIPT_PS1,
  'slack-notify.ps1': SLACK_NOTIFY_SCRIPT_PS1,
  'git-auto-stage.ps1': GIT_AUTO_STAGE_SCRIPT_PS1,
  'security-guard.ps1': SECURITY_GUARD_SCRIPT_PS1,
};
