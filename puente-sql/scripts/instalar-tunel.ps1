# Registra SOLO la tarea del tunel de emergencia: "MITO - Tunel emergencia".
# Arranca tunel-emergencia.ps1 al iniciar sesion y lo mantiene prendido (cloudflared contra 127.0.0.1:3128).
# No toca ninguna de las otras tareas de MITO y no inicia el tunel ahora: si ya hay uno andando,
# sigue el que esta. Uso:  npm run tunel:instalar
#
# La URL del tunel cambia en cada arranque: queda en data\tunel-url.txt y hay que pegarla en el hub
# (Configuraciones > Conexion SQL), con /health al final.
# Para apagarlo cuando vuelva a andar el Funnel de Tailscale:
#   Disable-ScheduledTask -TaskName 'MITO - Tunel emergencia'

$raiz = Split-Path $PSScriptRoot -Parent
$usuario = "$env:USERDOMAIN\$env:USERNAME"

$accion = New-ScheduledTaskAction -Execute 'conhost.exe' -WorkingDirectory $raiz `
  -Argument "--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$raiz\scripts\tunel-emergencia.ps1`""

$ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
  -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName 'MITO - Tunel emergencia' -Force `
  -Description 'Tunel de Cloudflare al Puente SQL (127.0.0.1:3128) por si el Funnel de Tailscale no se publica. La URL queda en puente-sql\data\tunel-url.txt y hay que pegarla en Configuraciones > Conexion SQL del hub. Log: puente-sql\data\tunel-emergencia.log' `
  -Action $accion `
  -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $usuario) `
  -Settings $ajustes | Out-Null

Write-Output 'OK  MITO - Tunel emergencia (al iniciar sesion)'
Write-Output 'El tunel arranca solo en el proximo inicio de sesion. Si querias arrancarlo ahora:'
Write-Output "  Start-ScheduledTask -TaskName 'MITO - Tunel emergencia'"
