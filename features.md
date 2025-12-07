# Autohand CLI Features

Autohand is an advanced, autonomous LLM-powered coding agent designed to work directly in your terminal. Below is a comprehensive list of its current features.

## 🧠 Core Intelligence
- **Autonomous Agent**: Uses a ReAct (Reasoning + Acting) loop to solve complex coding tasks.
- **Multi-Model Support**: Integrated with OpenRouter to support various LLMs (Claude, GPT-4, Grok, etc.).
- **Local/Hosted Providers**: Supports OpenRouter, Ollama, llama.cpp, and MLX via configurable providers in `~/.autohand-cli/config.json`.
- **Context Awareness**: Automatically analyzes your project structure and files to provide relevant context.

## 💻 Interactive Experience
- **Slash Suggestions**: Type `/` to see inline command suggestions (same UX as @ mentions).
- **File Mentions**: Type `@` to trigger autocomplete for files in your workspace, allowing you to easily add them to the context.
- **Rich UI**: Modern terminal UI with a status bar, spinners, and colored output (powered by Ink and Chalk).
- **Graceful Error Handling**: Robust input handling that prevents crashes on cancellation (ESC) or invalid inputs.

## 💾 Session Management
- **Auto-Save**: All sessions are automatically saved to `~/.autohand-cli/sessions`.
- **Resume Capability**: Pick up exactly where you left off with the `/resume` command or `autohand resume <id>`.
- **History Tracking**: Keeps a log of all interactions, tool outputs, and agent thoughts.

## 🛠️ Slash Commands
The CLI supports a variety of slash commands for quick actions:

| Command | Description |
| :--- | :--- |
| `/quit` | Gracefully exit the current session. |
| `/model` | Switch between different LLM models and adjust reasoning effort. |
| `/session` | Show the current session details. |
| `/sessions` | List all available past sessions. |
| `/resume` | Resume a previous session by ID. |
| `/init` | Create an `AGENTS.md` file with instructions for Autohand. |
| `/agents` | List sub-agents from `~/.autohand-cli/agents/` (JSON or Markdown). |
| `/feedback` | Send feedback with environment details. |
| `/help` or `/?` | Display help information and tips. |

## 🤖 Sub-Agent Architecture
- **Registry**: Agents discovered from `~/.autohand-cli/agents/` (JSON or Markdown).
- **Delegation**: Main agent can delegate tasks (`delegate_task`) or run up to 5 in parallel (`delegate_parallel`).
- **Execution**: Sub-agents run their own ReAct loop with allowed tools; sequence handled via delegate_task.
- **Discovery**: `/agents` lists all available sub-agents with their description and path.

## 📂 Project Management
- **Workspace Resolution**: Automatically detects the project root.
- **Smart File Operations**: Can read, write, and modify files safely.
- **Git Integration**: Aware of git status and can show diffs.

---

## 🚀 Feature Roadmap & Checklist

Below is a comprehensive checklist of features we are tracking against competitors.

#### Core Architecture
- [ ] Component functions with props/context emitting intents (tool calls, text, diffs)
- [ ] Hooks: `use_state`, `use_effect` (async), `use_tool`, `use_stream`, `use_plan`
- [ ] Additional hooks: `use_memo`, `use_callback`, `use_ref`, `use_context`, `use_reducer`
- [ ] Reconciler: scheduling, batching, side-effect coordination, cancellation, timeouts
- [x] Renderer: terminal-focused; streaming output, progress, diffs, code blocks, tables
- [ ] Context propagation system for sharing state across component tree
- [ ] Error boundaries for graceful failure handling in component trees
- [ ] Suspense-like primitives for async data loading
- [ ] Portal rendering for floating/overlay UI elements
- [ ] Component lifecycle instrumentation and profiling
- [ ] Hot module reloading for component development
- [ ] Fiber-like work scheduling with priority lanes
- [ ] Concurrent rendering mode for responsiveness

