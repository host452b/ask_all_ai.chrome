// site-adapters.js
// per-site DOM selectors and interaction strategies.
//
// contract per adapter:
//   inputSelector    – CSS selector for the main textarea / contenteditable
//   submitSelector   – CSS selector for the send button
//   responseSelector – CSS selector for assistant response containers
//   thinkingSelector – CSS selector for "still generating" indicator
//   useEnterToSubmit – simulate Enter key instead of clicking a button
//   waitBeforeSubmit – ms to wait after filling before submitting
//   fillInput(el, text) – (optional) custom input fill function

// ---- shared fill helpers ----

function __askall_fillContentEditable(el, text) {
  el.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);
  document.execCommand("insertText", false, text);
}

function __askall_fillReactTextarea(el, text) {
  el.focus();
  const proto = Object.getPrototypeOf(el);
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  if (descriptor && descriptor.set) {
    descriptor.set.call(el, text);
  } else {
    el.value = text;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

// execCommand on textarea triggers real beforeinput + input events
// that React/Vue frameworks reliably capture
function __askall_fillViaExecCommand(el, text) {
  el.focus();
  if (el.select) {
    try { el.select(); } catch (_) { /* contenteditable doesn't support select() */ }
  }
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    document.execCommand("selectAll", false, null);
  } else {
    var sel = window.getSelection();
    var range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  document.execCommand("insertText", false, text);
}

// ---- adapters ----

window.__ASKALL_ADAPTERS = {

  "chatgpt.com": {
    inputSelector: "#prompt-textarea, [id='prompt-textarea'] p",
    submitSelector: 'button[data-testid="send-button"], button[aria-label="Send prompt"]',
    responseSelector: '[data-message-author-role="assistant"]',
    thinkingSelector: '[data-testid="stop-button"], button[aria-label="Stop streaming"]',
    useEnterToSubmit: false,
    waitBeforeSubmit: 500,
    fillInput(el, text) {
      const container = document.querySelector("#prompt-textarea");
      if (!container) { return; }
      const p = container.querySelector("p");
      if (p) {
        p.focus();
        __askall_fillContentEditable(p, text);
      }
      container.dispatchEvent(new Event("input", { bubbles: true }));
    }
  },

  "www.perplexity.ai": {
    inputSelector: '#ask-input[data-lexical-editor="true"], [data-lexical-editor="true"][contenteditable="true"], textarea',
    submitSelector: 'button[aria-label="Submit"], button[aria-label="Ask"], button[type="submit"], button[class*="submit"], button[class*="send"]',
    responseSelector: '[class*="prose"], [class*="markdown"], [class*="response-text"], [class*="answer"]',
    thinkingSelector: '[class*="animate-pulse"], [class*="skeleton"], [class*="searching"]',
    useEnterToSubmit: false,
    waitBeforeSubmit: 1000,
    fillInput(el, text) {
      if (el.contentEditable === "true") {
        __askall_fillViaExecCommand(el, text);
      } else {
        __askall_fillReactTextarea(el, text);
      }
    }
  },

  "gemini.google.com": {
    inputSelector: '.ql-editor[contenteditable="true"], rich-textarea [contenteditable="true"], [contenteditable="true"], .input-area-container textarea',
    submitSelector: 'button[aria-label="Send message"], button.send-button, .send-button-container button',
    responseSelector: 'message-content, .model-response-text, .response-container, [class*="markdown"]',
    thinkingSelector: '.loading-indicator, .thinking-indicator, model-response[is-streaming]',
    useEnterToSubmit: false,
    waitBeforeSubmit: 600,
    fillInput(el, text) {
      el.focus();
      __askall_fillContentEditable(el, text);
    }
  },

  "manus.im": {
    inputSelector: 'textarea, [contenteditable="true"]',
    submitSelector: 'button[type="submit"], button[aria-label*="send" i]',
    responseSelector: '[class*="message"][class*="assistant"], [class*="response"]',
    thinkingSelector: '[class*="loading"], [class*="typing"], [class*="generating"]',
    useEnterToSubmit: true,
    waitBeforeSubmit: 500,
  },

  "www.genspark.ai": {
    inputSelector: 'textarea, input[type="text"]',
    submitSelector: 'button[type="submit"], button[aria-label*="send" i]',
    responseSelector: '[class*="answer"], [class*="response"], [class*="message"]',
    thinkingSelector: '[class*="loading"], [class*="thinking"], [class*="generating"]',
    useEnterToSubmit: true,
    waitBeforeSubmit: 600,
  },

  "agent.minimax.io": {
    inputSelector: '.tiptap-editor[contenteditable="true"], .ProseMirror[contenteditable="true"], textarea, [contenteditable="true"]',
    submitSelector: '#input-send-icon, button[type="submit"], button[class*="send"], [class*="submit"]',
    responseSelector: '[class*="assistant"], [class*="bot-message"], [class*="response"], [class*="markdown"]',
    thinkingSelector: '[class*="generating"], [class*="typing"]',
    useEnterToSubmit: false,
    waitBeforeSubmit: 500,
    fillInput(el, text) {
      __askall_fillViaExecCommand(el, text);
    }
  },

  "chat.deepseek.com": {
    inputSelector: "textarea",
    submitSelector: '[class*="ds-icon-button"]:not([class*="hover-bg"]), div[role="button"][aria-disabled="false"]',
    responseSelector: ".ds-markdown--block, .ds-markdown, [class*='markdown']",
    thinkingSelector: 'div[class*="stop-button"], div[class*="stopBtn"], [class*="loading"], [class*="generating"]',
    useEnterToSubmit: true,
    waitBeforeSubmit: 500,
    fillInput(el, text) {
      __askall_fillViaExecCommand(el, text);
    }
  },

  "grok.com": {
    inputSelector: '.ProseMirror[contenteditable="true"], .tiptap[contenteditable="true"], [contenteditable="true"]',
    submitSelector: 'button[aria-label="Submit"]',
    responseSelector: '[class*="message-bubble"], [class*="response"], [class*="assistant"], [class*="markdown"]',
    thinkingSelector: '[class*="generating"], [class*="typing"]',
    useEnterToSubmit: true,
    waitBeforeSubmit: 800,
    fillInput(el, text) {
      el.focus();
      __askall_fillViaExecCommand(el, text);
    }
  },

  "www.kimi.com": {
    inputSelector: '[data-lexical-editor="true"][contenteditable="true"], .chat-input-editor[contenteditable="true"], [contenteditable="true"][role="textbox"], [contenteditable="true"]',
    submitSelector: '.send-button-container:not(.disabled), [class*="send-button-container"]:not([class*="disabled"])',
    responseSelector: '.segment-assistant .markdown-container .markdown, .segment-assistant .markdown',
    thinkingSelector: '[class*="stop"], [class*="loading"], [class*="generating"], [class*="thinking"]',
    useEnterToSubmit: false,
    waitBeforeSubmit: 800,
    fillInput(el, text) {
      el.focus();
      __askall_fillViaExecCommand(el, text);
    }
  },


  "chat.qwen.ai": {
    inputSelector: 'textarea.message-input-textarea, textarea[class*="message-input"], textarea',
    submitSelector: 'button.send-button, .chat-prompt-send-button button, .message-input-right-button-send button',
    responseSelector: '[class*="markdown"], [class*="message-content"], [class*="prose"], [class*="assistant"]',
    thinkingSelector: 'button.stop-button, [class*="generating"], [class*="typing"]',
    useEnterToSubmit: true,
    waitBeforeSubmit: 1200,
    fillInput(el, text) {
      __askall_fillReactTextarea(el, text);
    }
  },

  "www.doubao.com": {
    inputSelector: 'textarea[data-testid="chat_input_input"], textarea, [contenteditable="true"]',
    submitSelector: '[data-testid="send_btn"], #flow-end-msg-send, [data-testid="chat_input_send_button"], [class*="send-btn"], button[class*="send"]',
    responseSelector: '[class*="markdown"], [class*="message-content"], [class*="receive"]',
    thinkingSelector: '[class*="generating"]',
    useEnterToSubmit: true,
    waitBeforeSubmit: 600,
    fillInput(el, text) {
      el.focus();
      __askall_fillViaExecCommand(el, text);
    }
  },

  "chat.mistral.ai": {
    inputSelector: 'textarea, [contenteditable="true"], [role="textbox"]',
    submitSelector: 'button[type="submit"], button[aria-label*="Send" i], button[class*="send"]',
    responseSelector: '[class*="prose"], [class*="markdown"], [class*="assistant"], [class*="message-content"]',
    thinkingSelector: '[class*="loading"], [class*="generating"], [class*="stop"], [class*="typing"]',
    useEnterToSubmit: false,
    waitBeforeSubmit: 600,
    fillInput(el, text) {
      __askall_fillViaExecCommand(el, text);
    }
  },
  "duck.ai": {
    inputSelector: 'textarea[name="user-prompt"], textarea, [role="textbox"], [contenteditable="true"]',
    submitSelector: 'button[aria-label="Send"], button[type="submit"]',
    responseSelector: '[class*="markdown"], [class*="response"], [class*="assistant"], [class*="message"]',
    thinkingSelector: '[class*="generating"], [class*="typing"]',
    useEnterToSubmit: true,
    waitBeforeSubmit: 600,
    fillInput(el, text) {
      __askall_fillReactTextarea(el, text);
    }
  },

  "www.reddit.com": {
    inputSelector: 'textarea:not(.g-recaptcha-response), input[type="text"], [role="textbox"], [contenteditable="true"]',
    submitSelector: 'button[type="submit"], button[aria-label*="send" i], button[aria-label*="ask" i], button[class*="submit"]',
    responseSelector: '[class*="answer"]:not(.g-recaptcha-response), [class*="markdown"], [class*="response"], [class*="message"]',
    thinkingSelector: '[class*="loading"], [class*="generating"], [class*="thinking"], [class*="spinner"]',
    useEnterToSubmit: true,
    waitBeforeSubmit: 800,
    fillInput(el, text) {
      el.focus();
      el.click();
      __askall_fillViaExecCommand(el, text);
    }
  },

  "claude.ai": {
    inputSelector: '[contenteditable="true"], textarea',
    submitSelector: 'button[aria-label="Send Message"], button[aria-label*="Send" i], button[type="submit"]',
    responseSelector: '[class*="response"], [class*="markdown"], [class*="assistant"], [class*="message"], .prose',
    thinkingSelector: '[class*="stop"], [class*="loading"], [class*="generating"]',
    useEnterToSubmit: false,
    waitBeforeSubmit: 600,
    fillInput(el, text) {
      // claude uses ProseMirror — must use execCommand
      el.focus();
      __askall_fillContentEditable(el, text);
    }
  },


  "www.sogou.com": {
    inputSelector: 'textarea, [contenteditable="true"], input[type="text"]',
    submitSelector: '[aria-label="发送消息"], button[class*="send"], button[type="submit"], [class*="submit"]',
    responseSelector: '[class*="markdown"], [class*="message-content"], [class*="answer"], [class*="assistant"]',
    thinkingSelector: '[class*="generating"], [class*="typing"]',
    useEnterToSubmit: true,
    waitBeforeSubmit: 600,
    fillInput(el, text) {
      __askall_fillViaExecCommand(el, text);
    }
  },

  "chat.baidu.com": {
    inputSelector: '#chat-textarea, textarea, [contenteditable="true"]',
    submitSelector: '#sendBtn, button[class*="send"], button[type="submit"]',
    responseSelector: '[class*="markdown"], [class*="message-content"]',
    thinkingSelector: '[class*="generating"]',
    useEnterToSubmit: true,
    waitBeforeSubmit: 600,
    fillInput(el, text) {
      __askall_fillViaExecCommand(el, text);
    }
  },

  "chatglm.cn": {
    inputSelector: 'textarea, .el-textarea__inner, [contenteditable="true"], [role="textbox"]',
    submitSelector: '[data-testid="send"], button[class*="send"], [class*="send-btn"], button[type="submit"]',
    responseSelector: '[class*="markdown"]:not(svg):not([class*="name"]), [class*="message-content"]:not([class*="name"]), [class*="answer"]:not([class*="name"])',
    thinkingSelector: '[class*="stop"], [class*="loading"], [class*="generating"], [class*="typing"]',
    useEnterToSubmit: true,
    waitBeforeSubmit: 800,
    fillInput(el, text) {
      __askall_fillViaExecCommand(el, text);
    }
  },

  "yuanbao.tencent.com": {
    inputSelector: 'textarea, [contenteditable="true"]',
    submitSelector: 'button[class*="send"], form button, button[type="submit"]',
    responseSelector: '[class*="markdown"], [class*="message-content"], [class*="answer"], [class*="assistant"]',
    thinkingSelector: '[class*="stop"], [class*="loading"], [class*="generating"], [class*="typing"]',
    useEnterToSubmit: false,
    waitBeforeSubmit: 600,
    fillInput(el, text) {
      if (el.tagName === "TEXTAREA") {
        __askall_fillReactTextarea(el, text);
      } else {
        __askall_fillContentEditable(el, text);
      }
    }
  },


  "copilot.microsoft.com": {
    inputSelector: 'textarea#userInput, textarea, [contenteditable="true"], [role="textbox"]',
    submitSelector: 'button[aria-label="Submit"], button.submit, button[type="submit"], button[aria-label*="send" i]',
    responseSelector: '[class*="response"], [class*="markdown"], [class*="assistant"], [class*="message"], [class*="content"]',
    thinkingSelector: '[class*="loading"], [class*="generating"], [class*="typing"], [class*="progress"], [class*="stop"]',
    useEnterToSubmit: false,
    waitBeforeSubmit: 800,
    fillInput(el, text) {
      __askall_fillViaExecCommand(el, text);
    }
  },
  "build.nvidia.com": {
    inputSelector: 'textarea, [contenteditable="true"][role="textbox"]',
    submitSelector: 'button[aria-label*="Send" i], button[aria-label*="submit" i], button[type="submit"], button[class*="send" i]',
    responseSelector: '[class*="markdown"], [class*="response"], [class*="assistant"], [class*="message-content"]',
    thinkingSelector: '[class*="loading"], [class*="generating"], [class*="typing"], [class*="progress"]',
    useEnterToSubmit: false,
    waitBeforeSubmit: 1000,
    fillInput(el, text) {
      if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
        __askall_fillReactTextarea(el, text);
      } else {
        __askall_fillContentEditable(el, text);
      }
    }
  },
};

// fallback for custom / unknown sites
window.__ASKALL_ADAPTERS["__fallback"] = {
  inputSelector: 'textarea, input[type="text"], [contenteditable="true"]',
  submitSelector: '[id*="send" i], [data-testid*="send" i], button[type="submit"], button[aria-label*="send" i], button[class*="send"], [class*="icon-button"], div[role="button"][aria-disabled="false"]',
  responseSelector: '[class*="markdown"], [class*="response"], [class*="assistant"], [class*="message"]',
  thinkingSelector: '[class*="loading"], [class*="generating"], [class*="typing"], [class*="stop"]',
  useEnterToSubmit: false,
  waitBeforeSubmit: 800,
  fillInput(el, text) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      __askall_fillReactTextarea(el, text);
    } else {
      __askall_fillContentEditable(el, text);
    }
  }
};
