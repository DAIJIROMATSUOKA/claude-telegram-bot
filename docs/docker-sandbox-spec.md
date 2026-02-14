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