#### Tool System
- [x] Tool layer: typed traits, registry, mocking harness
- [x] File system tools: read, write, edit with diff preview, create, delete, move, copy
- [x] Search tools: ripgrep integration, semantic search, symbol lookup, AST queries
- [x] Git tools: status, diff, commit, branch, merge, rebase, cherry-pick, stash
- [ ] Code formatting: language-specific formatters (prettier, black, rustfmt, gofmt, etc.)
- [ ] Code linting: integration with eslint, pylint, clippy, etc.
- [x] Shell execution: safe command runner with output streaming
- [ ] LSP integration: go-to-definition, find-references, diagnostics, rename, code actions
- [ ] Build tools: compile, test, lint runners for multiple ecosystems
- [ ] Package manager tools: npm, pip, cargo, maven, gradle operations
- [ ] Database tools: query execution, schema inspection, migrations
- [ ] HTTP client: API requests with authentication
- [ ] WebSocket client for real-time services
- [ ] Docker/container tools: build, run, inspect, logs
- [ ] Kubernetes tools: deployment, pod inspection, logs
- [ ] Cloud provider CLIs: AWS, GCP, Azure integrations
- [ ] Tool composition: chain tools together, conditional execution, loops
- [x] Tool permission system: user approval for sensitive operations
- [ ] Tool result caching with TTL and invalidation
- [ ] Tool timeouts and retry strategies
- [ ] Tool execution sandboxing per workspace
- [ ] Tool usage analytics and optimization hints

#### UX & Interface
- [x] Interactive loop with command routing
- [x] Session persistence: save/resume conversations and context
- [x] Streaming text output with typewriter effect
- [x] Syntax-highlighted code blocks with language detection
- [x] Interactive diff viewer: accept/reject/edit changes
- [x] Progress indicators: spinners, progress bars, task lists
- [ ] Table rendering for structured data
- [ ] Collapsible sections for verbose output
- [ ] Keyboard shortcuts for common operations
- [ ] Multi-file preview pane
- [ ] Split view for comparing files
- [ ] Minimap for large file navigation
- [x] Undo/redo for file changes with history timeline
- [x] Search history and command palette (fuzzy search)
- [x] Auto-suggestions based on context (File mentions)
- [x] Natural language input parsing
- [ ] Voice input support (optional)
- [ ] Multi-modal output: text, images, graphs, diagrams
- [x] Responsive layout adapting to terminal size
- [x] Color scheme customization and accessibility modes
- [ ] Notification system for background tasks
- [ ] Breadcrumb navigation for nested contexts
- [ ] Quick actions menu (Ctrl+P style)
- [ ] File tree browser with filtering
- [ ] Integrated terminal emulator for shell commands
- [ ] Watch mode: auto-refresh on file changes
- [ ] Bookmarks and favorites
- [ ] Export session as markdown, HTML, or PDF

#### Planning & Execution
- [x] Multi-step plan generation and visualization
- [ ] Plan modification: user can edit/approve plans before execution
- [ ] Parallel task execution where safe
- [ ] Dependency graph for task ordering (DAG visualization)
- [ ] Checkpoint system: save state between major steps
- [ ] Rollback mechanism for failed operations
- [x] Dry-run mode: preview changes without execution
- [ ] What-if analysis: simulate different execution paths
- [ ] Resource estimation: time, tokens, API calls per plan
- [ ] Plan templates for common workflows
- [ ] Plan sharing and reuse across sessions
- [ ] Automatic plan optimization based on history
- [ ] Incremental plan execution with pause/resume
- [ ] Plan branching for exploratory tasks
- [ ] Failure recovery strategies: retry, skip, abort
- [ ] Progress tracking with ETA calculation

#### Runtime Services
- [ ] Structured logging with configurable verbosity levels
- [ ] Distributed tracing for debugging complex workflows
- [ ] Error taxonomy: categorized errors with actionable messages
- [ ] Performance metrics: token usage, tool call latency, execution time
- [ ] Resource limits: timeout enforcement, rate limiting
- [ ] Telemetry (opt-in): anonymous usage statistics
- [ ] Health checks for external dependencies
- [ ] Graceful degradation when services unavailable
- [ ] Circuit breaker pattern for failing services
- [ ] Request/response logging for debugging
- [ ] Metrics dashboard (TUI-based)
- [ ] Alert system for anomalies
- [ ] Memory profiling and leak detection
- [ ] CPU usage monitoring
- [ ] Network bandwidth tracking

