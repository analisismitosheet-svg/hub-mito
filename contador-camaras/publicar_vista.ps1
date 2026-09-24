# Publica el video en vivo del contador SOLO dentro de la VPN (Tailscale), por HTTPS.
# Usa un puerto propio (8765) SIN Funnel: no queda abierto a internet aunque la PC
# tenga otros servicios publicados con Funnel en el 443.
#   Uso:  publicar_vista.bat          (publicar)
#         publicar_vista.bat quitar   (dejar de publicar)
param([string]$Accion = 'publicar', [int]$Puerto = 8765)
$ErrorActionPreference = 'Stop'
$ts = 'C:\Program Files\Tailscale\tailscale.exe'
if (-not (Test-Path $ts)) { throw 'No está instalado Tailscale en esta PC.' }
$cfgRuta = Join-Path $PSScriptRoot 'config.json'

if ($Accion -eq 'quitar') {
  & $ts serve --https=$Puerto off
  Write-Host 'Video en vivo ya no se publica.' -ForegroundColor Green
  Read-Host 'Enter para cerrar'; exit
}

$cfg = Get-Content $cfgRuta -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $cfg.vista) { $cfg | Add-Member -NotePropertyName vista -NotePropertyValue ([pscustomobject]@{}) }
$token = $cfg.vista.token
if (-not $token -or $token.Length -lt 16) {
  $bytes = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $token = -join ($bytes | ForEach-Object { $_.ToString('x2') })
}
$dns = ((& $ts status --json | ConvertFrom-Json).Self.DNSName).TrimEnd('.')
$url = "https://${dns}:$Puerto"

& $ts serve --bg --https=$Puerto "http://127.0.0.1:$Puerto"
if ($LASTEXITCODE -ne 0) { throw 'tailscale serve falló. ¿Están activados MagicDNS y HTTPS en el panel de Tailscale (DNS -> HTTPS Certificates)?' }

foreach ($k in 'activo', 'puerto', 'token', 'url_publica') { $cfg.vista.PSObject.Properties.Remove($k) }
$cfg.vista | Add-Member -NotePropertyName activo -NotePropertyValue $true
$cfg.vista | Add-Member -NotePropertyName puerto -NotePropertyValue $Puerto
$cfg.vista | Add-Member -NotePropertyName token -NotePropertyValue $token
$cfg.vista | Add-Member -NotePropertyName url_publica -NotePropertyValue $url
$json = $cfg | ConvertTo-Json -Depth 20
[IO.File]::WriteAllText($cfgRuta, $json, (New-Object Text.UTF8Encoding $false))

Write-Host "`nListo. Video en vivo (solo dentro de la VPN): $url" -ForegroundColor Green
Write-Host 'Reiniciá el contador para que lo informe al hub.'
Read-Host 'Enter para cerrar'
