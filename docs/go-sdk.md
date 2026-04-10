# Autohand Code Agent SDK for Go

Build AI agents with Autohand Code using Go. Clean public APIs, provider-agnostic backends, and an ecosystem dashboard.

**Note:** This SDK is designed to work with the [Autohand Code CLI](https://github.com/autohandai/code-cli). While the SDK can be used standalone, we recommend installing the CLI for the best experience.

## Installation

```bash
go get github.com/autohandai/agentsdk-go
```

**Prerequisites:**

- Go 1.21+
- [Autohand Code CLI](https://github.com/autohandai/code-cli) (recommended for full functionality)

## Quick Start

```go
package main

import (
    "context"
    "fmt"
    "log"

    "github.com/autohandai/agentsdk-go/pkg/autohand"
)

func main() {
    agent := autohand.NewAgent(
        autohand.WithName("Assistant"),
        autohand.WithInstructions("You are a helpful assistant"),
    )

    config, err := autohand.Load("")
    if err != nil {
        log.Fatal(err)
    }

    runner, err := autohand.NewRunner(agent, config)
    if err != nil {
        log.Fatal(err)
    }

    ctx := context.Background()
    result, err := runner.Run(ctx, "Write a haiku about coding.")
    if err != nil {
        log.Fatal(err)
    }

    fmt.Println(result.FinalOutput)
}
```

## Basic Usage: Query()

`Query()` is a streaming function for querying AI agents. It returns channels for response events.

```go
package main

import (
    "context"
    "fmt"

    "github.com/autohandai/agentsdk-go/pkg/autohand"
)

func main() {
    options := &autohand.AgentOptions{
        Model:    "anthropic/claude-3-haiku",
        MaxTurns: 10,
    }

    config, _ := autohand.Load("")
    ctx := context.Background()

    eventChan, errChan := autohand.Query(ctx, "What is 2 + 2?", options, config)

    for {
        select {
        case event, ok := <-eventChan:
            if !ok {
                return
            }
            if event.Type == autohand.StreamEventTypeContent {
                fmt.Print(event.Content)
            }
        case err, ok := <-errChan:
            if !ok {
                return
            }
            log.Fatal(err)
        }
    }
}
```

### Using Tools

The SDK provides 40+ built-in tools for filesystem access, shell commands, git operations, and more.

```go
package main

import (
    "context"
    "fmt"
    "log"
    "os"

    "github.com/autohandai/agentsdk-go/pkg/autohand"
)

func main() {
    os.Setenv("AUTOHAND_PROVIDER", "openrouter")
    os.Setenv("AUTOHAND_API_KEY", "your-api-key-here")

    agent := autohand.NewAgent(
        autohand.WithName("Code Explorer"),
        autohand.WithInstructions("You are a software engineering assistant. Read code, understand it, and answer questions."),
        autohand.WithTools([]autohand.Tool{
            autohand.ToolReadFile,
            autohand.ToolBash,
        }),
        autohand.WithMaxTurns(15),
    )

    config, err := autohand.Load("")
    if err != nil {
        log.Fatal(err)
    }

    runner, err := autohand.NewRunner(agent, config)
    if err != nil {
        log.Fatal(err)
    }

    ctx := context.Background()
    result, err := runner.Run(ctx, "What does the auth module in src/auth.go do?")
    if err != nil {
        log.Fatal(err)
    }

    fmt.Println(result.FinalOutput)
}
```

### Streaming Responses

For long-running agents, you want to see progress in real-time:

```go
package main

import (
    "context"
    "fmt"
    "log"

    "github.com/autohandai/agentsdk-go/pkg/autohand"
)

func main() {
    agent := autohand.NewAgent(
        autohand.WithName("Explorer"),
        autohand.WithInstructions("Explore the codebase and report your findings."),
        autohand.WithTools([]autohand.Tool{
            autohand.ToolFind,
            autohand.ToolGlob,
            autohand.ToolReadFile,
        }),
    )

    config, err := autohand.Load("")
    if err != nil {
        log.Fatal(err)
    }

    runner, err := autohand.NewRunner(agent, config)
    if err != nil {
        log.Fatal(err)
    }

    ctx := context.Background()
    eventChan, errChan := runner.RunStream(ctx, "Find all Go test files")

    for {
        select {
        case event, ok := <-eventChan:
            if !ok {
                return
            }
            switch event.Type {
            case autohand.StreamEventTypeContent:
                fmt.Print(event.Content)
            case autohand.StreamEventTypeToolCall:
                fmt.Printf("\n[Tool: %s]\n", event.Tool)
            case autohand.StreamEventTypeToolResult:
                fmt.Printf("[Result]\n")
            case autohand.StreamEventTypeDone:
                return
            }
        case err, ok := <-errChan:
            if !ok {
                return
            }
            log.Fatal(err)
        }
    }
}
```

## Configuration

Configure providers and models via environment variables:

```bash
export AUTOHAND_PROVIDER=openrouter
export AUTOHAND_API_KEY=sk-or-v1-...
export AUTOHAND_MODEL=your-model-name-here
```

Or use a config file at `~/.autohand/config.json`:

```json
{
  "provider": "openrouter",
  "openrouter": {
    "api_key": "sk-or-v1-...",
    "model": "your-model-name-here"
  }
}
```

## Available Tools

The SDK provides 40+ built-in tools organized by category:

| Category   | Tools |
|------------|-------|
| Filesystem | read_file, write_file, edit_file, apply_patch, find, glob, search_in_files |
| Commands   | bash |
| Git        | git_status, git_diff, git_log, git_commit, git_add, git_reset, git_push, git_pull, git_fetch, git_checkout, git_switch, git_branch, git_merge, git_rebase, git_stash, git_apply_patch, git_worktree_list, git_worktree_add |
| Web        | web_search |
| Notebook   | notebook_read, notebook_edit |
| Dependencies | read_package_manifest, add_dependency, remove_dependency |
| Formatters | format_file, format_directory, list_formatters, check_formatting |
| Linters    | lint_file, lint_directory, list_linters |

## Providers

The SDK is provider-agnostic and supports multiple LLM backends:

| Provider   | Notes                        |
|------------|------------------------------|
| OpenRouter | Primary/default, 200+ models |
| OpenAI     | Direct OpenAI API            |
| Ollama     | Local models                 |
| Azure      | Enterprise Azure OpenAI      |
| LlamaCpp   | Local LLaMA.cpp server       |
| MLX        | Apple Silicon local runtime  |
| LLMGateway | Internal gateway proxy       |

## Types

See `pkg/autohand/types.go` for complete type definitions:

- `Agent` - Agent configuration with instructions, tools, and model settings
- `AgentOptions` - Runtime options for agent execution
- `Tool` - Tool definitions and permissions
- `Session` - Conversation state management
- `RunResult` - Execution results with outputs and metadata
- `ChatResponse` - LLM response with content and tool calls
- `Message` - Conversation message with role and content
- `ToolResult` - Result from executing a tool

## Examples

See `examples/` for comprehensive examples:

- `01-hello-agent.go` - Basic agent usage
- `02-streaming-query.go` - Streaming responses
- `03-code-reviewer-agent.go` - Code review workflow
- `04-bash-command.go` - Shell command execution
- `05-file-editor-agent.go` - File editing
- `06-config-from-env.go` - Environment configuration

## Documentation

- **[README](https://github.com/autohandai/agentsdk-go)** - Main SDK documentation
- **[Reference](docs/REFERENCE.md)** - Complete API reference
- **[Examples](examples/)** - Working examples covering common use cases
- **[Autohand Code CLI](https://github.com/autohandai/code-cli)** - The companion CLI for Autohand Code

## Development

If you're contributing to this project:

```bash
# Run tests
go test ./...

# Run tests with coverage
go test -cover ./...

# Build the SDK
go build ./...
```

For development with the Autohand Code CLI, see the [CLI repository](https://github.com/autohandai/code-cli).

## Agent Options Pattern

The SDK uses functional options for flexible agent configuration:

```go
agent := autohand.NewAgent(
    autohand.WithName("MyAgent"),
    autohand.WithInstructions("You are helpful"),
    autohand.WithTools([]autohand.Tool{...}),
    autohand.WithModel("gpt-4o"),
    autohand.WithMaxTurns(20),
    autohand.WithAppendSystemPrompt("Additional instructions"),
    autohand.WithCWD("/path/to/project"),
    autohand.WithMemories("User preferences"),
    autohand.WithCustomInstructions([]string{"Custom rule 1", "Custom rule 2"}),
)
```

## Session Management

Save and restore conversation state:

```go
// Save session
session := autohand.NewSession()
session.AddUserMessage("Hello")
session.AddAssistantMessage("Hi there!")
session.Save("my-session.json")

// Load session
loaded, err := autohand.LoadSession("my-session.json")
if err != nil {
    log.Fatal(err)
}

// Clone session
cloned := loaded.Clone()
```

## Custom Tools

Implement custom tools by satisfying the `ToolDefinition` interface:

```go
package main

import (
    "context"
    "github.com/autohandai/agentsdk-go/pkg/autohand"
    "github.com/autohandai/agentsdk-go/pkg/autohand/tools"
)

type MyCustomTool struct {
    *tools.BaseTool
}

func NewMyCustomTool() *MyCustomTool {
    return &MyCustomTool{
        BaseTool: tools.NewBaseTool(
            autohand.Tool("my_custom_tool"),
            "Description of my custom tool",
            map[string]interface{}{
                "type": "object",
                "properties": map[string]interface{}{
                    "input": map[string]interface{}{
                        "type":        "string",
                        "description": "The input data",
                    },
                },
                "required": []string{"input"},
            },
        ),
    }
}

func (t *MyCustomTool) Execute(ctx context.Context, params map[string]interface{}) (*autohand.ToolResult, error) {
    input, _ := params["input"].(string)
    return &autohand.ToolResult{Data: "Processed: " + input}, nil
}
```

Register custom tools with the tool manager:

```go
manager := tools.NewToolManager()
manager.Register(NewMyCustomTool())
```

## Provider Configuration

### OpenRouter

```go
config.SetProvider("openrouter", map[string]string{
    "api_key": "sk-or-v1-...",
    "model":   "anthropic/claude-3-haiku",
})
```

### OpenAI

```go
config.SetProvider("openai", map[string]string{
    "api_key":  "sk-...",
    "model":    "gpt-4o",
    "authMode": "api-key",
})
```

### Ollama

```go
config.SetProvider("ollama", map[string]string{
    "base_url": "http://localhost:11434",
    "model":    "llama3.2",
})
```

## License

Apache License 2.0
