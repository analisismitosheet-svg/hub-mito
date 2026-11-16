# Copia las fotos de los productos de indonesiashop.com.ar (Tiendanube) a Supabase (articulos_fotos),
# para la consulta de precios publica del hub (/precios).
# Lo lanza la tarea "MITO - Sync fotos Tiendanube" (todos los dias 7:40) (ver instalar-tarea.ps1).
# Log: data\sync-fotos-tiendanube.log
$raiz = Split-Path $PSScriptRoot -Parent
Set-Location $raiz
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = Join-Path $env:ProgramFiles 'nodejs\node.exe' }
& $node (Join-Path $raiz 'scripts\sync-fotos-tiendanube.js') @args
exit $LASTEXITCODE
