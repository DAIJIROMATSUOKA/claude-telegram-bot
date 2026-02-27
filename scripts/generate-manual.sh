#!/bin/bash
# generate-manual.sh - 装置マニュアル自動生成オーケストレーター
# Usage: bash scripts/generate-manual.sh M1308 "ベーコン原木をハーフカットする装置。伊藤ハム米久プラント柏工場"
set -euo pipefail

NUM="$1"
DESC="$2"
WORK="/tmp/manual-$NUM"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BOT_DIR="$(dirname "$SCRIPT_DIR")"

mkdir -p "$WORK"

echo "========================================="
echo " 装置マニュアル自動生成: $NUM"
echo "========================================="

# Phase 1: 素材収集
echo ""
echo "[Phase 1/3] 素材収集..."
python3 "$SCRIPT_DIR/collect-materials.py" "$NUM" "$DESC" "$WORK/materials.json"

# Phase 2: AI生成 (Claude CLI)
echo ""
echo "[Phase 2/3] AI生成 (Claude CLI)..."
TEMPLATE="$SCRIPT_DIR/manual-template.md"
if [ ! -f "$TEMPLATE" ]; then
  echo "ERROR: テンプレートが見つかりません: $TEMPLATE"
  exit 1
fi

# テンプレート + materials.json を1つのプロンプトに結合
SYSTEM_PROMPT=$(cat "$TEMPLATE")
MATERIALS_JSON=$(cat "$WORK/materials.json")

# プロンプトをファイルに書き出し（シェルエスケープ問題回避）
cat > "$WORK/prompt.txt" << 'PROMPT_HEADER'
以下のJSONデータに基づいて、取扱説明書を生成してください。
Markdown形式で出力し、コードブロックで囲まないでください。

=== 装置データ (JSON) ===
PROMPT_HEADER
echo "$MATERIALS_JSON" >> "$WORK/prompt.txt"

echo "  プロンプト: $(wc -c < "$WORK/prompt.txt") bytes"
echo "  テンプレート: $(wc -c < "$TEMPLATE") bytes"
echo "  生成開始... (数分かかります)"

# Claude CLI: -p (non-interactive) + --system-prompt + --model opus
cat "$WORK/prompt.txt" | claude -p \
  --model opus \
  --system-prompt "$SYSTEM_PROMPT" \
  --output-format text \
  > "$WORK/content.md" 2>"$WORK/claude-stderr.log" || {
    echo "ERROR: Claude CLI失敗"
    cat "$WORK/claude-stderr.log" | tail -20
    exit 1
  }

CONTENT_LINES=$(wc -l < "$WORK/content.md")
CONTENT_BYTES=$(wc -c < "$WORK/content.md")
echo "  → ${CONTENT_LINES}行 / ${CONTENT_BYTES}bytes 生成"

if [ "$CONTENT_BYTES" -lt 500 ]; then
  echo "WARNING: 生成内容が短すぎます。content.mdを確認:"
  head -20 "$WORK/content.md"
  echo "---stderr---"
  cat "$WORK/claude-stderr.log" | tail -10
  exit 1
fi

# Phase 3: Docx生成
echo ""
echo "[Phase 3/3] Docx生成..."

# docx-jsがインストールされているか確認
if ! node -e "require('docx')" 2>/dev/null; then
  echo "  docx-jsインストール中..."
  npm install -g docx 2>/dev/null || npm install docx 2>/dev/null
fi

node "$SCRIPT_DIR/generate-docx.cjs" "$WORK/content.md" "$WORK/materials.json"

# プロジェクトフォルダにコピー
DOCX_NAME="${NUM}_取扱説明書.docx"
DOCX_PATH="$WORK/$DOCX_NAME"

if [ -f "$DOCX_PATH" ]; then
  PROJECT_FOLDER=$(python3 -c "import json; print(json.load(open('$WORK/materials.json'))['project_folder'])")
  cp "$DOCX_PATH" "$PROJECT_FOLDER/$DOCX_NAME"
  echo ""
  echo "========================================="
  echo " ✅ 完了!"
  echo " 保存先: $PROJECT_FOLDER/$DOCX_NAME"
  echo " サイズ: $(du -h "$DOCX_PATH" | cut -f1)"
  echo "========================================="
else
  echo "ERROR: Docxファイルが生成されませんでした"
  exit 1
fi
