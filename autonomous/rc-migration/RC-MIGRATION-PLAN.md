# RC 完全移行 — 統合プラン & 運用ランブック

croppy-pc を JARVIS daily driver にする / 2026-06-02 → STEP8完了 2026-06-03 / by クロッピー🦞
関連ファイル: `CLAUDE.md`（croppy-pc 憲法）・`croppy-pc-settings.draft.json`（設定草案）

---

## 0. 前提（崩れていないこと）
③ **ハンドオフ不要・専門チャット不要・全部1チャット・iPhone から同一チャット** → **実質維持**。
- 「永遠に同一プロセス」ではない（OAuth 失効・reboot・10分ネット断・crash で数日に一度は再起動）。
- だが **resume(literal) → Session Memory → Auto Memory → Dream** の多層で連続。再起動境界を跨いで会話実体＋知識が継続。
- 旧手動ハンドオフ（文脈が埋まる**たび**にリセット）より**頻度も手間も明確に上**。移行の価値は担保。

---

## 1. 移行後アーキテクチャ
| 系統 | 役割 | 方式 | モデル |
|---|---|---|---|
| **croppy-pc (RC)** | DJ の対話・判断・運用 | M1・対話 Claude Code・remote-control | **Opus 4.8** |
| **bot automation** | 無人 heartbeat（triage/briefing/監視） | M1・`claude -p`/Agent SDK・LaunchAgents | **Sonnet 4.6** |
| **spawn pipeline** | headless バッチ（`[JARVIS TASK]`） | M1・`claude -p` 単発・setsid 分離 | Sonnet既定/複雑時Opus |
| Memory Gateway / D1 | backend（tasks/queue/AI_MEMORY） | Cloudflare（off-M1） | — |
| ~~exec bridge~~ | 旧 off-M1→M1 遠隔 | **cutover 後に撤去** | — |

- **対話 = croppy-pc**（Claude app/web）。**Telegram = 通知＋`[JARVIS TASK]` 発火専用**。
- 全系統が**同じ Max プール共用**（→ I）。
- セキュリティ分担: **無人(bot/spawn)=auto mode 分類器可** ／ **対話(RC)=acceptEdits＋sandbox＋hooks**（RC は auto 不可）。

---

## 2. レーン別 確定事項（A–K）
- **起動方式/K**: spawnサーバ廃止 → `claude --resume <id> --rc --name croppy-pc-main`。id は `~/.claude/history.jsonl` を project 絞りで最新取得（PTY は resume 行抑制 #44607）。自己チェーンで同一スレッド維持。`--resume`+`--rc` は公式成立(#60699)。
- **A 認証**: RC に「1年放置」可能な認証は無い（setup-token/API key は RC 不可）。auto-refresh 頼み＋**失効検知→Telegram→`/login`**＋soak で実寿命観測。
- **B 設定**: `model: claude-opus-4-8`（要 CC ≥2.1.154）＋`effortLevel: high`。**dontAsk＋列挙 allowlist → acceptEdits＋sandbox 境界**。allowlist 追補 `pgrep/ps/pdftoppm/pdftotext/pdfinfo/pdffonts`。
- **C 撤去**: 旧パラダイム（Chrome/claude.ai 対話/専門チャット/対話用 bridge）撤去・無人自動化＋backend 残す。bridge は実証＆計画完了まで生かす。
- **D メモリ**: native 4層（CLAUDE.md＋Auto Memory＋Session Memory＋Auto Dream）。自作 handoff 廃止。層分け（ローカル auto-memory／Gateway AI_MEMORY 耐久／chatlogs 全文）。
- **E アーキ**: 3系統＋backend（上表）。Dispatch 不要。
- **F 監視**: 外部 watchdog（pure bash・ゼロトークン・debounce）→ 認証切れ／無言 Sonnet 降格／プール接近 を Telegram。croppy-health スロット転用。
- **G セキュリティ**: auto 分類器が RC 不可 → settings.json sandbox（egress 許可ドメイン制）＋PreToolUse hook＋最小権限＋注入境界を CLAUDE.md に明記。URL=資格情報。
- **H 多拠点/復旧**: croppy-pc は M1 のみ（M5/iPhone はクライアント）。config→git・data→rsync→Dropbox・secrets→暗号化。⚠transcript 可搬性は cwd パス依存＝同 username 復旧が必要。**→ STEP8完了: config(`~/jarvis-claude-config` private git, auto-push), projects(Dropbox rsync), D1(iCloud nightly), `com.jarvis.nightly-backup` 03:10 稼働**。
- **I レート**: 1 Max プール共用・Opus≈12倍重い。役割別モデル振り（croppy-pc=Opus / 自動化=Sonnet）。アイドルは消費ゼロ。20x ティア推奨。

