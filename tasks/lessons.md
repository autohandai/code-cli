# Lessons Learned

## Bun Test Runner — Module Cache Pollution

**Problem:** `vi.mock()` with `var` declarations fails silently when another test file has already loaded the real module in the same Bun process. Tests pass in isolation but fail in the full suite.

**Root cause:** Bun doesn't support `vi.resetModules()`, `vi.doMock()`, or `vi.hoisted()`. Module cache is shared across all test files in the same process.

**Fix:** Use `await import()` (dynamic import) instead of static `import` for the module under test. This ensures mocks are applied before the module loads.

```typescript
// BAD — static import may resolve before vi.mock
import { myFunction } from '../../src/module.js';

// GOOD — dynamic import respects vi.mock hoisting
const { myFunction } = await import('../../src/module.js');
```

**Also:** When mocking a module that re-exports from sub-modules (e.g., `i18n/index.ts` re-exports `detectLocale` from `localeDetector.ts`), mock BOTH the parent and sub-module.

---

## Ink Modals Need Bracketed Paste Disabled

**Problem:** When Ink modals render with bracketed paste mode active, escape sequences (`[200~`) leak into `useInput` as literal characters, corrupting text inputs and breaking keyboard handling.

**Fix:** All `showModal`, `showInput`, `showConfirm`, `showPassword` helpers must call `disableBracketedPaste()` before rendering and `enableBracketedPaste()` in `unmountAndResolve()`.

---

## All Interactive Slash Commands Need Modal Pause/Resume

**Problem:** Any slash command that shows interactive UI (safePrompt, showModal, readline) while the PersistentInput composer is active causes garbled rendering — arrow keys print garbage, output stacks.

**Fix:** Wrap every interactive command with `onBeforeModal()`/`onAfterModal()` in the slash command handler. This pauses the persistent input before the interactive UI and resumes after.

**Commands requiring this:** `/hooks`, `/feedback`, `/permissions`, `/login`, `/logout`, `/agents-new`, `/resume`, `/chrome`, `/theme`, `/language`, `/skills`.

---

## Toggle Options in Modals Must Loop, Not Exit

**Problem:** When a modal has a toggle option (like "Enabled by default: Yes/No"), selecting it exits the modal. User expects it to flip the value in-place and stay in the menu.

**Fix:** Wrap the modal call in a `while (true)` loop. On toggle: save the config, clear the previous terminal output with ANSI sequences (`\x1b[NA\x1b[0J`), and re-show the modal with updated labels. Break on non-toggle selections or ESC.

---

## ChatGPT Codex Backend Has Strict Parameter Whitelist

**Problem:** The ChatGPT Codex backend at `chatgpt.com/backend-api/codex/responses` rejects parameters that the standard OpenAI API accepts (e.g., `max_output_tokens`, `temperature`).

**Fix:** Only send parameters the Codex CLI sends: `model`, `instructions`, `input`, `tools`, `tool_choice`, `parallel_tool_calls`, `reasoning`, `include`, `store`, `stream`. Reference the Codex CLI's `ResponsesApiRequest` struct as the source of truth.

---

## SSE Streaming Required for ChatGPT Backend

**Problem:** ChatGPT Codex backend requires `stream: true` in the request body and returns SSE (Server-Sent Events), not JSON.

**Fix:** Set `stream: true`, parse the response as SSE text, find the `response.completed` event, and extract its `data:` payload as the response object.

---

## Test-First Discipline

**Lesson:** Several bugs in this session were fixed code-first, tests-second. This violated the CLAUDE.md rule. The correct flow is:

1. Reproduce the bug with a failing test
2. Verify the test fails
3. Write the fix
4. Verify the test passes
5. Run `bun run proof`

No exceptions — even for "obvious" one-line fixes.
