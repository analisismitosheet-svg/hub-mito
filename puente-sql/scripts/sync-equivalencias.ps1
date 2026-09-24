# Corre la sincronización de equivalencias (SQL Server -> Supabase).
# Lo lanza la tarea "MITO - Sync equivalencias" (ver instalar-tarea.ps1). Log: data\sync-equivalencias.log
$raiz = Split-Path $PSScriptRoot -Parent
Set-Location $raiz
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = Join-Path $env:ProgramFiles 'nodejs\node.exe' }
& $node (Join-Path $raiz 'scripts\sync-equivalencias.js')
exit $LASTEXITCODE
