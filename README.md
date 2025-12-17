# Autohand CLI

[![Bun](https://img.shields.io/badge/Bun-%23c61f33?style=flat&logo=bun&logoColor=white)](https://bun.sh)

Autohand implements a CLI-based AI coding assistant utilizing the ReAct (Reason + Act) reasoning pattern. The system processes requests through sequential phases: reasoning, tool invocation (file system, Git operations, shell commands), result interpretation, and JSON-formatted response generation. Implemented in TypeScript with Bun runtime for optimal performance.

## Features

- **ReAct Execution Model**: reason → tool calls → observation → final response
- **Toolset**: 20+ operations including `read_file`, `write_file`, `git_status`, `run_command`, `search`, etc.
- **Response Protocol**: Structured JSON `{"thought":"...","toolCalls":[...],"finalResponse":"..."}`
- **Workspace Integration**: Operates within the current project directory with Git state awareness
- **Runtime**: Bun-native with zero external dependencies, native TypeScript execution
- **Safety Controls**: Destructive operations require explicit justification in reasoning trace

## Local Development

### Requirements
- Bun ≥1.0 (`curl -fsSL https://bun.sh/install | bash`)

### Installation
```bash
bun install
```

### Execution
```bash
# Development mode
bun run dev

# Production build and execution
bun build
./dist/cli.js

# Global installation
bun add -g .
```

## Configuration

### LLM Provider Configuration

Create a `.autohandrc.json` file in your project root or home directory:

```json
{
  "openrouter": {
    "apiKey": "your-api-key-here",
    "model": "anthropic/claude-3.5-sonnet"
  },
  "workspace": {
    "defaultRoot": ".",
    "allowDangerousOps": false
  },
  "ui": {
    "theme": "dark",
    "autoConfirm": false,
    "readFileCharLimit": 300
  }
}
```

### API Configuration (Telemetry & Feedback)

For telemetry and feedback submission, create a `.env` file in the project root:

```bash
# Autohand API Configuration
AUTOHAND_API_URL=https://api.autohand.ai
AUTOHAND_SECRET=your-company-secret-here
```

**Note:** The Autohand feedback and telemetry API backend has been extracted to a separate repository:
👉 https://github.com/autohandai/api

The CLI includes client libraries with offline queueing, retry mechanisms, and privacy features. API authentication uses a compound identifier: `device_id.company_secret`.

### UI Settings

- **`readFileCharLimit`** (default: `300`): Maximum characters to display when reading files. Larger files will be truncated with a clear indicator.
- **`theme`**: UI theme (`"dark"` | `"light"`)
- **`autoConfirm`**: Skip confirmation prompts for destructive operations

See `config.example.json` for a full example.

## Deployment

### Firecracker MicroVM

Create `run-microvm.sh`:
```bash
#!/bin/bash
firecracker --api-sock /tmp/fc.sock &

cat > config.json <<EOF
{
  "boot-source": {
    "kernel_image_path": "vmlinux.bin",
    "boot_args": "console=ttyS0 reboot=k panic=1 pci=off"
  },
  "drives": [{
    "drive_id": "rootfs",
    "path_on_host": "rootfs.ext4",
    "is_root_device": true,
    "is_read_only": false
  }],
  "machine-config": { "vcpu_count": 2, "mem_size_mib": 1024 }
}
EOF

curl --unix-socket /tmp/fc.sock -d @config.json http://localhost/actions

# Within MicroVM: bun install && bun run dev
```

Execute: `chmod +x run-microvm.sh && ./run-microvm.sh`

### Docker

`Dockerfile`:
```dockerfile
FROM oven/bun:1
WORKDIR /app
COPY . .
RUN bun install
RUN bun build
CMD ["./dist/cli.js"]
```

Build and run:
```bash
docker build -t autohand .
docker run -it autohand
```