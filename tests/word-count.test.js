// word-count regression test — the 1.6.4 fix made countWords aware of CJK
// characters (each Chinese/kana char counts as one word). before, a
// 600-character Chinese answer reported as ~40 "words".

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// load the function out of the service worker file. it doesn't depend on
// chrome.* APIs, just runs at module level. we Proxy the chrome namespace so
// any access (chrome.foo.bar.addListener, chrome.foo.bar()) returns a no-op
// without us having to enumerate every API the SW touches.
function makeStub() {
  const handler = {
    get(target, prop) {
      if (prop in target) { return target[prop]; }
      const sub = new Proxy(function () { return new Proxy({}, handler); }, handler);
      target[prop] = sub;
      return sub;
    },
  };
  return new Proxy({}, handler);
}

function loadCountWords() {
  const code = fs.readFileSync(
    path.join(__dirname, "..", "background", "service-worker.js"),
    "utf-8"
  );
  const ctx = {
    chrome: makeStub(),
    setInterval: () => {},
    setTimeout: () => {},
    clearInterval: () => {},
    clearTimeout: () => {},
    console: console,
    self: {},
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const wrapped = code + "\nglobalThis.__countWords = countWords;";
  vm.runInContext(wrapped, ctx);
  return ctx.__countWords;
}

const countWords = loadCountWords();

test("countWords: pure English text uses whitespace tokens", () => {
  assert.equal(countWords("Hello world from the bot"), 5);
});

test("countWords: empty / null returns 0", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords(null), 0);
  assert.equal(countWords(undefined), 0);
});

test("countWords: pure Chinese counts each character", () => {
  // before fix: 1 (no spaces). after fix: 12 chars → 12.
  assert.equal(countWords("美股暴跌的核心原因有三个"), 12);
});

test("countWords: mixed CJK + English", () => {
  // "Hello 你好 world 世界" — Hello + world (2 western) + 4 CJK = 6
  assert.equal(countWords("Hello 你好 world 世界"), 6);
});

test("countWords: Japanese kana counted", () => {
  // ありがとう (5 hiragana) + ございます (5 hiragana) — punctuation/spaces
  // collapsed
  assert.equal(countWords("ありがとう ございます"), 10);
});

test("countWords: regression — a real 200+ char Chinese paragraph reports >100 words", () => {
  const para = "2026年4月29日美股下跌：逐步分析。首先需要澄清：4月29日美股并非严格意义上的暴跌，而是以科技股为主的结构性回调。道指仅跌0.05%，标普500跌0.49%，纳指跌0.90%。以下是核心原因的逐步拆解：直接触发因素包括OpenAI业绩不及预期、美伊谈判陷入僵局、超级财报周前的观望情绪。";
  const n = countWords(para);
  // before fix this returned ~30; now should be CJK-char-count + a few Western tokens
  assert.ok(n > 100, `expected > 100, got ${n}`);
});
