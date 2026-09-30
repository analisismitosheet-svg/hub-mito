# Corre la sincronización de pedidos de compra (SQL Server local -> Supabase).
# Lo lanza la tarea "MITO - Sync pedidos compra" cada 1 hora (ver instalar-tarea.ps1).
# Log: data\sync-pedidos-compra.log
$raiz = Split-Path $PSScriptRoot -Parent
Set-Location $raiz
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = Join-Path $env:ProgramFiles 'nodejs\node.exe' }
& $node (Join-Path $raiz 'scripts\sync-pedidos-compra.js')
exit $LASTEXITCODE
