/**
 * Copia las FOTOS de los productos de indonesiashop.com.ar (Tiendanube, tienda Indonesiashop) a
 * Supabase (public.articulos_fotos, origen 'indonesiashop'; ver sql/articulos_fotos.sql) para la
 * consulta de precios pública del hub (/precios).
 *
 *   node scripts/sync-fotos-tiendanube.js                 todos los productos (≈ 6000, ~1 minuto)
 *   node scripts/sync-fotos-tiendanube.js --json=<ruta>   además sube public/fotos-articulos.json
 *                                                         (Captain Fin + Zimith) como origen 'ventasxmayor'
 *
 * El código de artículo sale del nombre del producto, entre paréntesis ("REMERA … (CF175121)"),
 * o del final de la URL (".../remera-captain-fin-college-cf175127/"). Supabase descarta los
 * códigos que no están en el maestro de artículos. Al terminar borra las fotos de los productos
 * que ya no están en la tienda.
 *
 * Lee la API de Tiendanube con el token de la app privada "acceso hub mito" (solo lectura):
 * TN_HUB_TOKEN / TN_STORE_ID / TN_USER_AGENT en puente-sql/.env, como sync-tiendanube.js.
 * Log: data/sync-fotos-tiendanube.log
 */

const fs = require('fs')
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const LOG = path.join(RAIZ, 'data', 'sync-fotos-tiendanube.log')
const POR_PAGINA = 200
const LOTE = 500
const JSON_FOTOS = process.argv.find((a) => a.startsWith('--json='))?.slice(7)

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
const RPC_KEY = (cfg('SUPABASE_SERVICE_ROLE_KEY') ?? envHub.SUPABASE_SERVICE_ROLE_KEY) || SUPABASE_ANON_KEY
const PUENTE_TOKEN = cfg('PUENTE_TOKEN')
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
    /* sin log en disco */
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

/** GET a la API de Tiendanube respetando el límite (balde de 40, 2 por segundo). */
async function tn(ruta, params) {
  const url = `https://api.tiendanube.com/v1/${TN_STORE}${ruta}?${new URLSearchParams(params)}`
  for (let intento = 1; ; intento++) {
    const r = await fetch(url, { headers: { Authentication: `bearer ${TN_TOKEN}`, 'User-Agent': TN_UA } })
    if (r.status === 429 && intento <= 5) {
      await esperar(Number(r.headers.get('x-rate-limit-reset')) || 2000)
      continue
    }
    if (r.status === 404) return { filas: [], hayMas: false }
    if (!r.ok) throw new Error(`Tiendanube ${ruta}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`)
    if (Number(r.headers.get('x-rate-limit-remaining')) < 5) await esperar(2000)
    return { filas: await r.json(), hayMas: /rel="next"/.test(r.headers.get('link') ?? '') }
  }
}

const CODIGO = /^[A-Z0-9]{4,20}$/
const textoDe = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? v.es ?? Object.values(v)[0] ?? '' : '')

/** Códigos de artículo de un producto: los que están entre paréntesis en el nombre y el final de la URL. */
function codigosDe(p) {
  const cods = new Set()
  for (const m of textoDe(p.name).matchAll(/\(([A-Za-z0-9]{4,20})\)/g)) cods.add(m[1].toUpperCase())
  const url = String(p.canonical_url ?? textoDe(p.handle) ?? '')
  const fin = url.replace(/\/+$/, '').split('/').pop()?.split('-').pop() ?? ''
  if (/^[a-z]{2}\d{6}$/i.test(fin)) cods.add(fin.toUpperCase())
  return [...cods].filter((c) => CODIGO.test(c))
}

async function subir(origen, filas) {
  let quedaron = 0
  for (let i = 0; i < filas.length; i += LOTE) {
    quedaron += await rpc('articulos_fotos_sync_lote', { p_token: PUENTE_TOKEN, p_origen: origen, p_filas: filas.slice(i, i + LOTE) })
  }
  return quedaron
}

async function main() {
  if (!TN_TOKEN || !TN_STORE) throw new Error('Falta TN_HUB_TOKEN / TN_STORE_ID en puente-sql/.env')
  if (!SUPABASE_URL || !RPC_KEY || !PUENTE_TOKEN) throw new Error('Falta SUPABASE_URL / clave / PUENTE_TOKEN')
  const t0 = Date.now()
  const inicio = new Date(Date.now() - 60_000).toISOString()

  // 1) Productos de la tienda (publicados o no: la foto sirve igual)
  const porArticulo = new Map()
  let productos = 0
  for (let pagina = 1; ; pagina++) {
    const { filas, hayMas } = await tn('/products', { page: pagina, per_page: POR_PAGINA, fields: 'id,name,handle,canonical_url,images' })
    for (const p of filas) {
      productos++
      const fotos = (p.images ?? [])
        .slice()
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((im) => String(im.src ?? ''))
        .filter((u) => u.startsWith('https://'))
      if (!fotos.length) continue
      for (const cod of codigosDe(p)) {
        const prev = porArticulo.get(cod) ?? []
        porArticulo.set(cod, [...new Set([...prev, ...fotos])].slice(0, 14))
      }
    }
    if (!hayMas || !filas.length) break
  }
  const filas = [...porArticulo.entries()].map(([id_art, fotos]) => ({ id_art, fotos }))
  const quedaron = await subir('indonesiashop', filas)
  const borradas = await rpc('articulos_fotos_sync_fin', { p_token: PUENTE_TOKEN, p_origen: 'indonesiashop', p_desde: inicio })
  anotar(`indonesiashop: ${productos} productos, ${filas.length} códigos con foto, ${quedaron} artículos guardados, ${borradas} borrados (${Math.round((Date.now() - t0) / 1000)} s)`)

  // 2) Opcional: el índice de fotos de Captain Fin + Zimith que usa el resto del hub
  if (JSON_FOTOS) {
    const HOST = 'https://bunny-cdn.ventasxmayor.com/'
    const mapa = JSON.parse(fs.readFileSync(JSON_FOTOS, 'utf8'))
    const filasJson = Object.entries(mapa).map(([id_art, lista]) => ({
      id_art,
      fotos: (Array.isArray(lista) ? lista : []).map((u) => (String(u).startsWith('http') ? String(u) : HOST + u)),
    }))
    const inicioJson = new Date(Date.now() - 60_000).toISOString()
    const q = await subir('ventasxmayor', filasJson)
    const b = await rpc('articulos_fotos_sync_fin', { p_token: PUENTE_TOKEN, p_origen: 'ventasxmayor', p_desde: inicioJson })
    anotar(`ventasxmayor (${path.basename(JSON_FOTOS)}): ${filasJson.length} códigos, ${q} artículos guardados, ${b} borrados`)
  }
}

main().catch((e) => {
  anotar(`ERROR: ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
