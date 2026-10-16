// Prueba de conexión con la API REST de Dragonfish (SOLO LECTURA: autentica y consulta un cliente).
//   node scripts/dragon-probar.js            (HMAC de la contraseña en hex)
//   node scripts/dragon-probar.js --b64      (HMAC en base64, si la primera da 401)
//
// Datos en puente-sql/.env (nunca en el chat):
//   DRAGON_API_URL        http://192.168.0.222:8015/api.Dragonfish
//   DRAGON_API_IDCLIENTE  código del Cliente REST API (ej. MITO)
//   DRAGON_API_AUTH       clave privada de ese Cliente REST API
//   DRAGON_USUARIO        usuario de Dragonfish
//   DRAGON_PASSWORD       contraseña de ese usuario
//
// Cómo arma el token Zoo Logic (campus.zoologic.com.ar, "Servicio REST API"):
//   JWT HS256 firmado con la clave privada, payload { usuario, password, exp }
//   usuario = usuario de Dragon en mayúsculas
//   password = HMAC-SHA256(mensaje = contraseña, clave = clave privada), ambos en mayúsculas
//   exp = vencimiento en epoch (segundos)
//   POST /Autenticar { IdCliente, JWToken } -> devuelve el token para el header Authorization.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

for (const l of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const URL_API = (process.env.DRAGON_API_URL || 'http://192.168.0.222:8015/api.Dragonfish').replace(/\/$/, '')
const ID = (process.env.DRAGON_API_IDCLIENTE || '').trim().toUpperCase()
const CLAVE = (process.env.DRAGON_API_AUTH || '').trim()
const USUARIO = (process.env.DRAGON_USUARIO || '').trim().toUpperCase()
const PASS = (process.env.DRAGON_PASSWORD || '').trim()
const faltan = ['DRAGON_API_IDCLIENTE', 'DRAGON_API_AUTH', 'DRAGON_USUARIO', 'DRAGON_PASSWORD'].filter((k) => !process.env[k])
if (faltan.length) { console.error('Faltan en puente-sql/.env:', faltan.join(', ')); process.exit(1) }

const b64url = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const enc = process.argv.includes('--b64') ? 'base64' : 'hex'
const hmacPass = crypto.createHmac('sha256', CLAVE.toUpperCase()).update(PASS.toUpperCase()).digest(enc)
const cabecera = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
const cuerpo = b64url(JSON.stringify({ usuario: USUARIO, password: hmacPass, exp: Math.floor(Date.now() / 1000) + 3600 }))
const firma = b64url(crypto.createHmac('sha256', CLAVE).update(`${cabecera}.${cuerpo}`).digest())
const jwt = `${cabecera}.${cuerpo}.${firma}`

;(async () => {
  console.log(`Autenticando ${ID} con el usuario ${USUARIO} (HMAC en ${enc})…`)
  const r = await fetch(`${URL_API}/Autenticar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ IdCliente: ID, JWToken: jwt }),
  })
  const texto = await r.text()
  console.log('Autenticar ->', r.status, r.statusText, r.headers.get('InformacionAdicional') || '')
  if (!r.ok) { console.log(texto.slice(0, 300)); process.exit(2) }
  let token = texto.trim()
  try { const j = JSON.parse(texto); token = j.token || j.Token || j.JWToken || j.AccessToken || j.access_token || (typeof j === 'string' ? j : token); console.log('Campos de la respuesta:', Object.keys(j)) } catch { /* texto plano */ }
  token = String(token).replace(/^"|"$/g, '')

  const c = await fetch(`${URL_API}/Cliente/01140/`, { headers: { IdCliente: ID, Authorization: token, BaseDeDatos: 'MITO' } })
  const cj = await c.text()
  console.log('GET Cliente/01140 ->', c.status, c.statusText, c.headers.get('InformacionAdicional') || '')
  console.log(cj.slice(0, 400))
})().catch((e) => { console.error('ERROR', e.message); process.exit(1) })
