# KV STUDIO 登録モニタファイル (.kmu) フォーマット & 生成

解読・検証: 2026-06-03（旧クロッピー作の `IA1_auto_run_monitor.kmu` を解析、バイト単位再現に成功）。
用途: ラダー解析・デバッグ時に「監視したいデバイス群」をまとめた登録モニタを**コードで自動生成** → KV STUDIO に読込。手作業の登録が不要。

## ファイル仕様
- **エンコード: UTF-16LE + BOM (`FF FE`)、改行 CRLF**（これを外すとKV STUDIOが読めない）
- 構造:
  ```
  {
  monitor(c) v1                ← フォーマット署名(固定)
  135,97,1000,800,1800,1350,1350,1800,1350,900,450,1800,7410,0,0,   ← レイアウト整数15個(ウィンドウ位置/列幅)+末尾カンマ
  1,1,1,1,1,1,                 ← 列表示フラグ(6列)+末尾カンマ
  ｸﾞﾛｰﾊﾞﾙ,MR1101,0,運転可能,    ← データ行: group,device,radix,comment, (末尾カンマ)
  ｸﾞﾛｰﾊﾞﾙ,DM2000,2,運転起動条件数,
  ｸﾞﾛｰﾊﾞﾙ,W1410,3,目標位置_IA01,
  ...
  }
  ```
- **group**: 既定 `ｸﾞﾛｰﾊﾞﾙ`（「グローバル」半角ｶﾅ＝デバイススコープ）
- **radix（表示形式コード）** ※確認済み:
  | コード | 意味 | 例 |
  |---|---|---|
  | 0 | ビット(ON/OFF) | MR/CR/B/LR等リレー |
  | 2 | 10進16bit | DM/W(制御信号・アラームコード・No.等) |
  | 3 | 10進32bit(2語) | W(目標位置/現在位置/現在速度) |
  | 4,5… | HEX/浮動小数(未確認) | 要実機検証 |

## 生成スクリプト
`scripts/make-kmu.py` — TSV(device, comment, [radix]) → 正しい.kmuを出力。radix省略時は自動推定(ビット系=0/ワード系=2)、32bit値は明示で3。

```bash
# rows.tsv:  デバイス<TAB>コメント<TAB>radix(省略可)
#   MR1101	運転可能	0
#   W1410	目標位置_IA01	3
python3 scripts/make-kmu.py rows.tsv out.kmu      # ファイル入力
cat rows.tsv | python3 scripts/make-kmu.py - out.kmu   # stdin
```
検証: 元ファイルから抽出したTSVで再生成 → `cmp`でバイト完全一致を確認済み。

## 作り方の実務フロー（解析→モニタ生成）
1. 監視対象を決める（例: IA1軸の自動運転 = 運転可能/起動/運転中/異常 + 起動条件1-16 + PCON状態語 + W-area位置/速度）。
2. ラダーの.html/コメントCSVから該当デバイスとコメントを拾う（`workspace/*-analysis/ladder-txt/` をgrep）。
3. TSV化（device, comment, radix）。W-areaの位置/速度は radix=3。
4. `make-kmu.py` で.kmu生成 → 案件の `_AI解析_croppy/monitors/` か PLCフォルダに置く → KV STUDIOで開く。

## 関連（M1312の例 = IAI PCON EtherNet/IP モニタ）
W-area がそのまま **PCON EtherNet/IP のサイクリック占有域**:
- W141F=制御信号2, W140F=状態信号2, W1410=目標位置, W1400=現在位置, W1404=現在速度, W1406=アラームコード
- → PCON No.84(動作モード)の占有バイト数と対応。EtherNet/IP接続資料は `workspace/iai-manuals/`。
