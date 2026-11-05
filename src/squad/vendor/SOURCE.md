# Squad MCP source

Canonical repository: https://github.com/autohandai/squad

Revision: `9857b40f75135c537f18f65497b32518658e26a0`

`control-plane.mjs` and `runtime.mjs` are unchanged copies of
`server/control-plane/` at that revision, under the accompanying MIT license.
The `.d.mts` files are CLI type declarations. The bundle uses the runtime
library, never the app's executable stdio entry point.

To update, copy both canonical modules and `LICENSE` together, update this
revision, run Squad's `node scripts/check-control-plane.mjs`, and run the CLI
`bun run proof`. Keep operator and managed-member connections separate.
Do not add an automatic download or execute an app-side server on startup.
