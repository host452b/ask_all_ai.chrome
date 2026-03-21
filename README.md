# AskAll

Send one question to multiple AI chatbots simultaneously. Collect, compare, and export all responses in one place.

## Features

### Core

- **Batch Send** – open 26 AI sites in batched tabs (10 at a time), auto-fill and submit your question
- **Pre-flight Check** – automatically detects unreachable sites and skips them before opening tabs
- **Prompt Enhancement** – optional prefix strategies: Chain-of-Thought, Step-by-Step, Expert Role, Be Concise, Pros & Cons
- **Auto-Polling** – detects when each AI finishes responding via DOM stability check (2-minute timeout)
- **Custom Sites** – add any chat URL to the batch list (up to 10)

### Productivity

- **Query History** – automatically saves your last 50 queries; one-click to re-fill
- **Prompt Templates** – save and reuse frequently asked question patterns (up to 30)
- **Full Settings Persistence** – all preferences auto-saved: theme, panel size, site selection, strategies, custom sites
- **Keyboard Shortcut** – `Ctrl+Enter` / `Cmd+Enter` to send instantly

### Output

- **Copy All** – copy every response as formatted text
- **Copy Single** – copy an individual AI's response
- **Export Markdown** – download a structured comparison report as `.md` file with metadata (word count, elapsed time, status)
- **Copy Debug** – one-click diagnostic report for all error/timeout sites (selectors, DOM probe, page errors)

### Reliability

- **Per-Site Retry** – one-click retry for any failed site without resending all
- **Response Stats** – real-time word count and elapsed time per AI
- **Error Recovery** – graceful handling of tab closure, injection failure, and timeout
- **Tab Warm-up** – briefly activates each background tab 3 times within 30 seconds to combat Chrome's background throttling on SPA sites
- **Memory Safety** – automatic cleanup of stale tabs, response truncation (500KB), duplicate injection guard
- **Batched Opening** – tabs open 10 at a time with 1.5s intervals to prevent browser stalling

### Design

- **3 Themes** – **Light** (Flexoki ink-on-paper), **Lumen** (warm dark glass), **Carbon** (industrial neon)
- **3 Panel Sizes** – S (440px) / M (580px, default) / L (750px, 3-column site grid)
- **Micro-Interactions** – ripple effects, press scaling, staggered card entrance
- **Completion Feedback** – shake animation on response arrival, progress bar glow, celebration pulse
- **Collapsed Cards** – pending sites show as compact list rows; expand on response arrival

## Supported AI Providers (26)

### General — Freemium

| Site | URL |
|------|-----|
| ChatGPT | https://chatgpt.com/ |
| Gemini | https://gemini.google.com/ |
| Claude | https://claude.ai/ |
| Grok | https://grok.com/ |
| Copilot | https://copilot.microsoft.com/ |
| Mistral | https://chat.mistral.ai/chat |

### General — Free

| Site | URL |
|------|-----|
| DeepSeek | https://chat.deepseek.com/ |
| Kimi | https://www.kimi.com/ |
| Qwen Think | https://chat.qwen.ai/?thinking=true |
| Doubao | https://www.doubao.com/chat/ |
| Yuanbao | https://yuanbao.tencent.com/ |
| ChatGLM | https://chatglm.cn/ |
| Yiyan | https://yiyan.baidu.com/ |
| Baidu Chat | https://chat.baidu.com/search |
| Sogou AI | https://www.sogou.com/aimode |
| MiniMax | https://agent.minimax.io/ |
| HuggingChat | https://huggingface.co/chat/ |

### Specialized — Freemium

| Site | URL |
|------|-----|
| Perplexity | https://www.perplexity.ai/ |
| Manus | https://manus.im/ |

### Specialized — Free

| Site | URL |
|------|-----|
| NVIDIA-Nemotron | https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b |
| NVIDIA-MiniMax-M2.5 | https://build.nvidia.com/minimaxai/minimax-m2.5 |
| NVIDIA-Kimi-K2.5 | https://build.nvidia.com/moonshotai/kimi-k2.5 |
| NVIDIA-GLM5 | https://build.nvidia.com/z-ai/glm5 |
| Genspark | https://www.genspark.ai/ |
| Duck.ai | https://duck.ai/ |
| Reddit | https://www.reddit.com/answers/ |

