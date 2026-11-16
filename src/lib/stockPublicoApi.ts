/**
 * Consulta de precios para clientes (/precios): stock de UN artículo por local, color y talle.
 *
 *   GET /api/sql/stock-publico?articulo=CF050302
 *     -> { articulo, locales: { CFRA: [{ color, talle, stock }], ... }, colores: { '01': 'BLANCO' }, sin_datos, en }
 *
 * ES PÚBLICO (sin sesión), así que va con candados:
 *  - solo GET y solo un código de artículo con forma válida (letras y números, 2 a 20);
 *  - el artículo tiene que estar en la consulta pública (public.articulos con precio_publico > 0);
 *  - el puente tiene la lista FIJA de locales al público (acción `stock_publico`): desde acá no se
 *    puede pedir otra base, otra vista ni otra columna; la respuesta se vuelve a filtrar acá
 *    (solo locales conocidos, color, talle y unidades);
 *  - tope de pedidos por IP y cache de 60 s en el CDN de Vercel (un mismo artículo no golpea el SQL).
 * Vive colgada del router api/sql/[ruta].ts.
 */
import { postAlPuente } from './puenteRetry.js'

type Req = {
  method?: string
  headers: Record<string, string | string[] | undefined>
  query: Record<string, string | string[] | undefined>
}
type Res = {
  status(code: number): Res
  setHeader(name: string, value: string): Res
  json(body: unknown): void
}

/** Locales que puede devolver (los mismos de STOCK_PUBLICO_LOCALES del puente). */
const LOCALES = new Set([
  '9DEJULIO', 'BUSTOD', 'CFD', 'CFPO', 'CFR4', 'CFR9', 'CFRA', 'DINOD', 'ESPINOD',
  'GPAZD', 'LIBERD', 'MUNOZ', 'NVOCED', 'RIVERAD', 'RUTA9D2', 'VCPD', 'WALMARTD',
])
const ARTICULO = /^[A-Z0-9]{2,20}$/
const CORTO = /^[A-Za-z0-9 ./-]{0,20}$/

const primero = (q: string | string[] | undefined) => (Array.isArray(q) ? String(q[0] ?? '') : q ?? '')

/* Tope por IP (por instancia de la función: frena a un script que recorre códigos). */
const VENTANA_MS = 60_000
const TOPE = 40
const pedidos = new Map<string, number[]>()
function excedido(ip: string): boolean {
  const ahora = Date.now()
  const lista = (pedidos.get(ip) ?? []).filter((t) => ahora - t < VENTANA_MS)
  lista.push(ahora)
  pedidos.set(ip, lista)
  if (pedidos.size > 5000) pedidos.clear()
  return lista.length > TOPE
}

async function urlDestino(url: string | undefined, service: string | undefined): Promise<string> {
  if (url && service) {
    try {
      const r = await fetch(`${url}/rest/v1/sql_conexion?id=eq.1&select=logicapp_url`, { headers: { Authorization: `Bearer ${service}`, apikey: service } })
      const filas = (await r.json().catch(() => null)) as Array<{ logicapp_url?: string | null }> | null
      const deDb = filas?.[0]?.logicapp_url?.trim()
      if (deDb) return deDb
    } catch {
      /* sigue con el env */
    }
  }
  return process.env.SQL_LOGICAPP_URL ?? ''
}

/** Locales con lista de precios propia (los mismos de LISTAS_LOCAL_PUBLICO del puente). */
const LOCALES_CON_LISTA = new Set(['GPAZD'])

/**
 *   GET /api/sql/stock-publico?local=GPAZD&articulos=A,B,…  (máx. 40)
 *     -> { local, lista: 'Outlet', precios: { A: 12345 } }  (los que no tienen precio en esa lista no vienen)
 * Solo artículos de la consulta pública.
 */
async function preciosLocal(res: Res, local: string, lista: string, url: string, service: string, tokenPuente: string) {
  if (!LOCALES_CON_LISTA.has(local)) return res.status(400).json({ error: 'Local inválido' })
  const pedidos = [...new Set(lista.split(',').map((a) => a.trim().toUpperCase()).filter(Boolean))]
  if (!pedidos.length || pedidos.length > 40 || pedidos.some((a) => !ARTICULO.test(a))) {
    return res.status(400).json({ error: 'Artículos inválidos' })
  }
  let articulos: string[]
  try {
    const r = await fetch(
      `${url}/rest/v1/articulos?id_art=in.(${pedidos.map(encodeURIComponent).join(',')})&precio_publico=gt.0&select=id_art`,
      { headers: { Authorization: `Bearer ${service}`, apikey: service } },
    )
    const filas = (await r.json().catch(() => null)) as Array<{ id_art?: string }> | null
    if (!r.ok || !Array.isArray(filas)) return res.status(502).json({ error: 'Consulta no disponible' })
    articulos = filas.map((f) => String(f.id_art ?? '')).filter((a) => ARTICULO.test(a))
  } catch {
    return res.status(502).json({ error: 'Consulta no disponible' })
  }
  if (!articulos.length) return res.status(200).json({ local, lista: null, precios: {} })

  const destino = await urlDestino(url, service)
  if (!destino) return res.status(500).json({ error: 'Consulta no disponible' })
  const r0 = await postAlPuente(
    destino,
    { headers: { 'Content-Type': 'application/json', 'X-Puente-Token': tokenPuente }, body: JSON.stringify({ accion: 'precios_local_publico', local, articulos }) },
    { timeoutMs: 20_000, intentos: 2 },
  )
  if (!r0.ok) return res.status(502).json({ error: 'No se pudieron consultar los precios' })
  const cuerpo = (await r0.res.json().catch(() => null)) as { lista?: unknown; precios?: Record<string, unknown> } | null
  if (!r0.res.ok || !cuerpo || typeof cuerpo.precios !== 'object' || !cuerpo.precios) {
    return res.status(502).json({ error: 'No se pudieron consultar los precios' })
  }
  const precios: Record<string, number> = {}
  for (const a of articulos) {
    const p = Number(cuerpo.precios[a])
    if (Number.isFinite(p) && p > 0) precios[a] = Math.round(p * 100) / 100
  }
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=300')
  return res.status(200).json({ local, lista: typeof cuerpo.lista === 'string' ? cuerpo.lista.slice(0, 30) : 'Outlet', precios })
}

