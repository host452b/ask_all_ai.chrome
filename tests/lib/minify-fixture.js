// minify a raw page-dump JSON down to just the fields tests need.
//
// raw dumps from the page-export tool are 1–3 MB each because they include
// per-element styleSummary / rect / xpath / sourceRoot / selector. tests only
// need the structural skeleton (parent/child indexes), tag, attributes,
// and directText. dropping the rest reduces fixtures ~85%.
//
// usage:
//   node tests/lib/minify-fixture.js <input.json> <output.json>

"use strict";

const fs = require("fs");
const path = require("path");

const KEEP_ATTRS = new Set(["class", "id", "role", "aria-hidden", "aria-label"]);

function pickAttrs(attrs) {
  if (!attrs) { return {}; }
  const out = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (KEEP_ATTRS.has(k) || k.startsWith("data-")) {
      out[k] = v;
    }
  }
  return out;
}

function minifyElement(el) {
  const out = {
    i: el.index,
    p: el.parentIndex,
    c: el.childIndexes || [],
    t: el.tag || "",
  };
  const attrs = pickAttrs(el.attributes);
  if (Object.keys(attrs).length > 0) { out.a = attrs; }
  // prefer directText (text directly under this element). text may include
  // descendants which we'll reconstruct by walking the tree at test time.
  const dt = (el.directText || "").trim();
  if (dt) { out.x = dt; }
  return out;
}

function minify(rawDump) {
  const frames = (rawDump.frames || []).filter((f) => (f.elements || []).length > 0);
  return {
    title: rawDump.title || "",
    url: rawDump.url || "",
    frames: frames.map((f) => ({
      url: f.frameUrl || "",
      elements: (f.elements || []).map(minifyElement),
    })),
  };
}

function main() {
  const [, , input, output] = process.argv;
  if (!input || !output) {
    console.error("usage: node minify-fixture.js <input.json> <output.json>");
    process.exit(2);
  }
  const raw = JSON.parse(fs.readFileSync(input, "utf-8"));
  const min = minify(raw);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(min));
  const before = fs.statSync(input).size;
  const after = fs.statSync(output).size;
  const pct = ((after / before) * 100).toFixed(1);
  console.log(`${path.basename(input)}: ${before} → ${after} bytes (${pct}%)`);
}

if (require.main === module) { main(); }

module.exports = { minify, minifyElement };
