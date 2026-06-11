#!/bin/bash
# Extract a KEYENCE PLC manual PDF into searchable, page-marked text for Croppy to grep.
#
# Usage:
#   extract-keyence-manual.sh <pdf-path> <model> <shortname>
# Example:
#   extract-keyence-manual.sh "$HOME/Machinelab Dropbox/Matsuoka Daijiro/reference/keyence/KV/KV-8000_InstructionRef_E.pdf" KV-8000 instruction-ref
#
# Output:
#   workspace/keyence-manuals/<model>/text/<shortname>.txt   (page markers: ===== PAGE n =====)
#   appends a manifest line to workspace/keyence-manuals/<model>/INDEX.md
#
# Text-based PDFs use pdftotext. Scanned PDFs (low text yield) are flagged for OCR (tesseract jpn+eng).
set -euo pipefail

PDF="${1:?pdf path required}"
MODEL="${2:?model required (e.g. KV-8000)}"
NAME="${3:?shortname required (e.g. instruction-ref)}"

REPO="$HOME/claude-telegram-bot"
# Workspace root is overridable so the same extractor serves any maker
# (sync-manuals.sh sets MANUAL_WS_BASE per maker). Default keeps KEYENCE behavior.
WSROOT="${MANUAL_WS_BASE:-$REPO/workspace/keyence-manuals}"
BASE="$WSROOT/$MODEL"
mkdir -p "$BASE/text"
OUT="$BASE/text/$NAME.txt"
INDEX="$BASE/INDEX.md"

if [ ! -f "$PDF" ]; then echo "ERROR: not found: $PDF" >&2; exit 1; fi

PAGES=$(pdfinfo "$PDF" 2>/dev/null | awk '/^Pages:/{print $2}'); PAGES=${PAGES:-0}
TITLE=$(pdfinfo "$PDF" 2>/dev/null | awk -F': *' '/^Title:/{print $2}')
echo "PDF: $(basename "$PDF")  | pages: $PAGES  | title: ${TITLE:-(none)}"

# --- text extraction (layout-preserving, keeps tables readable) ---
RAW="$BASE/text/.$NAME.raw.tmp"
pdftotext -layout "$PDF" "$RAW" 2>/dev/null || true
CHARS=$(wc -c < "$RAW" | tr -d ' ')
PERPAGE=0; [ "$PAGES" -gt 0 ] && PERPAGE=$(( CHARS / PAGES ))
echo "extracted: $CHARS chars  (~$PERPAGE chars/page)"

if [ "$PERPAGE" -lt 50 ]; then
  echo "!! Low text yield -> PDF is likely SCANNED (image)." >&2
  echo "!! OCR needed. Run: pdftoppm + tesseract -l jpn+eng. Not auto-run (slow). Re-invoke with --ocr to enable." >&2
  if [ "${4:-}" != "--ocr" ]; then rm -f "$RAW"; exit 2; fi
  echo "OCR mode: rendering pages -> tesseract (jpn+eng)..."
  TMPD="$BASE/text/.$NAME.ocr"; mkdir -p "$TMPD"
  pdftoppm -r 300 -png "$PDF" "$TMPD/p" 2>/dev/null
  : > "$RAW"
  n=0
  for img in "$TMPD"/p*.png; do
    n=$((n+1))
    printf '\f' >> "$RAW"
    tesseract "$img" stdout -l jpn+eng 2>/dev/null >> "$RAW" || true
  done
  rm -rf "$TMPD"
fi

# --- insert page markers (split on form-feeds) ---
python3 - "$RAW" "$OUT" <<'PY'
import sys
raw=open(sys.argv[1],encoding="utf-8",errors="replace").read()
pages=raw.split("\f")
with open(sys.argv[2],"w",encoding="utf-8") as f:
    for i,pg in enumerate(pages,1):
        f.write(f"===== PAGE {i} =====\n{pg.strip(chr(10))}\n\n")
PY
rm -f "$RAW"

OUTCHARS=$(wc -c < "$OUT" | tr -d ' ')
echo "wrote: $OUT  ($OUTCHARS chars)"

# --- manifest ---
[ -f "$INDEX" ] || printf '# %s — Manual Index\n\nGrep the text files under `text/`. Page markers: `===== PAGE n =====`.\n\n| shortname | title | pages | text file |\n|---|---|---|---|\n' "$MODEL" > "$INDEX"
# de-dup existing line for this shortname
grep -v "| \`$NAME\` |" "$INDEX" > "$INDEX.tmp" 2>/dev/null && mv "$INDEX.tmp" "$INDEX" || true
printf '| `%s` | %s | %s | `text/%s.txt` |\n' "$NAME" "${TITLE:-$(basename "$PDF")}" "$PAGES" "$NAME" >> "$INDEX"
echo "indexed in: $INDEX"