#### Testing & Quality
- [ ] Unit test framework for components and hooks
- [ ] Integration tests for end-to-end workflows
- [ ] Golden snapshot tests for renderer output
- [ ] Mock tool implementations for deterministic testing
- [ ] Deterministic scheduler for reproducible async behavior
- [ ] Property-based testing for reconciler logic
- [ ] Performance benchmarks and regression detection
- [ ] Fuzz testing for parser/renderer edge cases
- [ ] Contract testing for tool interfaces
- [ ] Mutation testing for test quality
- [ ] Coverage reporting with visualization
- [ ] Continuous integration templates
- [ ] Test parallelization for speed
- [ ] Flaky test detection and quarantine
- [ ] Visual regression testing for TUI
- [ ] Load testing for concurrent operations
- [ ] Chaos engineering for resilience testing

#### Configuration & Extensibility
- [x] Config file support (YAML/TOML/JSON)
- [ ] User-defined tool plugins with hot-reload
- [ ] Custom renderer themes and layouts
- [ ] Hook into lifecycle events (on_start, on_complete, on_error)
- [ ] Environment-specific profiles (dev, staging, prod)
- [ ] Project-specific settings (.claude directory)
- [ ] Workspace inheritance (global → project → local)
- [ ] Dynamic config reloading without restart
- [ ] Config validation with schema
- [ ] Config migration tools for version updates
- [ ] Plugin marketplace/registry
- [ ] Plugin dependency resolution
- [ ] Plugin sandboxing for security
- [ ] Scripting API for automation (Lua/Python/JS)
- [ ] Custom command definitions
- [ ] Macro system for repetitive tasks
- [ ] Template system for scaffolding

#### Developer Experience
- [ ] Comprehensive API documentation
- [ ] Interactive tutorial/onboarding flow
- [ ] Example library: common patterns and use cases
- [ ] Debug mode with verbose internal state logging
- [ ] REPL for testing components and tools in isolation
- [ ] VS Code extension for enhanced integration
- [ ] JetBrains plugin support
- [ ] Vim/Neovim plugin
- [ ] Shell completion scripts (bash, zsh, fish, PowerShell)
- [ ] Man pages for CLI commands
- [x] Interactive help system
- [ ] Quick start wizard for new projects
- [ ] Migration guides from other tools
- [ ] Video tutorials and screencasts
- [ ] Community Discord/forum integration
- [ ] Issue tracker integration for bug reports
- [ ] Feature request voting system
- [ ] Changelog with semantic versioning
- [ ] Upgrade assistant for breaking changes

#### Security & Safety
- [ ] Sandboxed tool execution environment
- [ ] File access whitelist/blacklist with glob patterns
- [x] Confirmation prompts for destructive operations
- [ ] Audit log of all tool executions
- [ ] Secret redaction in logs and outputs
- [ ] Input validation and sanitization
- [ ] Rate limiting for API calls
- [ ] API key rotation support
- [ ] OAuth2 integration for services
- [ ] Two-factor authentication support
- [ ] Encryption at rest for sensitive data
- [ ] Encryption in transit (TLS)
- [ ] Code signing for plugins
- [ ] Vulnerability scanning for dependencies
- [ ] Supply chain security (SBOM)
- [ ] Compliance reporting (SOC2, GDPR)
- [ ] Role-based access control
- [ ] Session timeout and auto-lock
- [ ] Secure credential storage (OS keychain)
- [ ] Network isolation modes

#### Performance
- [ ] Lazy loading of tools and components
- [x] Response streaming for immediate feedback
- [ ] Incremental rendering for large outputs
- [ ] Caching layer for repeated tool calls
- [ ] Connection pooling for external services
- [ ] Memory-efficient handling of large files (streaming)
- [ ] Virtual scrolling for long outputs
- [ ] Debouncing and throttling for inputs
- [ ] Background job queue for non-blocking ops
- [ ] Worker pool for parallel execution
- [ ] JIT compilation for hot paths
- [ ] Ahead-of-time optimization hints
- [ ] Garbage collection tuning
- [ ] Memory pooling for allocations
- [ ] Zero-copy operations where possible
- [ ] Compression for network payloads
- [ ] Index structures for fast lookups

