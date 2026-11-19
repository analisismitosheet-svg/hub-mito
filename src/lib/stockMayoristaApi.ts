/**
 * Stock MAYORISTA para la tienda web unificada (Captain Fin + Zimith, proyecto aparte de este hub).
 *
 *   GET /api/sql/stock-mayorista?prefijos=CF,ZH        -> { filas: [{ a, c, t, s }], en }
 *   GET /api/sql/stock-mayorista?articulos=CF264132,…  (hasta 200)
 *
 * Depósito MITO, stock REAL = físico − comprometido (pedido + preparado), por artículo, color y talle; solo s > 0.
 * Es la misma fórmula del Reparto manual (puente: acción `stock_mayorista`). SOLO LECTURA.
 *
 * NO es público: lo llama el servidor de la tienda con el header X-Mayorista-Token igual a la variable
 * STOCK_MAYORISTA_TOKEN (sin esa variable configurada, no responde). Nunca se llama desde el navegador.
 * Cache de 60 s en el puente; acá no-store (cada tienda cachea lo suyo).
 * Vive colgada del router api/sql/[ruta].ts.
 */
import { postAlPuente } from './puenteRetry.js'
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
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
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

export default async function stockMayorista(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' })
  const clave = process.env.STOCK_MAYORISTA_TOKEN ?? ''
  if (!clave || !mismoSecreto(primero(req.headers['x-mayorista-token']), clave)) return res.status(401).json({ error: 'No autorizado' })

  const prefijos = lista(req.query.prefijos)
  const articulos = lista(req.query.articulos)
  if (!prefijos.length && !articulos.length) return res.status(400).json({ error: 'Pasá prefijos o articulos' })
  if (prefijos.length > 10 || prefijos.some((p) => !/^[A-Z]{1,4}$/.test(p))) return res.status(400).json({ error: 'Prefijos inválidos' })
  if (articulos.length > 200 || articulos.some((a) => !/^[A-Z0-9._/-]{1,40}$/.test(a))) return res.status(400).json({ error: 'Artículos inválidos' })

  const destino = await urlDestino()
  const tokenPuente = process.env.SQL_BRIDGE_TOKEN ?? ''
  if (!destino || !tokenPuente) return res.status(500).json({ error: 'Falta configurar el Puente SQL' })
  const r0 = await postAlPuente(
    destino,
    { headers: { 'Content-Type': 'application/json', 'X-Puente-Token': tokenPuente }, body: JSON.stringify({ accion: 'stock_mayorista', prefijos, articulos }) },
    { timeoutMs: 30_000, intentos: 2 },
  )
  if (!r0.ok) return res.status(502).json({ error: 'No se pudo contactar la PC del SQL' })
  const cuerpo = (await r0.res.json().catch(() => null)) as { filas?: unknown; error?: string } | null
  if (!r0.res.ok || !cuerpo || !Array.isArray(cuerpo.filas)) {
    return res.status(502).json({ error: `Puente SQL: ${cuerpo?.error ?? `respuesta ${r0.res.status}`}` })
  }
  return res.status(200).json(cuerpo)
}
