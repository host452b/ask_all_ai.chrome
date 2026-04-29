// load-adapters.js
// run content/site-adapters.js inside a vm sandbox with a stub `window` so
// tests can read the adapter map without a browser. the file assigns to
// window.__ASKALL_ADAPTERS — we capture that.

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadAdapters() {
  const adaptersPath = path.join(__dirname, "..", "..", "content", "site-adapters.js");
  const code = fs.readFileSync(adaptersPath, "utf-8");
  const ctx = { window: {}, document: { execCommand: () => {} } };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx.window.__ASKALL_ADAPTERS || {};
}

module.exports = { loadAdapters: loadAdapters };
