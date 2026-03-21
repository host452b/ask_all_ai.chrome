// service-worker.js
// background orchestrator: tabs, injection, timing, history, retry.

const TAB_LOAD_TIMEOUT_MS = 15000;
const PAGE_READY_CHECK_DELAY_MS = 3000;
const MAX_RELOAD_RETRIES = 0;
const INJECT_RETRY_DELAY_MS = 2000;
const INJECT_MAX_RETRIES = 5;
const MAX_RESPONSE_LENGTH = 500000;
const MAX_HISTORY_ITEMS = 50;
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 1500;
const TAB_WARM_ROUNDS = 3;
const TAB_WARM_INTERVAL_MS = 10000;
const TAB_WARM_FOCUS_MS = 800;
const TAB_WARM_POST_ACTION_MS = 500;
const SLOW_SITE_EXTRA_DELAY_MS = 5000;
const SLOW_SITE_HOSTNAMES = [];

// { tabId -> { url, hostname, status, response, createdAt, doneAt } }
let activeTabs = {};
let isSending = false;
let currentQuestion = "";
let panelWindowId = null;
let askallTabId = null;

// open AskAll in a full tab when extension icon is clicked
chrome.action.onClicked.addListener(() => {
  const pageUrl = chrome.runtime.getURL("popup/popup.html?tab=1");
  if (askallTabId) {
    chrome.tabs.get(askallTabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        askallTabId = null;
        chrome.tabs.create({ url: pageUrl }, (t) => { askallTabId = t.id; });
      } else {
        chrome.tabs.update(askallTabId, { active: true });
        chrome.windows.update(tab.windowId, { focused: true });
      }
    });
  } else {
    chrome.tabs.create({ url: pageUrl }, (t) => { askallTabId = t.id; });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === askallTabId) { askallTabId = null; }
});

// reopen AskAll tab after extension reload
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "update" || details.reason === "install") {
    chrome.storage.local.get("askall_reopen", (r) => {
      if (r && r.askall_reopen) {
        chrome.storage.local.remove("askall_reopen");
        chrome.tabs.create({ url: r.askall_reopen }, (t) => { askallTabId = t.id; });
      }
    });
  }
});

// ============================================================
//  HELPERS
// ============================================================

function isValidUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch (_) {
    return false;
  }
}

function truncateResponse(text) {
  if (!text) {
    return "";
  }
  if (text.length > MAX_RESPONSE_LENGTH) {
    return text.slice(0, MAX_RESPONSE_LENGTH) + "\n\n[...truncated]";
  }
  return text;
}

function safeGetTab(tabId) {
  return activeTabs[tabId] || null;
}

function countWords(text) {
  if (!text) { return 0; }
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const isSpace = text[i] === " " || text[i] === "\n" || text[i] === "\t" || text[i] === "\r";
    if (!isSpace && !inWord) { count++; inWord = true; }
    if (isSpace) { inWord = false; }
  }
  return count;
}

function updateCachedWordCount(info) {
  if (info.response !== info._lastCountedResponse) {
    info._cachedWordCount = countWords(info.response);
    info._lastCountedResponse = info.response;
  }
}

function buildSummary() {
  const summary = {};
  for (const [tabId, info] of Object.entries(activeTabs)) {
    updateCachedWordCount(info);
    const elapsed = info.doneAt
      ? info.doneAt - info.createdAt
      : Date.now() - info.createdAt;
    summary[tabId] = {
      url: info.url,
      hostname: info.hostname,
      status: info.status,
      response: info.response,
      elapsedMs: elapsed,
      wordCount: info._cachedWordCount || 0,
      errorLog: info.errorLog || null,
      stabilityProgress: info.stabilityProgress || 0,
    };
  }
  return summary;
}

// ============================================================
//  PRE-FLIGHT REACHABILITY CHECK
// ============================================================

const PREFLIGHT_TIMEOUT_MS = 6000;

