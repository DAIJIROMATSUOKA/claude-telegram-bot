#!/usr/bin/env python3
"""
KV STUDIO 登録モニタファイル (.kmu) ジェネレータ.

.kmu フォーマット (解読 2026-06-03):
  - エンコード: UTF-16LE + BOM, 改行 CRLF
  - 1行目: "{"
  - 2行目: "monitor(c) v1"           (フォーマット署名)
  - 3行目: レイアウト整数15個 + 末尾カンマ (ウィンドウ位置/列幅)
  - 4行目: 列表示フラグ "1,1,1,1,1,1," (6列)
  - データ行: "<group>,<device>,<radix>,<comment>,"
      group : 既定 "ｸﾞﾛｰﾊﾞﾙ" (グローバル, 半角ｶﾅ)
      radix : 0=ビット, 2=10進16bit, 3=10進32bit(位置/速度等2語), 4=HEX(推定), 5=浮動小数(推定)
  - 最終行: "}"

入力 (TSV, stdin かファイル): 1行 = device <TAB> comment [<TAB> radix]
  radix 省略時は自動推定 (ビット系=0, ワード系=2). 32bit値は明示で 3 を指定.
  '#' 始まりと空行は無視.

使い方:
  python3 make-kmu.py rows.tsv out.kmu
  cat rows.tsv | python3 make-kmu.py - out.kmu
"""
import sys, re

DEFAULT_GROUP = "ｸﾞﾛｰﾊﾞﾙ"
DEFAULT_LAYOUT = "135,97,1000,800,1800,1350,1350,1800,1350,900,450,1800,7410,0,0,"
DEFAULT_FLAGS = "1,1,1,1,1,1,"
SIGNATURE = "monitor(c) v1"

# ビットデバイス接頭辞 (ON/OFF表示=radix 0)
BIT_PREFIXES = ("MR", "LR", "CR", "B", "VB", "T", "C", "R", "L", "M")

def infer_radix(device: str) -> int:
    d = device.upper()
    # 数字を除いた接頭辞
    m = re.match(r'([A-Z]+)', d)
    pre = m.group(1) if m else ""
    if pre in ("DM", "EM", "FM", "ZF", "W", "TM", "Z", "VM", "CM"):
        return 2          # ワード -> 10進16bit
    if pre in BIT_PREFIXES:
        return 0          # ビット -> ON/OFF
    return 2

def build(rows, group=DEFAULT_GROUP, layout=DEFAULT_LAYOUT, flags=DEFAULT_FLAGS):
    out = ["{", SIGNATURE, layout, flags]
    for r in rows:
        device, comment, radix = r
        out.append(f"{group},{device},{radix},{comment},")
    out.append("}")
    return out

def parse_tsv(text):
    rows = []
    for line in text.splitlines():
        line = line.rstrip("\r\n")
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        parts = line.split("\t")
        device = parts[0].strip()
        comment = parts[1].strip() if len(parts) > 1 else ""
        radix = int(parts[2]) if len(parts) > 2 and parts[2].strip() else infer_radix(device)
        rows.append((device, comment, radix))
    return rows

def write_kmu(path, lines):
    # UTF-16LE + BOM, CRLF
    data = "\r\n".join(lines) + "\r\n"
    with open(path, "wb") as f:
        f.write(b"\xff\xfe")                      # BOM (LE)
        f.write(data.encode("utf-16-le"))

def main():
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    src, dst = sys.argv[1], sys.argv[2]
    text = sys.stdin.read() if src == "-" else open(src, encoding="utf-8").read()
    rows = parse_tsv(text)
    lines = build(rows)
    write_kmu(dst, lines)
    print(f"wrote {dst}: {len(rows)} devices")

if __name__ == "__main__":
    main()
