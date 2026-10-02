/**
 * Copia las cancelaciones de pedidos de compra del DWH a Supabase
 * (tablas public.cancelaciones + public.cancelaciones_items) para Compras → Pedidos → Cancelaciones
 * y para descontarlas en Estado de pedidos.
 *
 *   node scripts/sync-cancelaciones.js
 *   (también la llama sync-pedidos-compra.js al terminar: cada 1 hora o con "Actualizar datos")
 *
 * Lee DWH.dbo.vw_FACT_CANCELADOS (una fila por artículo) con la misma conexión que el puente
 * (SQL_SERVER / SQL_USER del .env). Solo lectura en el SQL Server. Si algo falla a mitad de camino
 * no se borra nada: queda la copia anterior + lo que se alcanzó a actualizar.
 *
 * Configuración (puente-sql/.env): PUENTE_TOKEN; opcional CANCELADOS_VISTA (default DWH.dbo.vw_FACT_CANCELADOS)
 * Log: data/sync-cancelaciones.log
 */

const fs = require('fs')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const LOG = path.join(RAIZ, 'data', 'sync-cancelaciones.log')
const LOTE = 100

function leerEnv(archivo) {
  const out = {}
  try {
    for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
      const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
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
const VISTA = cfg('CANCELADOS_VISTA') || 'DWH.dbo.vw_FACT_CANCELADOS'

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
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const cuerpo = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`${nombre}: HTTP ${r.status} ${cuerpo?.message ?? ''}`.trim())
  return cuerpo
}

const txt = (v) => String(v ?? '').trim()
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const fecha = (v) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString().slice(0, 10) : txt(v).slice(0, 10) || null)

async function sincronizarCancelaciones() {
  if (!cfg('PUENTE_TOKEN')) throw new Error('Falta PUENTE_TOKEN en puente-sql/.env')
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Falta SUPABASE_URL / SUPABASE_ANON_KEY')
  const partes = VISTA.split('.')
  if (partes.length !== 3 || !partes.every((p) => /^[A-Za-z0-9_]{1,128}$/.test(p))) throw new Error(`CANCELADOS_VISTA inválida: ${VISTA}`)

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
      `SELECT NRO_CANCELADO, PROVEEDOR, FECHA_COMPROBANTE, COMPROBANTE_PROVEEDOR, NRO_PEDIDO, CODIGO_PEDIDO,
              OBSERVACIONES, ARTICULO, DESCRIPCION_ARTICULO, CANTIDAD, COLOR, TALLE
       FROM ${partes.map((p) => `[${p}]`).join('.')}`,
    )
    filas = r.recordset
  } finally {
    await pool.close()
  }

  // Agrupa por cancelación (la vista trae una fila por artículo)
  const cancelaciones = new Map()
  for (const f of filas) {
    const nro = txt(f.NRO_CANCELADO)
    if (!nro) continue
    let c = cancelaciones.get(nro)
    if (!c) {
      const m = /(\d+)\s*$/.exec(nro)
      c = {
        nro,
        numero: m ? Number(m[1]) : null,
        proveedor: txt(f.PROVEEDOR),
        fecha: fecha(f.FECHA_COMPROBANTE),
        comprobante: txt(f.COMPROBANTE_PROVEEDOR),
        nro_pedido: txt(f.NRO_PEDIDO),
        codigo_pedido: txt(f.CODIGO_PEDIDO),
        observacion: txt(f.OBSERVACIONES),
        items: [],
      }
      cancelaciones.set(nro, c)
    }
    c.items.push({
      linea: c.items.length + 1,
      articulo: txt(f.ARTICULO),
      descripcion: txt(f.DESCRIPCION_ARTICULO),
      color: txt(f.COLOR),
      talle: txt(f.TALLE),
      cantidad: num(f.CANTIDAD),
    })
  }
  const lista = [...cancelaciones.values()]
  anotar(`Leídas ${filas.length} filas de ${VISTA} (${lista.length} cancelaciones) en ${Date.now() - t0} ms`)
  if (lista.length === 0) throw new Error('La vista no devolvió cancelaciones: no se toca la copia actual')

  const token = cfg('PUENTE_TOKEN')
  const gen = Date.now()
  for (let i = 0; i < lista.length; i += LOTE) {
    await rpc('cancelaciones_sync_lote', { p_token: token, p_gen: gen, p_cancelaciones: lista.slice(i, i + LOTE) })
  }
  const borradas = await rpc('cancelaciones_sync_fin', { p_token: token, p_gen: gen, p_total: lista.length, p_origen: VISTA })
  anotar(`OK: ${lista.length} cancelaciones (${filas.length} ítems) en Supabase, ${borradas} viejas borradas (${Math.round((Date.now() - t0) / 1000)} s)`)
}

module.exports = { sincronizarCancelaciones }

if (require.main === module) {
  sincronizarCancelaciones().catch((err) => {
    anotar(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  })
}