export default async function stockPublico(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' })

  const ip = String(primero(req.headers['x-real-ip']) || primero(req.headers['x-forwarded-for']).split(',')[0] || '').trim()
  if (excedido(ip || 'sin-ip')) return res.status(429).json({ error: 'Demasiadas consultas. Esperá un minuto.' })

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  const tokenPuente = process.env.SQL_BRIDGE_TOKEN ?? ''
  if (!url || !service || !tokenPuente) return res.status(500).json({ error: 'Consulta no disponible' })

  // ?local=GPAZD&articulos=A,B -> precios de la lista propia del local (General Paz = Outlet)
  const localLista = primero(req.query.local).trim().toUpperCase()
  if (localLista) return preciosLocal(res, localLista, primero(req.query.articulos), url, service, tokenPuente)

  const articulo = primero(req.query.articulo).trim().toUpperCase()
  if (!ARTICULO.test(articulo)) return res.status(400).json({ error: 'Artículo inválido' })

  // Solo artículos de la consulta pública (los que tienen precio al público)
  try {
    const r = await fetch(
      `${url}/rest/v1/articulos?id_art=eq.${encodeURIComponent(articulo)}&precio_publico=gt.0&select=id_art`,
      { headers: { Authorization: `Bearer ${service}`, apikey: service } },
    )
    const filas = (await r.json().catch(() => null)) as unknown[] | null
    if (!r.ok) return res.status(502).json({ error: 'Consulta no disponible' })
    if (!Array.isArray(filas) || !filas.length) return res.status(404).json({ error: 'Artículo no encontrado' })
  } catch {
    return res.status(502).json({ error: 'Consulta no disponible' })
  }

  const destino = await urlDestino(url, service)
  if (!destino) return res.status(500).json({ error: 'Consulta no disponible' })
  const r0 = await postAlPuente(
    destino,
    { headers: { 'Content-Type': 'application/json', 'X-Puente-Token': tokenPuente }, body: JSON.stringify({ accion: 'stock_publico', articulo }) },
    { timeoutMs: 20_000, intentos: 2 },
  )
  if (!r0.ok) return res.status(502).json({ error: 'No se pudo consultar el stock' })
  const cuerpo = (await r0.res.json().catch(() => null)) as {
    locales?: Record<string, Array<{ color?: unknown; talle?: unknown; stock?: unknown }>>
    colores?: Record<string, unknown>
    sin_datos?: unknown
  } | null
  if (!r0.res.ok || !cuerpo || typeof cuerpo.locales !== 'object' || !cuerpo.locales) {
    return res.status(502).json({ error: 'No se pudo consultar el stock' })
  }

  // Se reenvía solo lo que hace falta (por si el puente devolviera de más)
  const locales: Record<string, Array<{ color: string; talle: string; stock: number }>> = {}
  for (const [cod, filas] of Object.entries(cuerpo.locales)) {
    if (!LOCALES.has(cod) || !Array.isArray(filas)) continue
    locales[cod] = filas
      .map((f) => ({ color: String(f.color ?? ''), talle: String(f.talle ?? ''), stock: Math.max(0, Math.round(Number(f.stock) || 0)) }))
      .filter((f) => f.stock > 0 && CORTO.test(f.color) && CORTO.test(f.talle))
      .slice(0, 400)
  }
  const colores: Record<string, string> = {}
  for (const [c, d] of Object.entries(cuerpo.colores ?? {})) {
    if (CORTO.test(c) && typeof d === 'string') colores[c] = d.slice(0, 40)
  }
  const sinDatos = Array.isArray(cuerpo.sin_datos) ? cuerpo.sin_datos.filter((c): c is string => typeof c === 'string' && LOCALES.has(c)) : []

  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=60')
  return res.status(200).json({ articulo, locales, colores, sin_datos: sinDatos, en: new Date().toISOString() })
}
