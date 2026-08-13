# Commands Directory

This directory contains all slash commands organized as individual modules for better maintainability and testability.

## Structure

Each command is a separate TypeScript file that exports:
- A command function (e.g., `listFiles`, `diff`, etc.)
- A `metadata` object with command information

## Available Commands

| Command | File | Description |
|---------|------|-------------|
| `/undo` | `undo.ts` | Undo last file mutation |
| `/model` | `model.ts` | Choose AI model |
| `/new` | `new.ts` | Start new conversation |
| `/init` | `init.ts` | Create AGENTS.md file |
| `/quit` | `quit.ts` | Exit Autohand |
| `/exit` | `quit.ts` | Exit Autohand |
| `/help` | `help.ts` | Show available commands |
| `/sessions` | `sessions.ts` | List saved sessions |
| `/resume` | `resume.ts` | Resume a previous session |
| `/memory` | `memory.ts` | List memory or inspect, zoom, forget derived summaries, rebuild projections, and delete entries |
| `/feedback` | `feedback.ts` | Submit feedback |
| `/agents` | `agents.ts` | Show active Autohand CLI instances |
| `/agents definitions` | `agents.ts` | List configured sub-agents |
| `/tools` | `tools.ts` | Manage persisted meta-tools |
| `/experiments` | `features.ts` | List and toggle experiments |
| `/goal` | `goal.ts` | Manage session-attached persistent goals, budgets, templates, and queued work; fresh sessions require explicit `/goal resume`. Requires `slash_goal`. |
| `/squad` | `squad.ts` | Open/manage the standalone Autohand Squad runtime. |
| `/usage` | `usage.ts` | Show Autohand plan limits and project token activity |
| `/statusline` | `statusline.ts` | Configure composer status-line fields |
| `/whatsnew` | `whatsnew.ts` | View and dismiss active CLI announcements |
| `/changelog` | `changelog.ts` | View recent GitHub release notes |

## Adding a New Command

1. Create a new file `yourcommand.ts`:
```typescript
/**
 * YourCommand - description
 */
export async function yourCommand(ctx: Context): Promise<string | null> {
  // Implementation
  return null;
}

export const metadata = {
  command: '/yourcommand',
  description: 'Your command description',
  implemented: true
};
```

2. Add the import to `slashCommands.ts`:
```typescript
import * as yourCommand from '../commands/yourcommand.js';
```

3. Add to the `SLASH_COMMANDS` array:
```typescript
export const SLASH_COMMANDS: SlashCommand[] = [
  // ...
  yourCommand.metadata
];
```

4. Add the case to `slashCommandHandler.ts`:
```typescript
case '/yourcommand': {
  const { yourCommand } = await import('../commands/yourcommand.js');
  return yourCommand(this.ctx);
}
```

## Benefits of This Structure

- **Modularity**: Each command is self-contained
- **Testability**: Easy to unit test individual commands
- **Maintainability**: Clear separation of concerns
- **Discoverability**: Easy to find and understand commands
- **Lazy Loading**: Commands are dynamically imported only when used
