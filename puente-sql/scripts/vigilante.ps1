# Vigilante del Puente SQL: cada 5 minutos revisa que el hub pueda llegar al puente y,
# si algo se cayó, lo levanta solo. Lo lanza la tarea "MITO - Vigilante puente".
# Log (solo cuando hay problemas o arreglos): data\vigilante.log
#
#  1. Puente local (http://127.0.0.1:3128/health): si no responde o quedó colgado,
#     se reinicia (servicio.ps1 lo vuelve a levantar).
#  2. Funnel de Tailscale: si se perdió la ruta /sql-bridge en el 443, se vuelve a poner.
#  3. Camino completo como lo usa el hub (Vercel -> internet -> Funnel -> puente), con
#     https://hub-mito.vercel.app/api/sql/ping: si falla 2 veces seguidas con el puente
#     local sano, se re-publica el Funnel (pasó al renombrar la PC: quedaba "on" pero no salía).

$raiz = Split-Path $PSScriptRoot -Parent
$log = Join-Path $raiz 'data\vigilante.log'
$estadoArch = Join-Path $raiz 'data\vigilante-estado.json'
$pingHub = 'https://hub-mito.vercel.app/api/sql/ping'
$ts = (Get-Command tailscale -ErrorAction SilentlyContinue).Source
if (-not $ts) { $ts = 'C:\Program Files\Tailscale\tailscale.exe' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Anotar($texto) {
  Add-Content -Path $log -Encoding utf8 -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $texto"
}

function PuenteLocalOk {
  try { return (Invoke-WebRequest 'http://127.0.0.1:3128/health' -UseBasicParsing -TimeoutSec 10).StatusCode -eq 200 } catch { return $false }
}

function PublicarFunnel {
  & $ts funnel --bg --https=443 http://127.0.0.1:4000 2>&1 | Out-Null
  & $ts funnel --bg --https=443 --set-path=/sql-bridge http://127.0.0.1:3128 2>&1 | Out-Null
}

$estado = @{ fallosAfuera = 0 }
try { $leido = Get-Content $estadoArch -Raw -ErrorAction Stop | ConvertFrom-Json; $estado.fallosAfuera = [int]$leido.fallosAfuera } catch {}

# ---- 1. Puente local ----
if (-not (PuenteLocalOk)) {
  Start-Sleep -Seconds 10
  if (-not (PuenteLocalOk)) {
    $tarea = Get-ScheduledTask -TaskName 'MITO - Puente SQL' -ErrorAction SilentlyContinue
    if ($tarea -and $tarea.State -ne 'Running') {
      Anotar 'Puente local sin respuesta y la tarea no corría: se inicia "MITO - Puente SQL"'
      Start-ScheduledTask -TaskName 'MITO - Puente SQL'
    } else {
      $c = Get-NetTCPConnection -State Listen -LocalPort 3128 -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($c) {
        Anotar "Puente local colgado (pid $($c.OwningProcess)): se reinicia"
        Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
      } else {
        Anotar 'Puente local caído: servicio.ps1 lo relanza'
      }
    }
    Start-Sleep -Seconds 25
    if (PuenteLocalOk) { Anotar 'Puente local: OK de nuevo' } else { Anotar 'Puente local: sigue sin responder' }
  }
}

# ---- 2. Configuración del Funnel ----
try {
  $cfg = (& $ts serve status --json 2>$null) -join "`n" | ConvertFrom-Json
  $web = $cfg.Web.PSObject.Properties | Where-Object { $_.Name -like '*:443' } | Select-Object -First 1
  $tieneRuta = $web -and ($web.Value.Handlers.PSObject.Properties.Name -contains '/sql-bridge')
  $permitido = $cfg.AllowFunnel.PSObject.Properties | Where-Object { $_.Name -like '*:443' -and $_.Value }
  if (-not $tieneRuta -or -not $permitido) {
    Anotar 'Funnel sin la ruta /sql-bridge en el 443: se vuelve a configurar'
    PublicarFunnel
  }
} catch {
  Anotar "No se pudo leer la configuración de Tailscale: $($_.Exception.Message)"
}

# ---- 3. Camino completo desde afuera (como el hub) ----
$afuera = $null  # $true ok, $false caído, $null sin dato (endpoint todavía no publicado, etc.)
try {
  $r = Invoke-WebRequest $pingHub -UseBasicParsing -TimeoutSec 25
  $afuera = (($r.Content | ConvertFrom-Json).ok -eq $true)
} catch {
  $cod = $_.Exception.Response.StatusCode.value__
  if ($cod -in 502, 504) { $afuera = $false }
  elseif (-not $cod) { $afuera = $null }  # sin internet en esta PC: no es culpa del Funnel
}

if ($afuera -eq $false -and (PuenteLocalOk)) {
  $estado.fallosAfuera++
  Anotar "El hub no llega al puente desde afuera (vez $($estado.fallosAfuera))"
  if ($estado.fallosAfuera -ge 2) {
    Anotar 'Se re-publica el Funnel del 443 (agentes + puente SQL)'
    & $ts funnel --https=443 off 2>&1 | Out-Null
    Start-Sleep -Seconds 3
    PublicarFunnel
    $estado.fallosAfuera = 0
  }
} elseif ($afuera -eq $true) {
  if ($estado.fallosAfuera -gt 0) { Anotar 'El hub vuelve a llegar al puente' }
  $estado.fallosAfuera = 0
}

$estado | ConvertTo-Json | Set-Content -Path $estadoArch -Encoding utf8
