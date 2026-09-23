# Registra en el Programador de tareas de Windows (para el usuario actual, sin permisos de administrador):
#  - "MITO - Puente SQL": arranca el puente al iniciar sesión, oculto, y lo reinicia si se cae.
# Uso: npm run tareas:instalar      Quitar: npm run tareas:quitar

$raiz = Split-Path $PSScriptRoot -Parent
$usuario = "$env:USERDOMAIN\$env:USERNAME"
# conhost --headless: corre sin mostrar ninguna ventana
function Accion($script, $argumentos = '') {
  New-ScheduledTaskAction -Execute 'conhost.exe' -WorkingDirectory $raiz `
    -Argument "--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$raiz\scripts\$script`" $argumentos"
}

$ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
  -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'MITO - Puente SQL' -Force `
  -Description 'Puente SQL local hacia el DWH (D:\pwa mito\puente-sql). Puerto 3128. Consulta en vivo para el hub.' `
  -Action (Accion 'servicio.ps1') `
  -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $usuario) `
  -Settings $ajustes | Out-Null
Write-Output 'OK  MITO - Puente SQL (al iniciar sesion)'