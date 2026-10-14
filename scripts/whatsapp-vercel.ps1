# Carga en Vercel (proyecto hub-mito, Production) lo que necesita el envío de informes por WhatsApp
# y vuelve a publicar el hub para que lo tome. Los valores se pegan acá: no quedan en pantalla ni en archivos.
#
#   powershell -ExecutionPolicy Bypass -File "D:\pwa mito\scripts\whatsapp-vercel.ps1"
#
#  - WHATSAPP_TOKEN     token permanente del usuario del sistema de Meta (no vence)
#  - WHATSAPP_PHONE_ID  "Identificador del número de teléfono" (WhatsApp > Configuración de la API)
#  - CRON_SECRET        se genera solo si no existe (lo usa el cron diario de Vercel para disparar los informes)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$scope = 'mito-srl'

function Pedir($texto) {
  $s = Read-Host $texto -AsSecureString
  $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)).Trim() } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }
}

function Cargar($nombre, $valor) {
  # Si ya existe se reemplaza (vercel no deja agregar dos veces la misma)
  npx --no-install vercel --scope $scope env rm $nombre production --yes 2>$null | Out-Null
  $valor | npx --no-install vercel --scope $scope env add $nombre production --sensitive | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "No se pudo cargar $nombre en Vercel" }
  Write-Host "  OK  $nombre" -ForegroundColor Green
}

Write-Host "`nWhatsApp para el Hub MITO (Vercel: $scope/hub-mito, Production)`n" -ForegroundColor Cyan

$token = Pedir 'Pegá el token permanente de Meta (WHATSAPP_TOKEN)'
if ($token.Length -lt 50) { throw 'Ese token es muy corto: tiene que ser el del usuario del sistema (empieza con EAA...).' }
$phoneId = Pedir 'Pegá el Phone number ID (WHATSAPP_PHONE_ID)'
if ($phoneId -notmatch '^\d{10,20}$') { throw 'El Phone number ID son solo números (unos 15 dígitos), no el teléfono.' }

# Probar contra Meta antes de guardar nada
Write-Host "`nProbando con Meta..."
try {
  $r = Invoke-RestMethod "https://graph.facebook.com/v23.0/$phoneId`?fields=display_phone_number,verified_name,quality_rating" -Headers @{ Authorization = "Bearer $token" }
  Write-Host "  Número: $($r.display_phone_number)  ($($r.verified_name))  calidad $($r.quality_rating)" -ForegroundColor Green
} catch {
  $msg = $_.ErrorDetails.Message
  throw "Meta rechazó el token o el ID: $msg"
}

Write-Host "`nCargando en Vercel..."
Cargar 'WHATSAPP_TOKEN' $token
Cargar 'WHATSAPP_PHONE_ID' $phoneId

$existentes = (npx --no-install vercel --scope $scope env ls production 2>$null) -join "`n"
if ($existentes -notmatch '\bCRON_SECRET\b') {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  Cargar 'CRON_SECRET' (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}
$token = $null

Write-Host "`nPublicando el hub de nuevo para que tome las variables..."
npx --no-install vercel --scope $scope redeploy hub-mito.vercel.app --target production
if ($LASTEXITCODE -ne 0) {
  Write-Host "No se pudo re-publicar solo. Hacelo a mano: https://vercel.com/mito-srl/hub-mito/deployments -> ultimo -> ... -> Redeploy" -ForegroundColor Yellow
} else {
  Write-Host "`nListo. En el hub: Sistemas -> Envío informes y reportes tiene que decir 'WhatsApp conectado'." -ForegroundColor Green
}
