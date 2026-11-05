/**
 * Copia las «Cancelación de venta» de Dragonfish MITO a Supabase
 * (tablas public.cancelaciones_venta + public.cancelaciones_venta_items) para Mayorista → Cancelaciones de venta.
 *
 *   node scripts/sync-cancelaciones-venta.js            últimos 2 días
 *   node scripts/sync-cancelaciones-venta.js --todo     últimos 120 días y borra lo anterior
 *   (también la llama sync-pedidos-venta.js al terminar: cada 15 minutos, y --todo a las 6:30)
 *
 * Lee DRAGONFISH_MITO.ZooLogic.COMPROBANTEV (FACTTIPO 12) + COMPROBANTEVDET, los comprobantes que afecta
 * cada una (ZooLogic.COMPAFE: pedidos tipo 23, remitos tipo 11) y el nombre del motivo (ZooLogic.MOTIVO),
 * con la misma conexión que el puente (SQL_SERVER / SQL_USER del .env). Solo lectura en el SQL Server.
 * Si algo falla a mitad de camino no se borra nada.
 *
 * Configuración (puente-sql/.env): PUENTE_TOKEN; opcional CANCELACIONES_VENTA_BASE (default DRAGONFISH_MITO.ZooLogic)
 * Log: data/sync-cancelaciones-venta.log
 */

