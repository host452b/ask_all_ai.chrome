#!/usr/bin/env bash
# pack.sh — build & validate a Chrome Web Store-ready ZIP
# Usage: bash scripts/pack.sh
#
# This project has no build step (plain JS), so we zip directly from source.
# The zip contains ONLY production files — no docs, scripts, store-assets, or dev files.

set -euo pipefail
cd "$(dirname "$0")/.."

# ── Config ──────────────────────────────────────────
OUT_DIR="releases"
MANIFEST="manifest.json"

# ── Preflight checks ───────────────────────────────
echo "=== AskAll Pack ==="
echo ""

if [[ ! -f "$MANIFEST" ]]; then
  echo "ERROR: $MANIFEST not found." >&2
  exit 1
fi

# sync manifest from popup.js site list
if command -v node &>/dev/null; then
  node scripts/sync-manifest.js
else
  echo "WARNING: node not found, skipping manifest sync" >&2
fi

VERSION=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$MANIFEST" \
  | head -1 | grep -o '"[^"]*"$' | tr -d '"')
if [[ -z "$VERSION" ]]; then
  echo "ERROR: Could not parse version from $MANIFEST" >&2
  exit 1
fi

echo "Version: $VERSION"
echo ""

# ── Security audit ──────────────────────────────────
echo "[Security Audit]"
AUDIT_FAIL=0

# check for eval() / new Function()
EVAL_HITS=$(grep -rn 'eval(' background/ content/ popup/ --include='*.js' 2>/dev/null || true)
FUNC_HITS=$(grep -rn 'new Function(' background/ content/ popup/ --include='*.js' 2>/dev/null || true)
if [[ -n "$EVAL_HITS" || -n "$FUNC_HITS" ]]; then
  echo "  WARNING: eval() or new Function() found:"
  [[ -n "$EVAL_HITS" ]] && echo "$EVAL_HITS"
  [[ -n "$FUNC_HITS" ]] && echo "$FUNC_HITS"
  AUDIT_FAIL=1
else
  echo "  OK: no eval() / new Function()"
fi

# check for remote script loading
REMOTE_HITS=$(grep -rn '<script[[:space:]].*src=["\x27]https\?://' popup/ --include='*.html' 2>/dev/null || true)
if [[ -n "$REMOTE_HITS" ]]; then
  echo "  WARNING: remote <script> found:"
  echo "$REMOTE_HITS"
  AUDIT_FAIL=1
else
  echo "  OK: no remote script loading"
fi

# check for unsafe-eval in CSP
CSP_HITS=$(grep -rn 'unsafe-eval' "$MANIFEST" popup/ --include='*.json' --include='*.html' 2>/dev/null || true)
if [[ -n "$CSP_HITS" ]]; then
  echo "  WARNING: unsafe-eval in CSP:"
  echo "$CSP_HITS"
  AUDIT_FAIL=1
else
  echo "  OK: no unsafe-eval in CSP"
fi

# check for hardcoded secrets
SECRET_HITS=$(grep -rniE '(api[_-]?key|secret|token|password)\s*[:=]\s*["\x27][A-Za-z0-9+/=]{16,}' background/ content/ popup/ --include='*.js' 2>/dev/null || true)
if [[ -n "$SECRET_HITS" ]]; then
  echo "  WARNING: possible hardcoded secrets:"
  echo "$SECRET_HITS"
  AUDIT_FAIL=1
else
  echo "  OK: no hardcoded secrets detected"
fi

if [[ $AUDIT_FAIL -eq 1 ]]; then
  echo ""
  echo "  Security audit has warnings. Review before submitting."
else
  echo "  All security checks passed."
fi
echo ""

# ── Validate: no forbidden files ────────────────────
echo "[Validation]"
FORBIDDEN=""
for pattern in "*.ts" "*.map" ".env*" "*.test.*" "*.spec.*"; do
  HITS=$(find background/ content/ popup/ icons/ -name "$pattern" 2>/dev/null || true)
  if [[ -n "$HITS" ]]; then
    FORBIDDEN="$FORBIDDEN$HITS"$'\n'
  fi
done

if [[ -n "$FORBIDDEN" ]]; then
  echo "  WARNING: forbidden files found in source:"
  echo "$FORBIDDEN"
else
  echo "  OK: no forbidden files (.ts, .map, .env, .test, .spec)"
fi

# verify essential files exist
for f in manifest.json background/service-worker.js content/site-adapters.js content/content-script.js popup/popup.html popup/popup.js popup/popup.css icons/icon128.png; do
  if [[ ! -f "$f" ]]; then
    echo "  ERROR: missing required file: $f" >&2
    exit 1
  fi
done
echo "  OK: all required files present"
echo ""

# ── Package ─────────────────────────────────────────
mkdir -p "$OUT_DIR"
ZIP_NAME="askall-v${VERSION}.zip"
ZIP_PATH="$OUT_DIR/$ZIP_NAME"

rm -f "$ZIP_PATH"

zip -r -9 "$ZIP_PATH" \
  manifest.json \
  background/ \
  content/ \
  popup/ \
  icons/ \
  LICENSE \
  -x "*.DS_Store" -x "__MACOSX/*"

# ── Post-pack validation ────────────────────────────
echo ""
echo "[Post-pack Validation]"

# verify manifest.json is at zip root (not nested in a subdirectory)
if unzip -l "$ZIP_PATH" | awk '{print $NF}' | grep -qx "manifest.json"; then
  echo "  OK: manifest.json at zip root"
else
  echo "  ERROR: manifest.json not at zip root!" >&2
  exit 1
fi

# check no dev files leaked in
LEAKED=$(unzip -l "$ZIP_PATH" | grep -E '\.(ts|map|env|test\.|spec\.)' || true)
if [[ -n "$LEAKED" ]]; then
  echo "  WARNING: dev files found in zip:"
  echo "$LEAKED"
else
  echo "  OK: no dev files in zip"
fi

# size check
SIZE=$(wc -c < "$ZIP_PATH" | tr -d ' ')
SIZE_KB=$((SIZE / 1024))
if [[ $SIZE -gt 10485760 ]]; then
  echo "  WARNING: zip is ${SIZE_KB}KB (> 10MB recommended limit)"
elif [[ $SIZE -gt 524288000 ]]; then
  echo "  ERROR: zip is ${SIZE_KB}KB (> 500MB hard limit)" >&2
  exit 1
else
  echo "  OK: zip size ${SIZE_KB}KB"
fi

# file count
FILE_COUNT=$(unzip -l "$ZIP_PATH" | tail -1 | awk '{print $2}')
echo "  Files in zip: $FILE_COUNT"

echo ""
echo "=== Done ==="
echo "  Output:   $ZIP_PATH"
echo "  Version:  $VERSION"
echo "  Size:     ${SIZE_KB}KB"
echo "  Upload:   https://chrome.google.com/webstore/devconsole"
