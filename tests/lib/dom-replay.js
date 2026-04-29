// dom-replay.js
// rebuild a minimal DOM-like tree from a minified page-dump fixture and
// expose enough surface for the production extraction code to run against
// it (querySelectorAll, innerText, textContent).
//
// supports the CSS-selector subset actually used by AskAll's site adapters:
//   - tag names: div, p, message-content
//   - class:     .foo, .foo.bar
//   - id:        #foo
//   - attrs:     [name], [name="v"], [name*="v"], [name^="v"], [name~="v"]
//   - descendant combinator (space)
//   - selector lists (comma)
// it does NOT support :not(), :nth-child, child combinator (>), sibling
// combinators (+ / ~). adapters don't use these.

"use strict";

const VOID_TAGS = new Set(["br", "hr", "img", "input", "meta", "link"]);

// ---- node construction ----

class FakeElement {
  constructor(min) {
    this.tagName = (min.t || "div").toUpperCase();
    this.tag = (min.t || "div").toLowerCase();
    this.attributes = min.a || {};
    this.id = this.attributes.id || "";
    this.className = this.attributes.class || "";
    this.classList = new Set((this.className || "").split(/\s+/).filter(Boolean));
    this._directText = min.x || "";
    this.children = [];
    this.parent = null;
  }
  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null;
  }
  hasAttribute(name) {
    return name in this.attributes;
  }
  // textContent: concat all descendant text in document order
  get textContent() {
    let out = this._directText || "";
    for (const c of this.children) { out += c.textContent; }
    return out;
  }
  // innerText emulation: same as textContent here. tests that need real
  // layout-aware innerText should use jsdom; this replayer is for selector
  // and text-extraction correctness, not layout. block-tag children get a
  // newline before/after so paragraph structure roughly survives.
  get innerText() {
    return walkInnerText(this);
  }
  querySelectorAll(selector) {
    return queryAll(this, selector);
  }
  querySelector(selector) {
    const r = queryAll(this, selector);
    return r.length > 0 ? r[0] : null;
  }
}

const BLOCK_TAGS = new Set([
  "p", "div", "li", "ul", "ol", "blockquote", "pre", "table", "tr",
  "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "br", "hr"
]);

function walkInnerText(node) {
  let out = "";
  const isBlock = BLOCK_TAGS.has(node.tag);
  if (isBlock && node._directText) { out += "\n"; }
  out += node._directText || "";
  for (const c of node.children) { out += walkInnerText(c); }
  if (isBlock) { out += "\n"; }
  return out;
}

// build the tree from the minified frame (an array of {i,p,c,t,a,x})
function buildFrameTree(frame) {
  const elems = (frame && frame.elements) || [];
  const byIndex = new Map();
  for (const m of elems) { byIndex.set(m.i, new FakeElement(m)); }
  let root = null;
  for (const m of elems) {
    const node = byIndex.get(m.i);
    if (m.p === undefined || m.p === null || m.p < 0) {
      if (!root) { root = node; }
    } else {
      const parent = byIndex.get(m.p);
      if (parent) {
        parent.children.push(node);
        node.parent = parent;
      }
    }
  }
  // if no explicit root, use a synthetic wrapper so querySelectorAll works
  if (!root && elems.length > 0) {
    root = new FakeElement({ t: "html", a: {} });
    for (const m of elems) {
      const node = byIndex.get(m.i);
      if (!node.parent) {
        root.children.push(node);
        node.parent = root;
      }
    }
  }
  return root || new FakeElement({ t: "html", a: {} });
}

function loadFixture(rawDump) {
  const frame = (rawDump.frames || []).find((f) => f.elements && f.elements.length > 0);
  if (!frame) { return new FakeElement({ t: "html", a: {} }); }
  return buildFrameTree(frame);
}

// ---- selector engine ----

