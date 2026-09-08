# Continue a Web conversation in the CLI

In Autohand Code Web, open the conversation menu and choose **Continue in CLI**.
Copy its command and run it from the folder where you want to continue:

```sh
autohand transfer <transfer-id> --account <account-id>
```

Sign in with the same Autohand account. The CLI downloads the private snapshot,
lets you review repository changes, and resumes the saved conversation and model.
Imported messages do not execute automatically. Enter a new message to continue.
The Web conversation remains available.

For a repository transfer, the CLI creates a separate checkout inside the current
folder. Use `--path <directory>` to choose its parent. For a conversation without a
repository, that directory becomes the workspace directly.

- `--import-only` saves the durable session without starting the interactive CLI.
- `--accept` skips interactive review after you have reviewed the transfer on Web.
- `--offline` skips model catalogue refresh; downloading a transfer still needs a connection.
- `--config <path>` selects your CLI configuration.

Retrying an already imported transfer reopens its existing local session. Expired
or revoked links must be exported again on Web. Transfers support text, embedded PNG/JPEG/WebP/GIF images (up to four 1 MB images
per message), and Git changes within the 8 MB snapshot limit. Image transfers use
format version 2; text transfers remain compatible with version 1. Remote image
URLs and other structured attachments are rejected explicitly. The command requires a CLI build containing this feature.
