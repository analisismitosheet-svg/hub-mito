/**
 * Copia los pedidos de la tienda Tiendanube (Indonesiashop) a Supabase
 * (tablas public.tn_pedidos + public.tn_pedidos_items) para la pantalla
 * "Ventas web" del hub (área Administradores). Ver sql/tiendanube.sql.
 *
 *   node scripts/sync-tiendanube.js                    lo modificado desde la última corrida (tarea cada 20 min)
 *   node scripts/sync-tiendanube.js --desde=2025-01-01 todos los pedidos creados desde esa fecha, mes por mes
 *
 * Lee la API de Tiendanube con el token de la app privada "acceso hub mito" (solo lectura).
 * No guarda mails, teléfonos, documentos ni direcciones: solo nombre y provincia/ciudad.
 *
 * Configuración (puente-sql/.env):
 *   TN_HUB_TOKEN    token de acceso de la app (obligatorio)
 *   TN_STORE_ID     id de la tienda (obligatorio)
 *   TN_USER_AGENT   default "Hub MITO"
 * Marca de la última corrida: data/sync-tiendanube.json. Log: data/sync-tiendanube.log
 */

const fs = require('fs')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const LOG = path.join(RAIZ, 'data', 'sync-tiendanube.log')
const ESTADO = path.join(RAIZ, 'data', 'sync-tiendanube.json')
const POR_PAGINA = 200
// Margen hacia atrás en cada corrida: un pedido que se modificó mientras corría la anterior no se pierde
const MARGEN_MIN = 15
// Sin marca (primera vez o se borró el archivo): los últimos 3 días
const DIAS_SIN_MARCA = 3
const DESDE = process.argv.find((a) => a.startsWith('--desde='))?.split('=')[1]

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
// Igual que los otros syncs: con service role no corre el statement_timeout de 3 s de anon;
// la protección del RPC sigue siendo el PUENTE_TOKEN.
const RPC_KEY = (cfg('SUPABASE_SERVICE_ROLE_KEY') ?? envHub.SUPABASE_SERVICE_ROLE_KEY) || SUPABASE_ANON_KEY
const TN_TOKEN = cfg('TN_HUB_TOKEN')
const TN_STORE = cfg('TN_STORE_ID')
const TN_UA = cfg('TN_USER_AGENT') || 'Hub MITO'

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

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

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

/**
 * GET a la API de Tiendanube. Respeta el límite (balde de 40 pedidos, se vacía 2 por segundo):
 * si quedan pocos espera, y ante un 429 espera lo que diga x-rate-limit-reset y reintenta.
 */
async function tn(ruta, params) {
  const url = `https://api.tiendanube.com/v1/${TN_STORE}${ruta}?${new URLSearchParams(params)}`
  for (let intento = 1; ; intento++) {
    const r = await fetch(url, { headers: { Authentication: `bearer ${TN_TOKEN}`, 'User-Agent': TN_UA } })
    if (r.status === 429 && intento <= 5) {
      await esperar(Number(r.headers.get('x-rate-limit-reset')) || 2000)
      continue
    }
    // Sin resultados la API responde 404 con "Last page is 0"
    if (r.status === 404) return { filas: [], hayMas: false }
    if (!r.ok) throw new Error(`Tiendanube ${ruta}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`)
    if (Number(r.headers.get('x-rate-limit-remaining')) < 5) await esperar(2000)
    return { filas: await r.json(), hayMas: /rel="next"/.test(r.headers.get('link') ?? '') }
  }
}

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const txt = (v) => {
  const s = String(v ?? '').trim()
  return s === '' ? null : s
}

