// pure-logic tests for content/extract-helpers.js. these protect against
// regression in the merge / read / pick functions that the production
// content script depends on.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const helpers = require("../content/extract-helpers");

const { mergeResponseText, readElementText, pickBestResponseElement, cleanResponseText } = helpers;

// ============================================================================
// mergeResponseText — overlap-merge accumulator for virtualized chat lists
// ============================================================================

test("mergeResponseText: empty accumulator returns current", () => {
  assert.equal(mergeResponseText("", "first chunk of text"), "first chunk of text");
});

test("mergeResponseText: empty current returns accumulator", () => {
  assert.equal(mergeResponseText("existing accumulated text", ""), "existing accumulated text");
});

test("mergeResponseText: identical inputs return one copy", () => {
  assert.equal(mergeResponseText("same text", "same text"), "same text");
});

test("mergeResponseText: current contained in accumulator returns accumulator", () => {
  assert.equal(
    mergeResponseText("the longer accumulated text holds it", "accumulated text"),
    "the longer accumulated text holds it"
  );
});

test("mergeResponseText: accumulator contained in current returns current", () => {
  assert.equal(
    mergeResponseText("partial start", "partial start with more added later text"),
    "partial start with more added later text"
  );
});

test("mergeResponseText: streaming tail — current's prefix overlaps accumulated's suffix", () => {
  const acc = "Section one talks about AI exposure to OpenAI revenue concerns";
  const cur = "AI exposure to OpenAI revenue concerns and Section two covers oil shock";
  const merged = mergeResponseText(acc, cur);
  assert.ok(merged.startsWith("Section one talks about AI exposure"), "should preserve head");
  assert.ok(merged.endsWith("Section two covers oil shock"), "should append new tail");
  assert.ok(merged.length < acc.length + cur.length, "overlap region should not duplicate");
});

test("mergeResponseText: scrolled-up head — current's suffix overlaps accumulated's prefix", () => {
  const acc = "Section two covers oil shock and Section three is the conclusion";
  const cur = "Section one talks about AI risk. Section two covers oil shock";
  const merged = mergeResponseText(acc, cur);
  assert.ok(merged.includes("Section one talks about AI risk"), "should prepend new head");
  assert.ok(merged.includes("Section three is the conclusion"), "should preserve tail");
});

test("mergeResponseText: disjoint slices keep the longer one", () => {
  // 16-char minOverlap means short uncorrelated strings shouldn't merge
  assert.equal(
    mergeResponseText("AAAAAAAA", "BBBBBBBBBBBBBBBBB"),
    "BBBBBBBBBBBBBBBBB"
  );
});

test("mergeResponseText: virtualized streaming simulation across 3 polls", () => {
  // simulate a long DeepSeek-style response where each poll only sees a
  // viewport-sized slice, with overlapping middle
  const full = [
    "一、核心导火索 OpenAI 业绩不及预期，引发 AI 板块抛售。",
    "二、油价上行带来通胀压力，市场预期再定价。",
    "三、美联储财报周前观望情绪浓厚，避险资金外流。",
    "结尾免责声明：本分析基于公开市场信息，不构成投资建议。"
  ].join("\n");
  const slice1 = full.slice(0, 60);
  const slice2 = full.slice(40, 110);
  const slice3 = full.slice(95);

  let acc = "";
  acc = mergeResponseText(acc, slice1);
  acc = mergeResponseText(acc, slice2);
  acc = mergeResponseText(acc, slice3);
  assert.equal(acc, full, "three overlapping slices should reconstruct the full text");
});

// ============================================================================
// readElementText — innerText vs textContent fallback
// ============================================================================

test("readElementText: returns empty when null/undefined", () => {
  assert.equal(readElementText(null), "");
  assert.equal(readElementText(undefined), "");
});

test("readElementText: prefers textContent when longer than innerText", () => {
  // simulates ChatGPT's content-visibility:auto behavior where innerText
  // truncates content past the viewport but textContent is full
  const fakeEl = {
    innerText: "Visible top of message only. The rest is below the fold.",
    textContent: "Visible top of message only. The rest is below the fold. Hidden middle. Hidden tail. Final paragraph that innerText skipped.",
  };
  const out = readElementText(fakeEl);
  assert.ok(out.includes("Final paragraph that innerText skipped"), "should fall back to textContent");
});

test("readElementText: prefers innerText when textContent isn't longer", () => {
  const fakeEl = {
    innerText: "Same content in both, but innerText preserves\nformatting.",
    textContent: "Same content in both, but innerText preservesformatting.",
  };
  const out = readElementText(fakeEl);
  assert.ok(out.includes("\n"), "should preserve innerText newlines when length isn't lost");
});

// ============================================================================
// pickBestResponseElement — last-with-multi-candidate fallback
// ============================================================================

test("pickBestResponseElement: empty input returns null", () => {
  assert.equal(pickBestResponseElement([], () => ""), null);
  assert.equal(pickBestResponseElement(null, () => ""), null);
});

test("pickBestResponseElement: single element returned as-is", () => {
  const el = { _label: "only" };
  assert.equal(pickBestResponseElement([el], () => "long enough text past 200 chars ".repeat(20)), el);
});

test("pickBestResponseElement: returns last when last has substantial content", () => {
  const a = { _label: "a" };
  const b = { _label: "b" };
  const c = { _label: "c" };
  const reads = { a: "x".repeat(100), b: "y".repeat(100), c: "z".repeat(500) };
  const got = pickBestResponseElement([a, b, c], (el) => reads[el._label]);
  assert.equal(got, c, "should pick last when its text > 200 chars");
});

test("pickBestResponseElement: scans last 5 and picks longest when last is short", () => {
  // simulates Gemini's case where lastEl is a short Sources panel and
  // an earlier sibling is the actual response
  const els = [
    { _label: "early", _text: "x".repeat(50) },
    { _label: "thinking-1", _text: "y".repeat(100) },
    { _label: "thinking-2", _text: "y".repeat(150) },
    { _label: "response", _text: "z".repeat(800) },
    { _label: "sources-panel", _text: "Sources" }, // length 7
  ];
  const got = pickBestResponseElement(els, (el) => el._text);
  assert.equal(got._label, "response", "should pick longest among last 5 candidates");
});

// ============================================================================
// cleanResponseText — line filtering
// ============================================================================

test("cleanResponseText: strips Copy/Retry UI noise lines", () => {
  const input = "First paragraph.\nCopy\nSecond paragraph.\nRetry\nThird.";
  const out = cleanResponseText(input);
  assert.ok(!out.includes("Copy") && !out.includes("Retry"), "noise filtered");
  assert.ok(out.includes("First paragraph") && out.includes("Third"), "real content kept");
});

test("cleanResponseText: collapses 3+ newlines to 2", () => {
  const input = "para A\n\n\n\npara B";
  assert.equal(cleanResponseText(input), "para A\n\npara B");
});
