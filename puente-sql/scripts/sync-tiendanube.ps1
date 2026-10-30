# Corre la sincronización de pedidos de Tiendanube (API -> Supabase).
# Lo lanza la tarea "MITO - Sync Tiendanube" (cada 20 minutos: lo modificado desde la ultima corrida) (ver instalar-tarea.ps1).
# Log: data\sync-tiendanube.log
$raiz = Split-Path $PSScriptRoot -Parent
Set-Location $raiz
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = Join-Path $env:ProgramFiles 'nodejs\node.exe' }
& $node (Join-Path $raiz 'scripts\sync-tiendanube.js') @args
exit $LASTEXITCODE