async function checkReachability(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREFLIGHT_TIMEOUT_MS);

  try {
    // mode: "no-cors" avoids CORS blocks; we only care if the server responds at all
    await fetch(url, {
      method: "HEAD",
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return { url: url, reachable: true };
  } catch (_) {
    clearTimeout(timer);
    return { url: url, reachable: false };
  }
}

async function batchCheckReachability(urls) {
  const results = await Promise.allSettled(
    urls.map((url) => checkReachability(url))
  );

  const reachable = [];
  const unreachable = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      if (result.value.reachable) {
        reachable.push(result.value.url);
      } else {
        unreachable.push(result.value.url);
      }
    }
  }

  return { reachable, unreachable };
}

// ============================================================
//  TAB LIFECYCLE
// ============================================================

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, TAB_LOAD_TIMEOUT_MS);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function ensureContentScriptInjected(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ["content/site-adapters.js", "content/content-script.js"],
    });
    return true;
  } catch (err) {
    console.warn(`[AskAll] inject failed for tab ${tabId}: ${err.message}`);
    return false;
  }
}

async function checkPageReady(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        const body = document.body;
        if (!body) { return false; }
        // blank page: no visible content
        if (body.innerText.trim().length < 10 && body.querySelectorAll("img, svg, canvas, video").length === 0) {
          return false;
        }
        // page has meaningful content
        return true;
      },
    });
    return results && results[0] && results[0].result === true;
  } catch (_) {
    return false;
  }
}

async function closeExistingTabsForHostname(hostname) {
  try {
    const allTabs = await chrome.tabs.query({});
    for (const tab of allTabs) {
      if (!tab.url) { continue; }
      try {
        const tabHostname = new URL(tab.url).hostname;
        if (tabHostname === hostname) {
          await chrome.tabs.remove(tab.id);
        }
      } catch (_) {
        // skip tabs with invalid urls
      }
    }
  } catch (_) {
    // query/remove failed
  }
}

async function openAndInject(url, question) {
  if (!isValidUrl(url)) {
    return null;
  }

  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch (_) {
    return null;
  }


  let tab;
  try {
    tab = await chrome.tabs.create({ url: url, active: false });
  } catch (err) {
    console.warn(`[AskAll] failed to open tab for ${url}: ${err.message}`);
    return null;
  }

  const tabId = tab.id;
  activeTabs[tabId] = {
    url: url,
    hostname: hostname,
    status: "loading",
    response: "",
    createdAt: Date.now(),
    doneAt: null,
  };

  await waitForTabComplete(tabId);

  if (!safeGetTab(tabId)) {
    return tabId;
  }

  // slow sites (anti-bot, delayed loading) need extra wait
  var isSlowSite = SLOW_SITE_HOSTNAMES.includes(hostname);
  var spaDelay = isSlowSite ? 1500 + SLOW_SITE_EXTRA_DELAY_MS : 1500;
  await new Promise((r) => setTimeout(r, spaDelay));

  if (!safeGetTab(tabId)) { return tabId; }

  const injected = await ensureContentScriptInjected(tabId);
  if (!injected) {
    const tabInfo = safeGetTab(tabId);
    if (tabInfo) {
      tabInfo.status = "error";
      tabInfo.response = "No permission to inject into this site. Please check if you are logged in and the site is accessible.";
      tabInfo.doneAt = Date.now();
    }
    return tabId;
  }

  await new Promise((r) => setTimeout(r, 500));

  let messageDelivered = false;
  for (let attempt = 0; attempt < INJECT_MAX_RETRIES; attempt++) {
    if (!safeGetTab(tabId)) {
      break;
    }
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: "ASKALL_INJECT",
        question: question,
      });
      if (response && response.success) {
        const tabInfo = safeGetTab(tabId);
        if (tabInfo) {
          tabInfo.status = "polling";
        }
        messageDelivered = true;
        break;
      }
    } catch (_) {
      // content script not ready
    }

    if (attempt < INJECT_MAX_RETRIES - 1) {
      await new Promise((r) => setTimeout(r, INJECT_RETRY_DELAY_MS));
      await ensureContentScriptInjected(tabId);
    }
  }

  if (!messageDelivered) {
    const tabInfo = safeGetTab(tabId);
    if (tabInfo) {
      tabInfo.status = "error";
      tabInfo.response = "Failed to inject question into page. Please check: 1) Are you logged in? 2) Does the site require a subscription or credits? 3) Is there a CAPTCHA or popup blocking the input?";
      tabInfo.doneAt = Date.now();
    }
  }

  return tabId;
}

