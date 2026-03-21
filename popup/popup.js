// popup.js
// UI logic, messaging, history, templates, export, retry, stats.

(function () {
  "use strict";

  // ============================================================
  //  CONSTANTS
  // ============================================================

  // sorted by 2026 popularity within each group
  const SITE_GROUPS = [
    {
      label: "General — Freemium",
      sites: [
        { name: "ChatGPT", url: "https://chatgpt.com/", hostname: "chatgpt.com" },
        { name: "Gemini", url: "https://gemini.google.com/", hostname: "gemini.google.com" },
        { name: "Claude", url: "https://claude.ai/", hostname: "claude.ai" },
        { name: "Grok", url: "https://grok.com/", hostname: "grok.com" },
        { name: "Copilot", url: "https://copilot.microsoft.com/", hostname: "copilot.microsoft.com" },
        { name: "Mistral", url: "https://chat.mistral.ai/chat", hostname: "chat.mistral.ai" },
      ]
    },
    {
      label: "General — Free",
      sites: [
        { name: "DeepSeek", url: "https://chat.deepseek.com/", hostname: "chat.deepseek.com" },

        { name: "Kimi", url: "https://www.kimi.com/", hostname: "www.kimi.com" },
        { name: "Qwen Think", url: "https://chat.qwen.ai/?thinking=true", hostname: "chat.qwen.ai" },
        { name: "Doubao", url: "https://www.doubao.com/chat/", hostname: "www.doubao.com" },
        { name: "Yuanbao", url: "https://yuanbao.tencent.com/", hostname: "yuanbao.tencent.com" },
        { name: "ChatGLM", url: "https://chatglm.cn/", hostname: "chatglm.cn" },
        { name: "Baidu Chat", url: "https://chat.baidu.com/search", hostname: "chat.baidu.com" },
        { name: "Sogou AI", url: "https://www.sogou.com/aimode", hostname: "www.sogou.com" },
        { name: "MiniMax", url: "https://agent.minimax.io/", hostname: "agent.minimax.io" },
      ]
    },
    {
      label: "Specialized — Freemium",
      sites: [
        { name: "Perplexity", url: "https://www.perplexity.ai/", hostname: "www.perplexity.ai" },
        { name: "Manus", url: "https://manus.im/", hostname: "manus.im" },
      ]
    },
    {
      label: "Specialized — Free",
      sites: [

        { name: "NVIDIA-Nemotron", url: "https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b", hostname: "build.nvidia.com" },
        { name: "NVIDIA-MiniMax-M2.5", url: "https://build.nvidia.com/minimaxai/minimax-m2.5", hostname: "build.nvidia.com" },
        { name: "NVIDIA-Kimi-K2.5", url: "https://build.nvidia.com/moonshotai/kimi-k2.5", hostname: "build.nvidia.com" },
        { name: "NVIDIA-GLM5", url: "https://build.nvidia.com/z-ai/glm5", hostname: "build.nvidia.com" },
        { name: "Genspark", url: "https://www.genspark.ai/", hostname: "www.genspark.ai" },
        { name: "Duck.ai", url: "https://duck.ai/", hostname: "duck.ai" },
        { name: "Reddit", url: "https://www.reddit.com/answers/", hostname: "www.reddit.com" },
      ]
    },
  ];

  // flat list for lookups
  const DEFAULT_SITES = SITE_GROUPS.flatMap((g) => g.sites);

  const STRATEGY_MAP = {
    cot: "Let's think step by step.\n\n",
    step: "Please break this down into numbered steps:\n\n",
    expert: "You are a world-class expert in this field. ",
    concise: "Be concise and direct. ",
    compare: "Analyze the pros and cons:\n\n",
  };

  const MAX_CUSTOM_SITES = 10;
  const STORAGE_KEY_SITES = "askall_selected_sites";
  const STORAGE_KEY_TEMPLATES = "askall_templates";
  const STORAGE_KEY_STRATEGIES = "askall_strategies";
  const STORAGE_KEY_CUSTOM_SITES = "askall_custom_sites";

  // ============================================================
  //  DOM REFS
  // ============================================================

  const questionEl = document.getElementById("question");
  const customSitesEl = document.getElementById("custom-sites");
  const siteListEl = document.getElementById("site-list");
  const toggleAllBtn = document.getElementById("toggle-all-btn");
  const sendBtn = document.getElementById("send-btn");
  const collectBtn = document.getElementById("collect-btn");
  const resetBtn = document.getElementById("reset-btn");
  const statusBar = document.getElementById("status-bar");
  const statusLabel = document.getElementById("status-label");
  // progress bar is now multi-segment, updated via updateProgressBar()
  const responsesSection = document.getElementById("responses-section");
  const responsesContainer = document.getElementById("responses-container");
  const emptyState = document.getElementById("empty-state");
  const etaLabel = document.getElementById("eta-label");
  const liveCounter = document.getElementById("live-counter");
  const copyAllBtn = document.getElementById("copy-all-btn");
  const exportMdBtn = document.getElementById("export-md-btn");
  const copyDebugBtn = document.getElementById("copy-debug-btn");
  const toastEl = document.getElementById("toast");
  const toastText = document.getElementById("toast-text");
  const historyBtn = document.getElementById("history-btn");
  const historyPanel = document.getElementById("history-panel");
  const tplSaveBtn = document.getElementById("tpl-save-btn");
  const tplLoadBtn = document.getElementById("tpl-load-btn");
  const tplPanel = document.getElementById("tpl-panel");

  let pollIntervalId = null;
  let autoRefreshId = null;
  let autoRefreshActive = false;
  let allSelected = true;
  let prevDoneSet = new Set();
  let sendInFlight = false;
  let lastSentQuestion = "";
  let etaTargetMs = 0;
  let etaTickId = null;
  let etaStreamingExtra = 0;

  // ============================================================
  //  SAFE MESSAGING
  // ============================================================

  function sendMsg(msg, callback) {
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) {
          console.warn("[AskAll]", chrome.runtime.lastError.message);
          if (callback) { callback(null); }
          return;
        }
        if (callback) { callback(resp); }
      });
    } catch (_) {
      if (callback) { callback(null); }
    }
  }

  function storageGet(key, cb) {
    try {
      chrome.storage.local.get(key, (result) => {
        if (chrome.runtime.lastError) { cb(null); return; }
        cb(result);
      });
    } catch (_) { cb(null); }
  }

  function storageSet(data) {
    try { chrome.storage.local.set(data); } catch (_) { /* skip */ }
  }

  // ============================================================
  //  RESTORE ALL SETTINGS (single storage read)
  // ============================================================

  const themeBtns = document.querySelectorAll(".theme-btn");

  function applyTheme(name) {
    document.body.setAttribute("data-theme", name);
    themeBtns.forEach((b) => b.classList.toggle("active", b.dataset.theme === name));
  }

  function saveStrategies() {
    const checked = [];
    document.querySelectorAll(".strategy-cb").forEach((cb) => {
      if (cb.checked) { checked.push(cb.value); }
    });
    storageSet({ [STORAGE_KEY_STRATEGIES]: checked });
  }

  storageGet([
    "askall_theme",
    STORAGE_KEY_SITES,
    STORAGE_KEY_STRATEGIES,
    STORAGE_KEY_CUSTOM_SITES,
  ], (r) => {
    if (!r) { r = {}; }

    applyTheme(r.askall_theme || "lumen");

    renderSiteList(r[STORAGE_KEY_SITES] || null);
    if (r[STORAGE_KEY_SITES]) {
      allSelected = r[STORAGE_KEY_SITES].length === DEFAULT_SITES.length;
    }

    if (r[STORAGE_KEY_STRATEGIES] && Array.isArray(r[STORAGE_KEY_STRATEGIES])) {
      document.querySelectorAll(".strategy-cb").forEach((cb) => {
        cb.checked = r[STORAGE_KEY_STRATEGIES].includes(cb.value);
      });
    }

    if (r[STORAGE_KEY_CUSTOM_SITES]) {
      customSitesEl.value = r[STORAGE_KEY_CUSTOM_SITES];
    }
  });

  themeBtns.forEach((b) => b.addEventListener("click", () => {
    applyTheme(b.dataset.theme);
    storageSet({ askall_theme: b.dataset.theme });
  }));

  document.querySelectorAll(".strategy-cb").forEach((cb) => {
    cb.addEventListener("change", saveStrategies);
  });

  customSitesEl.addEventListener("input", () => {
    storageSet({ [STORAGE_KEY_CUSTOM_SITES]: customSitesEl.value });
  });

  // ============================================================
  //  MICRO-INTERACTIONS
  // ============================================================

  function addRipple(btn, e) {
    const rect = btn.getBoundingClientRect();
    const ripple = document.createElement("span");
    ripple.className = "ripple";
    const size = Math.max(rect.width, rect.height) * 2;
    ripple.style.width = ripple.style.height = size + "px";
    ripple.style.left = (e.clientX - rect.left - size / 2) + "px";
    ripple.style.top = (e.clientY - rect.top - size / 2) + "px";
    btn.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove());
  }

  document.querySelectorAll(".btn").forEach((b) => {
    b.addEventListener("click", (e) => addRipple(b, e));
  });

  questionEl.addEventListener("input", () => {
    questionEl.style.height = "auto";
    questionEl.style.height = Math.min(questionEl.scrollHeight, 120) + "px";
  });

  questionEl.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      sendBtn.click();
    }
  });

  function shakeElement(el) {
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "card-arrive 400ms var(--ease-spring)";
  }

  // ============================================================
  //  SITE LIST + PERSISTENCE
  // ============================================================

  function renderSiteList(savedSelections) {
    siteListEl.innerHTML = "";
    let globalIdx = 0;

    SITE_GROUPS.forEach((group) => {
      const header = document.createElement("div");
      header.className = "site-group-header";
      header.textContent = group.label;
      siteListEl.appendChild(header);

      const grid = document.createElement("div");
      grid.className = "site-list";
      siteListEl.appendChild(grid);

      group.sites.forEach((site) => {
        const isChecked = savedSelections
          ? savedSelections.includes(site.hostname)
          : true;

        const div = document.createElement("div");
        div.className = "site-item" + (isChecked ? " selected" : "");
        div.dataset.url = site.url;
        div.dataset.hostname = site.hostname;
        div.dataset.name = site.name;

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = isChecked;
        cb.id = `site-cb-${globalIdx++}`;

        const favicon = document.createElement("img");
        favicon.className = "site-favicon";
        favicon.loading = "lazy";
        favicon.src = `https://www.google.com/s2/favicons?domain=${site.hostname}&sz=32`;
        favicon.alt = "";
        favicon.onerror = function () { this.style.display = "none"; };

        const nameSpan = document.createElement("span");
        nameSpan.className = "site-name";
        nameSpan.textContent = site.name;

        div.appendChild(cb);
        div.appendChild(favicon);
        div.appendChild(nameSpan);

        div.addEventListener("click", (e) => {
          if (e.target === cb) { return; }
          cb.checked = !cb.checked;
          div.classList.toggle("selected", cb.checked);
          saveSiteSelection();
        });

        cb.addEventListener("change", () => {
          div.classList.toggle("selected", cb.checked);
          saveSiteSelection();
        });

        grid.appendChild(div);
      });
    });
  }

  function saveSiteSelection() {
    const selected = [];
    siteListEl.querySelectorAll(".site-item").forEach((item) => {
      const cb = item.querySelector('input[type="checkbox"]');
      if (cb.checked) {
        selected.push(item.dataset.hostname);
      }
    });
    storageSet({ [STORAGE_KEY_SITES]: selected });
  }

  // site list is rendered in the unified storageGet callback above

  toggleAllBtn.addEventListener("click", () => {
    allSelected = !allSelected;
    siteListEl.querySelectorAll(".site-item").forEach((item, i) => {
      setTimeout(() => {
        const cb = item.querySelector('input[type="checkbox"]');
        cb.checked = allSelected;
        item.classList.toggle("selected", allSelected);
      }, i * 20);
    });
    setTimeout(saveSiteSelection, DEFAULT_SITES.length * 20 + 50);
  });

  // ============================================================
  //  HISTORY
  // ============================================================

  function closeAllPanels() {
    historyPanel.classList.add("hidden");
    tplPanel.classList.add("hidden");
    historyBtn.classList.remove("active-panel");
    tplSaveBtn.classList.remove("active-panel");
    tplLoadBtn.classList.remove("active-panel");
  }

  historyBtn.addEventListener("click", () => {
    const isOpen = !historyPanel.classList.contains("hidden");
    closeAllPanels();
    if (isOpen) { return; }
    historyBtn.classList.add("active-panel");
    historyPanel.classList.remove("hidden");
    loadHistoryPanel();
  });

  function loadHistoryPanel() {
    sendMsg({ type: "ASKALL_GET_HISTORY" }, (resp) => {
      const list = (resp && resp.history) || [];
      historyPanel.innerHTML = "";

      if (list.length === 0) {
        historyPanel.innerHTML = '<div class="dropdown-empty">No history yet</div>';
        return;
      }

      list.forEach((entry) => {
        const row = document.createElement("div");
        row.className = "dropdown-item";

        const text = document.createElement("span");
        text.className = "dropdown-item-text";
        text.textContent = entry.question.slice(0, 100);

        const meta = document.createElement("span");
        meta.className = "dropdown-item-meta";
        meta.textContent = formatTimeAgo(entry.timestamp);

        row.appendChild(text);
        row.appendChild(meta);

        row.addEventListener("click", () => {
          questionEl.value = entry.question;
          questionEl.dispatchEvent(new Event("input"));
          closeAllPanels();
        });

        historyPanel.appendChild(row);
      });

      const footer = document.createElement("div");
      footer.className = "dropdown-footer";
      const clearBtn = document.createElement("button");
      clearBtn.className = "dropdown-footer-btn";
      clearBtn.textContent = "Clear All";
      clearBtn.addEventListener("click", () => {
        sendMsg({ type: "ASKALL_CLEAR_HISTORY" });
        historyPanel.innerHTML = '<div class="dropdown-empty">No history yet</div>';
      });
      footer.appendChild(clearBtn);
      historyPanel.appendChild(footer);
    });
  }

  function formatTimeAgo(ts) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) { return "just now"; }
    if (mins < 60) { return mins + "m ago"; }
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) { return hrs + "h ago"; }
    const days = Math.floor(hrs / 24);
    return days + "d ago";
  }

  // ============================================================
  //  TEMPLATES
  // ============================================================

  tplSaveBtn.addEventListener("click", () => {
    const q = questionEl.value.trim();
    if (!q) {
      shakeElement(questionEl);
      return;
    }
    closeAllPanels();
    tplPanel.classList.remove("hidden");
    tplSaveBtn.classList.add("active-panel");

    tplPanel.innerHTML = "";
    const row = document.createElement("div");
    row.className = "tpl-save-row";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "tpl-save-input";
    input.placeholder = "Template name...";
    input.maxLength = 60;

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "tpl-save-confirm";
    confirmBtn.textContent = "Save";

    confirmBtn.addEventListener("click", () => {
      const name = input.value.trim() || q.slice(0, 40);
      saveTemplate(name, q);
      closeAllPanels();
      showToast("Template saved");
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { confirmBtn.click(); }
    });

    row.appendChild(input);
    row.appendChild(confirmBtn);
    tplPanel.appendChild(row);
    input.focus();
  });

  tplLoadBtn.addEventListener("click", () => {
    const isOpen = !tplPanel.classList.contains("hidden") && !tplSaveBtn.classList.contains("active-panel");
    closeAllPanels();
    if (isOpen) { return; }
    tplLoadBtn.classList.add("active-panel");
    tplPanel.classList.remove("hidden");
    loadTemplatesPanel();
  });

  function saveTemplate(name, question) {
    storageGet(STORAGE_KEY_TEMPLATES, (r) => {
      const templates = (r && r[STORAGE_KEY_TEMPLATES]) || [];
      templates.unshift({ name: name, question: question, timestamp: Date.now() });
      if (templates.length > 30) { templates.length = 30; }
      storageSet({ [STORAGE_KEY_TEMPLATES]: templates });
    });
  }

  function loadTemplatesPanel() {
    storageGet(STORAGE_KEY_TEMPLATES, (r) => {
      const templates = (r && r[STORAGE_KEY_TEMPLATES]) || [];
      tplPanel.innerHTML = "";

      if (templates.length === 0) {
        tplPanel.innerHTML = '<div class="dropdown-empty">No templates saved</div>';
        return;
      }

      templates.forEach((tpl, idx) => {
        const row = document.createElement("div");
        row.className = "dropdown-item";

        const text = document.createElement("span");
        text.className = "dropdown-item-text";
        text.textContent = tpl.name;

        const del = document.createElement("button");
        del.className = "dropdown-item-delete";
        del.innerHTML = "&times;";
        del.title = "Delete";
        del.addEventListener("click", (e) => {
          e.stopPropagation();
          templates.splice(idx, 1);
          storageSet({ [STORAGE_KEY_TEMPLATES]: templates });
          loadTemplatesPanel();
        });

        row.appendChild(text);
        row.appendChild(del);

        row.addEventListener("click", () => {
          questionEl.value = tpl.question;
          questionEl.dispatchEvent(new Event("input"));
          closeAllPanels();
        });

        tplPanel.appendChild(row);
      });
    });
  }

  // close panels when clicking outside
  document.addEventListener("click", (e) => {
    const isInToolbar = e.target.closest(".toolbar-actions") ||
      e.target.closest("#history-panel") ||
      e.target.closest("#tpl-panel");
    if (!isInToolbar) {
      closeAllPanels();
    }
  });

  // ============================================================
  //  QUESTION BUILDER
  // ============================================================

  function buildQuestion() {
    const raw = questionEl.value.trim();
    if (!raw) { return ""; }
    const checked = document.querySelectorAll(".strategy-cb:checked");
    let prefix = "";
    checked.forEach((cb) => {
      if (STRATEGY_MAP[cb.value]) { prefix += STRATEGY_MAP[cb.value]; }
    });
    return prefix + raw;
  }

  function isValidUrl(str) {
    try {
      const u = new URL(str);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch (_) { return false; }
  }

  function getSelectedUrls() {
    const urls = [];
    siteListEl.querySelectorAll(".site-item").forEach((item) => {
      const cb = item.querySelector('input[type="checkbox"]');
      if (cb.checked) { urls.push(item.dataset.url); }
    });
    const custom = customSitesEl.value.split("\n").map((l) => l.trim()).filter(isValidUrl).slice(0, MAX_CUSTOM_SITES);
    return urls.concat(custom);
  }

  // ============================================================
  //  SEND
  // ============================================================

  sendBtn.addEventListener("click", () => {
    if (sendInFlight) { return; }

    const question = buildQuestion();
    if (!question) { shakeElement(questionEl); questionEl.focus(); return; }

    const urls = getSelectedUrls();
    if (urls.length === 0) { shakeElement(toggleAllBtn); return; }

    sendInFlight = true;
    lastSentQuestion = question;
    sendBtn.disabled = true;
    sendBtn.classList.add("sending");
    sendBtn.textContent = "Checking...";
    collectBtn.disabled = false;
    prevDoneSet = new Set();

    statusBar.classList.remove("hidden", "all-done");
    statusBar.classList.add("section-enter");
    updateStatusUI("sending", 0, urls.length);

    responsesSection.classList.remove("hidden");
    responsesSection.classList.add("section-enter");
    responsesContainer.innerHTML = "";
    if (emptyState) { emptyState.classList.add("hidden"); }
    liveCounter.classList.remove("hidden", "done");
    liveCounter.textContent = "0 / " + urls.length;

    urls.forEach((url, i) => {
      const hn = safeHostname(url);
      appendResponseCard(hn, findSiteNameByUrl(url) || hn, i, url);
    });

    sendMsg({ type: "ASKALL_SEND", urls, question }, (resp) => {
      sendInFlight = false;
      if (resp && resp.success) {
        const skippedCount = (resp.skipped && resp.skipped.length) || 0;
        const activeCount = urls.length - skippedCount;
        if (activeCount > 0) {
          updateStatusUI("polling", skippedCount, urls.length);
          startPolling();
        } else {
          updateStatusUI("error", 0, urls.length, "All sites unreachable.");
          resetSendButton();
        }
        if (skippedCount > 0) {
          showToast(`${skippedCount} site(s) unreachable, skipped`);
        }
      } else {
        updateStatusUI("error", 0, urls.length, (resp && resp.error) || "Failed to send.");
        resetSendButton();
      }
    });
  });

  function resetSendButton() {
    sendBtn.disabled = false;
    sendBtn.classList.remove("sending");
    sendBtn.textContent = "Send to All";
    sendInFlight = false;
  }

  // ============================================================
  //  STATUS UI
  // ============================================================

  function updateStatusUI(phase, done, total, errMsg) {
    const dot = statusBar.querySelector(".status-dot");
    dot.style.background = "";

    liveCounter.textContent = `${done} / ${total}`;

    if (phase === "sending") {
      dot.className = "status-dot active";
      statusLabel.textContent = `Opening ${total} sites...`;
    } else if (phase === "polling") {
      dot.className = "status-dot active";
      statusLabel.textContent = `${done} / ${total} complete`;
    } else if (phase === "done") {
      dot.className = "status-dot done";
      statusLabel.textContent = "All responses collected";
      statusBar.classList.add("all-done");
      liveCounter.classList.add("done");
    } else if (phase === "error") {
      dot.className = "status-dot";
      dot.style.background = "var(--danger)";
      statusLabel.textContent = errMsg || "Failed.";
    }
  }

  function updateProgressBar(counts) {
    const total = counts.done + counts.streaming + counts.confirming + counts.pending + counts.empty + counts.error + counts.skipped;
    if (total === 0) { return; }

    function pct(n) { return (n / total * 100).toFixed(1) + "%"; }

    document.getElementById("seg-done").style.width = pct(counts.done);
    document.getElementById("seg-streaming").style.width = pct(counts.streaming + counts.confirming);
    document.getElementById("seg-pending").style.width = pct(counts.pending);
    document.getElementById("seg-empty").style.width = pct(counts.empty);
    document.getElementById("seg-error").style.width = pct(counts.error);
    document.getElementById("seg-skipped").style.width = pct(counts.skipped);

    const bd = document.getElementById("status-breakdown");
    let html = "";
    if (counts.done > 0) { html += `<span><i class="swatch swatch-done"></i>${counts.done} done</span>`; }
    if (counts.confirming > 0) { html += `<span><i class="swatch swatch-confirming"></i>${counts.confirming} confirming</span>`; }
    if (counts.streaming > 0) { html += `<span><i class="swatch swatch-streaming"></i>${counts.streaming} streaming</span>`; }
    if (counts.pending > 0) { html += `<span><i class="swatch swatch-pending"></i>${counts.pending} waiting</span>`; }
    if (counts.empty > 0) { html += `<span><i class="swatch swatch-empty"></i>${counts.empty} empty</span>`; }
    if (counts.error > 0) { html += `<span><i class="swatch swatch-error"></i>${counts.error} error</span>`; }
    if (counts.skipped > 0) { html += `<span><i class="swatch swatch-skipped"></i>${counts.skipped} skipped</span>`; }
    bd.innerHTML = html;
  }

  // ============================================================
  //  ETA COUNTDOWN (1-second tick)
  // ============================================================

  function startEtaCountdown() {
    stopEtaCountdown();
    etaTickId = setInterval(tickEta, 1000);
  }

  function stopEtaCountdown() {
    if (etaTickId) { clearInterval(etaTickId); etaTickId = null; }
    etaTargetMs = 0;
    etaStreamingExtra = 0;
  }

  function tickEta() {
    if (etaTargetMs <= 0) { return; }
    const remaining = Math.max(0, Math.ceil((etaTargetMs - Date.now()) / 1000));
    if (remaining <= 0) {
      if (etaStreamingExtra > 0) {
        etaLabel.classList.remove("hidden");
        etaLabel.textContent = "ETA: waiting " + etaStreamingExtra + " streaming...";
      } else {
        etaLabel.classList.add("hidden");
        etaLabel.textContent = "";
      }
      return;
    }
    etaLabel.classList.remove("hidden");
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    let text = "ETA: ";
    if (m > 0) {
      text += m + "m " + s + "s";
    } else {
      text += s + "s";
    }
    if (etaStreamingExtra > 0) {
      text += " + " + etaStreamingExtra + " streaming";
    }
    if (etaLabel.textContent !== text) {
      etaLabel.textContent = text;
      etaLabel.classList.remove("eta-tick");
      void etaLabel.offsetWidth;
      etaLabel.classList.add("eta-tick");
    }
  }

  // ============================================================
  //  POLLING & AUTO-REFRESH
  // ============================================================

  function startPolling() {
    stopPolling();
    pollIntervalId = setInterval(fetchStatus, 6000);
    startAutoRefresh();
    startEtaCountdown();
  }

  function stopPolling() {
    if (pollIntervalId) { clearInterval(pollIntervalId); pollIntervalId = null; }
    stopAutoRefresh();
    stopEtaCountdown();
  }

  function fetchStatus() {
    sendMsg({ type: "ASKALL_GET_STATUS" }, (resp) => {
      if (resp && resp.tabs) { updateResponseCards(resp.tabs); }
    });
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    autoRefreshActive = true;
    applyRefreshUI();
    autoRefreshId = setInterval(doCollectTick, 6000);
  }

  function stopAutoRefresh() {
    autoRefreshActive = false;
    if (autoRefreshId) { clearInterval(autoRefreshId); autoRefreshId = null; }
    applyRefreshUI();
  }

  function applyRefreshUI() {
    const label = collectBtn.querySelector(".btn-icon-label");
    if (autoRefreshActive) {
      collectBtn.classList.add("auto-active");
      collectBtn.classList.remove("auto-stopped");
      label.innerHTML = '<span class="auto-dot"></span>Auto';
      collectBtn.title = "Click to pause auto-refresh";
    } else {
      collectBtn.classList.remove("auto-active");
      label.textContent = "Refresh";
      collectBtn.title = "Refresh responses from all tabs";
    }
  }

  function doCollectTick() {
    collectBtn.classList.add("auto-tick");
    sendMsg({ type: "ASKALL_COLLECT_ALL" }, (resp) => {
      if (resp && resp.tabs) { updateResponseCards(resp.tabs); }
      setTimeout(() => collectBtn.classList.remove("auto-tick"), 300);
    });
  }

  function doCollect() {
    sendMsg({ type: "ASKALL_COLLECT_ALL" }, (resp) => {
      if (resp && resp.tabs) { updateResponseCards(resp.tabs); }
    });
  }

  collectBtn.addEventListener("click", () => {
    if (autoRefreshActive) {
      stopAutoRefresh();
      collectBtn.classList.add("auto-stopped");
      setTimeout(() => collectBtn.classList.remove("auto-stopped"), 600);
      showToast("Auto-refresh paused");
    } else {
      collectBtn.disabled = true;
      doCollect();
      setTimeout(() => {
        collectBtn.disabled = false;
        flashFeedback(collectBtn, "Updated!", true);
      }, 600);
    }
  });

  resetBtn.addEventListener("click", (e) => {
    addRipple(resetBtn, e);
    stopPolling();
    prevDoneSet = new Set();
    lastSentQuestion = "";
    sendInFlight = false;

    questionEl.value = "";
    questionEl.style.height = "auto";

    responsesContainer.innerHTML = "";
    responsesSection.classList.add("hidden");
    statusBar.classList.remove("all-done");
    statusBar.classList.add("hidden");
    if (emptyState) { emptyState.classList.remove("hidden"); }
    etaLabel.classList.add("hidden");
    etaLabel.textContent = "";
    liveCounter.classList.add("hidden");
    liveCounter.classList.remove("done");

    resetSendButton();
    collectBtn.disabled = true;

    sendMsg({ type: "ASKALL_STOP_ALL" });
    showToast("Reset — ready for new question");
  });

  document.getElementById("reload-btn").addEventListener("click", () => {
    showToast("Reloading extension...");
    const reopenUrl = chrome.runtime.getURL("popup/popup.html?tab=1");
    chrome.storage.local.set({ askall_reopen: reopenUrl }, () => {
      setTimeout(() => { chrome.runtime.reload(); }, 300);
    });
  });

  // ============================================================
  //  RESPONSE CARDS
  // ============================================================

  function safeHostname(url) {
    try { return new URL(url).hostname; } catch (_) { return url; }
  }

  function findSiteName(hn) {
    const m = DEFAULT_SITES.find((s) => s.hostname === hn);
    return m ? m.name : null;
  }

  function findSiteNameByUrl(url) {
    const m = DEFAULT_SITES.find((s) => s.url === url);
    if (m) { return m.name; }
    return findSiteName(safeHostname(url));
  }

  function formatElapsed(ms) {
    if (!ms || ms < 0) { return "..."; }
    const sec = Math.round(ms / 1000);
    if (sec < 60) { return sec + "s"; }
    return Math.floor(sec / 60) + "m " + (sec % 60) + "s";
  }

  function appendResponseCard(hostname, siteName, index, url) {
    const card = document.createElement("div");
    card.className = "response-card collapsed";
    card.dataset.hostname = hostname;
    card.dataset.url = url;
    card.style.animationDelay = (index * 40) + "ms";

    card.innerHTML = `
      <div class="response-card-header">
        <a class="response-site-name site-link" href="#" title="Jump to tab">${escapeHtml(siteName)}</a>
        <span class="response-status pending">pending</span>
      </div>
      <div class="response-body response-body-empty"></div>
      <div class="response-stats">
        <span class="response-stat" data-stat="words">--</span>
        <span class="response-stat" data-stat="time">--</span>
      </div>
      <div class="response-card-actions">
        <button class="btn-retry hidden" data-url="${escapeHtml(url)}">Retry</button>
        <button class="btn-copy-single">Copy</button>
      </div>
    `;

    card.querySelector(".site-link").addEventListener("click", (e) => {
      e.preventDefault();
      const tid = card.dataset.tabId;
      if (tid && !isNaN(parseInt(tid, 10))) {
        chrome.tabs.update(parseInt(tid, 10), { active: true });
      }
    });

    card.querySelector(".btn-copy-single").addEventListener("click", () => {
      const text = card.querySelector(".response-body").textContent || "";
      if (!text) { return; }
      copyText(text);
      const btn = card.querySelector(".btn-copy-single");
      btn.classList.add("copied");
      btn.textContent = "Copied";
      setTimeout(() => { btn.classList.remove("copied"); btn.textContent = "Copy"; }, 1200);
    });

    card.querySelector(".btn-retry").addEventListener("click", function () {
      this.classList.add("retrying");
      this.textContent = "Retrying...";
      sendMsg({ type: "ASKALL_RETRY_SITE", url: url }, (resp) => {
        this.classList.remove("retrying");
        this.textContent = "Retry";
        if (resp && resp.success) {
          this.classList.add("hidden");
          card.classList.remove("card-error");
          card.classList.add("collapsed");
          card.querySelector(".response-status").className = "response-status polling";
          card.querySelector(".response-status").textContent = "retrying";
          card.querySelector(".response-body").className = "response-body response-body-empty";
          card.querySelector(".response-body").textContent = "";
          prevDoneSet.delete(url);
          startPolling();
        }
      });
    });

    responsesContainer.appendChild(card);
  }

  function updateResponseCards(tabs) {
    let totalCount = 0;
    let doneCount = 0;
    const counts = { done: 0, streaming: 0, confirming: 0, pending: 0, empty: 0, error: 0, skipped: 0 };

    for (const [tabId, info] of Object.entries(tabs)) {
      totalCount++;
      let card = null;
      const allCards = responsesContainer.querySelectorAll(".response-card");
      for (const c of allCards) {
        if (c.dataset.url === info.url) { card = c; break; }
      }
      if (!card) { continue; }

      card.dataset.tabId = tabId;

      const statusEl = card.querySelector(".response-status");
      const bodyEl = card.querySelector(".response-body");
      const retryBtn = card.querySelector(".btn-retry");
      const wordsStat = card.querySelector('[data-stat="words"]');
      const timeStat = card.querySelector('[data-stat="time"]');

      const isDone = info.status === "done";
      const isTimeout = info.status === "timeout";
      const isError = info.status === "error";
      const isSkipped = info.status === "skipped";
      const isPolling = info.status === "polling";

      if (isDone || isTimeout || isError || isSkipped) { doneCount++; }

      if (isDone) { counts.done++; }
      else if (isTimeout) { counts.error++; }
      else if (isError) { counts.error++; }
      else if (isSkipped) { counts.skipped++; }
      else if (isPolling && info.stabilityProgress > 0) { counts.confirming++; }
      else if (isPolling) { counts.streaming++; }
      else if (info.status === "empty") { counts.empty++; }
      else { counts.pending++; }

      statusEl.className = "response-status";
      if (isDone) {
        statusEl.classList.add("done");
        statusEl.textContent = "done";
      } else if (isTimeout) {
        statusEl.classList.add("error");
        statusEl.textContent = "timeout";
      } else if (isSkipped) {
        statusEl.classList.add("skipped");
        statusEl.textContent = "skipped";
      } else if (isError) {
        statusEl.classList.add("error");
        statusEl.textContent = "error";
      } else if (isPolling && info.stabilityProgress > 0) {
        statusEl.classList.add("confirming");
        const secLeft = (10 - info.stabilityProgress) * 6;
        statusEl.textContent = `confirming ${info.stabilityProgress}/10 · ${secLeft}s`;
      } else if (isPolling) {
        statusEl.classList.add("polling");
        statusEl.textContent = "streaming";
      } else {
        statusEl.classList.add("pending");
        statusEl.textContent = info.status || "pending";
      }

      // expand card when content arrives, done, error, timeout, or skipped
      const hasContent = !!info.response;
      if (hasContent || isDone || isTimeout || isError || isSkipped) {
        card.classList.remove("collapsed");
      }

      if (isSkipped) {
        card.classList.add("card-skipped");
      }

      if (info.response) {
        bodyEl.classList.remove("response-body-empty");
        bodyEl.textContent = info.response;
      }

      // stats
      if (info.wordCount > 0) {
        wordsStat.textContent = info.wordCount + " words";
      }
      timeStat.textContent = formatElapsed(info.elapsedMs);

      // retry button visibility
      if (isError || isTimeout) {
        retryBtn.classList.remove("hidden");
      } else {
        retryBtn.classList.add("hidden");
      }

      // done animation
      if (isDone && !prevDoneSet.has(info.url)) {
        prevDoneSet.add(info.url);
        card.classList.remove("card-done");
        void card.offsetWidth;
        card.classList.add("card-done");
      }
      if ((isError || isTimeout) && !prevDoneSet.has(info.url)) {
        prevDoneSet.add(info.url);
        card.classList.add("card-error");
      }
    }

    // compute ETA from the slowest CONFIRMING site only;
    // streaming sites (progress = 0) have unknown finish time
    let maxConfirmingSec = 0;
    let streamingCount = 0;
    for (const [_tabId, info] of Object.entries(tabs)) {
      const isFinal = info.status === "done" || info.status === "timeout" ||
                       info.status === "error" || info.status === "skipped";
      if (isFinal) { continue; }
      const progress = info.stabilityProgress || 0;
      if (progress > 0) {
        const remaining = (10 - progress) * 6;
        if (remaining > maxConfirmingSec) { maxConfirmingSec = remaining; }
      } else {
        streamingCount++;
      }
    }
    if (maxConfirmingSec > 0 && doneCount < totalCount) {
      etaTargetMs = Date.now() + maxConfirmingSec * 1000;
      etaStreamingExtra = streamingCount;
      tickEta();
    } else if (streamingCount > 0 && doneCount < totalCount) {
      etaTargetMs = 0;
      etaStreamingExtra = streamingCount;
      etaLabel.classList.remove("hidden");
      etaLabel.textContent = "ETA: waiting " + streamingCount + " streaming...";
    } else {
      etaTargetMs = 0;
      etaStreamingExtra = 0;
      etaLabel.classList.add("hidden");
      etaLabel.textContent = "";
    }

    if (totalCount > 0) {
      updateProgressBar(counts);
      if (doneCount >= totalCount) {
        stopPolling();
        updateStatusUI("done", doneCount, totalCount);
        resetSendButton();
      } else {
        updateStatusUI("polling", doneCount, totalCount);
      }
    }
  }

  // ============================================================
  //  EXPORT MARKDOWN
  // ============================================================

  exportMdBtn.addEventListener("click", (e) => {
    addRipple(exportMdBtn, e);
    const cards = responsesContainer.querySelectorAll(".response-card");
    if (cards.length === 0) { return; }

    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    let md = `# AskAll Comparison Report\n\n`;
    md += `**Date:** ${now}\n`;
    md += `**Question:** ${lastSentQuestion}\n\n---\n\n`;

    cards.forEach((card) => {
      const name = card.querySelector(".response-site-name").textContent;
      const status = card.querySelector(".response-status").textContent;
      const body = card.querySelector(".response-body").textContent;
      const words = card.querySelector('[data-stat="words"]').textContent;
      const time = card.querySelector('[data-stat="time"]').textContent;

      md += `## ${name}\n\n`;
      md += `> Status: ${status} | ${words} | ${time}\n\n`;
      md += `${body}\n\n---\n\n`;
    });

    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `askall-report-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    flashFeedback(exportMdBtn, "Done!", true);
  });

  // ============================================================
  //  COPY DEBUG
  // ============================================================

  copyDebugBtn.addEventListener("click", (e) => {
    copyDebugBtn.querySelector(".btn-action-label").textContent = "Collecting...";
    copyDebugBtn.disabled = true;

    sendMsg({ type: "ASKALL_DEBUG_ALL" }, (resp) => {
      copyDebugBtn.querySelector(".btn-action-label").textContent = "Debug";
      copyDebugBtn.disabled = false;

      if (!resp || !resp.debugEntries || resp.debugEntries.length === 0) {
        flashFeedback(copyDebugBtn, "Empty", false);
        return;
      }

      const now = new Date().toISOString();
      const total = resp.debugEntries.length;
      const done = resp.debugEntries.filter((e) => e.status === "done").length;
      const errs = resp.debugEntries.filter((e) => e.status === "error" || e.status === "timeout").length;

      let report = `=== AskAll Debug Report ===\n`;
      report += `Time: ${now}\n`;
      report += `Question: ${resp.question || lastSentQuestion || "N/A"}\n`;
      report += `Sites: ${total} total, ${done} done, ${errs} error/timeout\n`;
      report += `${"=".repeat(60)}\n\n`;

      resp.debugEntries.forEach((entry, idx) => {
        report += `--- [${idx + 1}/${total}] ${entry.hostname} [${entry.status}] ---\n`;
        report += `URL: ${entry.url}\n`;
        report += `Status: ${entry.status}\n`;
        report += `Response: ${entry.response ? entry.response.slice(0, 200) + (entry.response.length > 200 ? "..." : "") : "N/A"}\n`;
        report += `Sent: ${entry.createdAt}\n`;
        report += `Done: ${entry.doneAt || "still running"}\n`;
        report += `Elapsed: ${entry.elapsedMs}ms\n`;

        const d = entry.pageDiag;
        if (d && !d.error) {
          report += `\n[Page Info]\n`;
          report += `  Title: ${d.pageTitle}\n`;
          report += `  URL: ${d.currentUrl}\n`;
          if (d.userAgent) { report += `  UA: ${d.userAgent}\n`; }
          report += `  Body text: ${d.bodyTextLength} chars\n`;
          report += `  Forms: ${d.formsCount}\n`;

          report += `\n[Adapter Config]\n`;
          report += `  Adapter: ${d.adapterUsed}\n`;
          if (d.adapterConfig) {
            report += `  useEnterToSubmit: ${d.adapterConfig.useEnterToSubmit}\n`;
            report += `  waitBeforeSubmit: ${d.adapterConfig.waitBeforeSubmit}ms\n`;
            report += `  hasFillInput: ${d.adapterConfig.hasFillInput}\n`;
          }

          report += `\n[Selectors]\n`;
          report += `  input: ${d.selectors.input}\n`;
          report += `  submit: ${d.selectors.submit}\n`;
          report += `  response: ${d.selectors.response}\n`;
          report += `  thinking: ${d.selectors.thinking}\n`;

          report += `\n[Input Element]\n`;
          if (d.domProbe.inputDetail) {
            const inp = d.domProbe.inputDetail;
            report += `  found: true\n`;
            report += `  tag: ${inp.tag}, id: ${inp.id || "-"}, type: ${inp.type || "-"}\n`;
            report += `  class: ${inp.className || "-"}\n`;
            report += `  placeholder: ${inp.placeholder || "-"}\n`;
            report += `  contentEditable: ${inp.contentEditable}\n`;
            report += `  value.length: ${inp.hasValue}, textContent.length: ${inp.hasTextContent}\n`;
          } else {
            report += `  found: false\n`;
          }

          report += `\n[Submit Button]\n`;
          if (d.domProbe.submitDetail) {
            const sub = d.domProbe.submitDetail;
            report += `  found: true\n`;
            report += `  tag: ${sub.tag}, id: ${sub.id || "-"}, type: ${sub.type || "-"}\n`;
            report += `  class: ${sub.className || "-"}\n`;
            report += `  ariaLabel: ${sub.ariaLabel || "-"}\n`;
            report += `  disabled: ${sub.disabled}, ariaDisabled: ${sub.ariaDisabled || "-"}\n`;
            report += `  visible: ${sub.visible}, hasSvg: ${sub.hasSvg}\n`;
            report += `  text: ${sub.textContent || "-"}\n`;
          } else {
            report += `  found: false\n`;
          }

          report += `\n[Response]\n`;
          report += `  count: ${d.domProbe.responseCount}\n`;
          report += `  thinkingVisible: ${d.domProbe.thinkingVisible}\n`;
          if (d.domProbe.responseDetail && d.domProbe.responseDetail.length > 0) {
            d.domProbe.responseDetail.forEach((r) => {
              report += `  [${r.index}] ${r.tag} .${r.className} (${r.textLength} chars)\n`;
            });
          }

          report += `\n[Polling State]\n`;
          if (d.pollingState) {
            report += `  isPolling: ${d.pollingState.isPolling}\n`;
            report += `  lastResponseLength: ${d.pollingState.lastResponseLength}\n`;
            report += `  stabilityCounter: ${d.pollingState.stabilityCounter}\n`;
          }

          if (d.pageButtons && d.pageButtons.length > 0) {
            report += `\n[Page Buttons (${d.pageButtons.length})]\n`;
            d.pageButtons.forEach((b, i) => {
              report += `  [${i}] ${b.tag} label="${b.ariaLabel}" text="${b.text}" disabled=${b.disabled} visible=${b.visible}\n`;
            });
          }

          if (d.errorHints && d.errorHints.length > 0) {
            report += `\n[Page Alerts/Errors]\n`;
            d.errorHints.forEach((hint) => {
              report += `  - ${hint.slice(0, 200)}\n`;
            });
          }

          if (d.domSnapshot) {
            const snap = d.domSnapshot;
            if (snap.allInputs && snap.allInputs.length > 0) {
              report += `\n[All Input Elements (${snap.allInputs.length})]\n`;
              snap.allInputs.forEach((inp, i) => {
                report += `  [${i}] ${inp.tag} id="${inp.id}" class="${inp.class}" placeholder="${inp.placeholder}" editable=${inp.contentEditable} visible=${inp.visible}`;
                if (inp.dataAttrs) { report += ` data=[${inp.dataAttrs}]`; }
                report += `\n`;
              });
            }
            if (snap.allSendElements && snap.allSendElements.length > 0) {
              report += `\n[All Send-like Elements (${snap.allSendElements.length})]\n`;
              snap.allSendElements.forEach((el, i) => {
                report += `  [${i}] ${el.tag} id="${el.id}" label="${el.ariaLabel}" text="${el.text}" class="${el.class}" visible=${el.visible} disabled=${el.disabled}\n`;
              });
            }
            if (snap.inputAreaHtml) {
              report += `\n[Input Area HTML (${snap.inputAreaHtml.length} chars)]\n`;
              report += snap.inputAreaHtml.slice(0, 3000) + "\n";
            }
            if (snap.bodyHtmlTruncated) {
              report += `\n[Body HTML (truncated, ${snap.fullPageHtmlLength} total chars)]\n`;
              report += snap.bodyHtmlTruncated.slice(0, 5000) + "\n";
            }
          }
        } else if (d) {
          report += `Page diagnostics: ${d.error}\n`;
        }
        report += `\n`;
      });

      copyText(report);
      flashFeedback(copyDebugBtn, "Copied!", true);
    });
  });

  // ============================================================
  //  CLIPBOARD
  // ============================================================

  copyAllBtn.addEventListener("click", (e) => {
    const cards = responsesContainer.querySelectorAll(".response-card");
    if (cards.length === 0) { return; }
    let text = "";
    cards.forEach((card) => {
      const name = card.querySelector(".response-site-name").textContent;
      const body = card.querySelector(".response-body").textContent;
      text += `=== ${name} ===\n${body}\n\n`;
    });
    copyText(text.trim());
    flashFeedback(copyAllBtn, "Copied!", true);
  });

  function copyText(text) {
    if (!text) { return; }
    navigator.clipboard.writeText(text).then(() => {
      showToast("Copied to clipboard");
    }).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (_) { /* fallback failed */ }
      document.body.removeChild(ta);
      showToast("Copied to clipboard");
    });
  }

  function flashFeedback(btn, text, success) {
    const label = btn.querySelector(".btn-action-label") || btn.querySelector(".btn-icon-label");
    const origText = label ? label.textContent : btn.textContent;
    const feedbackClass = success ? "feedback-ok" : "feedback-fail";

    if (label) {
      label.textContent = text;
    } else {
      btn.textContent = text;
    }
    btn.classList.add(feedbackClass);

    setTimeout(() => {
      if (label) {
        label.textContent = origText;
      } else {
        btn.textContent = origText;
      }
      btn.classList.remove(feedbackClass);
    }, 1500);
  }

  let toastTimer = null;

  function showToast(message) {
    toastText.textContent = message || "Done";
    if (toastTimer) { clearTimeout(toastTimer); }
    toastEl.classList.add("show");
    toastTimer = setTimeout(() => { toastEl.classList.remove("show"); toastTimer = null; }, 1800);
  }

  // ============================================================
  //  UTIL
  // ============================================================

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function isDetachedWindow() {
    return window.location.search.includes("detached=1") ||
      window.location.search.includes("tab=1");
  }

  if (isDetachedWindow()) {
    document.body.classList.add("detached");
  }

  // ============================================================
  //  RESTORE STATE
  // ============================================================

  sendMsg({ type: "ASKALL_GET_STATUS" }, (resp) => {
    if (!resp || !resp.tabs) { return; }
    const entries = Object.entries(resp.tabs);
    if (entries.length === 0) { return; }

    if (resp.question) { lastSentQuestion = resp.question; }

    responsesSection.classList.remove("hidden");
    statusBar.classList.remove("hidden");
    collectBtn.disabled = false;
    if (emptyState) { emptyState.classList.add("hidden"); }
    liveCounter.classList.remove("hidden");

    entries.forEach(([_tabId, info], i) => {
      let existing = false;
      responsesContainer.querySelectorAll(".response-card").forEach((c) => {
        if (c.dataset.url === info.url) { existing = true; }
      });
      if (!existing) {
        appendResponseCard(info.hostname, findSiteNameByUrl(info.url) || info.hostname, i, info.url);
      }
    });

    updateResponseCards(resp.tabs);

    const hasPending = entries.some(([_, info]) => info.status === "polling" || info.status === "loading");
    if (hasPending) { startPolling(); }
  });
})();
