/**
 * Venta diaria de cada local propio → Supabase (ventas_locales_dia), para Locales → Objetivos.
 *
 *   node scripts/sync-ventas-locales.js          (últimos 10 días; si nunca corrió, todo desde 2024-12-20)
 *   node scripts/sync-ventas-locales.js --todo   (todo desde 2024-12-20)
 *
 * Venta = tickets + facturas electrónicas, netos: comprobantes TICKET%, FACTURAELECTRONICA% y
 * NOTADECREDITOELECTRONICA% no anulados (sin remitos), TOTAL = suma de FTOTAL × SIGNOMOV (las notas
 * de crédito vienen en positivo con SIGNOMOV -1, así restan) y TICKETS = cantidad de TICKETFACTURA +
 * FACTURAELECTRONICA. Es la misma venta que usaba el Excel de objetivos. La WEB (punto 39 de 9 de
 * Julio) es un local aparte, así que 9 de Julio no cuenta ese punto. Lee el COMPROBANTEV de cada base en el servidor principal
 * (SQL_SERVER del .env), solo lectura.
 *
 * Lo lanza la tarea "MITO - Pedidos franquicias" (sync-franquicias-dragon.ps1, cada 1 min), pero
 * corre de verdad una vez por hora (marca en data/sync-ventas-locales.ultimo).
 * Log: data/sync-ventas-locales.log (solo cuando hay algo).
 */
const fs = require('fs')
const path = require('path')
const sql = require('mssql')

const RAIZ = path.join(__dirname, '..')
const LOG = path.join(RAIZ, 'data', 'sync-ventas-locales.log')
const MARCA = path.join(RAIZ, 'data', 'sync-ventas-locales.ultimo')
const DESDE_TODO = '2024-12-20' // 2025 completo + la semana anterior (para repartir el domingo de CFR9)
const CADA_MS = 60 * 60_000

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

/**
 * Local del hub (tabla locales) → base(s) de Dragon. 9 de Julio cambió de base en mar-2025.
 * Por defecto cuenta tickets y facturas electrónicas del local. Un local puede traer su propio
 * filtro: la WEB es el punto de venta 39 de la base de 9 de Julio (solo factura electrónica).
 */
const VENTA = "(C.DESCFW LIKE 'TICKET%' OR C.DESCFW LIKE 'FACTURAELECTRONICA%' OR C.DESCFW LIKE 'NOTADECREDITOELECTRONICA%')"
const WEB = "C.FPTOVEN = 39 AND (C.DESCFW LIKE 'FACTURAELECTRONICA%' OR C.DESCFW LIKE 'NOTADECREDITOELECTRONICA%')"
const LOCALES = {
  '9DEJULIO': { bases: ['DRAGONFISH_9DEJULIO', 'DRAGONFISH_9DEJUL2'], filtro: `${VENTA} AND C.FPTOVEN <> 39` },
  WEB: { bases: ['DRAGONFISH_9DEJULIO', 'DRAGONFISH_9DEJUL2'], filtro: WEB },
  BUSTOD: ['DRAGONFISH_BUSTOD'],
  CFD: ['DRAGONFISH_CFD'],
  CFPO: ['DRAGONFISH_CFPO'],
  CFR4: ['DRAGONFISH_CFR4'],
  CFR9: ['DRAGONFISH_CFR9'],
  CFRA: ['DRAGONFISH_CFRA'],
  DINOD: ['DRAGONFISH_DINOD'],
  ESPINOD: ['DRAGONFISH_ESPINOD'],
  GPAZD: ['DRAGONFISH_GRALPAZ'],
  LIBERD: ['DRAGONFISH_LIBERD'],
  MUNOZ: ['DRAGONFISH_MUNOZ'],
  NVOCED: ['DRAGONFISH_NVOCED2'],
  RIVERAD: ['DRAGONFISH_RIVERAD'],
  RUTA9D2: ['DRAGONFISH_RUTA9D2'],
  VCPD: ['DRAGONFISH_VCPD'],
  WALMARTD: ['DRAGONFISH_WALMARTD'],
}

function anotar(texto) {
  const linea = `${new Date().toLocaleString('sv-SE')}  ${texto}`
  console.log(linea)
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true })
    fs.appendFileSync(LOG, linea + '\n')
  } catch {
    /* sin log en disco */
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

const isoLocal = (d) => d.toLocaleDateString('sv-SE')

async function main() {
  const token = cfg('PUENTE_TOKEN')
  if (!token) throw new Error('Falta PUENTE_TOKEN en puente-sql/.env')
  const todo = process.argv.includes('--todo') || !fs.existsSync(MARCA)
  if (!todo) {
    const ultimo = Number(fs.readFileSync(MARCA, 'utf8')) || 0
    if (Date.now() - ultimo < CADA_MS) return
  }
  const desde = todo ? DESDE_TODO : isoLocal(new Date(Date.now() - 10 * 86_400_000))

  const [host, port] = String(cfg('SQL_SERVER') || '').split(':')
  const pool = await sql.connect({
    server: host,
    ...(port ? { port: Number(port) } : {}),
    database: cfg('SQL_DATABASE') || 'master',
    user: cfg('SQL_USER'),
    password: cfg('SQL_PASSWORD'),
    options: { encrypt: cfg('SQL_ENCRYPT') === 'true', trustServerCertificate: cfg('SQL_TRUST_CERT') !== 'false' },
    requestTimeout: 120_000,
  })

  const filas = []
  try {
    for (const [local, def] of Object.entries(LOCALES)) {
      const { bases, filtro } = Array.isArray(def) ? { bases: def, filtro: VENTA } : def
      // Las notas de crédito vienen con FTOTAL positivo y SIGNOMOV = -1: el total es FTOTAL × SIGNOMOV
      const union = bases
        .map((b) => `SELECT CAST(C.FFCH AS date) AS F, C.DESCFW, C.FTOTAL * C.SIGNOMOV AS NETO FROM [${b}].ZooLogic.COMPROBANTEV AS C
                       WHERE C.ANULADO = 0 AND ${filtro} AND C.FFCH >= @desde`)
        .join(' UNION ALL ')
      const r = await pool.request().input('desde', sql.Date, desde).query(`
        SELECT CONVERT(varchar(10), T.F, 23) AS fecha, SUM(T.NETO) AS total,
               COUNT(CASE WHEN T.DESCFW LIKE 'TICKETFACTURA%' OR T.DESCFW LIKE 'FACTURAELECTRONICA%' THEN 1 END) AS tickets
          FROM (${union}) AS T GROUP BY T.F`)
      for (const f of r.recordset) filas.push({ local, fecha: f.fecha, total: Number(f.total) || 0, tickets: Number(f.tickets) || 0 })
    }
  } finally {
    await pool.close().catch(() => undefined)
  }

  let cambiadas = 0
  for (let i = 0; i < filas.length; i += 1000) {
    cambiadas += Number(await rpc('ventas_locales_dia_sync', { p_token: token, p_filas: filas.slice(i, i + 1000) })) || 0
  }
  fs.mkdirSync(path.dirname(MARCA), { recursive: true })
  fs.writeFileSync(MARCA, String(Date.now()))
  if (cambiadas || todo) anotar(`Desde ${desde}: ${filas.length} días·local leídos, ${cambiadas} nuevos o cambiados`)
}

main().catch((e) => {
  anotar(`ERROR ${e.message}`)
  process.exit(1)
})
