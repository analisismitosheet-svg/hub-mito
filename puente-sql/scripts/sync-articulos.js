/**
 * Copia el maestro de artículos del SQL Server a Supabase (tabla public.articulos),
 * para mostrar la descripción de cada artículo en el hub (Mapeo depósito, etc.).
 *
 *   node scripts/sync-articulos.js        (lo corre la tarea "MITO - Sync articulos")
 *
 * Lee la vista completa directo del SQL Server, sube solo los artículos con descripción
 * en lotes y al final borra de Supabase lo que ya no existe. Si algo falla a mitad de
 * camino no se borra nada: queda la copia anterior + lo que se alcanzó a actualizar.
 *
 * Configuración (puente-sql/.env):
 *   PUENTE_TOKEN, SQL_*        las mismas del puente (el token autentica la subida)
 *   ARTICULOS_VISTA            opcional, default DWH.dbo.vw_DIM_ARTICULO
 *   SUPABASE_URL / SUPABASE_ANON_KEY   opcionales: si faltan, se toman de ../.env del hub
 * Log: data/sync-articulos.log
 */

const fs = require('fs')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const LOG = path.join(RAIZ, 'data', 'sync-articulos.log')
// Lotes chicos: con 4000 filas el upsert pasaba el statement_timeout de Supabase (falló el 2026-09-30)
const LOTE = 1000
const REINTENTOS = 3

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
const VISTA = cfg('ARTICULOS_VISTA') || 'DWH.dbo.vw_DIM_ARTICULO'

function anotar(texto) {
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

const txt = (v) => String(v ?? '').trim()
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

async function main() {
  const faltan = ['PUENTE_TOKEN', 'SQL_SERVER', 'SQL_DATABASE', 'SQL_USER', 'SQL_PASSWORD'].filter((k) => !cfg(k))
  if (faltan.length) throw new Error(`Faltan variables en puente-sql/.env: ${faltan.join(', ')}`)
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Falta SUPABASE_URL / SUPABASE_ANON_KEY')

  const partes = VISTA.split('.')
  if (partes.length !== 3 || !partes.every((p) => /^[A-Za-z0-9_-]{1,128}$/.test(p))) {
    throw new Error(`ARTICULOS_VISTA inválida: ${VISTA} (usar BASE.esquema.vista)`)
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
    const r = await pool.request().query(
      `SELECT ID_ART, ARTICULO, ID_PROV, ID_GRUPO, ID_FLIA, ID_TEMPORADA, ID_MATERIAL, ID_LINEA,
              PUBLICADO, PRECIO_PUBLICO, [AÑO] AS ANIO
       FROM [${base}].[${esquema}].[${objeto}]`,
    )
    filas = r.recordset ?? []
  } finally {
    await pool.close()
  }

  // Normaliza (sin espacios de relleno); solo artículos con descripción, uno por código
  const porCodigo = new Map()
  for (const f of filas) {
    const art = String(f.ID_ART ?? '').replace(/\s/g, '').toUpperCase()
    const descripcion = txt(f.ARTICULO)
    if (!art || !descripcion || porCodigo.has(art)) continue
    porCodigo.set(art, {
      id_art: art,
      descripcion,
      id_prov: txt(f.ID_PROV),
      id_grupo: txt(f.ID_GRUPO),
      id_flia: txt(f.ID_FLIA),
      id_temporada: txt(f.ID_TEMPORADA),
      id_material: txt(f.ID_MATERIAL),
      id_linea: txt(f.ID_LINEA),
      publicado: f.PUBLICADO == null ? null : Boolean(f.PUBLICADO),
      precio_publico: num(f.PRECIO_PUBLICO),
      anio: num(f.ANIO),
    })
  }
  const lista = [...porCodigo.values()]
  anotar(`Leídas ${filas.length} filas de ${VISTA} (${lista.length} artículos con descripción) en ${Date.now() - t0} ms`)
  if (lista.length === 0) throw new Error('La vista no devolvió artículos con descripción: no se toca la copia actual')

  const token = cfg('PUENTE_TOKEN')
  const gen = Date.now()
  for (let i = 0; i < lista.length; i += LOTE) {
    for (let intento = 1; ; intento++) {
      try {
        await rpc('articulos_sync_lote', { p_token: token, p_gen: gen, p_filas: lista.slice(i, i + LOTE) })
        break
      } catch (err) {
        // Un lote que falla se reintenta (timeouts momentáneos); la clave inválida no tiene arreglo
        if (intento >= REINTENTOS || /Clave de sincronizaci/.test(String(err))) throw err
        anotar(`Lote ${i / LOTE + 1} falló (${err instanceof Error ? err.message : err}); reintento ${intento + 1} de ${REINTENTOS}`)
        await new Promise((r) => setTimeout(r, 5000 * intento))
      }
    }
  }
  const borradas = await rpc('articulos_sync_fin', {
    p_token: token,
    p_gen: gen,
    p_total: lista.length,
    p_origen: VISTA,
  })
  anotar(`OK: ${lista.length} artículos en Supabase, ${borradas} viejos borrados (${Math.round((Date.now() - t0) / 1000)} s)`)
}

main().catch((err) => {
  anotar(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
})