/** Pedido de la API -> fila de tn_pedidos (sin datos de contacto) */
function aFila(o) {
  const entrega = o.shipping_pickup_type === 'pickup' ? o.shipping_pickup_details?.address : o.shipping_address
  return {
    id: o.id,
    numero: o.number,
    creado_at: o.created_at,
    modificado_at: o.updated_at,
    pagado_at: o.paid_at ?? null,
    cancelado_at: o.cancelled_at ?? null,
    estado: txt(o.status),
    estado_pago: txt(o.payment_status),
    estado_envio: txt(o.shipping_status),
    moneda: txt(o.currency),
    subtotal: num(o.subtotal),
    descuento: num(o.discount),
    envio: num(o.shipping_cost_customer),
    total: num(o.total),
    medio_pago: txt(o.gateway_name ?? o.gateway),
    metodo_pago: txt(o.payment_details?.method),
    cuotas: num(o.payment_details?.installments),
    envio_tipo: txt(o.shipping_pickup_type),
    envio_opcion: txt(typeof o.shipping_option === 'string' ? o.shipping_option : o.shipping_option?.name),
    canal: txt(o.storefront),
    utm_source: txt(o.customer_visit?.utm_parameters?.utm_source),
    cupon: txt((o.coupon ?? []).map((c) => c.code).filter(Boolean).join(', ')),
    cliente: txt(o.contact_name ?? o.customer?.name),
    provincia: txt(entrega?.province),
    ciudad: txt(entrega?.city),
    items: (o.products ?? []).map((p) => ({
      producto_id: p.product_id ?? null,
      variante_id: p.variant_id ?? null,
      sku: txt(p.sku),
      nombre: txt(p.name_without_variants ?? p.name),
      variante: txt((p.variant_values ?? []).join(' / ')),
      cantidad: num(p.quantity),
      precio: num(p.price),
    })),
  }
}

/** Trae todas las páginas de un filtro y las sube a Supabase de a una página */
async function copiar(filtro) {
  let n = 0
  for (let pagina = 1; ; pagina++) {
    const { filas, hayMas } = await tn('/orders', { ...filtro, per_page: POR_PAGINA, page: pagina })
    if (filas.length) {
      await rpc('tn_pedidos_sync_lote', { p_token: cfg('PUENTE_TOKEN'), p_pedidos: filas.map(aFila) })
      n += filas.length
    }
    if (!hayMas || filas.length < POR_PAGINA) return n
  }
}

async function main() {
  if (!cfg('PUENTE_TOKEN')) throw new Error('Falta PUENTE_TOKEN en puente-sql/.env')
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Falta SUPABASE_URL / SUPABASE_ANON_KEY')
  if (!TN_TOKEN || !/^\d+$/.test(TN_STORE ?? '')) throw new Error('Falta TN_HUB_TOKEN / TN_STORE_ID en puente-sql/.env')

  const t0 = Date.now()
  const inicio = new Date()
  let n = 0
  let origen

  if (DESDE) {
    // Carga completa por mes (creados), así ninguna consulta pagina demasiado
    if (!/^\d{4}-\d{2}-\d{2}$/.test(DESDE)) throw new Error('--desde tiene que ser AAAA-MM-DD')
    let mes = new Date(`${DESDE}T00:00:00-03:00`)
    while (mes < inicio) {
      const sig = new Date(mes)
      sig.setUTCMonth(sig.getUTCMonth() + 1, 1)
      sig.setUTCHours(3, 0, 0, 0) // 00:00 de Córdoba
      const m = await copiar({ created_at_min: mes.toISOString(), created_at_max: sig.toISOString() })
      anotar(`  ${mes.toISOString().slice(0, 7)}: ${m} pedidos`)
      n += m
      mes = sig
    }
    origen = `completa desde ${DESDE}`
  } else {
    let marca
    try {
      marca = new Date(JSON.parse(fs.readFileSync(ESTADO, 'utf8')).marca)
    } catch {
      /* sin marca */
    }
    if (!marca || Number.isNaN(marca.getTime())) marca = new Date(Date.now() - DIAS_SIN_MARCA * 86400000)
    const desde = new Date(marca.getTime() - MARGEN_MIN * 60000)
    n = await copiar({ updated_at_min: desde.toISOString() })
    origen = `modificados desde ${desde.toISOString()}`
  }

  // La marca es la hora de ARRANQUE: lo que cambió mientras corría entra en la próxima
  fs.mkdirSync(path.dirname(ESTADO), { recursive: true })
  fs.writeFileSync(ESTADO, JSON.stringify({ marca: inicio.toISOString() }))
  const total = await rpc('tn_sync_fin', { p_token: cfg('PUENTE_TOKEN'), p_pedidos: n, p_origen: origen })
  anotar(`OK ${n} pedidos (${origen}); ${total} en la tabla; ${((Date.now() - t0) / 1000).toFixed(1)} s`)
}

main().catch((e) => {
  anotar(`ERROR ${e.message}`)
  process.exit(1)
})