function parseSimpleSelector(s) {
  // returns { tag, id, classes:[], attrs:[{name, op, value}], invalid? }
  const out = { tag: null, id: null, classes: [], attrs: [] };
  let rest = s.trim();
  if (rest === "") { out.invalid = true; return out; }
  // tag (optional, leading)
  const tagMatch = rest.match(/^([a-zA-Z][\w-]*)/);
  if (tagMatch) {
    out.tag = tagMatch[1].toLowerCase();
    rest = rest.slice(tagMatch[0].length);
  }
  while (rest.length > 0) {
    if (rest[0] === ".") {
      const m = rest.match(/^\.([\w-]+)/);
      if (!m) { out.invalid = true; break; }
      out.classes.push(m[1]);
      rest = rest.slice(m[0].length);
    } else if (rest[0] === "#") {
      const m = rest.match(/^#([\w-]+)/);
      if (!m) { out.invalid = true; break; }
      out.id = m[1];
      rest = rest.slice(m[0].length);
    } else if (rest[0] === "[") {
      // accept both single and double quotes for attr values, plus unquoted
      // [class*='foo']  [class*="foo"]  [class="foo"]  [data-x]  [class*=foo]
      const m = rest.match(/^\[([\w-]+)(?:([*^$~|]?=)(?:"([^"]*)"|'([^']*)'|([\w-]+)))?\]/);
      if (!m) { out.invalid = true; break; }
      const value = m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : (m[5] !== undefined ? m[5] : null));
      out.attrs.push({ name: m[1], op: m[2] || null, value: value });
      rest = rest.slice(m[0].length);
    } else {
      // unparseable suffix — bail rather than silently treat as match-all
      out.invalid = true;
      break;
    }
  }
  return out;
}

function matchesSimple(el, simple) {
  if (simple.invalid) { return false; }
  if (simple.tag && el.tag !== simple.tag) { return false; }
  if (simple.id && el.id !== simple.id) { return false; }
  for (const c of simple.classes) {
    if (!el.classList.has(c)) { return false; }
  }
  for (const a of simple.attrs) {
    const v = el.getAttribute(a.name);
    if (v === null) { return false; }
    if (a.op === null) { continue; }
    const target = a.value || "";
    if (a.op === "=") { if (v !== target) { return false; } }
    else if (a.op === "*=") { if (v.indexOf(target) === -1) { return false; } }
    else if (a.op === "^=") { if (!v.startsWith(target)) { return false; } }
    else if (a.op === "$=") { if (!v.endsWith(target)) { return false; } }
    else if (a.op === "~=") { if (v.split(/\s+/).indexOf(target) === -1) { return false; } }
    else { return false; }
  }
  return true;
}

// split a selector into simple compound parts by descendant combinator
function splitDescendantCombinators(sel) {
  // tokenize respecting [...]; spaces inside brackets are not combinators
  const parts = [];
  let depth = 0;
  let buf = "";
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (ch === "[") { depth++; buf += ch; }
    else if (ch === "]") { depth--; buf += ch; }
    else if (ch === " " && depth === 0) {
      if (buf.trim()) { parts.push(buf.trim()); buf = ""; }
    } else { buf += ch; }
  }
  if (buf.trim()) { parts.push(buf.trim()); }
  return parts;
}

function splitSelectorList(sel) {
  // split on top-level commas (no commas inside [] expected for our subset)
  const parts = [];
  let depth = 0;
  let buf = "";
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (ch === "[") { depth++; buf += ch; }
    else if (ch === "]") { depth--; buf += ch; }
    else if (ch === "," && depth === 0) {
      if (buf.trim()) { parts.push(buf.trim()); buf = ""; }
    } else { buf += ch; }
  }
  if (buf.trim()) { parts.push(buf.trim()); }
  return parts;
}

// match a compound-selector chain (descendant combinators) against an element
function matchesChain(el, chain) {
  // chain[chain.length-1] must match el; ancestors must match remaining parts
  if (!matchesSimple(el, chain[chain.length - 1])) { return false; }
  let i = chain.length - 2;
  let p = el.parent;
  while (i >= 0 && p) {
    if (matchesSimple(p, chain[i])) { i--; }
    p = p.parent;
  }
  return i < 0;
}

function queryAll(root, selector) {
  const lists = splitSelectorList(selector);
  const chains = lists.map((s) => splitDescendantCombinators(s).map(parseSimpleSelector));
  const results = [];
  // walk all descendants in document order
  function walk(node) {
    for (const chain of chains) {
      if (matchesChain(node, chain)) {
        if (!results.includes(node)) { results.push(node); }
        break;
      }
    }
    for (const c of node.children) { walk(c); }
  }
  for (const c of root.children) { walk(c); }
  return results;
}

module.exports = {
  loadFixture: loadFixture,
  buildFrameTree: buildFrameTree,
  FakeElement: FakeElement,
  // exposed for test debugging
  _queryAll: queryAll,
  _parseSimpleSelector: parseSimpleSelector,
};
