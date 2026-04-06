#!/bin/bash
# Quick Access DB query via Parallels COM
# Usage: access-query.sh "SQL query" [output_file]
set -e
SQL="$1"
OUT="${2:-$HOME/Documents/access-result.json}"
DB_SRC="$HOME/Library/CloudStorage/Dropbox-Machinelab/machinelab/etc/ACCESS/MLDatabase.accdb"
DB_TMP="$HOME/Documents/MLDatabase-tmp.accdb"

# Copy from Dropbox
cp "$DB_SRC" "$DB_TMP" 2>/dev/null

# Write PowerShell script
PS1_FILE="$HOME/Documents/access-query.ps1"
cat > "$PS1_FILE" << PSEOF
\$ErrorActionPreference = 'Stop'
\$dbPath = Join-Path \$env:TEMP 'MLDatabase-tmp.accdb'
Copy-Item '\\Mac\Home\Documents\MLDatabase-tmp.accdb' \$dbPath -Force

\$access = New-Object -ComObject Access.Application
\$access.OpenCurrentDatabase(\$dbPath)
\$db = \$access.CurrentDb()

\$sql = ''
\$rs = \$db.OpenRecordset(\$sql, 4)

\$results = @()
while (-not \$rs.EOF) {
    \$row = @{}
    for (\$i = 0; \$i -lt \$rs.Fields.Count; \$i++) {
        \$row[\$rs.Fields.Item(\$i).Name] = \$rs.Fields.Item(\$i).Value
    }
    \$results += \$row
    \$rs.MoveNext()
}
\$rs.Close()
\$access.CloseCurrentDatabase()
\$access.Quit()

\$results | ConvertTo-Json -Depth 3 | Out-File '\\Mac\Home\Documents\access-result.json' -Encoding UTF8
PSEOF

# Run via Parallels
prlctl exec "DJ's Windows 11" powershell.exe -ExecutionPolicy Bypass -File "\\Mac\Home\Documents\access-query.ps1" 2>&1

# Read result
cat "$OUT" 2>/dev/null
