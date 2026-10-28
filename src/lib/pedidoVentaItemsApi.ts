/**
 * Mayorista > Pedidos de venta: renglones de un pedido viejo, en vivo de Dragonfish.
 *
 *   GET /api/sql/pedido-venta-items?codigo=<CODIGO>  -> [{ linea, articulo, descripcion, ... }]
 *
 * En Supabase solo quedan los renglones de los últimos 120 días (sql/pedidos_venta_items_ventana.sql,
 * para que la base del hub entre en el plan chico). Los pedidos más viejos se abren desde acá:
 * acción propia del Puente SQL (`POST / {accion:'items_pedido_venta', codigo}`), que lee
 * COMPROBANTEVDET por el servidor local de la PC del puente.
 *
 * Vive colgado del router api/sql/[ruta].ts (tope de 12 funciones del plan Hobby de Vercel).
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

const PERMISO = 'pedidos_venta.view'

/** URL efectiva del Puente: la guardada en sql_conexion, si no el env. */
async function urlDestino(): Promise<string> {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (url && service) {
    try {
      const res = await fetch(`${url}/rest/v1/sql_conexion?id=eq.1&select=logicapp_url`, {
        headers: { Authorization: `Bearer ${service}`, apikey: service },
      })
      if (res.ok) {
        const filas = (await res.json().catch(() => null)) as Array<{ logicapp_url?: string | null }> | null
        const deDb = filas?.[0]?.logicapp_url?.trim()
        if (deDb) return deDb
      }
    } catch {
      /* sigue con el env */
    }
  }
  return process.env.SQL_LOGICAPP_URL ?? ''
}

function primero(q: string | string[] | undefined): string {
  if (Array.isArray(q)) return typeof q[0] === 'string' ? q[0] : ''
  return q ?? ''
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' })

  const token = tokenDe(req.headers.authorization as string | undefined)
  if (!token || !(await autorizado(token, [PERMISO]))) return res.status(401).json({ error: 'No autorizado' })

  const codigo = primero(req.query.codigo).trim()
  if (!/^[A-Za-z0-9]{1,40}$/.test(codigo)) return res.status(400).json({ error: 'Código de pedido inválido' })

  const destino = await urlDestino()
  if (!destino) return res.status(500).json({ error: 'Falta configurar la URL del Puente SQL' })
  const tokenPuente = process.env.SQL_BRIDGE_TOKEN ?? ''
  if (!tokenPuente) return res.status(500).json({ error: 'Falta la variable SQL_BRIDGE_TOKEN en Vercel' })

  const r0 = await postAlPuente(
    destino,
    {
      headers: { 'Content-Type': 'application/json', 'X-Puente-Token': tokenPuente },
      body: JSON.stringify({ accion: 'items_pedido_venta', codigo }),
    },
    { timeoutMs: 20_000, intentos: 2 },
  )
  if (!r0.ok) {
    return res.status(502).json({
      error: r0.motivo === 'timeout' ? 'El Puente SQL tardó demasiado' : 'No se pudo contactar la PC del SQL (¿está prendida?)',
    })
  }
  const cuerpo: unknown = await r0.res.json().catch(() => null)
  if (!r0.res.ok) {
    let detalle = (cuerpo as { error?: string } | null)?.error ?? `respuesta ${r0.res.status}`
    if (/vista inválida|vista invalida/i.test(detalle)) detalle += ' — Puente SQL desactualizado: hay que reiniciarlo.'
    return res.status(502).json({ error: `Puente SQL: ${detalle}` })
  }
  if (!Array.isArray(cuerpo)) return res.status(502).json({ error: 'Respuesta inesperada del Puente SQL' })
  return res.status(200).json(cuerpo)
}