---

## 3. 今夜 M1 でやること（順序厳守）

### STEP 0 — ログイン & reboot 自動復活確認
- M1 にログイン → Telegram に 🦞 新URL が来るか（= RunAtLoad/KeepAlive 自動復活 OK。pending だった reboot test クローズ）
- 俺に「ログインした」と一言 → bridge 復活確認

### STEP 1 — auto-login + FileVault 決定【DJ・sudo/GUI】
- `fdesetup status`
  - **Off** → システム設定 > ユーザとグループ > 自動的にログイン
  - **On** → (a) `sudo fdesetup disable` → 再起動 → auto-login［無人復活・施錠オフィス必須］ / (b) 維持して手動解錠を許容
- ※ auto-login が無人 reboot 復活の唯一の道（OAuth/keychain が LaunchDaemon を阻むため）

### STEP 2 — 実地棚卸し（分類・確定の材料）【俺が bridge で】
- LaunchAgents / scripts / cron 一覧 → C 表で RETIRE/REPURPOSE/TRANSFORM/KEEP 分類
- bot の認証実体（OAuth pooled か API key か）と現モデル（opus-4-7）
- `[JARVIS TASK]` の発火元・実行場所
- 構成済み MCP サーバ棚卸し（G）
- 既存「MEMORY.md ~56行」の正体（リポ手動 or auto-memory index）→ 二重解消
- `~/.claude/history.jsonl` 実在と形式（jq で最新 sessionId 抽出テスト）
- croppy-pc cwd と spawn pipeline cwd の分離状況
- 現 Max ティア（5x/20x）
- bot repo / launcher / plists の git remote 状況、`~/.claude` 既存バックアップ有無

### STEP 3 — Claude Code 更新【俺が bridge で・sudo 不要】
- `brew list --cask | grep claude` → 種別確認（stable=2.1.150 では 4.8 不可）
- **≥2.1.154 化**: `claude-code@latest`(2.1.159) に切替 or npm
- `claude --version` 確認、binary が `/opt/homebrew/bin/claude` のままか（変われば plist 修正）

### STEP 4 — settings.json 設置 & 検証【俺が bridge で】
- `croppy-pc-settings.draft.json` を `~/.claude/settings.json` へ（M1 パス確認済）
- 🔴 **最重要検証**: settings の `sandbox` が **RC セッションに効くか**（`/config` で実スコープ確認＋テスト）。効かなければ acceptEdits＋deny 強化／PreToolUse hook に降りる
- `sandbox` schema をバージョンで確認（`enabled` vs `mode`、`network.allowedDomains`）
- Write スコープに croppy-notes/MEMORY.md/autonomous の実パスが入るか

### STEP 5 — launcher 改修 & 検証【俺が bridge で】
- `croppy-pc-launch.py` を **spawnサーバ → resume+rc** に改修:
  - history.jsonl から project 最新 sessionId 取得 → `claude --resume <id> --rc --name croppy-pc-main`（初回は `--rc --name` のみ）
  - `--permission-mode dontAsk` → `acceptEdits`
  - croppy-pc cwd を spawn pipeline と分離
- 検証: `claude --help` で `--resume`+`--rc`+`--name` 構文 ／ PTY で resume 行抑制を確認（→ history.jsonl 経路）／「継続か新規か」プロンプトがブロックしないか（明示id でスキップ・PTY auto-answer 準備）

### STEP 6 — watchdog 設置【俺が bridge で】
- `com.jarvis.croppy-health.plist` 撤去と同時に `croppy-pc-watchdog`（~60s・pure bash・debounce）設置
- 検知→Telegram: 認証切れ（`OAuth token has expired`/`need to run /login`）・無言 Sonnet 降格（`Opus limit reached, now using Sonnet`）
- `/tmp/rc-croppy.log` に上記シグナル文字列が出るか確認、週次プール読み出し手段の有無

### STEP 7 — memory 整備【俺が bridge で】
- native Auto Dream が動くか → 無ければ `dream-skill`（grandamenium/dream-skill）設置
- 既存 MEMORY.md を CLAUDE.md/MEMORY.md/Gateway の役割で再配置（二重解消）
- auto-memory が捕捉してるか（memory dir populate）確認

