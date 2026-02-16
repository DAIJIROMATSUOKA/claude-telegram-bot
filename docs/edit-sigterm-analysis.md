# /edit SIGTERM バグ分析レポート

**日付**: 2026-02-17
**ステータス**: 調査完了 — 修正案あり

---

## 1. 症状

`/edit` コマンド実行時、単発でもSIGTERMが発生しプロセスが異常終了する。
Media Queue直列化（2026-02頃実装）で並列実行起因のメモリ圧迫は軽減されたが、
単発実行でもSIGTERMが出る事象は残存。

---

## 2. 処理フロー全体像

```
ユーザー: /edit 髪を金髪にして
    │
    ▼
[media-commands.ts] handleEdit()
    │  ├─ downloadPhoto() ← Telegram APIから画像DL
    │  ├─ withMediaQueue() ← 直列キュー
    │  └─ runAiMedia(["edit", ...])
    │       ├─ spawn(python3, ai-media.py edit ...)
    │       ├─ activity-based timeout (25min)
    │       └─ stderr → Telegram editMessageText (4秒throttle)
    │
    ▼
[ai-media.py] cmd_edit()
    │  ├─ ensure_comfyui() ← ComfyUI自動起動
    │  ├─ 画像アップロード (30s timeout)
    │  ├─ 顔検出・マスク生成
    │  ├─ ワークフロー構築
    │  ├─ comfyui_queue_and_wait() ← ★ 最長ブロッキング地点
    │  │     ├─ WebSocket接続 (timeout=2400s)
    │  │     ├─ prompt POST (30s timeout)
    │  │     └─ ws.recv() ループ ← ★ SIGTERMに対して無防備
    │  ├─ 出力ダウンロード (60s timeout)
    │  └─ comfyui_free_memory() ← ★ 正常終了時のみ実行
    │
    ▼
[media-commands.ts] 結果受信
    │  ├─ replyWithPhoto() ← Telegram API送信 (timeoutSeconds=300)
    │  ├─ replyWithDocument() ← Telegram API送信
    │  └─ cleanupFile()
```

---

## 3. タイムアウト設定一覧

| レイヤー | 値 | 場所 | 備考 |
|---------|-----|------|------|
| Grammy HTTPクライアント | 300s (5分) | src/index.ts:131 | sendPhoto/sendDocument用 |
| media-commands activity timeout | 25分 (画像) / 45分 (動画) | media-commands.ts:47-48 | stderr出力でリセット |
| SIGTERM→SIGKILL猶予 | +5秒 | media-commands.ts:209-212 | SIGTERM無視時のフォールバック |
| ai-media.py WebSocket timeout | 2400s (40分) | ai-media.py:2548 | ws.settimeout() |
| ai-media.py prompt POST | 30s | ai-media.py:2559 | urllib timeout |
| ai-media.py 画像アップロード | 30s | ai-media.py:2533 | urllib timeout |
| ai-media.py 出力ダウンロード | 60s | ai-media.py:2633 | urllib timeout |
| ai-media.py メモリ解放 | 10s | ai-media.py:2498 | /free API |
| Telegram editMessageText throttle | 4秒 | media-commands.ts:435 | レートリミット対策 |

---

## 4. 原因仮説（優先度順）

### 仮説A: ComfyUI実行中のstderr無出力によるactivity timeout (確度: 高)

**メカニズム:**

media-commands.tsのactivity-based timeout（25分）はstderr出力でリセットされる。
しかしComfyUIのワークフロー実行中、以下の「沈黙区間」が存在する:

1. **モデルロード後〜推論開始**: ComfyUIがGPUカーネルをコンパイル中（MPS backend）、stderrに何も出ない
2. **KSampler実行中**: progressメッセージはWebSocket経由でai-media.pyに届くが、ai-media.pyがstderrに `\r[ai-media] Progress: XX%` を出力する。ただし `\r` (carriage return) のみで改行がない → Node.jsの `proc.stderr.on("data")` はバッファリングにより即座に発火しない可能性がある
3. **VAEデコード**: 大きな画像のVAEデコードは数分かかるが、progress出力がない

**証拠:**
- media-commands.ts:188-194 で `stderr += data.toString()` を蓄積し、末尾の `line` でtimeoutをリセット
- ai-media.py:2580 の progress出力は `end=""` (改行なし) + `\r` 付き
- Pythonの `PYTHONUNBUFFERED=1` は設定済み（media-commands.ts:176）だが、`\r` のみの出力がNode.js側でどうバッファリングされるかは環境依存

