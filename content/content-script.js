// content-script.js
// injected into AI chat pages. handles:
// 1. receiving a question from the background service worker
// 2. filling the input and submitting
// 3. observing DOM for response completion
// 4. reporting the extracted response back

(function () {
  "use strict";

  // prevent duplicate registration when re-injected
  if (window.__ASKALL_CONTENT_LOADED) {
    return;
  }
  window.__ASKALL_CONTENT_LOADED = true;

  const hostname = window.location.hostname;
  const adapters = window.__ASKALL_ADAPTERS || {};
  const adapter = adapters[hostname] || adapters["__fallback"];

  if (!adapter) {
    return;
  }

  let pollingTimer = null;
  let stabilityCounter = 0;
  let lastResponseText = "";
  let pollEverStarted = false;
  let preExistingPageText = "";
  const STABILITY_THRESHOLD = 10;
  const STABILITY_THRESHOLD_FORCE = 12;
  const POLL_INTERVAL_MS = 6000;
  const MAX_POLL_DURATION_MS = 180000;

  // ============================================================
  //  HELPERS
  // ============================================================

  function queryFirst(selectorString) {
    if (!selectorString) {
      return null;
    }
    const selectors = selectorString.split(",").map((s) => s.trim());
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          return el;
        }
      } catch (_) {
        // invalid selector
      }
    }
    return null;
  }

  function queryAll(selectorString) {
    if (!selectorString) {
      return [];
    }
    const selectors = selectorString.split(",").map((s) => s.trim());
    const results = [];
    for (const sel of selectors) {
      try {
        document.querySelectorAll(sel).forEach((el) => results.push(el));
      } catch (_) {
        // skip
      }
    }
    return results;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function setNativeValue(element, value) {
    const proto = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ============================================================
  //  UNIVERSAL SUBMIT HELPERS
  // ============================================================

  const STEP_DELAY_MS = 300;

  function dispatchEnter(el) {
    const shared = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    };
    el.dispatchEvent(new KeyboardEvent("keydown", shared));
    el.dispatchEvent(new KeyboardEvent("keypress", shared));
    el.dispatchEvent(new KeyboardEvent("keyup", shared));
  }

  const SEND_KEYWORDS = /send|submit|ask|发送|提交|搜索|提问/i;
  const SKIP_KEYWORDS = /attach|upload|menu|setting|config|voice|mic|image|photo|file|model|附件|上传|设置|语音/i;

  function isElementVisible(el) {
    if (!el) { return false; }
    try {
      const s = window.getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0" && el.offsetParent !== null;
    } catch (_) { return false; }
  }

  function isElementDisabled(el) {
    if (el.disabled) { return true; }
    if (el.getAttribute("aria-disabled") === "true") { return true; }
    if (el.getAttribute("data-disabled") === "true") { return true; }
    var cls = (el.className || "").toString().toLowerCase();
    if (cls.indexOf("disabled") >= 0) { return true; }
    return false;
  }

  // simulate a realistic mouse click sequence to avoid bot detection.
  // many tracking systems (e.g. baidu bioc/banti) check for
  // pointerdown → mousedown → pointerup → mouseup → click chain.
  function humanClick(el) {
    var rect = el.getBoundingClientRect();
    var cx = rect.left + rect.width / 2 + (Math.random() * 4 - 2);
    var cy = rect.top + rect.height / 2 + (Math.random() * 4 - 2);
    var shared = {
      bubbles: true, cancelable: true, view: window,
      clientX: cx, clientY: cy, button: 0,
    };
    el.dispatchEvent(new PointerEvent("pointerdown", shared));
    el.dispatchEvent(new MouseEvent("mousedown", shared));
    el.dispatchEvent(new PointerEvent("pointerup", shared));
    el.dispatchEvent(new MouseEvent("mouseup", shared));
    el.dispatchEvent(new MouseEvent("click", shared));
  }

  function scoreSubmitCandidate(el) {
    let score = 0;
    const tag = el.tagName;
    const text = (el.textContent || "").trim().toLowerCase();
    const label = (el.getAttribute("aria-label") || "").toLowerCase();
    const id = (el.id || "").toLowerCase();
    const testId = (el.getAttribute("data-testid") || "").toLowerCase();
    const cls = el.className || "";

    if (!isElementVisible(el)) { return -100; }
    if (isElementDisabled(el)) { return -50; }

    // positive: send-related signals
    if (SEND_KEYWORDS.test(label)) { score += 10; }
    if (SEND_KEYWORDS.test(id)) { score += 10; }
    if (SEND_KEYWORDS.test(testId)) { score += 10; }
    if (SEND_KEYWORDS.test(text) && text.length < 20) { score += 6; }
    if (el.querySelector("svg")) { score += 4; }
    if (tag === "BUTTON") { score += 2; }
    if (el.getAttribute("role") === "button") { score += 2; }
    if (el.getAttribute("type") === "submit") { score += 8; }

    // negative: unrelated buttons
    if (SKIP_KEYWORDS.test(label)) { score -= 15; }
    if (SKIP_KEYWORDS.test(id)) { score -= 15; }
    if (SKIP_KEYWORDS.test(cls)) { score -= 10; }
    if (SKIP_KEYWORDS.test(text) && !SEND_KEYWORDS.test(text)) { score -= 10; }

    return score;
  }

  function findNearbySubmitButton(inputEl) {
    let container = inputEl.parentElement;
    const MAX_CLIMB = 6;

    for (let level = 0; level < MAX_CLIMB && container; level++) {
      const candidates = container.querySelectorAll(
        'button, [role="button"], [class*="button"], [class*="btn"], [data-testid*="send"], div[class*="send"]'
      );

      let best = null;
      let bestScore = 0;

      for (const el of candidates) {
        if (el === inputEl || el.contains(inputEl)) { continue; }
        const s = scoreSubmitCandidate(el);
        if (s > bestScore) {
          bestScore = s;
          best = el;
        }
      }

      if (best && bestScore >= 4) {
        return best;
      }

      container = container.parentElement;
    }

    return null;
  }

  function tryFormSubmit(inputEl) {
    const form = inputEl.closest("form");
    if (!form) { return false; }
    try {
      if (form.requestSubmit) {
        form.requestSubmit();
      } else {
        form.submit();
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  // ============================================================
  //  FILL & SUBMIT
  // ============================================================

  async function fillAndSubmit(question) {
    try {
      const inputEl = queryFirst(adapter.inputSelector);
      if (!inputEl) {
        return { success: false, error: "input element not found" };
      }

      // step 1: focus
      inputEl.focus();
      await sleep(STEP_DELAY_MS);

      // step 2: fill
      if (adapter.fillInput) {
        adapter.fillInput(inputEl, question);
      } else if (inputEl.tagName === "TEXTAREA" || inputEl.tagName === "INPUT") {
        setNativeValue(inputEl, question);
      } else {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(inputEl);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand("insertText", false, question);
      }

      // step 3: wait for framework to process input (with random jitter
      // so the interval is not machine-detectable)
      const baseWait = adapter.waitBeforeSubmit || 500;
      const jitter = Math.floor(Math.random() * 600);
      await sleep(baseWait + jitter);

      // step 4: submit
      if (adapter.useEnterToSubmit) {
        // direct Enter — skip all button-finding for Enter-to-send sites
        dispatchEnter(inputEl);
      } else {
        // four-level fallback for button-click sites
        let submitted = false;

        // level 1: adapter's specific selector (with retry for disabled state)
        for (let attempt = 0; attempt < 3 && !submitted; attempt++) {
          const btn = queryFirst(adapter.submitSelector);
          if (btn && !isElementDisabled(btn) && isElementVisible(btn)) {
            humanClick(btn);
            submitted = true;
          }
          if (!submitted) { await sleep(STEP_DELAY_MS); }
        }

        // level 2: universal proximity search
        if (!submitted) {
          const nearby = findNearbySubmitButton(inputEl);
          if (nearby) {
            humanClick(nearby);
            submitted = true;
          }
        }

        // level 3: form submit
        if (!submitted) {
          submitted = tryFormSubmit(inputEl);
        }

        // level 4: fallback Enter key
        if (!submitted) {
          dispatchEnter(inputEl);
        }
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message || "fill/submit failed" };
    }
  }

  // re-trigger submit without re-filling text (used by tab warm-up)
  async function retrySubmit() {
    const inputEl = queryFirst(adapter.inputSelector);
    if (!inputEl) { return false; }

    const hasText = (inputEl.value && inputEl.value.length > 0)
      || (inputEl.textContent && inputEl.textContent.trim().length > 0);
    if (!hasText) { return false; }

    inputEl.focus();
    await sleep(200);

    if (adapter.useEnterToSubmit) {
      dispatchEnter(inputEl);
      return true;
    }

    const btn = queryFirst(adapter.submitSelector);
    if (btn && !isElementDisabled(btn) && isElementVisible(btn)) {
      humanClick(btn);
      return true;
    }

    const nearby = findNearbySubmitButton(inputEl);
    if (nearby) {
      humanClick(nearby);
      return true;
    }

    if (tryFormSubmit(inputEl)) { return true; }

    dispatchEnter(inputEl);
    return true;
  }

  // ============================================================
  //  RESPONSE DETECTION
  // ============================================================

  function isStillThinking() {
    // check adapter-specific thinking selector
    if (adapter.thinkingSelector) {
      var sels = adapter.thinkingSelector.split(",");
      for (var s = 0; s < sels.length; s++) {
        try {
          var el = document.querySelector(sels[s].trim());
          if (el && el.offsetParent !== null) {
            var style = window.getComputedStyle(el);
            if (style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0") {
              return true;
            }
          }
        } catch (_) { /* skip */ }
      }
    }

    // universal: visible "Stop" button = still streaming
    // only match actual stop-generation buttons, avoid false positives
    var stopSelectors = [
      'button[aria-label*="Stop" i]',
      'button[aria-label*="stop" i]',
      'button[aria-label*="停止" i]',
    ];
    for (var i = 0; i < stopSelectors.length; i++) {
      try {
        var btn = document.querySelector(stopSelectors[i]);
        if (btn && btn.offsetParent !== null) { return true; }
      } catch (_) { /* skip */ }
    }

    return false;
  }

  var UI_NOISE = /^(Copy|Copied|复制|已复制|Retry|重试|Edit|编辑|Share|分享|Like|Dislike|Good|Bad|👍|👎)[\s]*$/;

  function cleanResponseText(text) {
    if (!text) { return ""; }
    return text
      .split("\n")
      .filter(function(line) { return !UI_NOISE.test(line.trim()); })
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function extractLatestResponse() {
    try {
      // primary: precise selector extraction
      var elements = queryAll(adapter.responseSelector);
      if (elements.length > 0) {
        var lastEl = elements[elements.length - 1];
        var text = cleanResponseText(lastEl.innerText || lastEl.textContent || "");
        if (text.length > 10) { return text; }
      }

      // fallback: main content area minus sidebar/nav/header noise
      var noiseSelector = "nav, aside, header, footer, [class*='sidebar'], [class*='history'], [class*='nav-'], [class*='side-'], [role='navigation'], [role='banner'], [role='contentinfo']";
      var noiseEls = document.querySelectorAll(noiseSelector);
      var noise = new Set();
      for (var i = 0; i < noiseEls.length; i++) { noise.add(noiseEls[i]); }

      var main = document.querySelector("main, [role='main'], [class*='chat-container'], [class*='conversation'], [id*='message']") || document.body;
      var walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
      var result = "";
      while (walker.nextNode()) {
        var skip = false;
        var parent = walker.currentNode.parentElement;
        while (parent && parent !== main) {
          if (noise.has(parent)) { skip = true; break; }
          parent = parent.parentElement;
        }
        if (!skip) { result += walker.currentNode.textContent; }
      }
      return result.replace(/\n{3,}/g, "\n\n").trim();
    } catch (_) {
      return "";
    }
  }

  // ============================================================
  //  POLLING
  // ============================================================

  function startPolling() {
    stopPolling();
    stabilityCounter = 0;
    lastResponseText = "";
    pollEverStarted = true;
    preExistingPageText = extractLatestResponse();
    let lastSentText = "";
    const preExistingText = preExistingPageText;
    const startTime = Date.now();

    pollingTimer = setInterval(() => {
      if (Date.now() - startTime > MAX_POLL_DURATION_MS) {
        stopPolling();
        sendStatus("timeout", extractLatestResponse());
        return;
      }

      const thinking = isStillThinking();
      const currentText = extractLatestResponse();

      // ignore pre-existing response from previous conversation
      const isNewResponse = currentText !== preExistingText;

      if (isNewResponse && currentText && currentText === lastResponseText) {
        stabilityCounter++;
      } else {
        stabilityCounter = 0;
      }

      lastResponseText = currentText;

      // send progress on every tick so the UI can show confirming countdown
      const progress = isNewResponse ? stabilityCounter : 0;
      const textChanged = currentText !== lastSentText;
      if (textChanged || progress > 0) {
        sendStatus("polling", currentText, progress);
        lastSentText = currentText;
      }

      var normalDone = !thinking && isNewResponse && stabilityCounter >= STABILITY_THRESHOLD && currentText.length > 0;
      var forceDone = isNewResponse && stabilityCounter >= STABILITY_THRESHOLD_FORCE && currentText.length > 0;
      if (normalDone || forceDone) {
        stopPolling();
        sendStatus("done", currentText, STABILITY_THRESHOLD);
      }
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
  }

  function sendStatus(status, responseText, stability) {
    try {
      chrome.runtime.sendMessage({
        type: "ASKALL_STATUS",
        hostname: hostname,
        status: status,
        response: responseText || "",
        stabilityProgress: stability || 0,
      });
    } catch (_) {
      // extension context invalidated (reloaded/uninstalled)
      stopPolling();
    }
  }

  // ============================================================
  //  DIAGNOSTICS
  // ============================================================

  function captureDomSnapshot(inputEl) {
    try {
      var snapshot = {};

      // capture the input area's parent context (3 levels up)
      if (inputEl) {
        var ctx = inputEl.parentElement;
        for (var i = 0; i < 3 && ctx && ctx !== document.body; i++) {
          ctx = ctx.parentElement;
        }
        if (ctx) {
          snapshot.inputAreaHtml = ctx.outerHTML.slice(0, 5000);
        }
      }

      // capture all textareas and contenteditable elements
      var inputs = [];
      document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]').forEach(function(el) {
        inputs.push({
          tag: el.tagName,
          id: el.id || "",
          class: (el.className || "").toString().slice(0, 100),
          placeholder: el.placeholder || "",
          contentEditable: el.contentEditable,
          dataAttrs: Array.from(el.attributes).filter(function(a) { return a.name.startsWith("data-"); }).map(function(a) { return a.name + "=" + a.value.slice(0, 30); }).join(", "),
          visible: isElementVisible(el),
        });
      });
      snapshot.allInputs = inputs;

      // capture elements with "send" in class/id/aria-label
      var sendEls = [];
      document.querySelectorAll('[class*="send"], [id*="send"], [aria-label*="Send"], [aria-label*="send"], [aria-label*="Submit"], [data-testid*="send"]').forEach(function(el) {
        sendEls.push({
          tag: el.tagName,
          id: el.id || "",
          class: (el.className || "").toString().slice(0, 100),
          ariaLabel: el.getAttribute("aria-label") || "",
          text: (el.textContent || "").trim().slice(0, 30),
          visible: isElementVisible(el),
          disabled: el.disabled || false,
        });
      });
      snapshot.allSendElements = sendEls.slice(0, 10);

      // capture body outerHTML (truncated)
      snapshot.fullPageHtmlLength = document.documentElement.outerHTML.length;
      snapshot.bodyHtmlTruncated = document.body.innerHTML.slice(0, 8000);

      return snapshot;
    } catch (err) {
      return { error: err.message };
    }
  }

  function collectDiagnostics() {
    try {
      const inputEl = queryFirst(adapter.inputSelector);
      const submitEl = queryFirst(adapter.submitSelector);
      const responseEls = queryAll(adapter.responseSelector);
      const thinkingEl = queryFirst(adapter.thinkingSelector);

      // input element details
      var inputInfo = null;
      if (inputEl) {
        inputInfo = {
          tag: inputEl.tagName,
          id: inputEl.id || null,
          className: (inputEl.className || "").toString().slice(0, 120),
          type: inputEl.type || null,
          placeholder: inputEl.placeholder || null,
          contentEditable: inputEl.contentEditable,
          hasValue: inputEl.value ? inputEl.value.length : 0,
          hasTextContent: (inputEl.textContent || "").length,
          rect: inputEl.getBoundingClientRect().toJSON(),
        };
      }

      // submit button details
      var submitInfo = null;
      if (submitEl) {
        submitInfo = {
          tag: submitEl.tagName,
          id: submitEl.id || null,
          className: (submitEl.className || "").toString().slice(0, 120),
          type: submitEl.type || null,
          ariaLabel: submitEl.getAttribute("aria-label") || null,
          ariaDisabled: submitEl.getAttribute("aria-disabled"),
          disabled: submitEl.disabled || false,
          hasSvg: !!submitEl.querySelector("svg"),
          textContent: (submitEl.textContent || "").trim().slice(0, 50),
          visible: isElementVisible(submitEl),
        };
      }

      // response elements summary
      var responseInfo = responseEls.slice(-3).map(function(el, i) {
        return {
          index: responseEls.length - 3 + i,
          tag: el.tagName,
          className: (el.className || "").toString().slice(0, 80),
          textLength: (el.innerText || "").length,
        };
      });

      // page-level error/alert/warning hints
      var errorHints = [];
      var errorSelectors = [
        '[class*="error"]', '[class*="alert"]', '[class*="warning"]',
        '[role="alert"]', '[class*="notice"]', '[class*="fail"]',
        '[class*="captcha"]', '[class*="login"]', '[class*="sign-in"]',
      ];
      for (var idx = 0; idx < errorSelectors.length; idx++) {
        try {
          document.querySelectorAll(errorSelectors[idx]).forEach(function(el) {
            var text = (el.innerText || "").trim();
            if (text && text.length > 0 && text.length < 500) {
              errorHints.push(text);
            }
          });
        } catch (_) { /* skip */ }
      }

      // all buttons on page (for debugging submit issues)
      var allButtons = [];
      try {
        document.querySelectorAll("button, [role='button']").forEach(function(btn) {
          var label = btn.getAttribute("aria-label") || "";
          var text = (btn.textContent || "").trim().slice(0, 40);
          var cls = (btn.className || "").toString().slice(0, 60);
          if (label || text) {
            allButtons.push({
              tag: btn.tagName,
              ariaLabel: label,
              text: text,
              class: cls,
              disabled: btn.disabled || false,
              visible: isElementVisible(btn),
            });
          }
        });
      } catch (_) { /* skip */ }

      return {
        hostname: hostname,
        pageTitle: document.title,
        currentUrl: window.location.href,
        userAgent: navigator.userAgent.slice(0, 100),
        adapterUsed: hostname in adapters ? hostname : "__fallback",
        adapterConfig: {
          useEnterToSubmit: adapter.useEnterToSubmit,
          waitBeforeSubmit: adapter.waitBeforeSubmit,
          hasFillInput: !!adapter.fillInput,
        },
        selectors: {
          input: adapter.inputSelector,
          submit: adapter.submitSelector,
          response: adapter.responseSelector,
          thinking: adapter.thinkingSelector,
        },
        domProbe: {
          inputFound: !!inputEl,
          inputDetail: inputInfo,
          submitFound: !!submitEl,
          submitDetail: submitInfo,
          responseCount: responseEls.length,
          responseDetail: responseInfo,
          thinkingVisible: !!thinkingEl && isStillThinking(),
        },
        pollingState: {
          lastResponseLength: lastResponseText.length,
          stabilityCounter: stabilityCounter,
          isPolling: !!pollingTimer,
        },
        pageButtons: allButtons.slice(0, 15),
        errorHints: errorHints.slice(0, 8),
        bodyTextLength: (document.body.innerText || "").length,
        formsCount: document.querySelectorAll("form").length,
        domSnapshot: captureDomSnapshot(inputEl),
      };
    } catch (err) {
      return { hostname: hostname, error: err.message };
    }
  }

  // ============================================================
  //  MESSAGE LISTENER
  // ============================================================

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "ASKALL_INJECT") {
      stopPolling();
      fillAndSubmit(msg.question).then((result) => {
        if (result.success) {
          setTimeout(() => startPolling(), 2000);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: result.error });
        }
      });
      return true;
    }

    if (msg.type === "ASKALL_COLLECT") {
      const text = extractLatestResponse();
      const hasNewContent = pollEverStarted && text !== preExistingPageText;
      let status;
      if (pollingTimer) {
        status = "polling";
      } else if (hasNewContent) {
        status = "done";
      } else if (pollEverStarted) {
        // polling ran but no new content detected — timed out
        status = "timeout";
      } else {
        // polling never started (injection failed) — don't claim done
        status = "pending";
      }
      sendResponse({ status: status, response: hasNewContent ? text : "", stabilityProgress: stabilityCounter });
      return true;
    }

    if (msg.type === "ASKALL_WARM") {
      const currentText = extractLatestResponse();
      const hasNewContent = pollEverStarted && currentText !== preExistingPageText;
      if (hasNewContent) {
        sendResponse({ retried: false, reason: "already streaming" });
        return true;
      }
      retrySubmit().then((tried) => {
        if (tried && !pollingTimer) {
          setTimeout(() => startPolling(), 2000);
        }
        sendResponse({ retried: tried });
      });
      return true;
    }

    if (msg.type === "ASKALL_STOP") {
      stopPolling();
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === "ASKALL_DEBUG") {
      const diag = collectDiagnostics();
      sendResponse(diag);
      return true;
    }

    return false;
  });
})();
