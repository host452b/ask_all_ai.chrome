# AskAll — AI Provider Fix Flow

A step-by-step human-in-the-loop debugging guide for diagnosing and fixing input injection, submission, or response collection failures on individual AI provider sites.

## When to Use This

- A site shows **error** or **timeout** after Send
- A site shows **done** but the response is empty or garbage
- The COPY_DEBUG report shows `input not found`, `submit not found`, or `response count: 0`

---

## Step 1: Reproduce and Classify the Failure

Open AskAll, send a simple question (e.g. "hello"), and check the result for the failing site.

| Card Status | Meaning | Go To |
|-------------|---------|-------|
| `error` — "Failed to inject question" | Input element not found or click failed | Step 2 |
| `error` — "No permission to inject" | Content script blocked by the site | Step 6 |
| `timeout` — no response text | Input worked but response selector missed | Step 4 |
| `done` — wrong/garbage text | Response selector matched the wrong element | Step 4 |
| `streaming` — stuck forever | `isStillThinking()` false positive | Step 5 |

---

## Step 2: Collect Input Element Info

Open the failing AI site in a new tab. Log in if needed. Press **F12** > **Console** and run:

```js
(() => {
  const r = { inputs: [], sends: [] };
  document.querySelectorAll(
    'textarea, [contenteditable="true"], [role="textbox"], [data-slate-editor], [data-lexical-editor]'
  ).forEach(el => {
    r.inputs.push({
      tag: el.tagName, id: el.id || '',
      cls: (el.className || '').toString().slice(0, 100),
      placeholder: el.placeholder || el.getAttribute('data-placeholder') || '',
      contentEditable: el.contentEditable,
      visible: el.offsetParent !== null,
      dataAttrs: Array.from(el.attributes)
        .filter(a => a.name.startsWith('data-'))
        .map(a => `${a.name}=${a.value.slice(0, 30)}`)
        .join(', ')
    });
  });
  document.querySelectorAll('button, [role="button"], div[class*="send"], a[class*="send"]').forEach(el => {
    const t = (el.textContent || '').trim().slice(0, 30);
    const a = el.getAttribute('aria-label') || '';
    r.sends.push({
      tag: el.tagName, id: el.id || '', label: a, text: t,
      disabled: el.disabled || false,
      visible: el.offsetParent !== null,
      cls: (el.className || '').toString().slice(0, 80)
    });
  });
  console.log(JSON.stringify(r, null, 2));
})();
```

**What to look for:**
- `inputs[]` — which element is the actual chat input? Note its `tag`, `cls`, and `data-*` attributes
- `sends[]` — which element is the actual send button? Note its `tag`, `label`, `cls`

---

## Step 3: Test Input Injection Manually

In the same Console, try filling text into the input you identified:

### For textarea (React):
```js
const el = document.querySelector('textarea');
const nSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
nSet.call(el, 'hello from AskAll');
el.dispatchEvent(new Event('input', { bubbles: true }));
```

### For contenteditable (Slate/Lexical/ProseMirror):
```js
const el = document.querySelector('[contenteditable="true"]');
el.focus();
const sel = window.getSelection();
sel.selectAllChildren(el);
sel.collapseToEnd();
document.execCommand('insertText', false, 'hello from AskAll');
```

### For Slate editors specifically:
```js
const el = document.querySelector('[data-slate-editor="true"]');
el.focus();
try {
  const dt = new DataTransfer();
  dt.setData('text/plain', 'hello from AskAll');
  el.dispatchEvent(new InputEvent('beforeinput', {
    inputType: 'insertText', data: 'hello from AskAll',
    dataTransfer: dt, bubbles: true, cancelable: true, composed: true
  }));
} catch (_) {}
document.execCommand('insertText', false, 'hello from AskAll');
el.dispatchEvent(new Event('input', { bubbles: true }));
```

**Check:** Does text appear in the input box? Does the send button become enabled?

---

## Step 4: Collect Response Element Info

After a successful manual submission (or if the site already shows a response), run:

```js
(() => {
  const sels = [
    '[class*="markdown"]', '[class*="prose"]', '[class*="response"]',
    '[class*="assistant"]', '[class*="message"]', '[class*="answer"]',
    '[class*="bot"]', '[data-role="assistant"]', '[data-message-author-role="assistant"]'
  ];
  const r = [];
  sels.forEach(s => {
    try {
      document.querySelectorAll(s).forEach(el => {
        const text = (el.innerText || '').trim();
        if (text.length > 5) {
          r.push({
            selector: s,
            tag: el.tagName,
            cls: (el.className || '').toString().slice(0, 80),
            textLength: text.length,
            textPreview: text.slice(0, 100)
          });
        }
      });
    } catch (_) {}
  });
  console.log(JSON.stringify(r, null, 2));
})();
```

