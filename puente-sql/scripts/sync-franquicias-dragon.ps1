# Carga en Dragon (DRAGONFISH_MITO) los pedidos que confirmaron las franquicias desde el link
# y después arma la reposición diaria automática de los clientes que tocan (venta de ayer).
# Lo lanza la tarea "MITO - Pedidos franquicias" cada 1 minuto (ver instalar-tarea.ps1).
# Log: data\sync-franquicias-dragon.log y data\reposicion-franquicias-auto.log
$raiz = Split-Path $PSScriptRoot -Parent
Set-Location $raiz
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = Join-Path $env:ProgramFiles 'nodejs\node.exe' }
& $node (Join-Path $raiz 'scripts\sync-franquicias-dragon.js')
$codigo = $LASTEXITCODE
& $node (Join-Path $raiz 'scripts\reposicion-franquicias-auto.js')
if ($codigo -eq 0) { $codigo = $LASTEXITCODE }
# Venta diaria de los locales para Locales -> Objetivos (corre de verdad una vez por hora)
& $node (Join-Path $raiz 'scripts\sync-ventas-locales.js')
if ($codigo -eq 0) { $codigo = $LASTEXITCODE }
exit $codigo