## Installation

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `ask_all_ai` folder
5. Click the AskAll icon in your toolbar
6. **Log in to each AI site beforehand** — the extension does not handle login or authorization

## Usage

1. Type your question (or load one from **History** / **Templates**)
2. (Optional) Select prompt enhancement chips
3. Check which AI providers to query (grouped by category)
4. Click **Send to All** (or press `Ctrl+Enter`)
5. Sites are checked for reachability, then opened in batches
6. Watch the progress bar and streaming status per card
7. When done: **Copy All**, **Copy** individual, **Export MD**, or **Copy Debug** for errors

## Architecture

```
ask_all_ai/
├── manifest.json              Manifest V3
├── popup/
│   ├── popup.html             Main UI
│   ├── popup.css              3-theme styles (Light + Lumen + Carbon)
│   └── popup.js               UI logic, history, templates, export, debug
├── background/
│   └── service-worker.js      Tab orchestration, batching, timing, retry, history
├── content/
│   ├── site-adapters.js       Per-site DOM selectors (23 sites + fallback)
│   └── content-script.js      Injection, polling, extraction, diagnostics
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Data Flow

```
Popup (user input)
  → Background (pre-flight reachability check)
    → Background (opens tabs in batches of 10)
      → Background (tab warm-up: 3 rounds of brief activation over 30s)
      → Content Script (fills input, submits)
        → Content Script (polls for completion via DOM stability)
          → Background (aggregates responses + stats)
            → Popup (displays cards, stats, animations)
              → Export / Copy / Copy Debug / Retry
```

### Storage Keys

| Key | Purpose |
|-----|---------|
| `askall_theme` | Selected theme (light / lumen / carbon) |
| `askall_size` | Panel size (s / m / l) |
| `askall_selected_sites` | Checked AI site hostnames |
| `askall_strategies` | Selected prompt enhancement strategies |
| `askall_custom_sites` | Custom sites textarea content |
| `askall_history` | Last 50 queries with timestamps |
| `askall_templates` | Saved prompt templates (up to 30) |

## Adding New Sites

Edit `content/site-adapters.js`:

```js
"example.com": {
  inputSelector: 'textarea',
  submitSelector: 'button[type="submit"]',
  responseSelector: '[class*="response"]',
  thinkingSelector: '[class*="loading"]',
  useEnterToSubmit: false,
  waitBeforeSubmit: 500,
  fillInput(el, text) {
    if (el.tagName === "TEXTAREA") {
      __askall_fillReactTextarea(el, text);
    } else {
      __askall_fillContentEditable(el, text);
    }
  }
}
```

Then add the URL to `manifest.json` (`host_permissions` + `content_scripts.matches`) and `popup.js` (`SITE_GROUPS`).

For sites not in `host_permissions`, the extension uses `optional_host_permissions` to request access at runtime.

## Known Limitations

- Each AI site must be logged in separately before using AskAll
- Site DOM structures change over time; adapters may need periodic updates
- Some sites employ anti-automation measures that may block injection
- The popup closes when clicking outside; reopen to see current status (state is fully preserved)
- Custom sites require the user to grant additional host permissions on first use
- The extension does not select AI models — users should pre-configure their preferred model on each site



## DOM Debugging Snippet

Run this in the browser console (F12) on any AI chat page to test input injection and copy the full DOM for troubleshooting:

```js
setTimeout(() => {
  const selectors = [
    '[data-slate-editor="true"][contenteditable="true"]',
    '[data-lexical-editor="true"][contenteditable="true"]',
    '[role="textbox"][contenteditable="true"]',
    '[contenteditable="true"]',
    'textarea'
  ];
  let input = null;
  for (const s of selectors) {
    input = document.querySelector(s);
    if (input) break;
  }
  if (!input) { console.error("input not found"); return; }

  input.focus();
  if (input.contentEditable === "true") {
    const sel = window.getSelection();
    sel.selectAllChildren(input);
    sel.collapseToEnd();
    document.execCommand("insertText", false, "hello from AskAll");
  } else {
    const nSet = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype, "value"
    ).set;
    nSet.call(input, "hello from AskAll");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  navigator.clipboard.writeText(document.documentElement.outerHTML)
    .then(() => console.log("DOM copied to clipboard"))
    .catch(() => {
      const t = document.createElement("textarea");
      t.value = document.documentElement.outerHTML;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      document.body.removeChild(t);
      console.log("DOM copied (fallback)");
    });
}, 500);
```