# Correr UNA vez en la PC del local (la que tiene Tailscale y está en la red del DVR).
# Reenvía SOLO el DVR a través de esta PC (puerto de la librería Dahua 37777 y video RTSP),
# y SOLO para equipos de Tailscale. No comparte la red del local.
#
#   Uso:  puente_dvr.bat                  (busca el DVR solo en la red del local)
#         puente_dvr.bat 192.168.0.108    (IP interna del DVR, si ya la sabés)
#   Quitar:  puente_dvr.bat quitar

param([string]$Dvr = '', [int]$PuertoSdk = 37777, [int]$PuertoRtsp = 554, [int]$PuertoPuenteRtsp = 5540)
$ErrorActionPreference = 'Stop'
$regla = 'MITO Contador - DVR por Tailscale'
$reglaVieja = 'MITO Contador - video DVR por Tailscale'

function Abierto([string]$ip, [int]$puerto, [int]$ms = 1500) {
  $c = New-Object Net.Sockets.TcpClient
  try { return ($c.ConnectAsync($ip, $puerto).Wait($ms) -and $c.Connected) } catch { return $false } finally { $c.Close() }
}

if ($Dvr -eq 'quitar') {
  foreach ($p in $PuertoSdk, $PuertoPuenteRtsp) { netsh interface portproxy delete v4tov4 listenport=$p listenaddress=0.0.0.0 2>$null | Out-Null }
  Remove-NetFirewallRule -DisplayName $regla -ErrorAction SilentlyContinue
  Remove-NetFirewallRule -DisplayName $reglaVieja -ErrorAction SilentlyContinue
  Write-Host 'Puente quitado.' -ForegroundColor Green
  Read-Host 'Enter para cerrar'; exit
}

if (-not $Dvr) {
  # Buscar el DVR: equipos de la red local con el puerto de Dahua abierto
  $redes = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
    $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -notlike '100.*' -and $_.PrefixLength -ge 16 }
  $encontrados = @()
  foreach ($r in $redes) {
    $base = ($r.IPAddress -split '\.')[0..2] -join '.'
    Write-Host "Buscando el DVR en $base.x ..."
    $pruebas = foreach ($i in 1..254) {
      $ip = "$base.$i"; $c = New-Object Net.Sockets.TcpClient
      [pscustomobject]@{ Ip = $ip; Cliente = $c; Tarea = $c.ConnectAsync($ip, $PuertoSdk) }
    }
    Start-Sleep -Milliseconds 2500
    foreach ($p in $pruebas) {
      if ($p.Tarea.IsCompleted -and -not $p.Tarea.IsFaulted -and $p.Cliente.Connected) { $encontrados += $p.Ip }
      $p.Cliente.Close()
    }
  }
  if ($encontrados.Count -eq 0) {
    Write-Host "No encontré ningún DVR (puerto $PuertoSdk) en la red. Buscá la IP en el DVR: Red -> TCP/IP, y corré: puente_dvr.bat <IP>" -ForegroundColor Red
    Read-Host 'Enter para cerrar'; exit 1
  }
  if ($encontrados.Count -eq 1) { $Dvr = $encontrados[0] }
  else {
    Write-Host 'Encontré varios equipos Dahua:'
    for ($i = 0; $i -lt $encontrados.Count; $i++) { Write-Host "  $($i + 1)) $($encontrados[$i])" }
    $Dvr = $encontrados[[int](Read-Host 'Número del DVR de las cámaras') - 1]
  }
}

Write-Host "Probando el DVR $Dvr ..."
if (-not (Abierto $Dvr $PuertoSdk 3000)) {
  Write-Host "El DVR no responde en $Dvr`:$PuertoSdk. Revisá la IP (Red -> TCP/IP) y el puerto TCP (Red -> Connect)." -ForegroundColor Red
  Read-Host 'Enter para cerrar'; exit 1
}
$conRtsp = Abierto $Dvr $PuertoRtsp 3000

# El reenvío de puertos de Windows necesita el servicio "Aplicación auxiliar IP"
Set-Service iphlpsvc -StartupType Automatic
Start-Service iphlpsvc

$puertos = @($PuertoSdk)
netsh interface portproxy delete v4tov4 listenport=$PuertoSdk listenaddress=0.0.0.0 2>$null | Out-Null
netsh interface portproxy add v4tov4 listenport=$PuertoSdk listenaddress=0.0.0.0 connectport=$PuertoSdk connectaddress=$Dvr | Out-Null
if ($conRtsp) {
  $puertos += $PuertoPuenteRtsp
  netsh interface portproxy delete v4tov4 listenport=$PuertoPuenteRtsp listenaddress=0.0.0.0 2>$null | Out-Null
  netsh interface portproxy add v4tov4 listenport=$PuertoPuenteRtsp listenaddress=0.0.0.0 connectport=$PuertoRtsp connectaddress=$Dvr | Out-Null
}

# Solo se acepta desde direcciones de Tailscale (100.64.0.0/10), nunca desde internet ni la red local
Remove-NetFirewallRule -DisplayName $reglaVieja -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName $regla -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName $regla -Direction Inbound -Protocol TCP -LocalPort $puertos -RemoteAddress 100.64.0.0/10 -Action Allow | Out-Null

$tsIp = (& 'C:\Program Files\Tailscale\tailscale.exe' ip -4) 2>$null
Write-Host "`nListo. El DVR $Dvr queda disponible por Tailscale en $tsIp (puertos $($puertos -join ', '))" -ForegroundColor Green
Write-Host 'Avisale a Claude que ya está.'
Read-Host 'Enter para cerrar'
