/**
 * Órdenes de compras: colores y talles de un artículo en Dragon (en vivo).
 *
 *   GET /api/sql/dragon-variantes?base=INDOD&articulo=RU162504  -> { colores: [{codigo,nombre}], talles: [] }
 *
 * Acción propia del Puente SQL (`POST / {accion:'dragon_variantes', base, articulo}`), que lee
 * ZooLogic.COMB + COL de DRAGONFISH_<base>. Vive colgada del router api/sql/[ruta].ts.
 */
import { postAlPuente } from './puenteRetry.js'
import { autorizado, tokenDe } from './apiAuth.js'

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

async function urlDestino(): Promise<string> {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (url && service) {
    try {
      const res = await fetch(`${url}/rest/v1/sql_conexion?id=eq.1&select=logicapp_url`, { headers: { Authorization: `Bearer ${service}`, apikey: service } })
      const filas = (await res.json().catch(() => null)) as Array<{ logicapp_url?: string | null }> | null
      const deDb = filas?.[0]?.logicapp_url?.trim()
      if (deDb) return deDb
    } catch {
      /* sigue con el env */
    }
  }
  return process.env.SQL_LOGICAPP_URL ?? ''
}

/**
 *   GET /api/sql/dragon-articulos?base=INDOD&q=boxer            -> [{ articulo, descripcion, proveedor }] (buscador en vivo)
 *   GET /api/sql/dragon-articulos?base=INDOD&codigos=A,B        -> lo mismo + colores y talles, solo los que existen (txt)
 */
export async function dragonArticulos(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' })
  const token = tokenDe(req.headers.authorization as string | undefined)
  if (!token || !(await autorizado(token, ['ordenes_compra.view']))) return res.status(401).json({ error: 'No autorizado' })

  const base = primero(req.query.base).trim().toUpperCase() || 'INDOD'
  if (!/^[A-Z0-9_]{2,20}$/.test(base)) return res.status(400).json({ error: 'Base inválida' })
  const texto = primero(req.query.q).trim().slice(0, 80)
  const codigos = primero(req.query.codigos).split(',').map((c) => c.trim().toUpperCase()).filter(Boolean)
  if (codigos.length > 100) return res.status(400).json({ error: 'Máximo 100 artículos por pedido' })
  if (codigos.some((c) => !/^[A-Z0-9._/-]{1,40}$/.test(c))) return res.status(400).json({ error: 'Artículo inválido' })
  if (!codigos.length && texto.length < 2) return res.status(400).json({ error: 'Escribí al menos 2 letras' })

  const destino = await urlDestino()
  const tokenPuente = process.env.SQL_BRIDGE_TOKEN ?? ''
  if (!destino || !tokenPuente) return res.status(500).json({ error: 'Falta configurar el Puente SQL' })
  const r0 = await postAlPuente(
    destino,
    { headers: { 'Content-Type': 'application/json', 'X-Puente-Token': tokenPuente }, body: JSON.stringify({ accion: 'dragon_articulos', base, ...(codigos.length ? { codigos } : { texto }) }) },
    { timeoutMs: 20_000, intentos: 2 },
  )
  if (!r0.ok) return res.status(502).json({ error: 'No se pudo contactar la PC del SQL' })
  const cuerpo = (await r0.res.json().catch(() => null)) as unknown
  if (!r0.res.ok || !Array.isArray(cuerpo)) {
    return res.status(502).json({ error: `Puente SQL: ${(cuerpo as { error?: string } | null)?.error ?? `respuesta ${r0.res.status}`}` })
  }
  return res.status(200).json(cuerpo)
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'private, max-age=300')
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' })
  const token = tokenDe(req.headers.authorization as string | undefined)
  if (!token || !(await autorizado(token, ['ordenes_compra.view']))) return res.status(401).json({ error: 'No autorizado' })

  const base = primero(req.query.base).trim().toUpperCase() || 'INDOD'
  const articulo = primero(req.query.articulo).trim().toUpperCase()
  if (!/^[A-Z0-9_]{2,20}$/.test(base)) return res.status(400).json({ error: 'Base inválida' })
  if (!/^[A-Z0-9._/-]{1,40}$/.test(articulo)) return res.status(400).json({ error: 'Artículo inválido' })

  const destino = await urlDestino()
  const tokenPuente = process.env.SQL_BRIDGE_TOKEN ?? ''
  if (!destino || !tokenPuente) return res.status(500).json({ error: 'Falta configurar el Puente SQL' })
  const r0 = await postAlPuente(
    destino,
    { headers: { 'Content-Type': 'application/json', 'X-Puente-Token': tokenPuente }, body: JSON.stringify({ accion: 'dragon_variantes', base, articulo }) },
    { timeoutMs: 15_000, intentos: 2 },
  )
  if (!r0.ok) return res.status(502).json({ error: 'No se pudo contactar la PC del SQL' })
  const cuerpo = (await r0.res.json().catch(() => null)) as { colores?: unknown; error?: string } | null
  if (!r0.res.ok || !cuerpo || !Array.isArray(cuerpo.colores)) {
    return res.status(502).json({ error: `Puente SQL: ${cuerpo?.error ?? `respuesta ${r0.res.status}`}` })
  }
  return res.status(200).json(cuerpo)
}