#### Platform Support
- [x] Cross-platform compatibility (macOS, Linux, Windows)
- [ ] ARM architecture support (Apple Silicon, ARM servers)
- [ ] Container/Docker support with optimized images
- [ ] CI/CD integration examples (GitHub Actions, GitLab CI, Jenkins)
- [ ] Remote execution over SSH
- [ ] Cloud IDE support (GitHub Codespaces, Gitpod, CodeSandbox)
- [ ] Web assembly build for browser environments
- [ ] Native binary distribution (no runtime dependencies)
- [ ] Package manager integrations (Homebrew, apt, Chocolatey, Scoop)
- [ ] Snap/Flatpak packages
- [ ] Portable mode (run from USB)
- [ ] Windows Terminal integration
- [ ] iTerm2/Kitty/Alacritty enhanced features
- [ ] tmux/screen session support
- [ ] Mobile SSH client compatibility

#### Collaboration & Sharing
- [ ] Session sharing via unique URLs
- [ ] Real-time collaborative editing (CRDT-based)
- [ ] Team workspaces with shared context
- [ ] Code review workflow integration
- [ ] Commenting system on code changes
- [ ] Presence indicators for team members
- [ ] Chat integration (Slack, Teams, Discord)
- [ ] Screen recording for demos
- [ ] Snippet sharing with syntax highlighting
- [ ] Export/import session data
- [ ] Version control for conversations
- [ ] Conflict resolution for concurrent edits

#### AI & Intelligence
- [x] Context-aware auto-completion
- [ ] Semantic code search across entire codebase
- [ ] Intelligent refactoring suggestions
- [ ] Bug prediction and prevention
- [ ] Performance optimization recommendations
- [ ] Dependency update suggestions with impact analysis
- [ ] Natural language to code generation
- [ ] Code explanation and documentation generation
- [ ] Test generation from implementations
- [ ] Security vulnerability detection
- [ ] Code smell detection
- [ ] Learning from user corrections
- [x] Multi-file understanding and reasoning
- [ ] Codebase-wide impact analysis
- [ ] Architecture diagram generation

#### Observability & Debugging
- [ ] Real-time execution visualization
- [ ] Step-through debugging for plans
- [ ] Breakpoints in component execution
- [ ] Variable inspection at runtime
- [ ] Call stack traces for errors
- [ ] Timeline view of all operations
- [ ] Flame graphs for performance analysis
- [ ] Distributed tracing across tools
- [ ] Log aggregation and search
- [ ] Replay mode for debugging sessions
- [ ] Comparative debugging (before/after)
- [ ] Live metrics dashboard
- [ ] Alert rules for error conditions

#### Accessibility
- [ ] Screen reader support
- [ ] High contrast themes
- [ ] Configurable font sizes
- [ ] Keyboard-only navigation
- [ ] Alternative text for visual elements
- [ ] Reduced motion mode
- [ ] Color-blind friendly palettes
- [ ] Text-to-speech output (optional)
- [ ] Internationalization (i18n) support
- [ ] Localization for major languages
- [ ] Right-to-left language support
- [ ] Timezone handling

#### Ecosystem Integration
- [ ] GitHub App for PR reviews and issue triage
- [ ] GitLab integration
- [ ] Bitbucket support
- [ ] Jira integration for task tracking
- [ ] Linear integration
- [ ] Asana/Trello/Monday.com connectors
- [ ] Notion/Confluence documentation sync
- [ ] Figma design import for UI generation
- [ ] Slack bot for CLI access
- [ ] Email integration for summaries
- [ ] Calendar integration for scheduling
- [ ] RSS feeds for updates
- [ ] Webhook support for custom integrations
- [ ] Zapier/IFTTT actions
- [ ] GraphQL API for programmatic access
- [ ] REST API for external tools
- [ ] gRPC support for high-performance integrations

#### Advanced Features
- [ ] Multi-agent orchestration (spawning sub-tasks)
  - [x] **Sub-Agents System**: Ability to define custom agents in `~/.autohand-cli/agents/`.
  - [x] **Parallel Execution**: Run up to 5 sub-agents concurrently with different toolsets.
  - [x] **Slash Command**: `/agents` to list and inspect available sub-agents.
- [ ] Federated learning from user interactions
- [ ] Offline mode with sync on reconnect
- [ ] Blockchain-based audit trail (optional)
- [ ] Quantum-resistant encryption (future-proof)
- [ ] Browser extension for web scraping
- [ ] Custom DSL for complex workflows
- [ ] Machine learning model fine-tuning
- [ ] A/B testing framework for UX experiments
- [ ] Blue-green deployment strategies
- [ ] Canary releases for risky changes
- [ ] Feature flags for gradual rollout