**影響:**
- 25分のactivity timeoutが「stderrに改行付き出力がない」区間で発火
- media-commands.tsがSIGTERMを送信 → ai-media.pyが即死 → comfyui_free_memory()未実行

### 仮説B: ai-media.pyにSIGTERMハンドラがない (確度: 高)

**メカニズム:**

ai-media.py全体（約3099行）にSIGTERMハンドラが一切登録されていない。
Pythonのデフォルト動作はSIGTERM受信時に即座にプロセス終了（SystemExit等なし）。

つまり:
1. `comfyui_queue_and_wait()` 内の `ws.recv()` でブロッキング中にSIGTERMが来ると即死
2. `comfyui_free_memory()` は `cmd_edit()` の正常終了パスにのみ存在（ai-media.py:691）
3. モデルがVRAMに残留 → 次回実行時にメモリ圧迫 → さらにSIGTERM連鎖

**証拠:**
- ai-media.py:2937-3059 の `main()` にtry/exceptなし
- signal.signal() の呼び出しがスクリプト全体に存在しない

### 仮説C: Telegram APIファイルアップロードタイムアウト (確度: 中、既に部分修正済み)

**メカニズム:**

FLUX出力PNGは1-3MB。Telegram Bot APIへのアップロードがGrammyのHTTPタイムアウトを超過。
コミット `72d0be2` で `timeoutSeconds: 300` に増加済みだが、以下のケースでまだ不足の可能性:

1. ネットワーク状況が悪い場合
2. 画像が特に大きい場合（outpaint拡張後のPNG）
3. Telegram APIサーバー側の処理遅延

**証拠:**
- src/index.ts:128-133 のコメント「Default is too short and causes SIGTERM during /edit uploads」
- 実際にtimeoutSeconds追加で一部改善したとの報告あり

### 仮説D: macOSメモリ圧迫によるOS起因SIGTERM (確度: 中)

**メカニズム:**

M1 MAX 64GBだが、ComfyUIのFLUX Devモデルロードで大量メモリ消費:
- UNET (Q5_K_S): ~4-5GB
- Text Encoder (Q5_K_M): ~4GB
- VAE: ~1GB
- 追加LoRA: ~1-2GB

合計10GB超がComfyUIプロセスで消費される。他のプロセス（JARVIS Bot、Chrome等）との
競合でmacOSがメモリ圧迫と判断し、JARVISのchild process（ai-media.py）にSIGTERMを送る可能性。

**証拠:**
- Media Queue直列化はこの仮説のために導入された
- 単発でも発生するのは、ComfyUI自体のメモリ消費が大きいため

---

## 5. 修正案

### Fix 1: ai-media.pyにSIGTERMハンドラ追加 (優先度: 最高)

```python
# ai-media.py の先頭付近に追加
import signal

_shutting_down = False

def _sigterm_handler(signum, frame):
    global _shutting_down
    _shutting_down = True
    print(f"\n[ai-media] SIGTERM received, cleaning up...", file=sys.stderr, flush=True)
    try:
        comfyui_free_memory()
    except Exception as e:
        print(f"[ai-media] Cleanup failed: {e}", file=sys.stderr, flush=True)
    sys.exit(143)  # 128 + 15 (SIGTERM)

signal.signal(signal.SIGTERM, _sigterm_handler)
signal.signal(signal.SIGINT, _sigterm_handler)
```

**効果:** SIGTERM受信時にcomfyui_free_memory()を確実に実行。次回実行のメモリ圧迫を防止。

### Fix 2: progress出力に改行を追加 (優先度: 高)

ai-media.pyの `comfyui_queue_and_wait()` 内:

```python
# 変更前 (ai-media.py:2580)
print(f"\r[ai-media] Progress: {pct:.0f}%", end="", file=sys.stderr, flush=True)

# 変更後: 10%刻みで改行付き出力（Node.jsのstderrバッファをフラッシュさせる）
if int(pct) % 10 == 0:
    print(f"[ai-media] Progress: {pct:.0f}%", file=sys.stderr, flush=True)
else:
    print(f"\r[ai-media] Progress: {pct:.0f}%", end="", file=sys.stderr, flush=True)
```

**効果:** Node.js側のactivity timeoutリセットが確実に発火。沈黙区間によるfalse timeoutを防止。

### Fix 3: comfyui_queue_and_wait()にkeep-alive出力追加 (優先度: 高)

