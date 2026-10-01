# Corre la sincronización de pedidos de venta (SQL Server local -> Supabase).
# Lo lanza la tarea "MITO - Sync pedidos venta" (cada 15 minutos: ultimos 7 dias; diaria con --todo: copia completa) (ver instalar-tarea.ps1).
# Log: data\sync-pedidos-venta.log
$raiz = Split-Path $PSScriptRoot -Parent
Set-Location $raiz
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = Join-Path $env:ProgramFiles 'nodejs\node.exe' }
& $node (Join-Path $raiz 'scripts\sync-pedidos-venta.js') @args
exit $LASTEXITCODE
