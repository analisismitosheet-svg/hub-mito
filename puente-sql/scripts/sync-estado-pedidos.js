/**
 * Copia a Supabase el estado de los pedidos de venta de Dragonfish MITO que tienen saldo pendiente
 * (tablas public.estado_pedidos + public.estado_pedidos_items) para Mayorista → Estado de pedidos.
 *
 *   node scripts/sync-estado-pedidos.js
 *   (también la llama sync-pedidos-venta.js al terminar: cada 15 minutos)
 *
 * Por cada línea del pedido: pedido (FCANT), saldo (AFESALDO, el pendiente de Dragon) y lo que le descontó cada
 * comprobante vinculado por línea (COMPROBANTEVDET.AFE_COD / AFENROITEM): remitos (11), facturas (1),
 * preparaciones de mercadería (57) y cancelaciones de venta (12). Pedidos desde 2025, no anulados, con saldo.
 *
 * Para no saturar Supabase cada pedido lleva una huella de sus datos: solo se suben los que cambiaron y al final
 * se borran los que ya no tienen saldo. Solo lectura en el SQL Server, misma conexión que el puente.
 *
 * Configuración (puente-sql/.env): PUENTE_TOKEN; opcional ESTADO_PEDIDOS_BASE (default DRAGONFISH_MITO.ZooLogic)
 * Log: data/sync-estado-pedidos.log
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const RAIZ = path.join(__dirname, '..')
const LOG = path.join(RAIZ, 'data', 'sync-estado-pedidos.log')
const ITEMS_POR_LOTE = 2000
const MAX_PEDIDOS_LOTE = 100
const DESDE = '2025-01-01'

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
const BASE = cfg('ESTADO_PEDIDOS_BASE') || 'DRAGONFISH_MITO.ZooLogic'

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
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? 0 : Number(v))
const fecha = (v) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString().slice(0, 10) : txt(v).slice(0, 10) || null)
const redondo = (n) => Math.round(n * 100) / 100
const CAMPO_TIPO = { 11: 'remitido', 1: 'facturado', 57: 'preparado', 12: 'cancelado' }

async function sincronizarEstadoPedidos() {
  if (!cfg('PUENTE_TOKEN')) throw new Error('Falta PUENTE_TOKEN en puente-sql/.env')
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Falta SUPABASE_URL / SUPABASE_ANON_KEY')
  const partes = BASE.split('.')
  if (partes.length !== 2 || !partes.every((p) => /^[A-Za-z0-9_]{1,128}$/.test(p))) throw new Error(`ESTADO_PEDIDOS_BASE inválida: ${BASE}`)
  const DB = partes.map((p) => `[${p}]`).join('.')

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
  let cab
  const lineas = []
  const afe = []
  try {
    cab = (await pool.request().input('desde', sql.Date, DESDE).query(`
      SELECT c.CODIGO, c.FNUMCOMP, c.FFCH, c.FPERSON, c.FCLIENTE, c.MOTIVO, m.MOTDES, c.FTOTAL
      FROM ${DB}.COMPROBANTEV c
      LEFT JOIN ${DB}.MOTIVO m ON RTRIM(m.MOTCOD) = RTRIM(c.MOTIVO) AND RTRIM(c.MOTIVO) <> ''
      WHERE c.FACTTIPO = 23 AND c.ANULADO = 0 AND c.FFCH >= @desde
        AND EXISTS (SELECT 1 FROM ${DB}.COMPROBANTEVDET d WHERE d.CODIGO = c.CODIGO AND d.AFESALDO > 0)`)).recordset
    // Líneas y afectaciones de esos pedidos, de a 300 códigos (van como parámetros)
    for (let i = 0; i < cab.length; i += 300) {
      const req = () => {
        const r = pool.request()
        cab.slice(i, i + 300).forEach((p, j) => r.input(`c${j}`, sql.VarChar(40), p.CODIGO))
        return r
      }
      const lista = cab.slice(i, i + 300).map((_, j) => `@c${j}`).join(',')
      lineas.push(...(await req().query(`
        SELECT d.CODIGO, d.NROITEM, d.FART, CAST(d.FTXT AS varchar(400)) FTXT, d.CCOLOR, d.FCOLTXT, d.TALLE, d.FCANT, d.AFESALDO, d.FPRECIO
        FROM ${DB}.COMPROBANTEVDET d WHERE d.CODIGO IN (${lista})`)).recordset)
      afe.push(...(await req().query(`
        SELECT d.AFE_COD, d.AFENROITEM, c.FACTTIPO, c.FNUMCOMP, SUM(d.FCANT) CANT
        FROM ${DB}.COMPROBANTEVDET d JOIN ${DB}.COMPROBANTEV c ON c.CODIGO = d.CODIGO
        WHERE d.AFE_COD IN (${lista}) AND d.AFETIPOCOM = 23 AND c.ANULADO = 0
        GROUP BY d.AFE_COD, d.AFENROITEM, c.FACTTIPO, c.FNUMCOMP`)).recordset)
    }
  } finally {
    await pool.close()
  }

  // Lo que le descontó cada comprobante a cada línea, y qué comprobantes tocaron cada pedido
  const clave = (cod, item) => `${txt(cod)}|${item}`
  const usado = new Map()
  const comprobantes = new Map()
  for (const a of afe) {
    const k = clave(a.AFE_COD, a.AFENROITEM)
    const u = usado.get(k) || { remitido: 0, facturado: 0, preparado: 0, cancelado: 0 }
    const campo = CAMPO_TIPO[a.FACTTIPO]
    if (campo) u[campo] += num(a.CANT)
    usado.set(k, u)
    const cod = txt(a.AFE_COD)
    if (!comprobantes.has(cod)) comprobantes.set(cod, new Map())
    comprobantes.get(cod).set(`${a.FACTTIPO}:${a.FNUMCOMP}`, { tipo: num(a.FACTTIPO), numero: num(a.FNUMCOMP) })
  }
  const porPedido = new Map()
  for (const l of lineas) {
    const cod = txt(l.CODIGO)
    if (!porPedido.has(cod)) porPedido.set(cod, [])
    const u = usado.get(clave(cod, l.NROITEM)) || { remitido: 0, facturado: 0, preparado: 0, cancelado: 0 }
    porPedido.get(cod).push({
      linea: l.NROITEM,
      articulo: txt(l.FART),
      descripcion: txt(l.FTXT),
      color: txt(l.CCOLOR),
      color_nombre: txt(l.FCOLTXT),
      talle: txt(l.TALLE),
      pedido: num(l.FCANT),
      ...u,
      saldo: num(l.AFESALDO),
      precio: num(l.FPRECIO),
    })
  }

  const pedidos = cab.map((c) => {
    const codigo = txt(c.CODIGO)
    const items = (porPedido.get(codigo) || []).sort((a, b) => a.linea - b.linea)
    const sum = (k) => redondo(items.reduce((s, it) => s + it[k], 0))
    const p = {
      codigo,
      numero: num(c.FNUMCOMP),
      fecha: fecha(c.FFCH),
      cliente: txt(c.FPERSON),
      cliente_nombre: txt(c.FCLIENTE),
      motivo: txt(c.MOTIVO),
      motivo_nombre: txt(c.MOTDES),
      total: redondo(num(c.FTOTAL)),
      lineas: items.length,
      lineas_saldo: items.filter((it) => it.saldo > 0).length,
      u_pedido: sum('pedido'),
      u_remitido: sum('remitido'),
      u_facturado: sum('facturado'),
      u_preparado: sum('preparado'),
      u_cancelado: sum('cancelado'),
      u_saldo: sum('saldo'),
      pesos_saldo: redondo(items.reduce((s, it) => s + it.saldo * it.precio, 0)),
      comprobantes: [...(comprobantes.get(codigo)?.values() ?? [])].sort((a, b) => a.tipo - b.tipo || a.numero - b.numero),
      items,
    }
    p.huella = crypto.createHash('sha1').update(JSON.stringify(p)).digest('hex')
    return p
  })
  anotar(`Leídos ${pedidos.length} pedidos con saldo (${lineas.length} líneas, ${afe.length} afectaciones) en ${Date.now() - t0} ms`)

  const token = cfg('PUENTE_TOKEN')
  const actuales = new Map(((await rpc('estado_pedidos_huellas', { p_token: token })) ?? []).map((h) => [h.codigo, h.huella]))
  const cambiados = pedidos.filter((p) => actuales.get(p.codigo) !== p.huella)

  // Lotes por cantidad de líneas (hay pedidos de cientos de líneas)
  const lotes = []
  let actual = []
  let items = 0
  for (const p of cambiados) {
    if (actual.length && (items + p.items.length > ITEMS_POR_LOTE || actual.length >= MAX_PEDIDOS_LOTE)) {
      lotes.push(actual)
      actual = []
      items = 0
    }
    actual.push(p)
    items += p.items.length
  }
  if (actual.length) lotes.push(actual)
  for (const lote of lotes) await rpc('estado_pedidos_sync_lote', { p_token: token, p_pedidos: lote })

  const borrados = await rpc('estado_pedidos_sync_fin', {
    p_token: token,
    p_codigos: pedidos.map((p) => p.codigo),
    p_subidos: cambiados.length,
    p_origen: `${cfg('SQL_SERVER')} ${BASE}`,
  })
  anotar(`OK: ${pedidos.length} pedidos con saldo, ${cambiados.length} subidos (cambiaron), ${borrados} borrados (${Math.round((Date.now() - t0) / 1000)} s)`)
}

module.exports = { sincronizarEstadoPedidos }

if (require.main === module) {
  sincronizarEstadoPedidos().catch((err) => {
    anotar(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  })
}