```python
# comfyui_queue_and_wait() のwhile loopに追加
KEEPALIVE_INTERVAL = 30  # 30秒ごと
last_keepalive = time.time()

while time.time() - start < timeout:
    try:
        msg = ws.recv()
        # ... 既存の処理 ...
    except websocket.WebSocketTimeoutException:
        # Keep-alive: stderrに定期出力してNode.js側のtimeoutをリセット
        now = time.time()
        if now - last_keepalive >= KEEPALIVE_INTERVAL:
            elapsed_min = (now - start) / 60
            print(f"[ai-media] Waiting for ComfyUI... ({elapsed_min:.1f}min elapsed)",
                  file=sys.stderr, flush=True)
            last_keepalive = now
        continue
```

**効果:** WebSocketタイムアウト例外時（ComfyUIが沈黙している間）にもstderr出力を生成。
Node.js側のactivity timeoutが不要に発火するのを防ぐ。

### Fix 4: WebSocket timeoutを短縮してkeep-alive頻度を上げる (優先度: 中)

```python
# 変更前
ws.settimeout(timeout)  # 2400s (40分) — ws.recv()が最大40分ブロック

# 変更後
ws.settimeout(30)  # 30秒 — ws.recv()が最大30秒でWebSocketTimeoutException
```

**効果:** ws.recv()のブロック時間を30秒に制限。`except WebSocketTimeoutException: continue` で
ループが回り、keep-alive出力やSIGTERMチェックが可能になる。
現在の `ws.settimeout(2400)` では、ws.recv()が最大40分ブロックし、その間SIGTERMハンドラも
実行されない（Pythonのシグナル処理はメインスレッドのシステムコール間でしか発火しない）。

### Fix 5: comfyui_free_memory()をtry/finallyに移動 (優先度: 中)

```python
# cmd_edit() の構造変更
def cmd_edit(args):
    try:
        # ... 既存の処理 ...
        outputs = comfyui_queue_and_wait(workflow, timeout=1500)
        # ... 出力処理 ...
        return {"ok": True, "path": output, "elapsed": round(elapsed, 1)}
    except Exception as e:
        return {"ok": False, "error": str(e)}
    finally:
        try:
            comfyui_free_memory()
        except:
            pass
```

**効果:** 例外発生時（SIGTERMハンドラからのSystemExit含む）にもメモリ解放が走る。

---

## 6. 推奨実装順序

| 順序 | Fix | 工数 | 効果 |
|-----|-----|------|------|
| 1 | Fix 1: SIGTERMハンドラ | 小 | メモリ解放保証 |
| 2 | Fix 4: WebSocket timeout短縮 | 小 | シグナル応答性向上 |
| 3 | Fix 3: keep-alive出力 | 小 | false timeout防止 |
| 4 | Fix 2: progress改行 | 小 | stderr確実配信 |
| 5 | Fix 5: try/finally | 小 | 防御的クリーンアップ |

全Fix合計で ai-media.py への変更のみ。media-commands.ts側の変更は不要。

---

## 7. 検証方法

1. **再現テスト**: `/edit` を実行し、ComfyUI推論中に `kill -SIGTERM <ai-media.py PID>` を手動送信
2. **ログ確認**: `[ai-media] SIGTERM received, cleaning up...` が出力されること
3. **メモリ確認**: SIGTERM後に `curl http://127.0.0.1:8188/system_stats` でモデルがアンロードされていること
4. **連続テスト**: `/edit` を2回連続実行し、2回目がSIGTERMなしで完了すること
5. **activity timeout**: ComfyUI推論中のstderr出力（keep-alive含む）がNode.js側で受信されていることを `[media]` ログで確認

---

## 8. 関連ファイル

| ファイル | 関連行 | 内容 |
|---------|--------|------|
| `src/handlers/media-commands.ts` | 47-48, 169-252, 372-569 | タイムアウト設定、runAiMedia、handleEdit |
| `scripts/ai-media.py` | 537-697, 2541-2607 | cmd_edit、comfyui_queue_and_wait |
| `src/index.ts` | 127-133, 545-555 | Grammy timeout、SIGTERM handler |
| `src/config.ts` | 144 | QUERY_TIMEOUT_MS |

---

## 9. 既知の緩和策（実装済み）

| 対策 | 導入時期 | 効果 | 残課題 |
|------|---------|------|--------|
| Media Queue直列化 | 2026-02 | 並列実行のメモリ圧迫防止 | 単発SIGTERMは防げない |
| Grammy timeoutSeconds: 300 | 2026-02-16 | アップロードタイムアウト改善 | 根本原因ではない |
| PYTHONUNBUFFERED=1 | 初期実装 | stderr即時出力 | `\r`のみの行はNode.jsでバッファされる可能性 |
| activity-based timeout | 初期実装 | 無活動時のみタイムアウト | 沈黙区間で誤発火 |