**What to look for:**
- Which selector matched the actual AI response?
- Is the `textPreview` the real response content, or UI noise (buttons, sidebar, etc.)?

---

## Step 5: Check Thinking/Stop Indicators

If a site is stuck at "streaming", run:

```js
(() => {
  const sels = [
    'button[aria-label*="Stop" i]', 'button[aria-label*="stop" i]',
    'button[aria-label*="停止"]', '[class*="stop"]', '[class*="loading"]',
    '[class*="generating"]', '[class*="typing"]', '[class*="pending"]'
  ];
  const r = [];
  sels.forEach(s => {
    try {
      document.querySelectorAll(s).forEach(el => {
        r.push({
          selector: s, tag: el.tagName,
          visible: el.offsetParent !== null,
          text: (el.textContent || '').trim().slice(0, 50),
          cls: (el.className || '').toString().slice(0, 60)
        });
      });
    } catch (_) {}
  });
  console.log(JSON.stringify(r, null, 2));
})();
```

**What to look for:**
- Any element matching `[class*="stop"]` or `[class*="loading"]` that is visible but unrelated to AI generation (false positive)

---

## Step 6: Copy Full DOM for Deep Analysis

If the above steps are insufficient, copy the full page HTML:

```js
navigator.clipboard.writeText(document.documentElement.outerHTML)
  .then(() => console.log('DOM copied to clipboard'))
  .catch(() => {
    const t = document.createElement('textarea');
    t.value = document.documentElement.outerHTML;
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    document.body.removeChild(t);
    console.log('DOM copied (fallback)');
  });
```

Paste the HTML into a file and share it for analysis.

---

## Step 7: Apply the Fix

Based on findings from Steps 2-6, update `content/site-adapters.js`:

```js
"example.com": {
  inputSelector: '<from Step 2>',
  submitSelector: '<from Step 2>',
  responseSelector: '<from Step 4>',
  thinkingSelector: '<from Step 5, or remove false positives>',
  useEnterToSubmit: <true if no clickable button>,
  waitBeforeSubmit: <600-1200ms depending on framework>,
  fillInput(el, text) {
    // choose method based on Step 3 results:
    // textarea → __askall_fillReactTextarea(el, text)
    // contenteditable → __askall_fillViaExecCommand(el, text)
    // Slate → beforeinput event + execCommand
  }
}
```

Also add the hostname to:
- `manifest.json` — `host_permissions` + `content_scripts.matches`
- `popup/popup.js` — `SITE_GROUPS` array

---

## Step 8: Verify

1. Reload the extension (`chrome://extensions/` > Reload)
2. Open AskAll, send a test question with only the fixed site selected
3. Check:
   - [ ] Input text appears in the chat box
   - [ ] Question is submitted (page navigates or shows loading)
   - [ ] Response card shows "streaming" then "confirming X/10" then "done"
   - [ ] Response text is the actual AI answer, not UI noise
4. If still broken, repeat from Step 2 with the new debug output

---

## Quick Reference: Fill Method by Framework

| Framework | How to Identify | Fill Method |
|-----------|-----------------|-------------|
| Plain textarea | `<textarea>` | `__askall_fillReactTextarea` |
| React textarea | `<textarea>` with React fiber | `__askall_fillReactTextarea` |
| Slate.js | `data-slate-editor="true"` | `beforeinput` event + `execCommand` |
| Lexical | `data-lexical-editor="true"` | `__askall_fillViaExecCommand` |
| ProseMirror | `.ProseMirror` class | `__askall_fillViaExecCommand` |
| Quill | `.ql-editor` class | `__askall_fillContentEditable` |
| Plain contenteditable | `contenteditable="true"` | `__askall_fillContentEditable` |

## Quick Reference: Common False Positives

| Selector | False Positive | Fix |
|----------|---------------|-----|
| `[class*="stop"]` | "stopwatch", "stop-icon" unrelated elements | Use `button[aria-label*="Stop" i]` instead |
| `[class*="loading"]` | Navigation loading bars, skeleton screens | Use `[class*="generating"]` instead |
| `[class*="message"]` | Sidebar message list, notification badges | Use `[data-role="assistant"]` or scope to chat area |
| `[class*="response"]` | HTTP response headers, error response divs | Combine with `[class*="markdown"]` |
