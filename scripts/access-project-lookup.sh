#!/bin/bash
# Access DB project lookup by M-number via Parallels COM
# Usage: access-project-lookup.sh M1314
set -e
MNUM="$1"
if [ -z "$MNUM" ]; then echo 'ERROR: usage: access-project-lookup.sh M1314'; exit 1; fi

DB_SRC="$HOME/Library/CloudStorage/Dropbox-Machinelab/machinelab/etc/ACCESS/MLDatabase.accdb"
DB_TMP="$HOME/Documents/MLDatabase-tmp.accdb"
RESULT_FILE="$HOME/Documents/project-result.txt"

cp "$DB_SRC" "$DB_TMP" 2>/dev/null || true
rm -f "$RESULT_FILE"

python3 << PYEOF
import os

mnum = "$MNUM"
home = os.path.expanduser("~")
ps1_path = os.path.join(home, "Documents", "project-lookup.ps1")

sql = (
    "SELECT 見積書.見積書No, 見積書.マシンNo, 見積書.装置名, 見積書.件名, "
    "見積書.受注, 見積書.却下, 販売先.会社名 "
    "FROM 見積書 "
    "LEFT JOIN プロジェクトデータ ON 見積書.プロジェクトNo = プロジェクトデータ.プロジェクトNo "
    "LEFT JOIN 販売先 ON プロジェクトデータ.販売先ID = 販売先.販売先ID "
    f"WHERE 見積書.マシンNo LIKE '{mnum}%'"
)

ps1 = r'''
\$ErrorActionPreference = 'Stop'
\$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
\$src = '\\\\Mac\\Home\\Documents\\MLDatabase-tmp.accdb'
\$localDb = Join-Path \$env:TEMP 'MLDatabase-tmp.accdb'
\$outFile = '\\\\Mac\\Home\\Documents\\project-result.txt'
Copy-Item \$src \$localDb -Force
\$access = New-Object -ComObject Access.Application
\$access.Visible = \$false
\$access.OpenCurrentDatabase(\$localDb, \$true)
\$db = \$access.CurrentDb()
'''.lstrip()

ps1 += f'\n\$sql = "{sql}"\n'

ps1 += r'''
\$rs = \$db.OpenRecordset(\$sql, 4)
\$lines = @()
while (-not \$rs.EOF) {
    \$no = \$rs.Fields.Item('見積書No').Value
    \$m = \$rs.Fields.Item('マシンNo').Value
    \$dev = \$rs.Fields.Item('装置名').Value
    \$subj = \$rs.Fields.Item('件名').Value
    \$won = \$rs.Fields.Item('受注').Value
    \$rej = \$rs.Fields.Item('却下').Value
    \$cust = \$rs.Fields.Item('会社名').Value
    if (\$won) { \$status = '受注' } elseif (\$rej) { \$status = '却下' } else { \$status = '進行中' }
    \$lines += "\$m|\$cust|\$subj|\$dev|\$status|No.\$no"
    \$rs.MoveNext()
}
\$rs.Close()
\$access.CloseCurrentDatabase()
\$access.Quit()
if (\$lines.Count -eq 0) {
    'NOT_FOUND' | Out-File \$outFile -Encoding UTF8
} else {
    \$lines -join "`n" | Out-File \$outFile -Encoding UTF8
}
'''

# Remove the backslash before dollar signs (they were escaped for bash heredoc)
ps1 = ps1.replace(r'\$', '$').replace('\\\\\\\\', '\\\\')

with open(ps1_path, 'w', encoding='utf-8-sig') as f:
    f.write(ps1)
PYEOF

prlctl exec "DJ's Windows 11" powershell.exe -ExecutionPolicy Bypass -File "\\\\Mac\\Home\\Documents\\project-lookup.ps1" > /dev/null 2>&1

if [ -f "$RESULT_FILE" ]; then
  cat "$RESULT_FILE"
else
  echo "ERROR: query failed"
fi
