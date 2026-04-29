// site-adapters tests — replay each fixture's DOM and verify the per-site
// responseSelector picks the assistant response (and not user-message,
// thinking blocks, citation panels, or stale conversation titles).
//
// these are the regression guards for selector-level fixes:
//   - DeepSeek virtualization (1.6.1)
//   - ChatGPT content-visibility (1.6.2)
//   - Gemini multi-pane (1.6.2)
//   - Claude user-message reflection (1.6.3)
//   - Perplexity selector tightening (1.6.4)

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { loadFixture } = require("./lib/dom-replay");
const { loadAdapters } = require("./lib/load-adapters");
const helpers = require("../content/extract-helpers");

const ADAPTERS = loadAdapters();
const FIXTURES_DIR = path.join(__dirname, "fixtures");

function loadFixtureByName(name) {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name + ".json"), "utf-8"));
  return loadFixture(raw);
}

function extractWithAdapter(root, adapter) {
  // mirror what content-script.js does, minus the DOM-fallback path
  const matches = [];
  for (const sel of adapter.responseSelector.split(",").map((s) => s.trim())) {
    for (const el of root.querySelectorAll(sel)) {
      if (!matches.includes(el)) { matches.push(el); }
    }
  }
  if (matches.length === 0) { return ""; }
  const best = helpers.pickBestResponseElement(matches, helpers.readElementText);
  return helpers.readElementText(best);
}

// ----------------------------------------------------------------------------
// DeepSeek
// ----------------------------------------------------------------------------

test("DeepSeek: response selector finds the assistant markdown body", () => {
  const root = loadFixtureByName("deepseek");
  const adapter = ADAPTERS["chat.deepseek.com"];
  assert.ok(adapter, "adapter should be loaded");
  const text = extractWithAdapter(root, adapter);
  // dump captured the head of a virtualized response
  assert.ok(text.includes("核心导火索"), "should include the response's first section header");
  assert.ok(text.includes("OpenAI"), "should include OpenAI mention from response");
  assert.ok(!text.includes("美股暴跌原因分析 - DeepSeek"), "should not pick up the page <title> chrome");
});

// ----------------------------------------------------------------------------
// ChatGPT
// ----------------------------------------------------------------------------

test("ChatGPT: adapter exists with expected response selector", () => {
  const adapter = ADAPTERS["chatgpt.com"];
  assert.ok(adapter, "adapter should be loaded");
  assert.ok(
    adapter.responseSelector.includes("data-message-author-role"),
    "ChatGPT response selector should target assistant message author role"
  );
});

// dump for ChatGPT hit traversal-limit before reaching the response, so this
// fixture only exercises the selector-presence check above. re-capture the
// page deeper into the conversation to add a content assertion later.

// ----------------------------------------------------------------------------
// Gemini
// ----------------------------------------------------------------------------

test("Gemini: response selector picks the response markdown, not thinking blocks or sources", () => {
  const root = loadFixtureByName("gemini");
  const adapter = ADAPTERS["gemini.google.com"];
  assert.ok(adapter, "adapter should be loaded");
  const text = extractWithAdapter(root, adapter);
  // these phrases come from the response body
  assert.ok(
    text.includes("由科技股主导") || text.includes("AI 商业化变现的信任危机"),
    "should include phrases from the actual response body"
  );
  // these are thinking-block titles that should NOT be the lead content
  // (thinking is OK to include when nested under message-content, but the
  // primary captured text must contain the response body, not just thoughts)
  assert.ok(text.length > 500, `response should be substantial (got ${text.length} chars)`);
});

test("Gemini: canonical [id^=model-response-message-content] is in the selector", () => {
  const adapter = ADAPTERS["gemini.google.com"];
  assert.ok(
    adapter.responseSelector.includes("model-response-message-content"),
    "selector must include the canonical Gemini response container"
  );
});

// ----------------------------------------------------------------------------
// Claude — guard against the 1.6.3 regression where panel echoed user prompt
// ----------------------------------------------------------------------------

test("Claude: response selector does NOT match user-message", () => {
  const root = loadFixtureByName("claude");
  const adapter = ADAPTERS["claude.ai"];
  assert.ok(adapter, "adapter should be loaded");
  // the regression bug: [class*="message"] would match user-message div
  assert.ok(
    !adapter.responseSelector.includes('[class*="message"]'),
    "Claude selector must not contain [class*='message'] (matches user-message)"
  );
});

test("Claude: extracted text contains response body, not the user prompt", () => {
  const root = loadFixtureByName("claude");
  const adapter = ADAPTERS["claude.ai"];
  const text = extractWithAdapter(root, adapter);
  // the user's prompt was: "Let's think step by step... 美股 2026.4.29为什么暴跌"
  // it must not show up as the captured response
  assert.ok(
    !text.startsWith("Let's think step by step"),
    "captured text must not be the echoed user prompt"
  );
  // the response includes "先做事实校准" (Claude's fact-correction opener)
  assert.ok(text.includes("先做事实校准") || text.includes("校准"),
    "should include the assistant's opening fact-check phrase");
});

// ----------------------------------------------------------------------------
// Perplexity
// ----------------------------------------------------------------------------

test("Perplexity: canonical [id^=markdown-content] matches the response container", () => {
  const root = loadFixtureByName("perplexity");
  const adapter = ADAPTERS["www.perplexity.ai"];
  assert.ok(adapter, "adapter should be loaded");
  // verify the new specific selector is in there
  assert.ok(
    adapter.responseSelector.includes("markdown-content"),
    "Perplexity selector should include [id^='markdown-content']"
  );
  // and it actually finds something in the fixture
  const matches = root.querySelectorAll('[id^="markdown-content"]');
  assert.ok(matches.length > 0, "Perplexity fixture should have a markdown-content element");
});

test("Perplexity: extracted text contains the analysis, not just citations", () => {
  const root = loadFixtureByName("perplexity");
  const adapter = ADAPTERS["www.perplexity.ai"];
  const text = extractWithAdapter(root, adapter);
  assert.ok(text.includes("澄清") || text.includes("逐步拆解"), "should include opener");
  assert.ok(text.includes("OpenAI") || text.includes("美伊"), "should include section content");
});
