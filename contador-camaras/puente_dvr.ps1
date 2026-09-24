# Correr UNA vez en la PC del local (la que tiene Tailscale y está en la red del DVR).
# Reenvía SOLO el video (RTSP) del DVR a través de esta PC, y SOLO para equipos de Tailscale.
# No comparte la red del local (evita choques entre locales/oficina que usan la misma numeración).
#
#   Uso:  puente_dvr.bat 192.168.0.108          (IP interna del DVR)
#   Quitar:  puente_dvr.bat quitar

param([Parameter(Mandatory = $true)][string]$Dvr, [int]$PuertoDvr = 554, [int]$PuertoPuente = 5540)
$ErrorActionPreference = 'Stop'
$regla = 'MITO Contador - video DVR por Tailscale'

if ($Dvr -eq 'quitar') {
  netsh interface portproxy delete v4tov4 listenport=$PuertoPuente listenaddress=0.0.0.0 | Out-Null
  Remove-NetFirewallRule -DisplayName $regla -ErrorAction SilentlyContinue
  Write-Host 'Puente quitado.' -ForegroundColor Green
  Read-Host 'Enter para cerrar'; exit
}

Write-Host "Probando el DVR $Dvr en el puerto $PuertoDvr ..."
$c = New-Object Net.Sockets.TcpClient
$ok = $c.ConnectAsync($Dvr, $PuertoDvr).Wait(3000) -and $c.Connected
$c.Close()
if (-not $ok) { Write-Host "El DVR no responde en $Dvr`:$PuertoDvr. Revisá la IP y el puerto RTSP (Red -> Connect)." -ForegroundColor Red; Read-Host 'Enter para cerrar'; exit 1 }

# El reenvío de puertos de Windows necesita el servicio "Aplicación auxiliar IP"
Set-Service iphlpsvc -StartupType Automatic
Start-Service iphlpsvc

netsh interface portproxy delete v4tov4 listenport=$PuertoPuente listenaddress=0.0.0.0 2>$null | Out-Null
netsh interface portproxy add v4tov4 listenport=$PuertoPuente listenaddress=0.0.0.0 connectport=$PuertoDvr connectaddress=$Dvr | Out-Null

# Solo se acepta desde direcciones de Tailscale (100.64.0.0/10), nunca desde internet ni la red local
Remove-NetFirewallRule -DisplayName $regla -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName $regla -Direction Inbound -Protocol TCP -LocalPort $PuertoPuente -RemoteAddress 100.64.0.0/10 -Action Allow | Out-Null

$tsIp = (& 'C:\Program Files\Tailscale\tailscale.exe' ip -4) 2>$null
Write-Host "`nListo. El video del DVR queda disponible por Tailscale en $tsIp`:$PuertoPuente" -ForegroundColor Green
Write-Host 'Avisale a Claude que ya está.'
Read-Host 'Enter para cerrar'
