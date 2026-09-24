/**
 * Copia la vista de equivalencias del SQL Server a Supabase (tabla public.equivalencias),
 * para que el escaneo de Mi repo traduzca cualquier código de barras a artículo/color/talle.
 *
 *   node scripts/sync-equivalencias.js        (lo corre la tarea "MITO - Sync equivalencias")
 *
 * Lee la vista completa directo del SQL Server (sin el tope de filas del proxy), la sube
 * en lotes y al final borra de Supabase lo que ya no existe. Si algo falla a mitad de
 * camino no se borra nada: queda la copia anterior + lo que se alcanzó a actualizar.
 *
 * Configuración (puente-sql/.env):
 *   PUENTE_TOKEN, SQL_*        las mismas del puente (el token autentica la subida)
 *   EQUIV_VISTA                opcional, default DRAGONFISH_INDOD.ZooLogic.equivalencias
 *   SUPABASE_URL / SUPABASE_ANON_KEY   opcionales: si faltan, se toman de ../.env del hub
 * Log: data/sync-equivalencias.log
 */

const fs = require('fs')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const LOG = path.join(RAIZ, 'data', 'sync-equivalencias.log')
const LOTE = 4000

/* ---- .env del puente y, como respaldo, el del hub (URL y clave anon de Supabase) ---- */
function leerEnv(archivo) {
  const out = {}
  try {
    for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
      const m = linea.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* opcional */
  }
  return out
}
const envPuente = leerEnv(path.join(RAIZ, '.env'))
const envHub = leerEnv(path.join(RAIZ, '..', '.env'))
const cfg = (k) => process.env[k] ?? envPuente[k]

const SUPABASE_URL = cfg('SUPABASE_URL') ?? envHub.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = cfg('SUPABASE_ANON_KEY') ?? envHub.VITE_SUPABASE_ANON_KEY
const VISTA = cfg('EQUIV_VISTA') || 'DRAGONFISH_INDOD.ZooLogic.equivalencias'

function anotar(texto) {
  // Hora local (sv-SE da el formato "2026-09-24 07:00:00")
  const linea = `${new Date().toLocaleString('sv-SE')}  ${texto}`
  console.log(linea)
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true })
    fs.appendFileSync(LOG, linea + '\n')
  } catch {
    /* sin log en disco: igual se ve en consola */
  }
}

async function rpc(nombre, params) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  })
  const cuerpo = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`${nombre}: HTTP ${r.status} ${cuerpo?.message ?? ''}`.trim())
  return cuerpo
}

async function main() {
  const faltan = ['PUENTE_TOKEN', 'SQL_SERVER', 'SQL_DATABASE', 'SQL_USER', 'SQL_PASSWORD'].filter((k) => !cfg(k))
  if (faltan.length) throw new Error(`Faltan variables en puente-sql/.env: ${faltan.join(', ')}`)
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Falta SUPABASE_URL / SUPABASE_ANON_KEY')

  const partes = VISTA.split('.')
  if (partes.length !== 3 || !partes.every((p) => /^[A-Za-z0-9_-]{1,128}$/.test(p))) {
    throw new Error(`EQUIV_VISTA inválida: ${VISTA} (usar BASE.esquema.vista)`)
  }
  const [base, esquema, objeto] = partes

  // Misma conexión que el puente (host, host\instancia, host:puerto o host,puerto)
  const sql = require('mssql')
  let serverHost = cfg('SQL_SERVER')
  let serverPort
  const mPuerto = String(serverHost).match(/^(.+?)[,:](\d+)$/)
  if (mPuerto && !String(serverHost).includes('\\')) {
    serverHost = mPuerto[1]
    serverPort = Number(mPuerto[2])
  }
  const pool = await new sql.ConnectionPool({
    server: serverHost,
    ...(serverPort ? { port: serverPort } : {}),
    database: cfg('SQL_DATABASE'),
    user: cfg('SQL_USER'),
    password: cfg('SQL_PASSWORD'),
    options: {
      encrypt: (cfg('SQL_ENCRYPT') ?? 'false') === 'true',
      trustServerCertificate: (cfg('SQL_TRUST_CERT') ?? 'true') === 'true',
    },
    requestTimeout: 300000,
  }).connect()

  const t0 = Date.now()
  let filas
  try {
    const r = await pool
      .request()
      .query(`SELECT ID_ART, COD_BARRAS, ID_COLOR, ID_TALLE FROM [${base}].[${esquema}].[${objeto}]`)
    filas = r.recordset ?? []
  } finally {
    await pool.close()
  }

  // Normaliza (sin espacios de relleno) y deja un solo registro por código de barras
  const porCodigo = new Map()
  for (const f of filas) {
    const cod = String(f.COD_BARRAS ?? '').replace(/\s/g, '').toUpperCase()
    const art = String(f.ID_ART ?? '').trim()
    if (!cod || !art || porCodigo.has(cod)) continue
    porCodigo.set(cod, {
      cod_barras: cod,
      id_art: art,
      id_color: String(f.ID_COLOR ?? '').trim(),
      id_talle: String(f.ID_TALLE ?? '').trim(),
    })
  }
  const lista = [...porCodigo.values()]
  anotar(`Leídas ${filas.length} filas de ${VISTA} (${lista.length} códigos únicos) en ${Date.now() - t0} ms`)
  if (lista.length === 0) throw new Error('La vista no devolvió filas: no se toca la copia actual')

  const token = cfg('PUENTE_TOKEN')
  const gen = Date.now()
  for (let i = 0; i < lista.length; i += LOTE) {
    await rpc('equivalencias_sync_lote', { p_token: token, p_gen: gen, p_filas: lista.slice(i, i + LOTE) })
  }
  const borradas = await rpc('equivalencias_sync_fin', {
    p_token: token,
    p_gen: gen,
    p_total: lista.length,
    p_origen: VISTA,
  })
  anotar(`OK: ${lista.length} equivalencias en Supabase, ${borradas} viejas borradas (${Math.round((Date.now() - t0) / 1000)} s)`)
}

main().catch((err) => {
  anotar(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
})
