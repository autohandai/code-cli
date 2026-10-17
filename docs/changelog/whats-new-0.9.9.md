# Autohand 0.9.9

### Answers and continuity

- Replies stay visible while completion review, pending todos, steering, or peer updates continue. Interrupted reviews retain the draft and its status in the session; a draft never completes a goal. Fixes [#674](https://github.com/autohandai/code-cli/issues/674).
- Final answers lead with the result and include a short recap of the request, useful facts learned, and confirmed memories saved. Pending automatic reflection is identified honestly. Successful background memory writes produce a receipt tied to the originating request and session. Research citations, experiment state, goal acceptance, and structured output remain authoritative.

### Search and provider setup

- Signed-in Lite, Pro, Pro Plus, Max, Team, and Enterprise accounts can use included Autohand Web Search through the authenticated API, backed by Cloudflare Web Search. Queries support up to 1,024 characters and 10 results, with an account limit of 30 searches per minute. Access is verified on the server for the selected account.
- Free users can set up browser-profile search or their own Exa, Brave, or Parallel API key during standard and quick onboarding. Google and DuckDuckGo remain explicit options with CAPTCHA caveats. Existing provider choices are preserved.
- Search settings and `/search` show the same providers. `--search-engine` takes precedence in interactive, patch, automatic, RPC, and ACP modes. Browser-profile failures identify the selected provider and offer setup guidance without silently switching to Google. Fixes [#672](https://github.com/autohandai/code-cli/issues/672).
- Custom OpenAI-compatible providers can save a router policy absent from `/models` after explicit confirmation. Authentication and connection failures still block the save. Fixes [#659](https://github.com/autohandai/code-cli/issues/659); thanks to Cestercian for [#676](https://github.com/autohandai/code-cli/pull/676).
- Fantail documentation now distinguishes its 256k input context from its 16k maximum output. Fixes [#658](https://github.com/autohandai/code-cli/issues/658).