const fs = require('fs')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const LOG = path.join(RAIZ, 'data', 'sync-cancelaciones-venta.log')
const LOTE = 100
// Corre cada 15 minutos: con 2 días alcanza (una cancelación casi no cambia después de cargarse) y
// se reescriben ~300 renglones por corrida en vez de ~1.000; lo anterior lo corrige la copia diaria
const DIAS_RECIENTES = 2
const DIAS_COMPLETA = 120

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
// Igual que sync-pedidos-venta: la service role evita el statement_timeout de 3 s de `anon`;
// la protección del RPC sigue siendo el PUENTE_TOKEN
const RPC_KEY = (cfg('SUPABASE_SERVICE_ROLE_KEY') ?? envHub.SUPABASE_SERVICE_ROLE_KEY) || SUPABASE_ANON_KEY
const BASE = cfg('CANCELACIONES_VENTA_BASE') || 'DRAGONFISH_MITO.ZooLogic'

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
    headers: { apikey: RPC_KEY, Authorization: `Bearer ${RPC_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const cuerpo = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`${nombre}: HTTP ${r.status} ${cuerpo?.message ?? ''}`.trim())
  return cuerpo
}

const txt = (v) => String(v ?? '').trim()
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const fecha = (v) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString().slice(0, 10) : txt(v).slice(0, 10) || null)

async function sincronizarCancelacionesVenta({ completa = false } = {}) {
  if (!cfg('PUENTE_TOKEN')) throw new Error('Falta PUENTE_TOKEN en puente-sql/.env')
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Falta SUPABASE_URL / SUPABASE_ANON_KEY')
  const partes = BASE.split('.')
  if (partes.length !== 2 || !partes.every((p) => /^[A-Za-z0-9_]{1,128}$/.test(p))) throw new Error(`CANCELACIONES_VENTA_BASE inválida: ${BASE}`)
  const DB = partes.map((p) => `[${p}]`).join('.')

  const dias = completa ? DIAS_COMPLETA : DIAS_RECIENTES
  const hoy = new Date(Date.now() - 3 * 3600_000) // fecha de Argentina
  const desde = new Date(hoy.getTime() - dias * 86400_000).toISOString().slice(0, 10)

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
  let cab, afe, det
  const filtro = 'c.FACTTIPO = 12 AND c.FFCH >= @desde'
  try {
    const consulta = (q) => pool.request().input('desde', sql.Date, desde).query(q).then((r) => r.recordset)
    cab = await consulta(`
      SELECT c.CODIGO, c.FNUMCOMP, c.FFCH, c.HALTAFW, c.FPERSON, c.FCLIENTE, c.UALTAFW, CAST(c.FOBS AS varchar(4000)) FOBS,
             c.FTOTAL, c.ANULADO, c.MOTIVO, m.MOTDES
      FROM ${DB}.COMPROBANTEV c
      LEFT JOIN ${DB}.MOTIVO m ON RTRIM(m.MOTCOD) = RTRIM(c.MOTIVO) AND RTRIM(c.MOTIVO) <> ''
      WHERE ${filtro}`)
    afe = await consulta(`
      SELECT a.CODIGO, a.NROITEM, a.AFECTA, a.AFETIPOCOM, a.AFENUMCOM, a.AFECOMPROB, a.AFEFECHA, a.AFETOTAL
      FROM ${DB}.COMPAFE a JOIN ${DB}.COMPROBANTEV c ON c.CODIGO = a.CODIGO
      WHERE ${filtro} AND RTRIM(a.AFETIPO) = 'Afectado'`)
    det = await consulta(`
      SELECT d.CODIGO, d.NROITEM, d.FART, CAST(d.FTXT AS varchar(400)) FTXT, d.CCOLOR, d.FCOLTXT, d.TALLE, d.FCANT, d.FPRECIO
      FROM ${DB}.COMPROBANTEVDET d JOIN ${DB}.COMPROBANTEV c ON c.CODIGO = d.CODIGO
      WHERE ${filtro}`)
  } finally {
    await pool.close()
  }

  const agrupar = (filas) => {
    const p = new Map()
    for (const f of filas) {
      const k = txt(f.CODIGO)
      if (!p.has(k)) p.set(k, [])
      p.get(k).push(f)
    }
    for (const l of p.values()) l.sort((a, b) => a.NROITEM - b.NROITEM)
    return p
  }
  const porAfe = agrupar(afe)
  const porDet = agrupar(det)
  const lista = cab
    .filter((c) => txt(c.CODIGO))
    .map((c) => {
      const codigo = txt(c.CODIGO)
      const items = (porDet.get(codigo) || []).map((d, i) => ({
        linea: i + 1,
        articulo: txt(d.FART),
        descripcion: txt(d.FTXT),
        color: txt(d.CCOLOR),
        color_nombre: txt(d.FCOLTXT),
        talle: txt(d.TALLE),
        cantidad: num(d.FCANT),
        precio: num(d.FPRECIO),
      }))
      return {
        codigo,
        numero: num(c.FNUMCOMP),
        fecha: fecha(c.FFCH),
        hora: txt(c.HALTAFW).slice(0, 5),
        cliente: txt(c.FPERSON),
        cliente_nombre: txt(c.FCLIENTE),
        usuario: txt(c.UALTAFW),
        observacion: txt(c.FOBS),
        motivo: txt(c.MOTIVO),
        motivo_nombre: txt(c.MOTDES),
        total: num(c.FTOTAL),
        unidades: items.reduce((s, it) => s + (it.cantidad || 0), 0),
        anulado: !!c.ANULADO,
        afecta: (porAfe.get(codigo) || []).map((a) => ({
          codigo: txt(a.AFECTA),
          tipo: num(a.AFETIPOCOM),
          numero: num(a.AFENUMCOM),
          comprobante: txt(a.AFECOMPROB),
          fecha: fecha(a.AFEFECHA),
          total: num(a.AFETOTAL),
        })),
        items,
      }
    })
  const alcance = completa ? `${DIAS_COMPLETA} días` : `${DIAS_RECIENTES} días`
  anotar(`Leídas ${lista.length} cancelaciones (${det.length} renglones, desde ${desde}) en ${Date.now() - t0} ms`)
  if (lista.length === 0) {
    anotar(`Sin cancelaciones en los últimos ${alcance}: no se toca la copia`)
    return
  }

  const token = cfg('PUENTE_TOKEN')
  const gen = Date.now()
  for (let i = 0; i < lista.length; i += LOTE) {
    await rpc('cancelaciones_venta_sync_lote', { p_token: token, p_gen: gen, p_cancelaciones: lista.slice(i, i + LOTE) })
  }
  const borradas = await rpc('cancelaciones_venta_sync_fin', {
    p_token: token,
    p_gen: gen,
    p_total: lista.length,
    p_origen: `${cfg('SQL_SERVER')} ${BASE}`,
    p_desde: desde,
    p_completa: completa,
  })
  anotar(`OK: ${lista.length} cancelaciones (${det.length} renglones, ${alcance}) en Supabase, ${borradas} borradas (${Math.round((Date.now() - t0) / 1000)} s)`)
}

module.exports = { sincronizarCancelacionesVenta }

if (require.main === module) {
  sincronizarCancelacionesVenta({ completa: process.argv.includes('--todo') }).catch((err) => {
    anotar(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  })
}