// ============================================================
//  BATCHED TAB OPENING
// ============================================================

async function openInBatches(urls, question) {
  const allTabIds = [];
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((url) => openAndInject(url, question))
    );
    for (const r of results) {
      allTabIds.push(r.status === "fulfilled" ? r.value : null);
    }
    if (i + BATCH_SIZE < urls.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }
  return allTabIds;
}

// ============================================================
//  TAB WARM-UP (combat background throttling)
// ============================================================

async function warmTabs(tabIds) {
  const validIds = tabIds.filter((id) => id != null && !isNaN(id));
  if (validIds.length === 0) { return; }

  for (let round = 0; round < TAB_WARM_ROUNDS; round++) {
    if (round > 0) {
      await new Promise((r) => setTimeout(r, TAB_WARM_INTERVAL_MS));
    }

    let originalTab = null;
    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tabs && tabs.length > 0) { originalTab = tabs[0]; }
    } catch (_) {
      // query may fail if no focused window
    }

    for (const tabId of validIds) {
      const info = safeGetTab(tabId);
      if (!info) { continue; }
      const terminal = info.status === "done" || info.status === "error"
        || info.status === "timeout" || info.status === "skipped";
      if (terminal) { continue; }

      try {
        await chrome.tabs.update(tabId, { active: true });
        // let the tab wake up from background throttle
        await new Promise((r) => setTimeout(r, TAB_WARM_FOCUS_MS));
        // retry submit (Enter / click) while tab is still active
        try { await chrome.tabs.sendMessage(tabId, { type: "ASKALL_WARM" }); } catch (_) {}
        // let the page process the submit before switching away
        await new Promise((r) => setTimeout(r, TAB_WARM_POST_ACTION_MS));
      } catch (_) {
        // tab already closed
      }
    }

    if (originalTab) {
      try {
        await chrome.tabs.update(originalTab.id, { active: true });
        await chrome.windows.update(originalTab.windowId, { focused: true });
      } catch (_) {
        // original tab may have been closed
      }
    }
  }
}

// ============================================================
//  AUTO-CLOSE PANEL WHEN ALL DONE
// ============================================================

function openNewPanel(msg, sendResponse) {
  const width = msg.width || 600;
  const height = msg.height || 620;
  chrome.windows.create({
    url: chrome.runtime.getURL("popup/popup.html?detached=1"),
    type: "popup",
    width: width,
    height: height,
    top: 0,
    focused: true,
  }, (win) => {
    panelWindowId = win.id;
    sendResponse({ windowId: win.id });
  });
}

function checkAllDoneAndClosePanel() {
  if (!panelWindowId) { return; }
  const entries = Object.values(activeTabs);
  if (entries.length === 0) { return; }
  const allFinished = entries.every((info) => {
    return info.status === "done" || info.status === "timeout" ||
      info.status === "error" || info.status === "skipped";
  });
  if (allFinished) {
    // delay so user can see final results
    setTimeout(() => {
      if (!panelWindowId) { return; }
      try { chrome.windows.remove(panelWindowId); } catch (_) { /* ok */ }
      panelWindowId = null;
    }, 5000);
  }
}

// ============================================================
//  GARBAGE COLLECTION
// ============================================================

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === panelWindowId) {
    panelWindowId = null;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeTabs[tabId]) {
    const info = activeTabs[tabId];
    if (info.status !== "done" && info.status !== "error" && info.status !== "timeout") {
      info.status = "error";
      info.doneAt = Date.now();
      if (!info.response) {
        info.response = "Tab was closed before response completed. Please keep AI tabs open until all responses are collected.";
      }
    }
  }
});

function cleanupStaleTabs() {
  const ONE_HOUR = 60 * 60 * 1000;
  const now = Date.now();
  for (const [tabId, info] of Object.entries(activeTabs)) {
    if (now - info.createdAt > ONE_HOUR) {
      delete activeTabs[tabId];
    }
  }
}

function stopAllContentPolling() {
  for (const tabIdStr of Object.keys(activeTabs)) {
    const tabId = parseInt(tabIdStr, 10);
    if (isNaN(tabId)) { continue; }
    try {
      chrome.tabs.sendMessage(tabId, { type: "ASKALL_STOP" });
    } catch (_) {
      // tab may already be gone
    }
  }
}

