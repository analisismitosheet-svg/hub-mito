/**
 * Reposiciones / Transferencias > Reparto manual.
 *
 *   GET  /api/sql/reparto                       -> { opciones }  (filtros del paso 1, del DWH)
 *   POST /api/sql/reparto  { filtros, desde, hasta, forzar? }
 *     -> { estado: 'calculando', desde }        (el Puente está leyendo el DWH, ~1-2 min)
 *     -> { estado: 'listo', locales, filas, arts, ... }
 *     -> { estado: 'demasiados', articulos, max }
 *   POST /api/sql/reparto  { dragon: true, modo: 'motivos'|'revisar'|'cargar'|'estado', motivo, obs, pedidos, confirmo? }
 *     -> lo que da MITO se carga como pedido de venta por local en Dragon (puente-sql/reparto-dragon.js)
 *
 * SOLO LECTURA: el Puente (puente-sql/reparto.js + sql/reparto-*.sql) lee stock y venta de cada
 * local y depósito. Los movimientos entre locales van a Supabase como lote de Transferencias
 * (RPC reparto_cargar_transferencias); lo que sale de MITO va a Dragon como pedido de venta
 * (API REST de Dragon, solo altas). Nunca se escribe directo en el SQL Server.
 *
 * Cuelga del router api/sql/[ruta].ts (tope de funciones de Vercel). Permiso: transferencias.import.
 */

import { postAlPuente } from './puenteRetry.js'
import { autorizado, tokenDe } from './apiAuth.js'

type Req = {
  method?: string
  headers: Record<string, string | string[] | undefined>
  query: Record<string, string | string[] | undefined>
  body?: unknown
}
type Res = {
  status(code: number): Res
  setHeader(name: string, value: string): Res
  json(body: unknown): void
}

const PERMISO = 'transferencias.import'
/** Reparto manual sin el resto de Transferencias (rol mayorista): ver, cargar el lote y los pedidos en Dragon */
const PERMISO_REPARTO = 'transferencias.reparto'

/** URL efectiva del Puente: la guardada en sql_conexion, si no el env (igual que repoDiariaApi). */
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

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

  const token = tokenDe(req.headers.authorization as string | undefined)
  if (!token || !(await autorizado(token, [PERMISO, PERMISO_REPARTO]))) return res.status(401).json({ error: 'No autorizado' })

  const destino = await urlDestino()
  if (!destino) return res.status(500).json({ error: 'Falta configurar la URL del Puente SQL' })
  if (/\.logic\.azure\.com/i.test(destino)) {
    return res.status(500).json({ error: 'El reparto sólo lo calcula el Puente SQL local: la URL guardada apunta a una Logic App.' })
  }
  const tokenPuente = process.env.SQL_BRIDGE_TOKEN ?? ''
  if (!tokenPuente) return res.status(500).json({ error: 'Falta la variable SQL_BRIDGE_TOKEN en Vercel' })

  let cuerpo: Record<string, unknown>
  if (req.method === 'GET') {
    cuerpo = { accion: 'reparto_opciones' }
  } else {
    const b = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {}) as Record<string, unknown>
    if (b.dragon) {
      // Lo que da MITO -> pedidos de venta en Dragon (puente-sql/reparto-dragon.js valida todo)
      if (JSON.stringify(b).length > 1_000_000) return res.status(400).json({ error: 'Pedido demasiado grande' })
      const modo = String(b.modo ?? '')
      if (!['motivos', 'revisar', 'cargar', 'estado'].includes(modo)) return res.status(400).json({ error: 'Modo inválido' })
      cuerpo = { accion: 'reparto_dragon', modo, motivo: b.motivo, obs: b.obs, pedidos: b.pedidos, confirmo: b.confirmo }
    } else {
      if (JSON.stringify(b).length > 20_000) return res.status(400).json({ error: 'Filtros demasiado grandes' })
      cuerpo = { accion: 'reparto_stock', filtros: b.filtros ?? {}, desde: String(b.desde ?? ''), hasta: String(b.hasta ?? ''), forzar: !!b.forzar }
    }
  }

  const r0 = await postAlPuente(
    destino,
    { headers: { 'Content-Type': 'application/json', 'X-Puente-Token': tokenPuente }, body: JSON.stringify(cuerpo) },
    { timeoutMs: 25_000, intentos: 2 },
  )
  if (!r0.ok) {
    return res.status(502).json({
      error: r0.motivo === 'timeout' ? 'El Puente SQL no respondió a tiempo' : 'No se pudo contactar el Puente SQL de la PC central',
    })
  }
  const datos = (await r0.res.json().catch(() => null)) as ({ error?: string } & Record<string, unknown>) | null
  if (!r0.res.ok || !datos) {
    let detalle = datos?.error ?? `respuesta ${r0.res.status}`
    if (/vista inv[aá]lid[ao]/i.test(detalle)) detalle += ' — Puente SQL desactualizado: reiniciá puente-sql (acción "reparto").'
    return res.status(r0.res.status === 400 ? 400 : 502).json({ error: detalle })
  }
  return res.status(200).json(datos)
}
