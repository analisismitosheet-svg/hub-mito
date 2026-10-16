# Carga en Dragon (DRAGONFISH_MITO) los pedidos que confirmaron las franquicias desde el link.
# Lo lanza la tarea "MITO - Pedidos franquicias" cada 1 minuto (ver instalar-tarea.ps1).
# Log: data\sync-franquicias-dragon.log
$raiz = Split-Path $PSScriptRoot -Parent
Set-Location $raiz
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = Join-Path $env:ProgramFiles 'nodejs\node.exe' }
& $node (Join-Path $raiz 'scripts\sync-franquicias-dragon.js')
exit $LASTEXITCODE