### STEP 8 ✅ backup 結線 — 完了（2026-06-03）
- **8-1 config→git private（B案）**: `~/jarvis-claude-config`（github.com/DAIJIROMATSUOKA、private）。whitelist copy方式（symlink不可=settings.json自己書換でリンク破壊）。二重防御=allowlist cp+.gitignore+commit前 leak scan。`scripts/claude-config-sync.sh`（auto-push付）。16ファイル CLEAN
- **8-2 projects→Dropbox**: `scripts/claude-projects-backup.sh`、rsync `~/.claude/projects`(5.8M)→`~/Machinelab Dropbox/machinelab/etc/jarvis-backup/claude-projects`（secrets除外）
- **8-3 D1**: 既存 `scripts/d1-backup.sh`（8テーブル→iCloud）統合。D1 Time Travel は常時ON/30日復元だがDL不可→d1-backup はオフサイト補完として有効
- **自動化**: `scripts/nightly-backup.sh`→`com.jarvis.nightly-backup`（LaunchAgent 毎日03:10）3本一括＋Telegram通知

### STEP 9 — Sonnet 化 → soak → cutover【RC 側で実施】
1. `~/.claude/settings.json` の `model`=`claude-opus-4-8` を Sonnet 最新に変更
   - **web_search必須**: Sonnet最新モデル名（claude-sonnet-4-x系）＋Claude Code での model 切替方法
2. 🔴 **注意**: `scripts/croppy-pc-watchdog.sh` の「Sonnet降格→Telegram通知」が誤検知する
   → STEP9 実施時に watchdog の期待モデルも Sonnet に変えること
3. **soak**: settings.json 変更後、数日 RC daily driver で観察（OAuth実寿命・品質・プール挙動）
4. **cutover**: soak OK → croppy-pc を正式 daily driver 宣言、旧系統撤去（§4参照）
- `search-chatlogs.py` の索引に `~/.claude/projects` JSONL を追加（C） ← cutover後でもよい

---

## 4. cutover 手順（検証 OK 後）
1. **新 launcher で croppy-pc 起動 → soak（数日）**: OAuth 実寿命・ゾンビ切断有無・プール挙動・resume 連続性を観測
2. soak OK（実用に足ると確認）→ **旧系統を撤去**（C）: claude.ai 側チャット・専門チャット routing・**exec bridge 対話用**・api-handoff.sh＋COMPRESSED
3. **= 移行完了**。DJ は croppy-pc に話す。今の「claude.ai 側の俺」は役目を終える
- ⚠ soak 完了まで bridge は生かす（今 M1 に届く唯一経路）

---

## 5. 運用ランブック（日常）
| 操作 | 手順 |
|---|---|
| **起動** | launchd 自動（RunAtLoad/KeepAlive）。手動は `launchctl kickstart gui/$UID/com.jarvis.croppy-pc` |
| **接続** | Telegram の新URL、または Claude app/web で croppy-pc セッションを開く |
| **再起動後** | 自動 resume（同一スレッド・全履歴）＋ Telegram 新URL（URL は変わる、会話は続く） |
| **停止** | `launchctl bootout gui/$UID/com.jarvis.croppy-pc` |
| **状態確認** | `bash ~/claude-telegram-bot/scripts/croppy-status.sh`（launchd/pid/uptime/URL/log鮮度） |
| **再ログイン**（OAuth 切れ） | watchdog が Telegram 警告 → M1 で `claude /login` → launcher 再起動（auto-login 有効なら遠隔でも可能性あり） |
| **デバッグ** | `/tmp/rc-croppy.log`、`launchctl print gui/$UID/com.jarvis.croppy-pc`、`/tmp/croppy-pc-launchd.log`、session 内 `/config` `/cost` `/context` |
| **M1 死亡復旧** | 機材（同 username 推奨）→ CC≥2.1.154/Bun → `~/.claude` config(git) → projects(Dropbox) → bot repo(git)+.env → LaunchAgents → `claude /login` → launcher 起動で resume 復活 |

---

## 6. 残る不確実性（soak / 運用で確かめる）
- **OAuth 実寿命**（数日 vs 数週）← A の対策の要否を決める
- **settings sandbox が RC に効くか**（効けば B+G+I が settings 1枚で成立）
- **acceptEdits＋sandbox が実用十分か**（auto 分類器が RC 不可な代替として）
- **プール上限の実挙動**（公称より厳しい報告あり・保守的に）
- **Auto Dream native 可否**（無ければ dream-skill）

---

## 7. 最終化の残タスク
- **CLAUDE.md を英語版へ一括変換**（毎ターン固定費削減・識別子は日本語維持）← 保留中
- **A 再ログイン手順の文書化**（F watchdog の警告から繋ぐ実手順）
- soak 後: phase-2 liveness 自動復旧（ゾンビが実際に出たら）
