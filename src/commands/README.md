# Commands Directory

This directory contains all slash commands organized as individual modules for better maintainability and testability.

## Structure

Each command is a separate TypeScript file that exports:
- A command function (e.g., `listFiles`, `diff`, etc.)
- A `metadata` object with command information

## Available Commands

| Command | File | Description |
|---------|------|-------------|
| `/ls` | `ls.ts` | List files in workspace |
| `/diff` | `diff.ts` | Show git diff (including untracked) |
| `/undo` | `undo.ts` | Undo last file mutation |
| `/model` | `model.ts` | Choose AI model |
| `/approvals` | `approvals.ts` | Configure auto-approvals |
| `/review` | `review.ts` | Review current changes |
| `/new` | `new.ts` | Start new conversation |
| `/init` | `init.ts` | Create AGENTS.md file |
| `/compact` | `compact.ts` | Compact conversation |
| `/quit` | `quit.ts` | Exit Autohand |
| `/help` | `help.ts` | Show available commands |

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
