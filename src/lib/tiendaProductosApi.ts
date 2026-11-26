/**
 * POST /api/sql/tienda-productos  (clave X-Mayorista-Token de la tienda; la tienda controla que guardar sea solo admin)
 *   { accion: 'listar' }                                   -> { productos: [...] } lo de la web de cada artículo
 *   { accion: 'guardar', marca, codigo, cambios, por? }    -> { producto } (alta o cambio)
 * Tabla public.tienda_productos (sql/tienda_productos.sql): cerrada, solo service_role.
 */
import { mismoSecreto } from './apiAuth.js'

type Req = { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown }
type Res = { status(code: number): Res; setHeader(name: string, value: string): Res; json(body: unknown): void }

const COLUMNAS = 'marca,codigo,visible,nuevo,oferta,preventa,entrega,suma_locales,detalle,actualizado_at,actualizado_por'
const primero = (q: string | string[] | undefined) => (Array.isArray(q) ? String(q[0] ?? '') : q ?? '')

function rest(ruta: string, init: RequestInit = {}): Promise<Response> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Falta SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  return fetch(`${url}/rest/v1/${ruta}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
}

export default async function tiendaProductos(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  const clave = process.env.STOCK_MAYORISTA_TOKEN ?? ''
  if (!clave || !mismoSecreto(primero(req.headers['x-mayorista-token']), clave)) return res.status(401).json({ error: 'No autorizado' })
  let b: Record<string, unknown> = {}
  try {
    b = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {}) as Record<string, unknown>
  } catch {
    return res.status(400).json({ error: 'JSON inválido' })
  }

  if (b.accion === 'listar') {
    const r = await rest(`tienda_productos?select=${COLUMNAS}&limit=10000`)
    if (!r.ok) return res.status(502).json({ error: 'No se pudo leer la base' })
    return res.status(200).json({ productos: await r.json() })
  }

  if (b.accion === 'guardar') {
    const marca = String(b.marca ?? '')
    const codigo = String(b.codigo ?? '').trim().toUpperCase()
    if (marca !== 'captainfin' && marca !== 'zimith') return res.status(400).json({ error: 'Marca inválida' })
    if (!/^[A-Z0-9!._/-]{1,40}$/.test(codigo)) return res.status(400).json({ error: 'Código inválido' })
    const c = (b.cambios ?? {}) as Record<string, unknown>
    const fila: Record<string, unknown> = { marca, codigo, actualizado_at: new Date().toISOString(), actualizado_por: String(b.por ?? '').slice(0, 60) || null }
    for (const k of ['visible', 'preventa', 'suma_locales'] as const) {
      if (c[k] === undefined) continue
      if (typeof c[k] !== 'boolean') return res.status(400).json({ error: `${k} inválido` })
      fila[k] = c[k]
    }
    for (const k of ['nuevo', 'oferta'] as const) {
      if (c[k] === undefined) continue
      if (c[k] !== null && typeof c[k] !== 'boolean') return res.status(400).json({ error: `${k} inválido` })
      fila[k] = c[k]
    }
    if (c.entrega !== undefined) {
      const e = c.entrega === null ? null : String(c.entrega).trim().slice(0, 40)
      fila.entrega = e || null
    }
    if (c.detalle !== undefined) {
      if (c.detalle !== null && (typeof c.detalle !== 'string' || c.detalle.length > 20000)) return res.status(400).json({ error: 'Detalle inválido (hasta 20.000 caracteres)' })
      fila.detalle = c.detalle === null || !String(c.detalle).trim() ? null : c.detalle
    }
    const r = await rest('tienda_productos?on_conflict=marca,codigo', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(fila),
    })
    const filas = (await r.json().catch(() => [])) as unknown[]
    if (!r.ok || !filas[0]) return res.status(502).json({ error: 'No se pudo guardar' })
    return res.status(200).json({ producto: filas[0] })
  }

  return res.status(400).json({ error: 'Acción no permitida' })
}