// ============================================================
//  HISTORY
// ============================================================

async function saveToHistory(question, urls) {
  try {
    const result = await chrome.storage.local.get("askall_history");
    const history = (result && result.askall_history) || [];
    history.unshift({
      question: question,
      urls: urls,
      timestamp: Date.now(),
    });
    if (history.length > MAX_HISTORY_ITEMS) {
      history.length = MAX_HISTORY_ITEMS;
    }
    await chrome.storage.local.set({ askall_history: history });
  } catch (_) {
    // storage write failed
  }
}

// ============================================================
//  MESSAGE HANDLING
// ============================================================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.type === "ASKALL_STATUS") {
    const tabId = sender.tab && sender.tab.id;
    const tabInfo = tabId ? safeGetTab(tabId) : null;
    if (tabInfo) {
      const wasDone = tabInfo.status === "done" || tabInfo.status === "timeout" || tabInfo.status === "error";
      if (!wasDone || (msg.status === "done" && msg.response)) {
        tabInfo.status = msg.status;
      }
      tabInfo.response = truncateResponse(msg.response) || tabInfo.response;
      tabInfo.stabilityProgress = msg.stabilityProgress || 0;
      const isNowDone = msg.status === "done" || msg.status === "timeout";
      if (!wasDone && isNowDone) {
        tabInfo.doneAt = Date.now();
        checkAllDoneAndClosePanel();
      }
    }
    return false;
  }

  if (msg.type === "ASKALL_SEND") {
    if (isSending) {
      sendResponse({ success: false, error: "Already sending." });
      return false;
    }

    const { urls, question } = msg;
    if (!urls || !Array.isArray(urls) || urls.length === 0 || !question) {
      sendResponse({ success: false, error: "Invalid parameters." });
      return false;
    }

    const MAX_TABS = 35;
    if (urls.length > MAX_TABS) {
      sendResponse({ success: false, error: `Maximum ${MAX_TABS} sites at once.` });
      return false;
    }

    isSending = true;
    currentQuestion = question;
    stopAllContentPolling();
    cleanupStaleTabs();
    activeTabs = {};

    const validUrls = urls.filter(isValidUrl);

    saveToHistory(question, validUrls);

    openInBatches(validUrls, question)
      .then((tabIds) => {
        isSending = false;
        sendResponse({
          success: true,
          tabIds: tabIds,
          skipped: [],
        });
        warmTabs(tabIds);
      })
      .catch(() => {
        isSending = false;
        sendResponse({ success: false, error: "Unexpected error." });
      });

    return true;
  }

  if (msg.type === "ASKALL_GET_STATUS") {
    sendResponse({ tabs: buildSummary(), question: currentQuestion });
    return false;
  }

  if (msg.type === "ASKALL_COLLECT_ALL") {
    const tabIds = Object.keys(activeTabs);
    if (tabIds.length === 0) {
      sendResponse({ tabs: {} });
      return false;
    }

    const collectPromises = tabIds.map(async (tabIdStr) => {
      const tabId = parseInt(tabIdStr, 10);
      if (isNaN(tabId)) { return; }
      const tabInfo = safeGetTab(tabId);
      if (!tabInfo) {
        return;
      }
      try {
        const resp = await chrome.tabs.sendMessage(tabId, { type: "ASKALL_COLLECT" });
        if (resp) {
          const isTerminal = tabInfo.status === "done" || tabInfo.status === "timeout" || tabInfo.status === "error";
          if (!isTerminal || (resp.status === "done" && resp.response)) {
            tabInfo.status = resp.status;
          }
          tabInfo.response = truncateResponse(resp.response) || tabInfo.response;
          tabInfo.stabilityProgress = resp.stabilityProgress || 0;
          if (!isTerminal && (resp.status === "done" || resp.status === "timeout")) {
            tabInfo.doneAt = Date.now();
          }
        }
      } catch (_) {
        if (tabInfo.status !== "done" && tabInfo.status !== "timeout") {
          tabInfo.status = "error";
          tabInfo.doneAt = Date.now();
          if (!tabInfo.response) {
            tabInfo.response = "Connection lost with tab. The page may have reloaded or navigated away. Try clicking Retry.";
          }
        }
      }
    });

    Promise.allSettled(collectPromises).then(() => {
      sendResponse({ tabs: buildSummary() });
    });

    return true;
  }

  // retry a single failed site
  if (msg.type === "ASKALL_RETRY_SITE") {
    const { url } = msg;
    if (!url || !currentQuestion || !isValidUrl(url)) {
      sendResponse({ success: false });
      return false;
    }

    let hostname;
    try { hostname = new URL(url).hostname; } catch (_) {
      sendResponse({ success: false });
      return false;
    }
    for (const [tabId, info] of Object.entries(activeTabs)) {
      if (info.hostname === hostname) {
        delete activeTabs[tabId];
        break;
      }
    }

    openAndInject(url, currentQuestion).then((tabId) => {
      sendResponse({ success: !!tabId, tabId: tabId });
    });

    return true;
  }

  if (msg.type === "ASKALL_STOP_ALL") {
    stopAllContentPolling();
    // close all tabs opened by AskAll
    for (const tabIdStr of Object.keys(activeTabs)) {
      const tabId = parseInt(tabIdStr, 10);
      if (!isNaN(tabId)) {
        try { chrome.tabs.remove(tabId); } catch (_) { /* already closed */ }
      }
    }
    activeTabs = {};
    currentQuestion = "";
    isSending = false;
    sendResponse({ success: true });
    return false;
  }

  // persistent panel window management
  if (msg.type === "ASKALL_OPEN_PANEL") {
    if (panelWindowId) {
      chrome.windows.update(panelWindowId, { focused: true }, () => {
        if (chrome.runtime.lastError) {
          panelWindowId = null;
        } else {
          sendResponse({ windowId: panelWindowId });
          return;
        }
        openNewPanel(msg, sendResponse);
      });
      return true;
    }
    openNewPanel(msg, sendResponse);
    return true;
  }

  if (msg.type === "ASKALL_CLOSE_PANEL") {
    if (panelWindowId) {
      try { chrome.windows.remove(panelWindowId); } catch (_) { /* already closed */ }
      panelWindowId = null;
    }
    sendResponse({ success: true });
    return false;
  }

  if (msg.type === "ASKALL_GET_PANEL_STATE") {
    sendResponse({ panelOpen: !!panelWindowId });
    return false;
  }

  // history
  if (msg.type === "ASKALL_GET_HISTORY") {
    chrome.storage.local.get("askall_history", (result) => {
      sendResponse({ history: (result && result.askall_history) || [] });
    });
    return true;
  }

  if (msg.type === "ASKALL_CLEAR_HISTORY") {
    chrome.storage.local.set({ askall_history: [] });
    sendResponse({ success: true });
    return false;
  }

  // collect debug diagnostics from all error/timeout tabs
  if (msg.type === "ASKALL_DEBUG_ALL") {
    const targets = Object.entries(activeTabs);

    if (targets.length === 0) {
      sendResponse({ debugEntries: [] });
      return false;
    }

    const debugPromises = targets.map(async ([tabIdStr, info]) => {
      const tabId = parseInt(tabIdStr, 10);
      const isRealTab = !isNaN(tabId);
      const entry = {
        hostname: info.hostname,
        url: info.url,
        status: info.status,
        response: info.response,
        createdAt: new Date(info.createdAt).toISOString(),
        doneAt: info.doneAt ? new Date(info.doneAt).toISOString() : null,
        elapsedMs: info.doneAt ? info.doneAt - info.createdAt : Date.now() - info.createdAt,
        pageDiag: null,
      };
      if (isRealTab) {
        try {
          const diag = await chrome.tabs.sendMessage(tabId, { type: "ASKALL_DEBUG" });
          entry.pageDiag = diag;
        } catch (_) {
          entry.pageDiag = { error: "tab unreachable" };
        }
      } else {
        entry.pageDiag = { error: "skipped site (no tab opened)" };
      }
      return entry;
    });

    Promise.allSettled(debugPromises).then((results) => {
      const entries = results
        .filter((r) => r.status === "fulfilled")
        .map((r) => r.value);
      sendResponse({ debugEntries: entries, question: currentQuestion });
    });

    return true;
  }

  return false;
});
