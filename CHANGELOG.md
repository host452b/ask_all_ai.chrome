# Changelog

All notable bug fixes and behavior changes go here. Format: each entry
explains the **symptom** the user saw, the **root cause** of the bug, and
the **fix** applied — so when something regresses we can tell whether
we're seeing a new bug or an old one coming back.

## [1.6.4] — 2026-04-29

### Fixed

- **Perplexity: response selector tightened, no behavior regression but more
  robust against future UI changes**
  - Previous selector: `[class*="prose"], [class*="markdown"],
    [class*="response-text"], [class*="answer"]`. Worked because Perplexity's
    `.prose` class is unambiguous today, but had no canonical hook.
  - Fix: prepend `[id^="markdown-content"]` (the stable wrapper Perplexity
    uses for each answer turn — `#markdown-content-0`,
    `#markdown-content-1` …) and drop the over-broad `[class*="markdown"]`
    fallback that wasn't matching anything anyway.

- **Word count under-reported Chinese / Japanese answers (e.g. "43 words"
  for a 600-character Chinese response)**
  - **Symptom**: the per-card "N words" stat in the panel showed values
    roughly 10–15× too low for any CJK response.
  - **Root cause**: `countWords` in `background/service-worker.js` only
    counted whitespace-separated tokens. Chinese / Japanese text has no
    inter-word spaces, so a 600-char Chinese paragraph counted as ~40 tokens.
  - **Fix**: count each CJK character (U+3400–U+4DBF, U+4E00–U+9FFF,
    U+3040–U+309F, U+30A0–U+30FF) individually, plus space-separated
    tokens for Western runs.

### Added

- **Regression test suite** (`tests/`) using Node's built-in `node:test`,
  zero npm deps. Run with `npm test`.
  - Pure-logic tests for `mergeResponseText`, `readElementText`,
    `pickBestResponseElement`, `cleanResponseText`.
  - Per-site adapter tests that replay real page-export DOM dumps
    (`tests/fixtures/{deepseek,chatgpt,gemini,claude,perplexity}.json`)
    against each adapter's `responseSelector` and assert the extraction
    contains the expected response phrases (and **doesn't** contain the
    user prompt or page chrome).
  - Word-count regression test covering English, pure-CJK, mixed,
    and Japanese kana.
  - Each previously-fixed bug has a guard test that would have caught it.

### Changed

- Extracted text-extraction helpers (`cleanResponseText`,
  `readElementText`, `mergeResponseText`, `pickBestResponseElement`) into
  `content/extract-helpers.js` so the test suite can load them in Node.
  Production behavior is unchanged — `manifest.json` loads
  `extract-helpers.js` before `content-script.js`, and the helpers are
  exposed on `window.__ASKALL_HELPERS`.

## [1.6.3] — 2026-04-29

### Fixed

- **Claude.ai panel echoed the user's prompt instead of showing Claude's
  answer**
  - **Symptom**: after asking a question on Claude.ai, the AskAll panel
    displayed the user's question text (verbatim, including the "Let's
    think step by step" template wrapper) where the response should be.
  - **Root cause**: the `responseSelector` for `claude.ai` included
    `[class*="message"]`. Claude's user-message container has class
    `font-large !font-user-message …`, which contains the substring
    "message" — so this selector matched it. `queryAll` returns matches in
    selector order, putting the user-message div near the end, so `lastEl`
    was the user prompt.
  - **Fix**: tighten the selector to
    `.font-claude-response, [class*="claude-response"]`. The
    `.font-claude-response` class is the canonical wrapper around each
    assistant turn (verified via the page DOM dump's parent-chain — it's an
    ancestor of both the extended-thinking blocks and the response markdown
    paragraphs).

## [1.6.2] — 2026-04-29

### Fixed

- **ChatGPT long responses were truncated mid-message** (panel showed only
  the first paragraph + any embedded widget, missing 80%+ of the answer)
  - **Symptom**: long ChatGPT answers — especially ones that contained an
    embedded stock/finance widget — appeared cut off at the fold of the
    viewport. The captured response stopped after the first or second
    paragraph.
  - **Root cause**: ChatGPT applies `content-visibility: auto` (and
    related lazy-mount tricks) to long markdown blocks for performance.
    `Element.innerText` is layout-aware and silently skips content past
    the fold or with `content-visibility: auto`. The previous code used
    `el.innerText || el.textContent` — falling back to `textContent` only
    when `innerText` returned an empty string, never when it just returned
    a shorter slice.
  - **Fix**: introduce `readElementText(el)` that returns whichever of
    `innerText` / `textContent` is **longer**, so layout-skipped content
    isn't dropped.

- **Gemini panel showed only "Show thinking / Gemini said / Sources" UI
  labels instead of the response**
  - **Symptom**: Gemini's panel displayed roughly 5 words of UI chrome and
    nothing of the actual response.
  - **Root cause**: the `responseSelector` included `[class*="markdown"]`,
    which matches Gemini's *thinking-summary* blocks too. With multiple
    matched elements, `lastEl` could land on a citation panel, sources list,
    or other footer chrome — none of which contain the response body.
  - **Fix**: (a) tighten Gemini's `responseSelector` to put the canonical
    `[id^="model-response-message-content"]` first; (b) add a multi-
    candidate fallback in `extractLatestResponse` (now
    `pickBestResponseElement`) — when the last matched element has < 200
    chars of text, scan the last 5 candidates and pick whichever has the
    most text.

## [1.6.1] — 2026-04-29

### Fixed

- **DeepSeek panel showed only the trailing disclaimer**, missing the
  entire body of the response
  - **Symptom**: DeepSeek's panel displayed only the closing disclaimer
    line ("⚠️ 以上内容仅为基于公开市场数据…"). The hundreds of characters of
    actual analysis above it were missing.
  - **Root cause**: DeepSeek's chat UI uses a virtualized message list
    (`.ds-virtual-list`). Only items currently inside the viewport are
    mounted to the DOM; earlier paragraphs are unmounted as auto-scroll
    advances during streaming. Any single DOM read returns only the
    viewport-sized slice. The poller was reading a single snapshot per
    tick and reporting that as the final response.
  - **Fix**: introduce `mergeResponseText(accumulated, current)` — an
    overlap-merge accumulator. Each poll's snapshot is overlap-merged with
    the running accumulator (longest matching suffix-prefix overlap). The
    accumulator survives across polls, so multiple slices captured at
    different scroll positions stitch back into the full response.
    Stability detection is now measured against the accumulator, not
    against the raw single-snapshot text (which would oscillate as the
    viewport scrolls).

## [1.6.0] — earlier

Initial public release covered by these notes.
