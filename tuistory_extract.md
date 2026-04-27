# Tuistory Skill - Extracted from Droid Binary

## Metadata

```javascript
{
  metadata: {
    name: "tuistory",
    description: "Automates terminal user interface (TUI) testing. Use when you need to launch, interact with, test, or debug terminal applications, capture TUI snapshots, or automate terminal inputs."
  },
  systemPrompt: KC1,  // Variable reference in minified code
  location: "builtin",
  filePath: "builtin:tuistory",
  lastModified: 0,
  validationResult: { valid: true, errors: [], warnings: [] }
}
```

## Description

**Tuistory** is a built-in skill for droid that automates terminal user interface (TUI) testing. It enables:

- Launching terminal applications
- Interacting with TUI apps
- Testing terminal applications
- Debugging TUI issues
- Capturing TUI snapshots
- Automating terminal inputs

## Usage Pattern (from TUI Application Playbook)

```
For CLI/TUI apps, the generated sub-skill MUST require **interactive TUI testing** -- 
building the binary, launching it via tuistory, sending real keystrokes, and 
verifying actual terminal output. Running unit tests or `droid exec` alone is NOT 
sufficient QA testing.

The sub-skill must instruct the agent to **use the `droid-control` skill for all 
tuistory interactions**. The droid-control skill contains the complete, correct 
tuistory API reference.

Do NOT write raw tuistory commands in the sub-skill -- instead write instructions like:
- "Launch the CLI via tuistory"
- "Type '/help' and verify the output shows..."
- "Send Ctrl+C to exit"
```

## Related Skills

- **droid-control**: Contains the complete tuistory API reference
- **tui-application-playbook**: Provides guidance on TUI application missions
- **agent-browser**: For browser/Electron app automation (similar concept)

## Notes

The full system prompt (KC1 variable content) is embedded in the minified droid binary 
and could not be fully extracted due to JavaScript minification. The prompt likely contains:
- TUI testing procedures
- Snapshot capture instructions
- Keystroke automation commands
- Terminal interaction patterns
- Error handling for TUI scenarios

## Source

Extracted from: `/Users/igorcosta/.local/bin/droid`
Binary type: Mach-O 64-bit executable (custom Bun runtime)
Droid version: 0.108.0
