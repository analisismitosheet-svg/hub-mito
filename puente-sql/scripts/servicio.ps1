# Mantiene prendido el Puente SQL: lo arranca y, si se cae, lo vuelve a arrancar.
# Lo lanza la tarea "MITO - Puente SQL" al iniciar sesión (ver instalar-tarea.ps1).
# Log de este script: data\servicio.log   |   Errores del puente: data\puente-errores.log

$raiz = Split-Path $PSScriptRoot -Parent
Set-Location $raiz
New-Item -ItemType Directory -Force (Join-Path $raiz 'data') | Out-Null
$logServicio = Join-Path $raiz 'data\servicio.log'
$errores = Join-Path $raiz 'data\puente-errores.log'

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = Join-Path $env:ProgramFiles 'nodejs\node.exe' }

function Anotar($texto) {
  Add-Content -Path $logServicio -Encoding utf8 -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $texto"
}

while ($true) {
  $ocupado = Get-NetTCPConnection -LocalPort 3128 -State Listen -ErrorAction SilentlyContinue
  if ($ocupado) {
    # Ya hay un puente corriendo (por ejemplo, uno abierto a mano)
    Start-Sleep -Seconds 60
    continue
  }
  Anotar 'Iniciando puente SQL'
  $p = Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $raiz `
    -NoNewWindow -Wait -PassThru -RedirectStandardError $errores
  Anotar "El puente se detuvo (codigo $($p.ExitCode)). Reinicio en 15 segundos. Detalle en data\puente-errores.log"
  Start-Sleep -Seconds 15
}