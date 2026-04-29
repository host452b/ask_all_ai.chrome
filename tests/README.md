# Tests

Regression-guard tests for the AskAll content script. Run:

```bash
npm test
```

Zero npm dependencies — uses Node's built-in `node:test` runner. Requires Node 18+.

## Layout

```
tests/
├── extract-helpers.test.js   # pure-logic tests for content/extract-helpers.js
├── site-adapters.test.js     # per-site selector tests (replay real DOM dumps)
├── word-count.test.js        # background/service-worker.js countWords()
├── fixtures/                 # minified page-export DOM dumps
│   ├── deepseek.json
│   ├── chatgpt.json
│   ├── gemini.json
│   ├── claude.json
│   └── perplexity.json
└── lib/
    ├── dom-replay.js         # rebuild a tree from fixtures + querySelectorAll
    ├── load-adapters.js      # load content/site-adapters.js into a vm sandbox
    └── minify-fixture.js     # one-shot script: raw page-dump → minified fixture
```

## Adding a new fixture

1. Use the page-export tool on a live AI chat page after the response is fully
   rendered. You'll get a multi-MB JSON dump.
2. Minify it (drops styleSummary / rect / xpath etc., ~85% size reduction):

   ```bash
   node tests/lib/minify-fixture.js /path/to/raw.json tests/fixtures/<site>.json
   ```

3. Add a test in `site-adapters.test.js` — assert that the adapter's
   `responseSelector` extracts text containing key phrases from the response,
   and crucially **does not** match the user prompt or page chrome.

## Selector engine limitations

`tests/lib/dom-replay.js` implements a hand-rolled CSS-selector matcher for
the subset of selectors AskAll's adapters actually use:

- tag names, `.class`, `#id`
- attribute selectors: `[name]`, `[name="v"]`, `[name*="v"]`, `[name^="v"]`,
  `[name$="v"]`, `[name~="v"]` (single, double, or unquoted values)
- descendant combinator (space)
- comma selector lists

It does **not** support `:not()`, `:nth-child(n)`, child combinator (`>`),
adjacent or general sibling combinators, or pseudo-elements. Adapters
shouldn't need these — if you're tempted to use one, prefer a more specific
class or data-attribute selector instead.

The replayer also doesn't simulate layout-aware `innerText` (no
`content-visibility:auto`, no `display:none` filtering). Tests here verify
**selector correctness**; for layout-quirk regressions add a manual repro
on the live site or migrate the fixture pipeline to jsdom.
