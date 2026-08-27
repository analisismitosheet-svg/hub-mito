/**
 * ============================================================
 * PUENTE SQL — corre en una PC/servidor de TU red, junto al SQL Server
 * ============================================================
 *
 * Expone las vistas del SQL Server como HTTP para el proxy de Vercel,
 * reemplazando al Logic App + On-Premises Data Gateway (sin Azure).
 *
 * Contrato (compatible con api/sql/[view].ts):
 *   POST /          body: { vista: string, top: number }
 *                   header: X-Puente-Token: <PUENTE_TOKEN>
 *                   -> 200 JSON array de filas
 *   GET  /health    -> { ok: true } (sin token, para probar el túnel)
 *
 * Solo lectura: siempre hace SELECT TOP (n) * FROM dbo.[vista].
 *
 * CONFIGURACIÓN (archivo .env junto a este archivo o variables de entorno):
 *   PUENTE_TOKEN=un-secreto-largo      # mismo valor que SQL_BRIDGE_TOKEN en Vercel
 *   PUENTE_PORT=3128
 *   SQL_SERVER=TU-SERVIDOR\SQLEXPRESS  # o host:puerto
 *   SQL_DATABASE=TuBase
 *   SQL_USER=usuario_solo_lectura      # login SQL con db_datareader
 *   SQL_PASSWORD=***
 *   SQL_ENCRYPT=false                  # true si tu servidor tiene TLS válido
 *   SQL_TRUST_CERT=true                # para certificados autofirmados internos
 *
 * ARRANQUE:  npm install && npm start   (y dejarlo corriendo, ej. con pm2)
 */

const http = require('http')
const fs = require('fs')
const path = require('path')

/* ---- mini lector de .env (sin dependencias) ---- */
try {
  const envPath = path.join(__dirname, '.env')
  for (const linea of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {
  /* .env opcional */
}

const {
  PUENTE_TOKEN,
  PUENTE_PORT = '3128',
  SQL_SERVER,
  SQL_DATABASE,
  SQL_USER,
  SQL_PASSWORD,
  SQL_ENCRYPT = 'false',
  SQL_TRUST_CERT = 'true',
} = process.env

if (!PUENTE_TOKEN || !SQL_SERVER || !SQL_DATABASE || !SQL_USER || !SQL_PASSWORD) {
  console.error('[puente] Faltan variables: PUENTE_TOKEN, SQL_SERVER, SQL_DATABASE, SQL_USER, SQL_PASSWORD')
  process.exit(1)
}

let sql
try {
  sql = require('mssql')
} catch {
  console.error('[puente] Falta el paquete mssql. Corré:  npm install')
  process.exit(1)
}

const pool = new sql.ConnectionPool({
  server: SQL_SERVER,
  database: SQL_DATABASE,
  user: SQL_USER,
  password: SQL_PASSWORD,
  options: {
    encrypt: SQL_ENCRYPT === 'true',
    trustServerCertificate: SQL_TRUST_CERT === 'true',
  },
})
pool.on('error', (err) => console.error('[puente] Error de pool:', err.message))

function enviar(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(payload)
}

async function leerCuerpo(req) {
  let data = ''
  for await (const chunk of req) data += chunk
  if (data.length > 4096) throw new Error('Body demasiado grande')
  return data ? JSON.parse(data) : {}
}

const server = http.createServer(async (req, res) => {
  try {
    // Salud: sin token, útil para verificar el túnel
    if (req.method === 'GET' && req.url.startsWith('/health')) {
      return enviar(res, 200, { ok: true })
    }

    if (req.method !== 'POST') return enviar(res, 405, { error: 'Método no permitido' })

    if ((req.headers['x-puente-token'] ?? '') !== PUENTE_TOKEN) {
      return enviar(res, 401, { error: 'Token inválido' })
    }

    const body = await leerCuerpo(req)
    const vista = String(body?.vista ?? '')
    const pedido = Number(body?.top)
    const top = Math.min(Number.isFinite(pedido) && pedido > 0 ? Math.floor(pedido) : 1000, 10000)

    // Sanitizado estricto del nombre de vista (solo SELECT, nunca otra cosa)
    if (!/^[A-Za-z0-9_]+$/.test(vista)) return enviar(res, 400, { error: 'Nombre de vista inválido' })

    const result = await pool.request().input('top', sql.Int(top)).query(
      `SELECT TOP (@top) * FROM dbo.[${vista}]`,
    )
    return enviar(res, 200, result.recordset ?? [])
  } catch (err) {
    console.error('[puente]', err.message)
    return enviar(res, 500, { error: err.message.slice(0, 300) })
  }
})

server.listen(Number(PUENTE_PORT), () => {
  console.log(`[puente] Escuchando en http://localhost:${PUENTE_PORT}`)
})
