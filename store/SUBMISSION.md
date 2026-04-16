# AskAll v1.5.0 — Chrome Web Store Submission Guide

> Generated: 2026-04-16
> Zip: `releases/askall-v1.5.0.zip` (43KB)
> Dashboard: https://chrome.google.com/webstore/devconsole

---

## 1. Upload Package

1. Open https://chrome.google.com/webstore/devconsole
2. Click **New Item** (or update existing)
3. Upload `releases/askall-v1.5.0.zip`
4. Proceed to fill in each section below

---

## 2. Store Listing

### Name

```
AskAll — Ask Multiple AI Chatbots, Compare Side by Side
```

### Short Description (132 chars max)

```
Send one question to ChatGPT, Gemini, Claude, DeepSeek, Grok and 17+ AI chatbots at once. Compare all responses side by side.
```

### Detailed Description

```
AskAll lets you send a single question to multiple AI chatbot websites simultaneously and compare their responses in one view.

How it works:
1. Type your question in AskAll
2. Select which AI providers to query (22+ supported)
3. Click "Send to All" — AskAll opens each AI site in a background tab, types your question, and collects the responses
4. Compare all responses side by side with word count, response time, and export options

Supported AI Providers:
- General (Freemium): ChatGPT, Gemini, Claude, Grok, Copilot, Mistral
- General (Free): DeepSeek, Kimi, Qwen, Doubao, Yuanbao, ChatGLM, Baidu Chat, Sogou AI, MiniMax, MiMo
- Specialized: Perplexity, Manus, NVIDIA Build, Genspark, Duck.ai, Reddit Answers
- Custom: Add any AI chatbot URL

Features:
- Prompt Enhancement: Chain-of-Thought, Step-by-Step, Expert Role, Be Concise, Pros & Cons
- Query History: Revisit and reuse past questions
- Templates: Save frequently used prompts
- Export: Copy all responses or download as Markdown report
- Debug Tools: Built-in diagnostics for troubleshooting
- Three UI themes: Light, Lumen, Carbon

Privacy First:
- No data is sent to any server controlled by AskAll
- No analytics, tracking, or telemetry
- All preferences stored locally in your browser
- Your questions go directly from your browser to each AI provider

Important: You must be logged in to each AI service before using AskAll. The extension automates typing and collecting responses — it does not bypass logins, paywalls, or usage limits.
```

### Category

```
Productivity
```

### Language

```
English
```

---

## 3. Store Assets

| Asset | Path | Size |
|-------|------|------|
| Icon 128x128 | `icons/icon128.png` | Already in zip |
| Screenshot 1 | `store-assets/screenshots/01-main-ui.png` | 1280x800 |
| Screenshot 2 | `store-assets/screenshots/02-responses.png` | 1280x800 |
| Screenshot 3 | `store-assets/screenshots/03-streaming.png` | 1280x800 |
| Screenshot 4 | `store-assets/screenshots/04-themes.png` | 1280x800 |
| Screenshot 5 | `store-assets/screenshots/05-features.png` | 1280x800 |
| Small Promo | `store-assets/promo-small-440x280.png` | 440x280 |
| Marquee Promo | `store-assets/promo-marquee-1400x560.png` | 1400x560 |

Upload screenshots in the **Store Listing > Screenshots** section. Upload promo tiles in the **Promotional Images** section.

---

## 4. Privacy Tab

### Single Purpose Description

```
Compare responses from multiple AI chatbots by sending one question to all of them simultaneously.
```

### Privacy Policy URL

```
https://host452b.github.io/ask_all_ai/privacy-policy.html
```

> Make sure GitHub Pages is enabled for the repo (Settings > Pages > Source: Deploy from branch `main`, folder `/docs`).

### Are you collecting or using any user data?

**No.** AskAll does not collect, transmit, or share any user data. All data (preferences, history, templates) is stored locally via `chrome.storage.local` and never leaves the user's browser.

---

## 5. Permission Justifications

Paste each justification into the corresponding field in the **Privacy practices** section.

### `tabs`

```
AskAll creates new browser tabs for each AI chatbot website the user selects, monitors their loading status, switches between them during the warm-up phase, and closes them when the user clicks Reset. The tabs permission is required to call chrome.tabs.create, chrome.tabs.update, chrome.tabs.remove, and chrome.tabs.query. Without this permission, the core functionality of opening multiple AI sites simultaneously would not be possible.
```

### `scripting`

```
AskAll uses chrome.scripting.executeScript to inject content scripts into AI chatbot pages after the user clicks "Send to All". The content scripts fill in the user's question into each site's input field, submit it, and observe the DOM for the AI's response. This is the core mechanism by which AskAll collects responses from multiple AI providers. The scripts are only injected into the specific AI chatbot sites listed in host_permissions — never into arbitrary websites.
```

### `storage`

```
AskAll uses chrome.storage.local to persist user preferences locally in the browser: selected AI providers, UI theme choice, prompt enhancement selections, query history (last 50 questions), saved prompt templates (max 30), and custom site URLs. No data is synced to any external server. Users can clear all stored data by uninstalling the extension or using the built-in Reset function.
```

### Host permissions (22 AI chatbot domains)

```
Each host permission corresponds to a specific AI chatbot website that AskAll supports. The extension needs access to these sites to inject content scripts that:
1. Fill the user's question into the site's chat input field
2. Click the submit/send button or simulate Enter key press
3. Observe the DOM to detect when the AI has finished generating its response
4. Extract the response text to display in the AskAll comparison view

The 22 sites are:
chatgpt.com, gemini.google.com, claude.ai, grok.com, copilot.microsoft.com, chat.mistral.ai, chat.deepseek.com, www.kimi.com, chat.qwen.ai, www.doubao.com, yuanbao.tencent.com, chatglm.cn, chat.baidu.com, www.sogou.com, agent.minimax.io, aistudio.xiaomimimo.com, www.perplexity.ai, manus.im, build.nvidia.com, www.genspark.ai, duck.ai, www.reddit.com

Each site requires its own host permission because Chrome's content script injection model requires explicit URL pattern matching. No other websites are accessed. The user must already be logged in to each service — the extension does not handle authentication.
```

---

## 6. Distribution Settings

| Field | Value |
|-------|-------|
| Visibility | Public |
| Distribution | All regions |
| Mature content | No |

---

## 7. Pre-submission Checklist

- [x] `manifest.json` version is `1.5.0`
- [x] `manifest.json` at zip root level
- [x] Zip contains only production files (no .ts, .map, .env, .git, node_modules)
- [x] Zip size: 43KB (well under 10MB)
- [x] Security audit passed (no eval, no remote scripts, no unsafe-eval, no hardcoded secrets)
- [x] No `<all_urls>` — only specific AI chatbot domains
- [x] No `webRequest`, `cookies`, `history`, or other high-risk permissions
- [x] Privacy policy hosted at GitHub Pages URL
- [x] All 5 screenshots ready (1280x800)
- [x] Promo tiles ready (440x280, 1400x560)
- [ ] Enable GitHub Pages for `docs/` folder (if not already)
- [ ] Verify privacy policy URL loads in browser
- [ ] Upload zip to Developer Dashboard
- [ ] Fill in all fields from this document
- [ ] Submit for review

---

## 8. Version Update Procedure (Future Releases)

1. Bump `version` in `manifest.json`
2. Run `bash scripts/pack.sh`
3. Verify zip in `releases/`
4. Upload to Developer Dashboard > existing item > Package tab
5. Update description if needed
6. Submit for review (incremental updates typically review faster)

Chrome auto-pushes updates to installed users within 24-48 hours.
