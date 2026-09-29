# Corre la sincronización del maestro de artículos (SQL Server -> Supabase).
# Lo lanza la tarea "MITO - Sync articulos" (ver instalar-tarea.ps1). Log: data\sync-articulos.log
$raiz = Split-Path $PSScriptRoot -Parent
Set-Location $raiz
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = Join-Path $env:ProgramFiles 'nodejs\node.exe' }
& $node (Join-Path $raiz 'scripts\sync-articulos.js')
exit $LASTEXITCODE
