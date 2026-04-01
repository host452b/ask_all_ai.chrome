#!/usr/bin/env python3
"""Generate 5 Chrome Web Store screenshots (1280x800, 24-bit PNG, no alpha)."""

from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "store-assets", "screenshots")
os.makedirs(OUT, exist_ok=True)

W, H = 1280, 800

# ── color palette (Lumen theme) ──────────────────────────────────
BG       = (17, 17, 20)
SURFACE  = (30, 30, 35)
CARD     = (38, 38, 44)
CARD_HI  = (45, 45, 52)
ACCENT   = (124, 106, 255)
ACCENT2  = (157, 143, 255)
GREEN    = (52, 211, 153)
RED      = (248, 113, 113)
YELLOW   = (251, 191, 36)
WHITE    = (240, 240, 245)
DIM      = (140, 140, 155)
DIMMER   = (90, 90, 105)
BORDER   = (55, 55, 65)

def try_font(size):
    for name in [
        "/System/Library/Fonts/SFPro-Bold.otf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]:
        try:
            return ImageFont.truetype(name, size)
        except (IOError, OSError):
            pass
    return ImageFont.load_default()

def try_font_regular(size):
    for name in [
        "/System/Library/Fonts/SFPro-Regular.otf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]:
        try:
            return ImageFont.truetype(name, size)
        except (IOError, OSError):
            pass
    return ImageFont.load_default()

font_title = try_font(32)
font_heading = try_font(20)
font_body = try_font_regular(16)
font_small = try_font_regular(13)
font_tag = try_font(13)
font_big = try_font(48)
font_medium = try_font(24)

def new_img():
    return Image.new("RGB", (W, H), BG)

def rounded_rect(draw, xy, fill, radius=12):
    x0, y0, x1, y1 = xy
    draw.rounded_rectangle(xy, radius=radius, fill=fill)

def pill(draw, xy, fill, text, text_color=WHITE, radius=16):
    rounded_rect(draw, xy, fill, radius)
    x0, y0, x1, y1 = xy
    cx = (x0 + x1) // 2
    cy = (y0 + y1) // 2
    draw.text((cx, cy), text, fill=text_color, font=font_tag, anchor="mm")

def save(img, name):
    path = os.path.join(OUT, name)
    img.save(path, "PNG")
    print(f"  {name} ({os.path.getsize(path) // 1024}KB)")

# ═══════════════════════════════════════════════════════════════════
# Screenshot 1: Main UI — question input + AI provider grid
# ═══════════════════════════════════════════════════════════════════
def shot1():
    img = new_img()
    d = ImageDraw.Draw(img)

    # top bar
    rounded_rect(d, (0, 0, W, 56), SURFACE)
    d.text((24, 28), "AskAll", fill=ACCENT, font=font_title, anchor="lm")
    d.text((140, 28), "One question, every AI.", fill=DIM, font=font_body, anchor="lm")

    # left panel background
    rounded_rect(d, (16, 72, 460, H - 16), SURFACE, 14)

    # Question section
    d.text((32, 92), "Question", fill=DIM, font=font_heading)
    rounded_rect(d, (32, 120, 444, 200), CARD, 10)
    d.text((44, 136), "What are the main differences between", fill=WHITE, font=font_body)
    d.text((44, 158), "transformer and diffusion models?", fill=WHITE, font=font_body)

    # Prompt Enhancement
    d.text((32, 218), "Prompt Enhancement", fill=DIM, font=font_heading)
    chips = [("Chain-of-Thought", True), ("Step-by-Step", False), ("Expert Role", True),
             ("Be Concise", False), ("Pros & Cons", False)]
    cx = 32
    for label, active in chips:
        tw = len(label) * 8 + 24
        color = ACCENT if active else CARD
        pill(d, (cx, 248, cx + tw, 276), color, label)
        cx += tw + 8

    # AI Providers
    d.text((32, 298), "AI Providers", fill=DIM, font=font_heading)
    d.text((195, 298), "All", fill=ACCENT, font=font_tag)

    # provider groups
    groups = [
        ("General — Freemium", ["ChatGPT", "Gemini", "Claude", "Grok", "Copilot", "Mistral"]),
        ("General — Free", ["DeepSeek", "Kimi", "Qwen", "Doubao", "Yuanbao", "ChatGLM"]),
        ("Specialized", ["Perplexity", "Manus", "NVIDIA", "Genspark", "Duck.ai", "Reddit"]),
    ]
    y = 324
    for group_name, sites in groups:
        d.text((32, y), group_name, fill=DIMMER, font=font_small)
        y += 20
        sx = 32
        for site in sites:
            tw = len(site) * 8 + 28
            # checkbox style
            rounded_rect(d, (sx, y, sx + tw, y + 28), CARD_HI, 6)
            # checkmark
            d.rectangle((sx + 4, y + 4, sx + 18, y + 24), fill=ACCENT)
            d.text((sx + 24, y + 14), site, fill=WHITE, font=font_small, anchor="lm")
            sx += tw + 6
            if sx > 420:
                sx = 32
                y += 34
        y += 40

    # Send button
    rounded_rect(d, (32, H - 80, 444, H - 36), ACCENT, 10)
    d.text((238, H - 58), "Send to All", fill=WHITE, font=font_heading, anchor="mm")

    # right panel — empty state
    rounded_rect(d, (476, 72, W - 16, H - 16), SURFACE, 14)
    d.text((476 + (W - 16 - 476) // 2, 380), "AA", fill=ACCENT, font=font_big, anchor="mm")
    d.text((476 + (W - 16 - 476) // 2, 440), "Responses will appear here after", fill=DIM, font=font_body, anchor="mm")
    d.text((476 + (W - 16 - 476) // 2, 462), "you send a question.", fill=DIM, font=font_body, anchor="mm")

    save(img, "01-main-ui.png")

# ═══════════════════════════════════════════════════════════════════
# Screenshot 2: Responses comparison — multiple AI responses
# ═══════════════════════════════════════════════════════════════════
def shot2():
    img = new_img()
    d = ImageDraw.Draw(img)

    # top bar
    rounded_rect(d, (0, 0, W, 56), SURFACE)
    d.text((24, 28), "AskAll", fill=ACCENT, font=font_title, anchor="lm")

    # status bar
    rounded_rect(d, (16, 66, W - 16, 110), SURFACE, 10)
    d.ellipse((28, 82, 42, 96), fill=GREEN)
    d.text((52, 88), "All responses collected", fill=GREEN, font=font_body, anchor="lm")
    d.text((W - 40, 88), "6 / 6", fill=DIM, font=font_body, anchor="rm")
    # progress bar
    rounded_rect(d, (28, 100, W - 28, 106), (30, 30, 35), 3)
    rounded_rect(d, (28, 100, W - 28, 106), GREEN, 3)

    # action buttons
    d.text((W - 400, 88), "Refresh", fill=DIM, font=font_small, anchor="lm")
    pill(d, (W - 340, 78, W - 260, 98), ACCENT, "Copy All")
    pill(d, (W - 250, 78, W - 180, 98), CARD, "Export")

    responses = [
        ("ChatGPT", "done", "342 words", "12s",
         "Transformer models use self-attention mechanisms to process input sequences in parallel, making them highly efficient for NLP tasks. They capture long-range dependencies through multi-head attention..."),
        ("Gemini", "done", "289 words", "8s",
         "The key differences lie in their fundamental architectures. Transformers operate on discrete tokens using attention mechanisms, while diffusion models work in continuous space by iteratively denoising..."),
        ("Claude", "done", "315 words", "15s",
         "There are several important distinctions between these two model families:\n\n1. Core mechanism: Transformers use self-attention to weigh relationships between all positions in a sequence..."),
        ("DeepSeek", "done", "278 words", "18s",
         "Transformer models and diffusion models represent two fundamentally different approaches to generative AI. Transformers excel at sequential data processing through their attention mechanism..."),
        ("Grok", "done", "256 words", "9s",
         "Great question! Here's a breakdown:\n\nTransformers: Token-based, parallel processing via self-attention. Used primarily for text, code, and structured data generation..."),
    ]

    y = 120
    for name, status, words, time, text in responses:
        card_h = 120
        rounded_rect(d, (16, y, W - 16, y + card_h), SURFACE, 10)
        # left border accent for done
        d.rectangle((16, y + 8, 20, y + card_h - 8), fill=GREEN)
        # header
        d.text((32, y + 16), name, fill=ACCENT2, font=font_heading)
        pill(d, (32 + len(name) * 11 + 8, y + 10, 32 + len(name) * 11 + 58, y + 30), (30, 80, 55), "done", GREEN)
        d.text((W - 40, y + 16), f"{words}  |  {time}", fill=DIM, font=font_small, anchor="rm")
        # body text
        lines = text[:200].split("\n")
        ty = y + 42
        for line in lines[:3]:
            d.text((32, ty), line[:100], fill=(200, 200, 210), font=font_small)
            ty += 18
        # copy button
        pill(d, (W - 80, y + card_h - 30, W - 30, y + card_h - 10), CARD, "Copy")

        y += card_h + 8

    save(img, "02-responses.png")

# ═══════════════════════════════════════════════════════════════════
# Screenshot 3: Streaming state — real-time progress
# ═══════════════════════════════════════════════════════════════════
def shot3():
    img = new_img()
    d = ImageDraw.Draw(img)

    rounded_rect(d, (0, 0, W, 56), SURFACE)
    d.text((24, 28), "AskAll", fill=ACCENT, font=font_title, anchor="lm")

    # status bar — in progress
    rounded_rect(d, (16, 66, W - 16, 110), SURFACE, 10)
    d.ellipse((28, 82, 42, 96), fill=ACCENT)
    d.text((52, 88), "3 / 6 complete", fill=WHITE, font=font_body, anchor="lm")
    d.text((W - 80, 88), "ETA: 42s", fill=YELLOW, font=font_small, anchor="rm")
    # segmented progress bar
    bar_x = 28
    bar_w = W - 56
    rounded_rect(d, (bar_x, 100, bar_x + bar_w, 106), (30, 30, 35), 3)
    rounded_rect(d, (bar_x, 100, bar_x + int(bar_w * 0.5), 106), GREEN, 3)  # done
    rounded_rect(d, (bar_x + int(bar_w * 0.5), 100, bar_x + int(bar_w * 0.75), 106), ACCENT, 3)  # streaming
    rounded_rect(d, (bar_x + int(bar_w * 0.75), 100, bar_x + int(bar_w * 0.85), 106), YELLOW, 3)  # confirming

    # breakdown legend
    items = [("3 done", GREEN), ("1 confirming 7/10", YELLOW), ("1 streaming", ACCENT), ("1 waiting", DIMMER)]
    lx = 52
    for label, color in items:
        d.rectangle((lx, 76, lx + 8, 84), fill=color)
        d.text((lx + 12, 80), label, fill=DIM, font=font_small, anchor="lm")
        lx += len(label) * 7 + 30

    cards = [
        ("ChatGPT", "done", GREEN, "Transformer models use self-attention mechanisms to process..."),
        ("Gemini", "done", GREEN, "The key differences lie in their fundamental architectures..."),
        ("Claude", "done", GREEN, "There are several important distinctions between these two..."),
        ("Grok", "confirming 7/10 · 18s", YELLOW, "Great question! Here's a breakdown: Transformers use..."),
        ("DeepSeek", "streaming", ACCENT, "Transformer models and diffusion models represent two fund▌"),
        ("Perplexity", "pending", DIMMER, ""),
    ]

    y = 120
    for name, status, color, text in cards:
        card_h = 90 if text else 50
        rounded_rect(d, (16, y, W - 16, y + card_h), SURFACE, 10)
        d.rectangle((16, y + 8, 20, y + card_h - 8), fill=color)
        d.text((32, y + 16), name, fill=ACCENT2, font=font_heading)

        # status pill
        status_short = status.split(" ")[0]
        pw = len(status) * 7 + 20
        sx = 32 + len(name) * 11 + 8
        pill_bg = (30, 80, 55) if status_short == "done" else (80, 70, 15) if "confirm" in status else (40, 35, 80) if status_short == "streaming" else (40, 40, 48)
        pill(d, (sx, y + 10, sx + pw, y + 30), pill_bg, status, color)

        if text:
            d.text((32, y + 44), text[:110], fill=(180, 180, 190), font=font_small)
            if status_short == "streaming":
                # blinking cursor effect
                tw = d.textlength(text[:110], font=font_small)
                d.rectangle((32 + int(tw), y + 44, 34 + int(tw), y + 58), fill=ACCENT)

        y += card_h + 8

    save(img, "03-streaming.png")

# ═══════════════════════════════════════════════════════════════════
# Screenshot 4: Three themes showcase
# ═══════════════════════════════════════════════════════════════════
def shot4():
    img = new_img()
    d = ImageDraw.Draw(img)

    d.text((W // 2, 40), "Three Beautiful Themes", fill=WHITE, font=font_title, anchor="mm")
    d.text((W // 2, 72), "Light  ·  Lumen  ·  Carbon", fill=DIM, font=font_body, anchor="mm")

    themes = [
        ("Light", (255, 252, 240), (16, 15, 15), (67, 133, 190), (206, 205, 195), (242, 240, 229)),
        ("Lumen", (17, 17, 20), (240, 240, 245), (124, 106, 255), (55, 55, 65), (30, 30, 35)),
        ("Carbon", (12, 12, 12), (0, 255, 136), (0, 200, 100), (40, 40, 40), (25, 25, 25)),
    ]

    tx = 40
    panel_w = 380
    for name, bg, fg, accent, border_c, surface in themes:
        # theme preview panel
        rounded_rect(d, (tx, 100, tx + panel_w, H - 40), bg, 16)
        rounded_rect(d, (tx, 100, tx + panel_w, 148), surface, 16)
        d.text((tx + 16, 124), f"AskAll — {name}", fill=accent, font=font_heading, anchor="lm")

        # mini question box
        rounded_rect(d, (tx + 16, 164, tx + panel_w - 16, 220), surface, 8)
        d.text((tx + 28, 180), "What is quantum computing?", fill=fg, font=font_small)

        # mini chips
        cx = tx + 16
        for chip in ["CoT", "Expert", "Concise"]:
            cw = len(chip) * 8 + 16
            pill(d, (cx, 232, cx + cw, 254), accent if chip == "CoT" else surface, chip,
                 (255, 255, 255) if chip == "CoT" else fg, 10)
            cx += cw + 6

        # mini provider grid
        py = 270
        for site in ["ChatGPT", "Gemini", "Claude", "DeepSeek", "Grok", "Kimi"]:
            rounded_rect(d, (tx + 16, py, tx + 180, py + 24), surface, 6)
            d.rectangle((tx + 20, py + 4, tx + 34, py + 20), fill=accent)
            d.text((tx + 40, py + 12), site, fill=fg, font=font_small, anchor="lm")
            rounded_rect(d, (tx + 200, py, tx + panel_w - 16, py + 24), surface, 6)
            d.rectangle((tx + 204, py + 4, tx + 218, py + 20), fill=accent)
            next_site = {"ChatGPT": "Copilot", "Gemini": "Mistral", "Claude": "Perplexity",
                         "DeepSeek": "Doubao", "Grok": "Qwen", "Kimi": "MiniMax"}.get(site, "")
            d.text((tx + 224, py + 12), next_site, fill=fg, font=font_small, anchor="lm")
            py += 30

        # mini send button
        rounded_rect(d, (tx + 16, py + 10, tx + panel_w - 16, py + 44), accent, 8)
        d.text((tx + panel_w // 2, py + 27), "Send to All", fill=(255, 255, 255), font=font_body, anchor="mm")

        # mini response card
        rounded_rect(d, (tx + 16, py + 56, tx + panel_w - 16, H - 56), surface, 8)
        d.rectangle((tx + 16, py + 64, tx + 20, H - 64), fill=accent)
        d.text((tx + 28, py + 70), "ChatGPT", fill=accent, font=font_small)
        d.text((tx + 28, py + 90), "Quantum computing uses qubits", fill=fg, font=font_small)
        d.text((tx + 28, py + 108), "that can exist in superposition...", fill=fg, font=font_small)

        tx += panel_w + 20

    save(img, "04-themes.png")

# ═══════════════════════════════════════════════════════════════════
# Screenshot 5: Features overview — prompt enhancement + export
# ═══════════════════════════════════════════════════════════════════
def shot5():
    img = new_img()
    d = ImageDraw.Draw(img)

    # title
    d.text((W // 2, 50), "Powerful Features", fill=WHITE, font=font_title, anchor="mm")

    features = [
        ("Prompt Enhancement", "Improve your prompts with one click",
         ["Chain-of-Thought", "Step-by-Step", "Expert Role", "Be Concise", "Pros & Cons"]),
        ("Query History", "Save and reuse your past questions",
         ["Last 50 queries saved", "One-click to reuse", "Clear all option"]),
        ("Export & Share", "Multiple output formats",
         ["Copy All responses", "Copy individual", "Markdown report", "Debug diagnostics"]),
        ("22+ AI Providers", "All major AI chatbots supported",
         ["ChatGPT, Gemini, Claude", "DeepSeek, Grok, Copilot", "Perplexity, Kimi, Qwen", "+ custom sites"]),
    ]

    positions = [(40, 100, 600, 370), (660, 100, W - 40, 370),
                 (40, 410, 600, 680), (660, 410, W - 40, 680)]

    for i, ((title, subtitle, items), (x0, y0, x1, y1)) in enumerate(zip(features, positions)):
        rounded_rect(d, (x0, y0, x1, y1), SURFACE, 14)

        # icon circle
        icon_colors = [ACCENT, GREEN, YELLOW, (255, 120, 180)]
        d.ellipse((x0 + 20, y0 + 20, x0 + 56, y0 + 56), fill=icon_colors[i])
        icons = ["?", "H", "E", "AI"]
        d.text((x0 + 38, y0 + 38), icons[i], fill=WHITE, font=font_heading, anchor="mm")

        d.text((x0 + 68, y0 + 28), title, fill=WHITE, font=font_heading)
        d.text((x0 + 68, y0 + 52), subtitle, fill=DIM, font=font_small)

        iy = y0 + 80
        if i == 0:  # chips for prompt enhancement
            cx = x0 + 24
            for chip in items:
                cw = len(chip) * 8 + 20
                if cx + cw > x1 - 20:
                    cx = x0 + 24
                    iy += 36
                pill(d, (cx, iy, cx + cw, iy + 30), ACCENT, chip, WHITE, 14)
                cx += cw + 8
        else:  # list items
            for item in items:
                d.text((x0 + 32, iy + 4), "•", fill=ACCENT, font=font_body)
                d.text((x0 + 50, iy + 4), item, fill=(200, 200, 210), font=font_body)
                iy += 32

    # bottom tagline
    d.text((W // 2, H - 60), "Privacy First — No server, no tracking, no analytics", fill=DIM, font=font_body, anchor="mm")
    d.text((W // 2, H - 34), "Your questions go directly from your browser to each AI provider", fill=DIMMER, font=font_small, anchor="mm")

    save(img, "05-features.png")

# ── generate all ─────────────────────────────────────────────────
print("Generating screenshots...")
shot1()
shot2()
shot3()
shot4()
shot5()
print("Done!")
