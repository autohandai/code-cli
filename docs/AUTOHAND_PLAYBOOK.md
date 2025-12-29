# Autohand CLI Playbook

> 20 Essential Use Cases for the Software Development Lifecycle

Autohand CLI is a ultra fast coding cli agent that lives in your terminal, it's built to run fast, and with a minimal terminal user interface (TUI). This playbook covers practical scenarios you'll encounter throughout the software development lifecycle.

---

## Table of Contents

1. [Project Scaffolding](#1-project-scaffolding)
2. [Code Generation](#2-code-generation)
3. [Bug Fixing](#3-bug-fixing)
4. [Refactoring](#4-refactoring)
5. [Writing Tests](#5-writing-tests)
6. [Documentation](#6-documentation)
7. [Code Review Assistance](#7-code-review-assistance)
8. [Git Operations](#8-git-operations)
9. [Dependency Management](#9-dependency-management)
10. [CI/CD Pipeline Setup](#10-cicd-pipeline-setup)
11. [Performance Optimization](#11-performance-optimization)
12. [Security Audits](#12-security-audits)
13. [API Development](#13-api-development)
14. [Database Migrations](#14-database-migrations)
15. [Debugging](#15-debugging)
16. [Code Search & Analysis](#16-code-search--analysis)
17. [Release Management](#17-release-management)
18. [Environment Setup](#18-environment-setup)
19. [Code Formatting & Linting](#19-code-formatting--linting)
20. [Learning & Exploration](#20-learning--exploration)

---

## 1. Project Scaffolding

**Goal:** Bootstrap a new project with proper structure, configuration, and best practices.

### Interactive Mode

```bash
autohand
› Create a new TypeScript CLI project with commander, vitest, and eslint. Include a src/ folder structure with index.ts, commands/, and utils/ directories.
```

### Command Mode

```bash
autohand --prompt "Scaffold a React + Vite project with TypeScript, Tailwind CSS, and React Router. Include folder structure for components, hooks, and services."
```

### Pro Tips

- Use `@package.json` to reference existing configs when extending projects
- Ask for specific patterns: "Use the repository pattern for data access"
- Request CI configs: "Include GitHub Actions workflow for testing"

---

## 2. Code Generation

**Goal:** Generate boilerplate code, components, or entire features.

### Generate a React Component

```bash
› Generate a reusable DataTable component with sorting, pagination, and filtering. Use TypeScript generics for type-safe column definitions. @src/components/
```

### Generate an API Endpoint

```bash
› Create a REST API endpoint for user authentication with login, register, and refresh token routes. Use Express and JWT. @src/routes/auth.ts
```

### Generate from Specification

```bash
› Based on @api-spec.yaml, generate TypeScript types and API client functions for all endpoints.
```

### Pro Tips

- Reference existing files with `@` to maintain consistency
- Be specific about patterns: "Use the factory pattern" or "Follow existing component structure"
- Ask for edge case handling: "Include error boundaries and loading states"

---

## 3. Bug Fixing

**Goal:** Identify and fix bugs in your codebase.

### Fix a Specific Error

```bash
› I'm getting "TypeError: Cannot read property 'map' of undefined" in @src/components/UserList.tsx. Find and fix the bug.
```

### Fix Failing Tests

```bash
› The tests in @tests/auth.test.ts are failing. Analyze the test output and fix the issues in the source code.
```

### Debug Runtime Issues

```bash
› Users report that the form in @src/pages/Checkout.tsx submits twice. Find the cause and fix it.
```

### Pro Tips

- Include error messages and stack traces in your prompt
- Reference both the failing code and related files
- Ask for root cause analysis: "Explain why this bug occurred and how to prevent similar issues"

---

## 4. Refactoring

**Goal:** Improve code quality without changing functionality.

### Extract Reusable Logic

```bash
› Extract the data fetching logic from @src/pages/Dashboard.tsx into a custom hook. Apply the same pattern to @src/pages/Profile.tsx.
```

### Modernize Code

```bash
› Refactor @src/utils/helpers.js from CommonJS to ES modules. Convert callbacks to async/await where appropriate.
```

### Apply Design Patterns

```bash
› Refactor @src/services/payment.ts to use the Strategy pattern for different payment providers (Stripe, PayPal, Square).
```

### Simplify Complex Functions

```bash
› The function processOrder in @src/services/orders.ts is 200 lines. Break it into smaller, testable functions.
```

### Pro Tips

- Ask for incremental refactoring: "Refactor in small steps, showing each change"
- Request tests first: "Write tests for current behavior before refactoring"
- Use `/undo` if a refactor goes wrong

---

## 5. Writing Tests

**Goal:** Create comprehensive test coverage for your code.

### Unit Tests

```bash
› Write unit tests for @src/utils/validation.ts using Vitest. Cover edge cases including empty inputs, invalid formats, and boundary values.
```

### Integration Tests

```bash
› Create integration tests for the user registration flow. Test the API endpoint, database operations, and email service integration.
```

### E2E Tests

```bash
› Write Playwright E2E tests for the checkout flow: add to cart, enter shipping, payment, confirmation.
```

### Test-Driven Development

```bash
› I need a function that validates credit card numbers using the Luhn algorithm. Write the tests first, then implement the function.
```

### Pro Tips

- Specify test framework: "Use Vitest with React Testing Library"
- Ask for test data factories: "Create a factory for generating test users"
- Request coverage analysis: "Identify untested code paths in @src/auth/"

---

## 6. Documentation

**Goal:** Create and maintain project documentation.

### Generate README

```bash
› Create a comprehensive README.md for this project. Include installation, usage, API reference, and contributing guidelines. Analyze @package.json and @src/ for accurate information.
```

### API Documentation

```bash
› Generate JSDoc comments for all exported functions in @src/utils/. Include parameter descriptions, return types, and usage examples.
```

### Architecture Documentation

```bash
› Create an ARCHITECTURE.md explaining the project structure, data flow, and key design decisions. Analyze the codebase for accuracy.
```

### Changelog

```bash
› Based on git commits since the last tag, generate a CHANGELOG entry following Keep a Changelog format.
```

### Pro Tips

- Use `/init` to scaffold an AGENTS.md for AI-friendly project documentation
- Ask for diagrams: "Include a Mermaid diagram showing the data flow"
- Request multiple formats: "Generate both Markdown and inline code comments"

---

## 7. Code Review Assistance

**Goal:** Get AI-powered code review feedback.

### Review a File

```bash
› Review @src/services/payment.ts for code quality, security issues, and performance. Suggest improvements.
```

### Review Changes

```bash
› Review my staged changes. Check for bugs, security issues, and adherence to project conventions.
```

### Review Pull Request Style

```bash
› Act as a senior engineer reviewing @src/features/auth/. Check for: error handling, type safety, test coverage, and documentation.
```

### Security-Focused Review

```bash
› Perform a security review of @src/api/. Look for injection vulnerabilities, authentication issues, and data exposure risks.
```

### Pro Tips

- Be specific about review criteria: "Focus on performance" or "Check for accessibility"
- Ask for severity ratings: "Rate issues as critical, major, or minor"
- Request actionable feedback: "For each issue, provide a fix"

---

## 8. Git Operations

**Goal:** Manage version control efficiently.

### Smart Commits

```bash
› Stage all changes and create a commit with a conventional commit message based on the diff.
```

Or use the slash command:
```bash
/commit
```

### Branch Management

```bash
› Create a feature branch for implementing user notifications. Set up tracking with origin.
```

### Resolve Merge Conflicts

```bash
› I have merge conflicts in @src/config.ts. Show me the conflicts and help resolve them, keeping both sets of changes where possible.
```

### Interactive Rebase Help

```bash
› I need to squash the last 5 commits into one with a clean message. Guide me through the process.
```

### Cherry-Pick Workflow

```bash
› Cherry-pick commit abc123 from the feature branch to main, resolving any conflicts.
```

### Pro Tips

- Use `git_status` to see current state before operations
- Autohand tracks changes for `/undo` functionality
- Ask for commit message suggestions: "Suggest a commit message for these changes"

---

## 9. Dependency Management

**Goal:** Manage project dependencies safely.

### Add Dependencies

```bash
› Add zod for schema validation and configure it with TypeScript. Show a usage example.
```

### Audit Dependencies

```bash
› Analyze @package.json for outdated dependencies. Which ones have breaking changes? Create an upgrade plan.
```

### Remove Unused Dependencies

```bash
› Find and remove unused dependencies from this project. Verify nothing breaks after removal.
```

### Migrate Dependencies

```bash
› Migrate from moment.js to date-fns. Update all imports and usage patterns in the codebase.
```

### Pro Tips

- Ask about peer dependencies: "What peer deps does this package require?"
- Request compatibility checks: "Is this package compatible with Node 18?"
- Use `package_info` tool for detailed package information

---

## 10. CI/CD Pipeline Setup

**Goal:** Configure continuous integration and deployment.

### GitHub Actions

```bash
› Create a GitHub Actions workflow that runs on PR: lint, typecheck, test, and build. Cache node_modules for speed.
```

### Docker Configuration

```bash
› Create a multi-stage Dockerfile for this Node.js app. Optimize for small image size and fast builds.
```

### Deployment Pipeline

```bash
› Set up a deployment pipeline to Vercel with preview deployments for PRs and production deployment on main merge.
```

### Quality Gates

```bash
› Add a CI step that fails if test coverage drops below 80% or if there are any TypeScript errors.
```

### Pro Tips

- Reference existing workflows: "Match the style of @.github/workflows/test.yml"
- Ask for secrets management: "How should I handle API keys in this workflow?"
- Request matrix builds: "Test against Node 18, 20, and 22"

---

## 11. Performance Optimization

**Goal:** Identify and fix performance bottlenecks.

### Profile and Optimize

```bash
› Analyze @src/components/DataGrid.tsx for performance issues. It re-renders too often. Suggest and implement optimizations.
```

### Bundle Size Optimization

```bash
› Analyze the bundle size and suggest ways to reduce it. Look for large dependencies that could be replaced or lazy-loaded.
```

### Database Query Optimization

```bash
› The query in @src/repositories/orders.ts is slow. Analyze it and suggest indexes or query restructuring.
```

### Memory Leak Detection

```bash
› Review @src/hooks/useWebSocket.ts for potential memory leaks. Ensure proper cleanup on unmount.
```

### Pro Tips

- Ask for benchmarks: "Add performance benchmarks for the critical path"
- Request lazy loading: "Implement code splitting for routes"
- Use profiling data: "Here's the flame graph output, analyze it"

---

## 12. Security Audits

**Goal:** Identify and fix security vulnerabilities.

### Dependency Vulnerabilities

```bash
› Run a security audit on dependencies and fix any high or critical vulnerabilities.
```

### Code Security Review

```bash
› Audit @src/api/ for OWASP Top 10 vulnerabilities. Focus on injection, authentication, and data exposure.
```

### Secrets Detection

```bash
› Scan the codebase for hardcoded secrets, API keys, or credentials. Set up pre-commit hooks to prevent future leaks.
```

### Input Validation

```bash
› Review all user input handling in @src/controllers/. Ensure proper validation and sanitization.
```

### Pro Tips

- Ask for security headers: "Add security headers to the Express app"
- Request rate limiting: "Implement rate limiting for auth endpoints"
- Use environment variables: "Move all secrets to environment variables"

---

## 13. API Development

**Goal:** Design and implement APIs.

### REST API Design

```bash
› Design a RESTful API for a blog platform with posts, comments, and users. Create the route handlers and OpenAPI spec.
```

### GraphQL Schema

```bash
› Create a GraphQL schema and resolvers for the e-commerce data model in @src/models/. Include pagination and filtering.
```

### API Versioning

```bash
› Implement API versioning for @src/api/. Support both v1 and v2 endpoints with graceful deprecation.
```

### API Client Generation

```bash
› Generate a type-safe API client from @openapi.yaml using openapi-typescript-codegen.
```

### Pro Tips

- Ask for validation: "Add request validation with Zod schemas"
- Request error handling: "Implement consistent error responses"
- Include rate limiting: "Add rate limiting middleware"

---

## 14. Database Migrations

**Goal:** Manage database schema changes safely.

### Create Migration

```bash
› Create a Prisma migration to add a 'preferences' JSON column to the User model with a default value.
```

### Seed Data

```bash
› Create a database seed script with realistic test data for users, products, and orders.
```

### Migration Rollback Plan

```bash
› Create a rollback migration for the changes in @prisma/migrations/20240115_add_preferences/. Include data preservation.
```

### Schema Documentation

```bash
› Generate documentation for the database schema including relationships, indexes, and constraints.
```

### Pro Tips

- Ask for data migration: "Migrate existing data to the new schema"
- Request validation: "Verify migration is reversible before applying"
- Include indexes: "Add appropriate indexes for common queries"

---

## 15. Debugging

**Goal:** Diagnose and fix issues systematically.

### Trace an Issue

```bash
› Users report 500 errors on /api/checkout. Trace the request flow through @src/api/checkout.ts and identify the failure point.
```

### Add Debugging

```bash
› Add structured logging to @src/services/payment.ts to help debug transaction failures. Use the existing logger.
```

### Reproduce a Bug

```bash
› Create a minimal reproduction for the race condition in @src/hooks/useAuth.ts. Then fix it.
```

### Analyze Logs

```bash
› Here's the error log output. Analyze it and identify the root cause:
[paste logs]
```

### Pro Tips

- Include context: "This only happens in production" or "Only affects Safari"
- Ask for debugging tools: "Set up debugging for VS Code"
- Request monitoring: "Add error tracking with Sentry"

---

## 16. Code Search & Analysis

**Goal:** Understand and navigate codebases.

### Find Usage Patterns

```bash
› Find all places where we directly access localStorage. I want to centralize this into a service.
```

### Analyze Dependencies

```bash
› Create a dependency graph showing how modules in @src/features/ depend on each other.
```

### Find Dead Code

```bash
› Identify unused exports and dead code in @src/utils/. Verify they're truly unused before suggesting removal.
```

### Understand Code Flow

```bash
› Trace the data flow from user login to dashboard render. Show me each step and file involved.
```

### Pro Tips

- Use semantic search for concepts: "Find error handling patterns"
- Ask for visualizations: "Create a Mermaid diagram of the flow"
- Request impact analysis: "What would break if I change this function?"

---

## 17. Release Management

**Goal:** Prepare and execute releases.

### Version Bump

```bash
› Bump the version to 2.0.0, update CHANGELOG.md with all changes since 1.9.0, and create a git tag.
```

### Release Notes

```bash
› Generate release notes for v2.0.0 based on commits and PR descriptions. Format for GitHub Releases.
```

### Pre-release Checklist

```bash
› Create a pre-release checklist: verify tests pass, check for breaking changes, update docs, and validate build.
```

### Hotfix Process

```bash
› Guide me through creating a hotfix for the payment bug. Create branch from latest tag, fix, and prepare for release.
```

### Pro Tips

- Use conventional commits for automatic changelog generation
- Ask for migration guides: "Create a v1 to v2 migration guide"
- Request deprecation notices: "Add deprecation warnings for removed features"

---

## 18. Environment Setup

**Goal:** Configure development environments.

### Local Development

```bash
› Set up the local development environment. Create .env.example, docker-compose for dependencies, and document the setup process.
```

### Environment Variables

```bash
› Audit all environment variable usage. Create a typed config module with validation and defaults.
```

### Development Tools

```bash
› Configure VS Code settings and recommended extensions for this project. Include debug configurations.
```

### Cross-Platform Setup

```bash
› Ensure the project works on Windows, macOS, and Linux. Fix any platform-specific issues in scripts.
```

### Pro Tips

- Ask for Docker setup: "Create a dev container configuration"
- Request onboarding docs: "Create a CONTRIBUTING.md with setup instructions"
- Include troubleshooting: "Add common setup issues and solutions"

---

## 19. Code Formatting & Linting

**Goal:** Maintain consistent code style.

### Setup Linting

```bash
› Set up ESLint with TypeScript support, Prettier integration, and import sorting. Include VS Code settings.
```

### Fix Lint Errors

```bash
› Fix all ESLint errors in @src/. For complex issues, explain the fix.
```

### Custom Rules

```bash
› Create a custom ESLint rule that enforces our API response format convention.
```

### Pre-commit Hooks

```bash
› Set up Husky with lint-staged to run formatting and linting on staged files before commit.
```

### Pro Tips

- Ask for gradual adoption: "Add lint rules as warnings first"
- Request auto-fix: "Configure auto-fix on save in VS Code"
- Include CI integration: "Fail CI if there are lint errors"

---

## 20. Learning & Exploration

**Goal:** Learn new technologies and patterns.

### Explain Code

```bash
› Explain how @src/core/actionExecutor.ts works. I'm new to this codebase.
```

### Learn a Pattern

```bash
› Show me how to implement the Repository pattern in TypeScript with a practical example for this project.
```

### Compare Approaches

```bash
› Compare Redux Toolkit vs Zustand for state management. Which is better for this project's needs?
```

### Best Practices

```bash
› What are the best practices for error handling in this Express API? Show examples using our existing code.
```

### Explore New Features

```bash
› Show me how to use the new React 19 features. Which ones would benefit this project?
```

### Pro Tips

- Ask for examples: "Show me a real-world example from this codebase"
- Request comparisons: "How does this compare to how we do it currently?"
- Use web search: Autohand can search for up-to-date documentation

---

## Quick Reference

### Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/model` | Change the AI model |
| `/undo` | Revert last change |
| `/new` | Start fresh conversation |
| `/init` | Create AGENTS.md template |
| `/sessions` | List saved sessions |
| `/resume` | Resume previous session |
| `/memory` | Manage saved preferences |
| `/quit` | Exit Autohand |

### File Mentions

Use `@` to reference files in your prompts:
- `@src/index.ts` - Reference a specific file
- `@src/components/` - Reference a directory
- `@package.json` - Include config files for context

### Command Mode Flags

```bash
autohand --prompt "your instruction"  # Single command
autohand --dry-run                    # Preview without changes
autohand --yes                        # Auto-confirm prompts
autohand --path src/                  # Set working directory
```

### Safety Features

- **ESC** - Cancel current operation
- **Ctrl+C** (once) - Warning
- **Ctrl+C** (twice) - Force exit
- **/undo** - Revert last change
- **Confirmations** - Required for destructive operations

---

## Tips for Effective Prompts

1. **Be Specific**: "Add error handling" to "Add try-catch with typed errors and user-friendly messages"

2. **Provide Context**: Reference files with `@` to give Autohand the full picture

3. **State Constraints**: "Must work with Node 18" or "Keep backward compatibility"

4. **Ask for Explanations**: "Explain your changes" helps you learn and verify

5. **Iterate**: Start broad, then refine: "Now optimize for performance"

6. **Use Examples**: "Follow the pattern in @src/existing-feature.ts"

7. **Request Tests**: "Include tests for the new functionality"

---

*Happy coding with Autohand! 🤖✨*
