// extract-helpers.js
// pure functions for response-text extraction. kept in their own file so the
// test suite (Node) can load them without a browser; production loads this
// before content-script.js via manifest.json content_scripts order.
//
// exported on window.__ASKALL_HELPERS for the content script, and on
// module.exports for Node tests. designed to be loaded into both runtimes.

(function (root) {
  "use strict";

  const UI_NOISE = /^(Copy|Copied|复制|已复制|Retry|重试|Edit|编辑|Share|分享|Like|Dislike|Good|Bad|👍|👎)[\s]*$/;

  function cleanResponseText(text) {
    if (!text) { return ""; }
    return text
      .split("\n")
      .filter((line) => !UI_NOISE.test(line.trim()))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // innerText respects layout (ignores content-visibility:auto, off-screen
  // lazy mounts, display:none) — ChatGPT's long messages get truncated at
  // the fold this way. textContent returns everything regardless of layout.
  // take whichever is longer so we don't silently drop content.
  function readElementText(el) {
    if (!el) { return ""; }
    const inner = cleanResponseText(el.innerText || "");
    const all = cleanResponseText(el.textContent || "");
    return all.length > inner.length ? all : inner;
  }

  // merge two text snapshots of the same response. handles virtualized lists
  // (DeepSeek's ds-virtual-list, etc.) where any single DOM read only sees
  // the currently-rendered slice, not the full message.
  //
  // strategy: find the longest overlap between the end of `accumulated` and
  // the start of `current` (current is the streaming tail) — or the
  // symmetric case where current is an earlier slice that scrolled into
  // view. on no overlap we keep the longer string rather than discarding.
  function mergeResponseText(accumulated, current) {
    if (!current) { return accumulated || ""; }
    if (!accumulated) { return current; }
    if (current === accumulated) { return accumulated; }
    if (accumulated.indexOf(current) !== -1) { return accumulated; }
    if (current.indexOf(accumulated) !== -1) { return current; }

    // 16 chars is enough to skip incidental matches on short common phrases
    // ("I think this is ...", "So in summary, ...") while still catching real
    // overlaps in shorter responses
    const minOverlap = 16;
    const maxOverlap = Math.min(accumulated.length, current.length);

    // case 1: current is the tail — its prefix overlaps accumulated's suffix
    for (let n = maxOverlap; n >= minOverlap; n--) {
      if (accumulated.slice(-n) === current.slice(0, n)) {
        return accumulated + current.slice(n);
      }
    }
    // case 2: current is the head — its suffix overlaps accumulated's prefix
    for (let n = maxOverlap; n >= minOverlap; n--) {
      if (current.slice(-n) === accumulated.slice(0, n)) {
        return current + accumulated.slice(n);
      }
    }
    // disjoint slices — keep whichever is longer rather than dropping either
    return accumulated.length >= current.length ? accumulated : current;
  }

  // pick the response element from the matched-elements array.
  // typical case: last match is the active response. but sites with
  // multi-pane responses (Gemini's thinking blocks, citation panels,
  // sources lists) can make the very last match be UI chrome, not the
  // response. when last produces short text, scan the last few candidates
  // and keep the longest.
  function pickBestResponseElement(elements, readText) {
    if (!elements || elements.length === 0) { return null; }
    const last = elements[elements.length - 1];
    let bestEl = last;
    let bestText = readText(last);
    if (bestText.length < 200 && elements.length > 1) {
      const N = Math.min(5, elements.length);
      for (let i = elements.length - N; i < elements.length - 1; i++) {
        const t = readText(elements[i]);
        if (t.length > bestText.length) {
          bestEl = elements[i];
          bestText = t;
        }
      }
    }
    return bestEl;
  }

  const api = {
    cleanResponseText: cleanResponseText,
    readElementText: readElementText,
    mergeResponseText: mergeResponseText,
    pickBestResponseElement: pickBestResponseElement,
  };

  if (root && typeof root === "object") { root.__ASKALL_HELPERS = api; }
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
