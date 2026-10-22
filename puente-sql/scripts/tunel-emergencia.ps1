# Tuneles de emergencia del hub, por si el Funnel de Tailscale deja de publicarse.
# Levanta un "quick tunnel" de Cloudflare por cada servicio local y los mantiene prendidos:
#   127.0.0.1:3128 -> Puente SQL (Datos SQL del hub)
#   127.0.0.1:4000 -> Servidor de agentes IA (el chat del hub)
# Lo lanza la tarea "MITO - Tunel emergencia" (ver instalar-tunel.ps1).
#
# Las URL que da Cloudflare son gratis y publicas (https://algo-algo.trycloudflare.com) pero CAMBIAN
# en cada arranque. Quedan en data\tunel-url.txt (puente) y data\tunel-url-agentes.txt (agentes),
# y se anotan en data\tunel-emergencia.log. Al cambiar hay que:
#   - puente:  pegar la URL con /health al final en el hub, Configuraciones > Conexion SQL
#   - agentes: poner la URL en VITE_URL_AGENTES (Vercel) y volver a deployar
#
# Mientras el Funnel de Tailscale ande, esto no hace falta (ver vigilante.ps1).

$raiz = Split-Path $PSScriptRoot -Parent
$log = Join-Path $raiz 'data\tunel-emergencia.log'

$servicios = @(
  @{ nombre = 'puente SQL'; puerto = 3128; urlArch = 'data\tunel-url.txt'; salida = 'data\tunel-cloudflared.log'
     campo = 'p_url_puente'; sufijo = '/health' }
  @{ nombre = 'agentes IA'; puerto = 4000; urlArch = 'data\tunel-url-agentes.txt'; salida = 'data\tunel-agentes.log'
     campo = 'p_url_agentes'; sufijo = '' }
)

function Anotar($texto) {
  Add-Content -Path $log -Encoding utf8 -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $texto"
}

# Un valor del .env (el del puente o el del hub, que esta un nivel arriba)
function LeerEnv($archivo, $clave) {
  if (-not (Test-Path $archivo)) { return $null }
  foreach ($l in Get-Content $archivo) {
    if ($l -match "^\s*$clave\s*=\s*(.*)$") { return $Matches[1].Trim().Trim('"') }
  }
  return $null
}

$envPuente = Join-Path $raiz '.env'
$envHub = Join-Path (Split-Path $raiz -Parent) '.env'
$supaUrl = LeerEnv $envHub 'VITE_SUPABASE_URL'
$supaAnon = LeerEnv $envHub 'VITE_SUPABASE_ANON_KEY'
$puenteToken = LeerEnv $envPuente 'PUENTE_TOKEN'

# Avisa al hub la URL nueva (funcion publicar_urls_puente: valida el token y el dominio),
# asi no hay que pegar nada a mano cuando el tunel cambia de direccion.
function PublicarEnElHub($campo, $url) {
  if (-not $supaUrl -or -not $supaAnon -or -not $puenteToken) {
    Anotar 'No se pudo avisar al hub: faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (.env del hub) o PUENTE_TOKEN'
    return $false
  }
  $cuerpo = @{ p_token = $puenteToken }
  $cuerpo[$campo] = $url
  try {
    Invoke-RestMethod -Method Post -Uri "$supaUrl/rest/v1/rpc/publicar_urls_puente" -TimeoutSec 25 `
      -Headers @{ apikey = $supaAnon; Authorization = "Bearer $supaAnon" } `
      -ContentType 'application/json' -Body ($cuerpo | ConvertTo-Json -Compress) | Out-Null
    return $true
  } catch {
    Anotar "No se pudo avisar al hub de la URL de ${campo}: $($_.Exception.Message)"
    return $false
  }
}

function BuscarCloudflared {
  $c = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
  if ($c) { return $c }
  $g = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter 'cloudflared.exe' -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($g) { return $g.FullName }
  return $null
}

# Ya hay un tunel andando para ese puerto? (puede haberlo levantado alguien a mano)
function TunelVivo($puerto) {
  $ps = Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue
  foreach ($p in $ps) { if ($p.CommandLine -like "*127.0.0.1:$puerto*") { return $true } }
  return $false
}

$exe = BuscarCloudflared
if (-not $exe) {
  Anotar 'No esta instalado cloudflared (winget install --id Cloudflare.cloudflared --scope user)'
  exit 1
}

while ($true) {
  foreach ($s in $servicios) {
    if (TunelVivo $s.puerto) { continue }

    $salida = Join-Path $raiz $s.salida
    $urlArch = Join-Path $raiz $s.urlArch
    if (Test-Path $salida) { Remove-Item $salida -Force -ErrorAction SilentlyContinue }

    Start-Process -FilePath $exe -WorkingDirectory $raiz -WindowStyle Hidden `
      -ArgumentList 'tunnel', '--no-autoupdate', '--url', "http://127.0.0.1:$($s.puerto)" `
      -RedirectStandardError $salida -RedirectStandardOutput "$salida.out" | Out-Null

    # La URL aparece en el log en los primeros segundos
    $url = $null
    for ($i = 0; $i -lt 30 -and -not $url; $i++) {
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
      $avisado = PublicarEnElHub $s.campo "$url$($s.sufijo)"
      if ($url -ne $anterior) {
        $comoFue = if ($avisado) { 'ya avisada al hub' } else { 'HAY QUE PONERLA A MANO EN EL HUB' }
        Anotar "URL NUEVA del tunel de $($s.nombre): $url$($s.sufijo)  ($comoFue)"
      } elseif (-not $avisado) {
        Anotar "Tunel de $($s.nombre) con la misma URL ($url) pero no se pudo avisar al hub"
      }
    } else {
      Anotar "El tunel de $($s.nombre) arranco pero no se pudo leer la URL (ver $($s.salida))"
    }
  }

  Start-Sleep -Seconds 30
}
