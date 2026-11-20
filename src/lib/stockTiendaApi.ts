/**
 * Stock para la TIENDA mayorista web (cf-zimith-mayorista.vercel.app, Captain Fin + Zimith, proyecto aparte de este hub).
 * No confundir con Mayorista > Stock del hub (stockMayoristaApi.ts, acción stock_mayorista).
 *
 *   GET /api/sql/stock-tienda?prefijos=CF,ZH        -> { filas: [{ a, c, t, s }], en }
 *   GET /api/sql/stock-tienda?articulos=CF264132,…  (hasta 200)
 *   GET /api/sql/stock-tienda?articulos=…&locales=1  -> { filas: [{ l, a, c, t, s }], sin_datos }  (17 locales, hasta 60)
 *
 * Depósito MITO, stock REAL = físico − comprometido (pedido + preparado), por artículo, color y talle; solo s > 0.
 * Es la misma fórmula del Reparto manual (puente: acción `stock_tienda`). SOLO LECTURA.
 *
 * NO es público: lo llama el servidor de la tienda con el header X-Mayorista-Token igual a la variable
 * STOCK_MAYORISTA_TOKEN (sin esa variable configurada, no responde). Nunca se llama desde el navegador.
 * Cache de 60 s en el puente; acá no-store (cada tienda cachea lo suyo).
 * Vive colgada del router api/sql/[ruta].ts.
 */
import { postAlPuente, urlsDelPuente } from './puenteRetry.js'
import { mismoSecreto } from './apiAuth.js'

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

const primero = (q: string | string[] | undefined) => (Array.isArray(q) ? String(q[0] ?? '') : q ?? '')
const lista = (q: string | string[] | undefined) => primero(q).split(',').map((x) => x.trim().toUpperCase()).filter(Boolean)

async function urlDestino(): Promise<string> {
  return (await urlsDelPuente())[0] ?? process.env.SQL_LOGICAPP_URL ?? ''
}

export default async function stockTienda(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' })
  const clave = process.env.STOCK_MAYORISTA_TOKEN ?? ''
  if (!clave || !mismoSecreto(primero(req.headers['x-mayorista-token']), clave)) return res.status(401).json({ error: 'No autorizado' })

  const prefijos = lista(req.query.prefijos)
  const articulos = lista(req.query.articulos)
  // locales=1: stock real de los 17 locales para esos artículos (tilde «sumar stock de locales»; hasta 60)
  const locales = primero(req.query.locales) === '1'
  if (locales && (!articulos.length || articulos.length > 60)) return res.status(400).json({ error: 'Con locales=1 pasá de 1 a 60 artículos' })
  if (!prefijos.length && !articulos.length) return res.status(400).json({ error: 'Pasá prefijos o articulos' })
  if (prefijos.length > 10 || prefijos.some((p) => !/^[A-Z]{1,4}$/.test(p))) return res.status(400).json({ error: 'Prefijos inválidos' })
  if (articulos.length > 200 || articulos.some((a) => !/^[A-Z0-9._/-]{1,40}$/.test(a))) return res.status(400).json({ error: 'Artículos inválidos' })

  const destino = await urlDestino()
  const tokenPuente = process.env.SQL_BRIDGE_TOKEN ?? ''
  if (!destino || !tokenPuente) return res.status(500).json({ error: 'Falta configurar el Puente SQL' })
  const r0 = await postAlPuente(
    destino,
    { headers: { 'Content-Type': 'application/json', 'X-Puente-Token': tokenPuente }, body: JSON.stringify({ accion: 'stock_tienda', prefijos, articulos, ...(locales ? { locales: true } : {}) }) },
    { timeoutMs: 30_000, intentos: 2 },
  )
  if (!r0.ok) return res.status(502).json({ error: 'No se pudo contactar la PC del SQL' })
  const cuerpo = (await r0.res.json().catch(() => null)) as { filas?: unknown; error?: string } | null
  if (!r0.res.ok || !cuerpo || !Array.isArray(cuerpo.filas)) {
    return res.status(502).json({ error: `Puente SQL: ${cuerpo?.error ?? `respuesta ${r0.res.status}`}` })
  }
  return res.status(200).json(cuerpo)
}

/**
 * POST /api/sql/tienda-dragon (misma clave X-Mayorista-Token): lo único de Dragon que la tienda puede pedirle al puente.
 *   { accion: 'dragon_articulos', codigos: [...] | texto }  -> buscar códigos en INDOD (solo lectura)
 *   { accion: 'dragon_alta_articulo', articulo: {...} }     -> alta de artículo en INDOD (el puente valida todo)
 *   { accion: 'dragon_cliente', codigo }                    -> ficha comercial del cliente en MITO (solo lectura)
 * Cualquier otra acción se rechaza; los artículos siempre van a INDOD y los clientes se leen de MITO.
 */
export async function tiendaDragon(req: Req & { body?: unknown }, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  const clave = process.env.STOCK_MAYORISTA_TOKEN ?? ''
  if (!clave || !mismoSecreto(primero(req.headers['x-mayorista-token']), clave)) return res.status(401).json({ error: 'No autorizado' })

  const b = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {}) as Record<string, unknown>
  let cuerpo: Record<string, unknown>
  if (b.accion === 'dragon_articulos') {
    const codigos = Array.isArray(b.codigos) ? b.codigos.map(String).slice(0, 50) : undefined
    const texto = typeof b.texto === 'string' ? b.texto.slice(0, 20) : undefined
    if (!codigos && !texto) return res.status(400).json({ error: 'Pasá codigos o texto' })
    cuerpo = { accion: 'dragon_articulos', base: 'INDOD', ...(codigos ? { codigos } : { texto }) }
  } else if (b.accion === 'dragon_alta_articulo') {
    if (!b.articulo || typeof b.articulo !== 'object') return res.status(400).json({ error: 'Falta el artículo' })
    cuerpo = { accion: 'dragon_alta_articulo', articulo: b.articulo }
  } else if (b.accion === 'dragon_cliente') {
    // ficha comercial de un cliente en DRAGONFISH_MITO, solo lectura (panel de Clientes de la tienda)
    const codigo = String(b.codigo ?? '').trim()
    if (!/^[A-Za-z0-9]{1,10}$/.test(codigo)) return res.status(400).json({ error: 'Código de cliente inválido' })
    cuerpo = { accion: 'dragon_cliente', codigo }
  } else {
    return res.status(400).json({ error: 'Acción no permitida' })
  }

  const destino = await urlDestino()
  const tokenPuente = process.env.SQL_BRIDGE_TOKEN ?? ''
  if (!destino || !tokenPuente) return res.status(500).json({ error: 'Falta configurar el Puente SQL' })
  // el alta no se reintenta: si el puente lo recibió y tardó, repetirlo podría duplicar colores o precios
  const r0 = await postAlPuente(
    destino,
    { headers: { 'Content-Type': 'application/json', 'X-Puente-Token': tokenPuente }, body: JSON.stringify(cuerpo) },
    { timeoutMs: 60_000, intentos: cuerpo.accion === 'dragon_alta_articulo' ? 1 : 2 },
  )
  if (!r0.ok) return res.status(502).json({ error: 'No se pudo contactar la PC del SQL' })
  const datos = await r0.res.json().catch(() => null)
  if (datos === null) return res.status(502).json({ error: `Puente SQL: respuesta ${r0.res.status}` })
  return res.status(r0.res.status).json(datos)
}
