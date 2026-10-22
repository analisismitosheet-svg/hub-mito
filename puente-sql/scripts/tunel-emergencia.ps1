# Tunel de emergencia para el Puente SQL, por si el Funnel de Tailscale deja de publicarse.
# Levanta un "quick tunnel" de Cloudflare contra el puente local (127.0.0.1:3128) y lo mantiene
# prendido: si cloudflared se cae, lo vuelve a arrancar. Lo lanza la tarea "MITO - Tunel emergencia".
#
# La URL que da Cloudflare es gratis y publica (https://algo-algo.trycloudflare.com) pero CAMBIA
# en cada arranque, asi que cada vez que cambia hay que pegarla en el hub:
#   Configuraciones > Conexion SQL > URL del puente  ->  https://<lo-que-salga>.trycloudflare.com/health
# El script la guarda en data\tunel-url.txt y la anota en data\tunel-emergencia.log.
#
# Mientras el Funnel de Tailscale ande, esto no hace falta (ver vigilante.ps1).

$raiz = Split-Path $PSScriptRoot -Parent
$log = Join-Path $raiz 'data\tunel-emergencia.log'
$urlArch = Join-Path $raiz 'data\tunel-url.txt'
$salida = Join-Path $raiz 'data\tunel-cloudflared.log'

function Anotar($texto) {
  Add-Content -Path $log -Encoding utf8 -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $texto"
}

function BuscarCloudflared {
  $c = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
  if ($c) { return $c }
  $g = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter 'cloudflared.exe' -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($g) { return $g.FullName }
  return $null
}

$exe = BuscarCloudflared
if (-not $exe) {
  Anotar 'No esta instalado cloudflared (winget install --id Cloudflare.cloudflared --scope user)'
  exit 1
}

while ($true) {
  # Si alguien ya dejo un tunel andando a mano, no se abre otro (seria otra URL distinta)
  if (Get-Process cloudflared -ErrorAction SilentlyContinue) {
    Start-Sleep -Seconds 60
    continue
  }
  if (Test-Path $salida) { Remove-Item $salida -Force -ErrorAction SilentlyContinue }
  $p = Start-Process -FilePath $exe -WorkingDirectory $raiz -WindowStyle Hidden -PassThru `
    -ArgumentList 'tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:3128' `
    -RedirectStandardError $salida -RedirectStandardOutput (Join-Path $raiz 'data\tunel-cloudflared-out.log')

  $url = $null
  for ($i = 0; $i -lt 40 -and -not $url; $i++) {
    Start-Sleep -Seconds 2
    if (Test-Path $salida) {
      $m = Select-String -Path $salida -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if ($m) { $url = $m.Matches[0].Value }
    }
  }

  if ($url) {
    $anterior = if (Test-Path $urlArch) { (Get-Content $urlArch -Raw).Trim() } else { '' }
    Set-Content -Path $urlArch -Encoding utf8 -Value $url
    if ($url -ne $anterior) {
      Anotar "URL NUEVA del tunel: $url/health  ->  pegarla en el hub (Configuraciones > Conexion SQL)"
    } else {
      Anotar "Tunel levantado con la misma URL: $url/health"
    }
  } else {
    Anotar 'El tunel arranco pero no se pudo leer la URL (ver data\tunel-cloudflared.log)'
  }

  Wait-Process -Id $p.Id -ErrorAction SilentlyContinue
  Anotar 'El tunel se corto. Reintento en 15 segundos.'
  Start-Sleep -Seconds 15
}
