#!/usr/bin/env python3
"""Access DB customer lookup via Parallels COM
Usage: access-customer-lookup.py 顧客名 [--limit N]
"""
import os, sys, subprocess, shutil

if len(sys.argv) < 2:
    print("ERROR: usage: access-customer-lookup.py 顧客名")
    sys.exit(1)

customer = sys.argv[1]
limit = 20
if "--limit" in sys.argv:
    idx = sys.argv.index("--limit")
    if idx + 1 < len(sys.argv):
        limit = int(sys.argv[idx + 1])

home = os.path.expanduser("~")
db_src = os.path.join(home, "Machinelab Dropbox/Matsuoka Daijiro/MLDatabase.accdb")
db_tmp = os.path.join(home, "Documents/MLDatabase-tmp.accdb")
ps1_path = os.path.join(home, "Documents/customer-lookup.ps1")
result_path = os.path.join(home, "Documents/customer-result.txt")

shutil.copy2(db_src, db_tmp)
if os.path.exists(result_path):
    os.remove(result_path)

sql = (
    "SELECT TOP {limit} \u898b\u7a4d\u66f8.\u898b\u7a4d\u66f8No, \u898b\u7a4d\u66f8.\u30de\u30b7\u30f3No, "
    "\u898b\u7a4d\u66f8.\u540d\u79f0, \u898b\u7a4d\u66f8.\u88c5\u7f6e\u540d, "
    "\u898b\u7a4d\u66f8.\u53d7\u6ce8, \u898b\u7a4d\u66f8.\u5374\u4e0b, "
    "\u8ca9\u58f2\u5148.\u8ca9\u58f2\u5148 "
    "FROM (\u898b\u7a4d\u66f8 "
    "LEFT JOIN \u30d7\u30ed\u30b8\u30a7\u30af\u30c8\u30c7\u30fc\u30bf "
    "ON \u898b\u7a4d\u66f8.\u30d7\u30ed\u30b8\u30a7\u30af\u30c8No = "
    "\u30d7\u30ed\u30b8\u30a7\u30af\u30c8\u30c7\u30fc\u30bf.\u30d7\u30ed\u30b8\u30a7\u30af\u30c8No) "
    "LEFT JOIN \u8ca9\u58f2\u5148 ON "
    "\u30d7\u30ed\u30b8\u30a7\u30af\u30c8\u30c7\u30fc\u30bf.\u8ca9\u58f2\u5148ID = \u8ca9\u58f2\u5148.\u8ca9\u58f2\u5148ID "
    "WHERE \u8ca9\u58f2\u5148.\u8ca9\u58f2\u5148 LIKE '*{cust}*' "
    "ORDER BY \u898b\u7a4d\u66f8.\u898b\u7a4d\u66f8No DESC"
).format(limit=limit, cust=customer.replace("'", "''"))

ps1_content = """$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$src = '\\\\Mac\\Home\\Documents\\MLDatabase-tmp.accdb'
$localDb = Join-Path $env:TEMP 'MLDatabase-tmp.accdb'
$outFile = '\\\\Mac\\Home\\Documents\\customer-result.txt'
Copy-Item $src $localDb -Force
$access = New-Object -ComObject Access.Application
$access.Visible = $false
$access.OpenCurrentDatabase($localDb, $true)
$db = $access.CurrentDb()
$sql = "{sql}"
$rs = $db.OpenRecordset($sql, 2, 0)
$lines = @()
while (-not $rs.EOF) {{
    $no = $rs.Fields.Item('\u898b\u7a4d\u66f8No').Value
    $m = $rs.Fields.Item('\u30de\u30b7\u30f3No').Value
    $nm = $rs.Fields.Item('\u540d\u79f0').Value
    $dev = $rs.Fields.Item('\u88c5\u7f6e\u540d').Value
    $won = $rs.Fields.Item('\u53d7\u6ce8').Value
    $rej = $rs.Fields.Item('\u5374\u4e0b').Value
    $cust = $rs.Fields.Item('\u8ca9\u58f2\u5148').Value
    if ($won) {{ $status = '\u53d7\u6ce8' }} elseif ($rej) {{ $status = '\u5374\u4e0b' }} else {{ $status = '\u9032\u884c\u4e2d' }}
    $lines += "$m|$cust|$nm|$dev|$status|No.$no"
    $rs.MoveNext()
}}
$rs.Close()
$access.CloseCurrentDatabase()
$access.Quit()
if ($lines.Count -eq 0) {{
    'NOT_FOUND' | Out-File $outFile -Encoding UTF8
}} else {{
    $lines -join "`n" | Out-File $outFile -Encoding UTF8
}}
""".format(sql=sql)

with open(ps1_path, 'w', encoding='utf-8-sig') as f:
    f.write(ps1_content)

result = subprocess.run(
    ['prlctl', 'exec', "DJ's Windows 11", 'powershell.exe', '-ExecutionPolicy', 'Bypass', '-File',
     '\\\\Mac\\Home\\Documents\\customer-lookup.ps1'],
    capture_output=True, text=True, timeout=60
)

if os.path.exists(result_path):
    with open(result_path, 'r', encoding='utf-8-sig') as f:
        data = f.read().strip()
    if data == 'NOT_FOUND':
        print(f"{customer} の案件が見つかりませんでした。")
    else:
        lines = data.split('\n')
        won_count = sum(1 for l in lines if '\u53d7\u6ce8' in l)
        prog_count = sum(1 for l in lines if '\u9032\u884c\u4e2d' in l)
        print(f"\U0001F4CA {customer} — {len(lines)}件 (\u53d7\u6ce8{won_count} / \u9032\u884c\u4e2d{prog_count})")
        print()
        for line in lines:
            parts = line.strip().split('|')
            if len(parts) >= 6:
                m, cust, nm, dev, status, no = parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]
                icon = "\u2705" if status == "\u53d7\u6ce8" else "\u274c" if status == "\u5374\u4e0b" else "\u23f3"
                print(f"  {icon} {m} | {nm} | {status} | {no}")
else:
    print("ERROR: query failed")
    if result.stderr:
        print(result.stderr[:200])
