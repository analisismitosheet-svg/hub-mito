# Carga en Vercel (proyecto hub-mito, Production) lo que necesita el envío de informes por WhatsApp
# y vuelve a publicar el hub para que lo tome. Los valores se pegan acá: no quedan en pantalla ni en archivos.
#
#   powershell -ExecutionPolicy Bypass -File "D:\pwa mito\scripts\whatsapp-vercel.ps1"
#
#  - WHATSAPP_TOKEN     token permanente del usuario del sistema de Meta (no vence)
#  - WHATSAPP_PHONE_ID  "Identificador del número de teléfono" (WhatsApp > Configuración de la API)
#  - CRON_SECRET        se genera solo si no existe (lo usa el cron diario de Vercel para disparar los informes)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Set-Location (Split-Path $PSScriptRoot -Parent)
$scope = 'mito-srl'
# Número emisor de MITO registrado en Meta (se compara con el que devuelve el Phone number ID)
$numeroMito = '5493512400630'
$wabaMito = '3764563940363184'      # cuenta de WhatsApp Business donde está ese número
$negocioMito = '1404173826108651'   # portfolio empresarial "Analisis"

function Pedir($texto) {
  $s = Read-Host $texto -AsSecureString
  $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)).Trim() } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }
}

# npm falla con ENOENT si no existe la carpeta global de npm del usuario
New-Item -ItemType Directory -Force (Join-Path $env:APPDATA 'npm') | Out-Null

# Vercel CLI por cmd: así los avisos que npm/vercel escriben en stderr no cortan el script (PowerShell 5)
function Vercel($argumentos, $entrada) {
  $cmd = "npx --yes vercel@64.0.2 --scope $scope $argumentos 2>&1"
  if ($null -ne $entrada) { $salida = $entrada | cmd /c $cmd } else { $salida = cmd /c $cmd }
  return @{ ok = ($LASTEXITCODE -eq 0); salida = ($salida -join "`n") }
}

function Cargar($nombre, $valor) {
  # Si ya existe se reemplaza (vercel no deja agregar dos veces la misma)
  Vercel "env rm $nombre production --yes" $null | Out-Null
  $r = Vercel "env add $nombre production --sensitive" $valor
  if (-not $r.ok) { throw "No se pudo cargar $nombre en Vercel:`n$($r.salida)" }
  Write-Host "  OK  $nombre" -ForegroundColor Green
}

Write-Host "`nWhatsApp para el Hub MITO (Vercel: $scope/hub-mito, Production)`n" -ForegroundColor Cyan

$token = Pedir 'Pegá el token permanente de Meta (WHATSAPP_TOKEN)'
if ($token.Length -lt 50) { throw 'Ese token es muy corto: tiene que ser el del usuario del sistema (empieza con EAA...).' }
$auth = @{ Authorization = "Bearer $token" }
$phoneId = (Read-Host 'Phone number ID (si no lo tenés, Enter y lo busco solo con el token)').Trim()

# Si viene vacío o pegaron el teléfono (+54 9 351 ...), se busca el ID en las cuentas de WhatsApp del token
if ($phoneId -notmatch '^\d{14,20}$') {
  Write-Host "`nBuscando en Meta el ID del +54 9 351 240-0630..."
  try {
    $dbg = Invoke-RestMethod "https://graph.facebook.com/v23.0/debug_token?input_token=$token" -Headers $auth
  } catch { throw "Meta rechazó el token: $($_.ErrorDetails.Message)" }
  # Con acceso total Meta a veces no lista las cuentas en el token: se prueba siempre también la de MITO
  # (cuenta de WhatsApp "hub mito informes", portfolio Analisis) y las del portfolio.
  $wabas = @($dbg.data.granular_scopes | Where-Object { $_.scope -like 'whatsapp_business_*' } | ForEach-Object { $_.target_ids }) + @($wabaMito)
  try { $wabas += @((Invoke-RestMethod "https://graph.facebook.com/v23.0/$negocioMito/owned_whatsapp_business_accounts?fields=id" -Headers $auth).data.id) } catch {}
  $wabas = $wabas | Where-Object { $_ } | Select-Object -Unique
  if (-not $wabas) { throw 'El token no tiene asignada ninguna cuenta de WhatsApp: en Usuarios del sistema > Asignar activos, dale la cuenta de WhatsApp de MITO y generá el token de nuevo.' }
  $numeros = foreach ($w in $wabas) {
    try { (Invoke-RestMethod "https://graph.facebook.com/v23.0/$w/phone_numbers?fields=id,display_phone_number,verified_name" -Headers $auth).data } catch { $errMeta = $_.ErrorDetails.Message }
  }
  if (-not $numeros -and $errMeta) { throw "Meta no deja ver los números con este token: $errMeta" }
  $numeros | ForEach-Object { Write-Host "  - $($_.display_phone_number)  ($($_.verified_name))  ID $($_.id)" }
  $elegido = $numeros | Where-Object { ($_.display_phone_number -replace '\D', '') -eq $numeroMito } | Select-Object -First 1
  if (-not $elegido) { throw 'El +54 9 351 240-0630 no está registrado en esa cuenta de WhatsApp: agregalo en WhatsApp > Configuración de la API > Agregar número de teléfono y verificalo con el código.' }
  $phoneId = $elegido.id
  Write-Host "  Encontrado: ID $phoneId" -ForegroundColor Green
}

# Probar contra Meta antes de guardar nada
Write-Host "`nProbando con Meta..."
try {
  $r = Invoke-RestMethod "https://graph.facebook.com/v23.0/$phoneId`?fields=display_phone_number,verified_name,quality_rating" -Headers $auth
  Write-Host "  Número: $($r.display_phone_number)  ($($r.verified_name))  calidad $($r.quality_rating)" -ForegroundColor Green
  $digitos = ($r.display_phone_number -replace '\D', '')
  if ($digitos -ne $numeroMito) {
    Write-Host "  Ojo: ese no es el número de MITO (+54 9 351 240-0630). Si es el número de prueba de Meta, sirve para probar pero no para mandar a cualquiera." -ForegroundColor Yellow
    if ((Read-Host '  ¿Seguir igual? (s/n)') -ne 's') { throw 'Cancelado: buscá el Phone number ID del +54 9 351 240-0630 en WhatsApp > Configuración de la API.' }
  }
} catch {
  if ($_.Exception.Message -like 'Cancelado*') { throw }
  $msg = $_.ErrorDetails.Message
  throw "Meta rechazó el token o el ID: $msg"
}

Write-Host "`nCargando en Vercel..."
Cargar 'WHATSAPP_TOKEN' $token
Cargar 'WHATSAPP_PHONE_ID' $phoneId

$existentes = (Vercel 'env ls production' $null).salida
if ($existentes -notmatch '\bCRON_SECRET\b') {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  Cargar 'CRON_SECRET' (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}
$token = $null; $auth = $null

Write-Host "`nPublicando el hub de nuevo para que tome las variables..."
$r = Vercel 'redeploy hub-mito.vercel.app --target production' $null
if (-not $r.ok) {
  Write-Host $r.salida
  Write-Host "No se pudo re-publicar solo. Hacelo a mano: https://vercel.com/mito-srl/hub-mito/deployments -> ultimo -> ... -> Redeploy" -ForegroundColor Yellow
} else {
  Write-Host "`nListo. En el hub: Sistemas -> Envío informes y reportes tiene que decir 'WhatsApp conectado'." -ForegroundColor Green
}
