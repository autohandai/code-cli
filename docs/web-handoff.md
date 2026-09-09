# Continue between CLI and Web

In an active CLI session, run `/handoff web`. Autohand saves a private conversation snapshot and opens `https://dev.autohand.ai/new?transfer=…&account=…`. Sign in with the same Autohand account, review the conversation and model, then choose **Continue here**. No prompt runs automatically.

Use `/handoff web --workspace` to include your GitHub repository, branch and a patch containing local commits, staged and unstaged changes, and non-ignored new files. Review what is in your working directory before using this option. The destination reviews and restores changes in a separate cloud workspace. Repository access must be connected in the destination account. Unsupported remotes and oversized snapshots produce an error without uploading a partial session.

Use `--no-open` to print the link without opening a browser. Transfers are private to the signed-in user and account, expire after 24 hours, and contain no runtime credentials or MCP configuration. The source conversation remains available. Conversation limits are 500 saved user/assistant messages and 8 MB, including supported embedded images.

To come back, type `/handoff cli` in a Web chat or choose **Conversation options → Continue in CLI**. Copy the `autohand transfer <id> --account <account>` command and run it in the folder where you want to continue. The CLI previews the transfer and resumes it locally. It does not overwrite the original repository or run the imported prompt. `autohand transfer --help` lists review and import-only options.

This is a conversation/workspace handoff, not a live relay. Local tools, processes and stdio MCP connections stay on the CLI machine. Web can reuse account connectors with hosted HTTPS endpoints; operating local MCP from Web still requires a remote bridge. The existing `/go` and experimental `/handoff session` mobile relay are unchanged.

## Verification — September 10, 2026

The authenticated production API round trip passed: CLI upload → Web import → Web export → CLI import, with the same account and complete conversation. No inference was requested. The unchanged test conversation and both transfers were removed, and transfer revocation was verified.

The focused handoff, slash-command, and real PTY checks pass (53 tests), as do the four built-CLI Tuistory transfer flows, TypeScript checks, lint, and the ESM/CJS/declaration build. The full `bun run proof` attempt reported 9,431 passing tests, one repository-fixture timeout, and four worker-start timeouts; all five affected files subsequently passed with one worker (163 tests). That rerun does not make the aggregate proof run green.

The Web shortcut is deployed. This change does not publish a new CLI package version.
