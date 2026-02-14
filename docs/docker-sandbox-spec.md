# Docker Sandbox + Three-Tier Validator 仕様書
**日付:** 2026-02-14
**ステータス:** CONVERGED (Croppy × GPT 4ラウンドディベート)

---

## 設計思想
Claude CLIが生成したコードのテスト実行をDockerサンドボックスで隔離する。
Validatorは3層に再編し、Docker有無で適用レベルを切り替える。

---

## Three-Tier Validator

### Tier 1: ALWAYS_BLOCK（Docker有無に関係なく常時ブロック）
目的: サンドボックス脱出・ビルド攻撃・環境変数一括漏洩の防止

```
# Docker脱出
docker.sock, /proc/(self|\d+)/(environ|cmdline|fd), mount, nsenter, --privileged, unshare, setns, ptrace

# ビルド攻撃
npm install, curl|bash, wget, pip install

# 環境変数バルクダンプ
Object.keys(process.env), JSON.stringify(process.env), Object.entries(process.env)
for...of process.env, console.log(process.env), process.env全体参照
```

### Tier 2: DOCKER_BLOCK（Docker実行時のみ追加ブロック）
目的: stdout経由の秘密漏洩防止

```
# 秘密ファイル読み取り
.env, *.pem, id_rsa, credential, token系ファイルのread

# dotenv
require('dotenv'), import 'dotenv'

# 2-hit: env参照 + 出力（ファイル含む）
process.env.* と console.log/stdout/fs.writeFile/Bun.write の組み合わせ
```

### Tier 3: HOST_ONLY_BLOCK（Docker無し時のみブロック）
目的: ホスト直接実行時の安全確保（現行DANGEROUS_SYMBOL_PATTERNSそのまま）

```
fs.rmSync, child_process, eval, new Function, execSync, spawnSync,
process.exit, Bun.spawn, Bun.$, Bun.shell, bun:ffi,
ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY
```

**→ Docker実行時はTier3をスキップ（Validatorパラドックス解消）**

---

## Docker実行構成

```bash
docker run --rm \
  --network=none \
  --memory=2g --cpus=2 --pids-limit=256 \
  --cap-drop=ALL --security-opt=no-new-privileges \
  --read-only --tmpfs /tmp:rw,noexec,size=500m \
  -e HOME=/tmp \
  -v /src:/app/src:ro \
  -v /tsconfig.json:/app/tsconfig.json:ro \
  -v /package.json:/app/package.json:ro \
  -v /sandbox:/app/sandbox:rw \
  --user 1000:1000 \
  jarvis-test-runner:latest \
  bun test /app/sandbox/*.test.ts
```

### マウントルール [DECIDED]
- src/ のみRO（.env, .git, node_modules はマウント禁止）
- tsconfig.json, package.json はROで個別マウント
- /sandbox のみRW（生成コード+テスト結果）

### 事前ビルドイメージ [DECIDED]
```Dockerfile
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
USER 1000
```

---

## stdout/stderr セキュリティ [DECIDED]

### Redaction（ログ保存前）
- sk-ant-*, sk-*, TELEGRAM_BOT_TOKEN=* をマスク
- base64文字列 >100文字をマスク
- JWT形式（eyJ...）をマスク

### 出力制限
- 総量上限: 80KB（既存MAX_OUTPUT）
- ストリーミング取り込み → 上限カット → redact → 保存

---

## フォールバック [DECIDED]

| Docker状態 | 動作 |
|-----------|------|
| 利用可能 | Tier1 + Tier2適用、Tier3スキップ |
| 利用不可 | Tier1 + Tier2 + Tier3全適用（現行動作） |
| 不明/エラー | 実行中止（fail-closed） |

Orchestrator起動時にdocker pingで可用性チェック。

---

## 却下した案と理由

| 案 | 却下理由 |
|----|---------|
| A) test.ts例外 | ファイル名偽装で回避可能 |
| B) Validator完全削除 | Docker不可時に無防備 |
| C) Advisory only | 無人夜間運転では警告を見る人がいない |
| AST解析 | 複雑すぎる、部分的に壊れたコードでパース失敗する |
| Docker内Claude CLI | macOS Keychain依存で認証不可 |

---

## Phase計画

### Phase 1: Docker統合（最小）
- Dockerfileビルド
- executor.tsにDocker実行パス追加
- docker ping可用性チェック

### Phase 2: Validator三層化
- ALWAYS_BLOCK / DOCKER_BLOCK / HOST_ONLY_BLOCK分離
- dockerAvailableフラグによる切り替え

### Phase 3: stdout redaction
- secretフィルタ実装
- ストリーミング上限処理

### Phase 4: Docker hardening
- non-root / cap-drop=ALL / no-new-privileges 検証
- HOME=/tmp動作確認
- seccomp profile（任意）

---

## max_changed_files_per_task ルール [DECIDED]
**ディベート:** Croppy × GPT, 3ラウンド CONVERGED (2026-02-14)

### 変更
- max_changed_files_per_task: 3 → **5**

### 禁止ファイル（テスト作成タスク）
package.json, bun.lock, bun.lockb, package-lock.json, yarn.lock, pnpm-lock.yaml

理由: テスト作成タスクがこれらを変更する正当な理由はゼロ。変更があれば異常。

### 却下した追加ガード
| 案 | 却下理由 |
|----|---------|
| blocked_paths全般 | 既存6層バリデーションで十分 |
| max_new_files=2 | 厳しすぎ。test+fixture+helperで3ファイルは正当 |
| require_change_rationale | Claude CLIに構造化報告機能がない |
| 8-10に引き上げ | 朝のレビュー負荷が爆増 |

---

## Tier 1 パラドックス + banned_patterns 対応 [DECIDED]
**ディベート:** Croppy × GPT, 3ラウンド CONVERGED (2026-02-14)

### 決定事項
1. **Validator無変更** — Tier 1, banned_patterns のロジックは一切触らない
2. **Tier 1テストは手書き固定** — ALWAYS_BLOCK_PATTERNS のテストは人間が作成・レビュー。自動生成対象外
3. **banned_patterns維持** — リポジトリ/成果物汚染防止の安全網として例外を設けない
4. **テストデータ回避パターン** — banned_patternsに一致する文字列は分割連結で回避:
   ```typescript
   const token = 'TELE' + 'GRAM_BOT_TOKEN=abc123'; // banned_patternsを踏まない
   ```

### 自動生成対象外の領域
- Tier 1 (ALWAYS_BLOCK_PATTERNS) のテスト
- banned_patterns に一致する文字列を含むテスト
- セキュリティパターンの回帰テスト全般

### 却下した案と理由
| 案 | 却下理由 |
|----|---------|
| 文字列リテラル状態機械 | AST無しでは脆弱（ネスト引用符、テンプレートリテラル、エスケープ） |
| expect()行スキップ | 攻撃者がexpect(doBadThing())で回避可能 |
| Tier 1 Docker-skip | Tier 1の存在意義（Docker脱出防止）を破壊 |
| banned_patterns削除 | 本物トークン混入の安全網が消える |
| ファイル名allowlist | 運用負荷高、攻撃面拡大 |
