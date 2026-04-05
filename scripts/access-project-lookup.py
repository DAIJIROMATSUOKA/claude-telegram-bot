#!/usr/bin/env python3
"""Access DB project lookup by M-number via Parallels COM"""
import os, sys, subprocess, shutil

if len(sys.argv) < 2:
    print("ERROR: usage: access-project-lookup.py M1314")
    sys.exit(1)

mnum = sys.argv[1].upper()
home = os.path.expanduser("~")
db_src = os.path.join(home, "Machinelab Dropbox/Matsuoka Daijiro/MLDatabase.accdb")
db_tmp = os.path.join(home, "Documents/MLDatabase-tmp.accdb")
ps1_path = os.path.join(home, "Documents/project-lookup.ps1")
result_path = os.path.join(home, "Documents/project-result.txt")

# Copy DB
shutil.copy2(db_src, db_tmp)
if os.path.exists(result_path):
    os.remove(result_path)

sql = (
    "SELECT \u898b\u7a4d\u66f8.\u898b\u7a4d\u66f8No, \u898b\u7a4d\u66f8.\u30de\u30b7\u30f3No, \u898b\u7a4d\u66f8.\u88c5\u7f6e\u540d, \u898b\u7a4d\u66f8.\u540d\u79f0, "
    "\u898b\u7a4d\u66f8.\u53d7\u6ce8, \u898b\u7a4d\u66f8.\u5374\u4e0b, \u8ca9\u58f2\u5148.\u8ca9\u58f2\u5148 "
    "FROM (\u898b\u7a4d\u66f8 "
    "LEFT JOIN \u30d7\u30ed\u30b8\u30a7\u30af\u30c8\u30c7\u30fc\u30bf ON \u898b\u7a4d\u66f8.\u30d7\u30ed\u30b8\u30a7\u30af\u30c8No = \u30d7\u30ed\u30b8\u30a7\u30af\u30c8\u30c7\u30fc\u30bf.\u30d7\u30ed\u30b8\u30a7\u30af\u30c8No) "
    "LEFT JOIN \u8ca9\u58f2\u5148 ON \u30d7\u30ed\u30b8\u30a7\u30af\u30c8\u30c7\u30fc\u30bf.\u8ca9\u58f2\u5148ID = \u8ca9\u58f2\u5148.\u8ca9\u58f2\u5148ID "
    f"WHERE \u898b\u7a4d\u66f8.\u30de\u30b7\u30f3No LIKE '{mnum}*'"
)

ps1_content = f"""$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$src = '\\\\Mac\\Home\\Documents\\MLDatabase-tmp.accdb'
$localDb = Join-Path $env:TEMP 'MLDatabase-tmp.accdb'
$outFile = '\\\\Mac\\Home\\Documents\\project-result.txt'
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
    $dev = $rs.Fields.Item('\u88c5\u7f6e\u540d').Value
    $subj = $rs.Fields.Item('\u540d\u79f0').Value
    $won = $rs.Fields.Item('\u53d7\u6ce8').Value
    $rej = $rs.Fields.Item('\u5374\u4e0b').Value
    $cust = $rs.Fields.Item('\u8ca9\u58f2\u5148').Value
    if ($won) {{ $status = '\u53d7\u6ce8' }} elseif ($rej) {{ $status = '\u5374\u4e0b' }} else {{ $status = '\u9032\u884c\u4e2d' }}
    $lines += "$m|$cust|$subj|$dev|$status|No.$no"
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
"""

with open(ps1_path, 'w', encoding='utf-8-sig') as f:
    f.write(ps1_content)

result = subprocess.run(
    ['prlctl', 'exec', "DJ's Windows 11", 'powershell.exe', '-ExecutionPolicy', 'Bypass', '-File', '\\\\Mac\\Home\\Documents\\project-lookup.ps1'],
    capture_output=True, text=True, timeout=45
)

if os.path.exists(result_path):
    with open(result_path, 'r', encoding='utf-8-sig') as f:
        data = f.read().strip()
    if data == 'NOT_FOUND':
        print(f"{mnum} \u306e\u60c5\u5831\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3067\u3057\u305f\u3002")
    else:
        for line in data.split('\n'):
            parts = line.strip().split('|')
            if len(parts) >= 6:
                print(f"\U0001F4CB {parts[0]} | {parts[1]}")
                print(f"   \u540d\u79f0: {parts[2]}")
                print(f"   \u88c5\u7f6e: {parts[3]}")
                print(f"   \u72b6\u614b: {parts[4]} | {parts[5]}")
                print()
else:
    print("ERROR: query failed")
    if result.stderr:
        print(result.stderr[:200])
