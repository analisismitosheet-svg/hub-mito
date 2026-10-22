# Registra en el Programador de tareas de Windows (para el usuario actual, sin permisos de administrador):
#  - "MITO - Puente SQL": arranca el puente al iniciar sesión, oculto, y lo reinicia si se cae.
#  - "MITO - Sync equivalencias": copia las equivalencias a Supabase todos los días a las 7:00.
#  - "MITO - Sync articulos": copia el maestro de artículos a Supabase todos los días a las 7:15.
#  - "MITO - Sync pedidos compra" (cada hora) y "MITO - Sync pedidos venta" (cada hora + completa 6:30).
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

# Equivalencias de códigos de barras -> Supabase, para el escaneo de Mi repo.
# Todos los días a las 7:00; si la PC estaba apagada, corre apenas se prende.
$ajustesSync = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName 'MITO - Sync equivalencias' -Force `
  -Description 'Copia DRAGONFISH_INDOD.ZooLogic.equivalencias a Supabase (tabla equivalencias) para el escaneo. Log: puente-sql\data\sync-equivalencias.log' `
  -Action (Accion 'sync-equivalencias.ps1') `
  -Trigger (New-ScheduledTaskTrigger -Daily -At '07:00') `
  -Settings $ajustesSync | Out-Null
Write-Output 'OK  MITO - Sync equivalencias (todos los dias 7:00)'

# Maestro de artículos -> Supabase (descripciones en el hub). Todos los días a las 7:15.
Register-ScheduledTask -TaskName 'MITO - Sync articulos' -Force `
  -Description 'Copia DWH.dbo.vw_DIM_ARTICULO a Supabase (tabla articulos) para las descripciones del hub. Log: puente-sql\data\sync-articulos.log' `
  -Action (Accion 'sync-articulos.ps1') `
  -Trigger (New-ScheduledTaskTrigger -Daily -At '07:15') `
  -Settings $ajustesSync | Out-Null
Write-Output 'OK  MITO - Sync articulos (todos los dias 7:15)'

# Pedidos de compra (SQL local VISTAS_CONSOLIDADAS) -> Supabase. Cada 1 hora (y a pedido desde el hub).
$cadaHora = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Hours 1)
$ajustesPedidos = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'MITO - Sync pedidos compra' -Force `
  -Description 'Copia VISTAS_CONSOLIDADAS.dbo.PEDIDO_COMPRA (SQL de esta PC) a Supabase cada 1 hora. Log: puente-sql\data\sync-pedidos-compra.log' `
  -Action (Accion 'sync-pedidos-compra.ps1') `
  -Trigger $cadaHora `
  -Settings $ajustesPedidos | Out-Null
Write-Output 'OK  MITO - Sync pedidos compra (cada 1 hora)'

# Pedidos de venta mayoristas (Dragonfish MITO) -> Supabase.
# Cada 15 minutos los últimos 7 días (y a pedido desde el hub); todos los días a las 6:30 la copia completa.
$cada15Venta = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName 'MITO - Sync pedidos venta' -Force `
  -Description 'Copia los pedidos de venta mayoristas (DRAGONFISH_MITO) de los ultimos 7 dias a Supabase cada 15 minutos. Log: puente-sql\data\sync-pedidos-venta.log' `
  -Action (Accion 'sync-pedidos-venta.ps1') `
  -Trigger $cada15Venta `
  -Settings $ajustesPedidos | Out-Null
Write-Output 'OK  MITO - Sync pedidos venta (cada 15 minutos, ultimos 7 dias)'
$ajustesVentaTodo = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'MITO - Sync pedidos venta completo' -Force `
  -Description 'Copia completa de los pedidos de venta mayoristas (DRAGONFISH_MITO) a Supabase y borra los que ya no estan. Log: puente-sql\data\sync-pedidos-venta.log' `
  -Action (Accion 'sync-pedidos-venta.ps1' '--todo') `
  -Trigger (New-ScheduledTaskTrigger -Daily -At '06:30') `
  -Settings $ajustesVentaTodo | Out-Null
Write-Output 'OK  MITO - Sync pedidos venta completo (todos los dias 6:30)'

# Vigilante: cada 5 minutos revisa puente local, Funnel y el camino desde el hub; arregla solo.
$cada5 = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 5)
$ajustesVig = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 4) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'MITO - Vigilante puente' -Force `
  -Description 'Cada 5 min: si el puente SQL o el Funnel de Tailscale se cayeron, los levanta. Log: puente-sql\data\vigilante.log' `
  -Action (Accion 'vigilante.ps1') `
  -Trigger $cada5 `
  -Settings $ajustesVig | Out-Null
Write-Output 'OK  MITO - Vigilante puente (cada 5 minutos)'

# Franquicias: cada 1 minuto carga en Dragon (DRAGONFISH_MITO) los pedidos que confirmaron desde el link.
$cada1 = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 1)
$ajustesFranq = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'MITO - Pedidos franquicias' -Force `
  -Description 'Cada 1 min: carga en Dragon (DRAGONFISH_MITO) los pedidos que confirmaron las franquicias. Log: puente-sql\data\sync-franquicias-dragon.log' `
  -Action (Accion 'sync-franquicias-dragon.ps1') `
  -Trigger $cada1 `
  -Settings $ajustesFranq | Out-Null
Write-Output 'OK  MITO - Pedidos franquicias (cada 1 minuto)'

# Tunel de emergencia (Cloudflare) al puente, para cuando el Funnel de Tailscale no se publica.
# Se instala pero conviene tenerlo APAGADO mientras el Funnel ande: Disable-ScheduledTask 'MITO - Tunel emergencia'.
# La URL cambia en cada arranque: queda en data\tunel-url.txt y hay que pegarla en el hub
# (Configuraciones > Conexion SQL). Ver scripts\tunel-emergencia.ps1.
Register-ScheduledTask -TaskName 'MITO - Tunel emergencia' -Force `
  -Description 'Tunel de Cloudflare al Puente SQL (127.0.0.1:3128) por si el Funnel de Tailscale no se publica. La URL queda en puente-sql\data\tunel-url.txt y hay que pegarla en Configuraciones > Conexion SQL del hub. Log: puente-sql\data\tunel-emergencia.log' `
  -Action (Accion 'tunel-emergencia.ps1') `
  -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $usuario) `
  -Settings $ajustes | Out-Null
Write-Output 'OK  MITO - Tunel emergencia (al iniciar sesion)'
