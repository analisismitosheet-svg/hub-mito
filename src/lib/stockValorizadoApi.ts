/**
 * Administradores > Stock valorizado.
 *
 *   GET /api/sql/stock-valorizado[?forzar=1]
 *     -> { servidor, bases: [...], articulos: [...], sin_costo: [...], costo, calculado, cacheado }
 *
 * No sale de una vista: es una acción propia del Puente SQL
 * (`POST / {accion:'stock_valorizado'}` → puente-sql/sql/stock-valorizado.sql),
 * que recorre todas las bases DRAGONFISH_* del SQL principal sumando el stock
 * por SKU (ZooLogic.COMB) por el costo de la lista "Compra" (LISTA0) de
 * DRAGONFISH_MITO. Tarda ~12 s, así que el puente la cachea 10 minutos;
 * `forzar=1` (botón "Actualizar" de la pantalla) saltea ese cache.
 *
 * Vive acá y no en api/ porque el plan Hobby de Vercel tope 12 Serverless
 * Functions: se cuelga del router api/sql/[ruta].ts, igual que status y catalogo.
 *
 * Variables de entorno (las mismas de sqlVista): SUPABASE_URL / SUPABASE_ANON_KEY /
 * SUPABASE_SERVICE_ROLE_KEY / SQL_LOGICAPP_URL / SQL_BRIDGE_TOKEN.
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

/** Permiso de la pantalla (los admins pasan igual: lo resuelve api_autorizado). */
const PERMISO = 'stock_valorizado.view'

export interface BaseValorizada {
  base: string
  unidades: number
  valorizado: number
  unidades_sin_costo: number
  skus: number
}

export interface ArticuloValorizado {
  articulo: string
  descripcion: string
  unidades: number
  valorizado: number
  costo: number | null
}

export interface ArticuloSinCosto {
  articulo: string
  descripcion: string
  /** unidades totales, sumando todas las sucursales */
  unidades: number
  /** de esas, las que están en sucursales que valorizan (no insumos tipo NOMED) */
  unidades_val: number
  sucursales: number
  bases: string
}

export interface StockValorizado {
  servidor: string
  bases: BaseValorizada[]
  articulos: ArticuloValorizado[]
  sin_costo: ArticuloSinCosto[]
  costo: { lista: string; lista_nombre: string; articulos_con_costo: number }
  calculado: string | null
  cacheado: boolean
  segundos: number | null
}

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

  const destino = await urlDestino()
  if (!destino) return res.status(500).json({ error: 'Falta configurar la URL del Puente SQL' })
  if (/\.logic\.azure\.com/i.test(destino)) {
    return res.status(500).json({
      error: 'El stock valorizado sólo lo calcula el Puente SQL local: la URL guardada apunta a una Logic App.',
    })
  }
  const tokenPuente = process.env.SQL_BRIDGE_TOKEN ?? ''
  if (!tokenPuente) return res.status(500).json({ error: 'Falta la variable SQL_BRIDGE_TOKEN en Vercel' })

  const forzar = /^(1|true|si|sí)$/i.test(primero(req.query.forzar))

  const r0 = await postAlPuente(
    destino,
    {
      headers: { 'Content-Type': 'application/json', 'X-Puente-Token': tokenPuente },
      body: JSON.stringify({ accion: 'stock_valorizado', forzar }),
    },
    // La consulta recorre ~40 bases: con el cache frío tarda unos 12 s.
    { timeoutMs: 55_000, intentos: 2 },
  )
  if (!r0.ok) {
    return res.status(502).json({
      error:
        r0.motivo === 'timeout'
          ? 'El Puente SQL tardó demasiado en calcular el stock valorizado'
          : 'No se pudo contactar el Puente SQL de la PC central',
      intentos: r0.intentos,
    })
  }

  const cuerpo: unknown = await r0.res.json().catch(() => null)
  if (!r0.res.ok) {
    let detalle = (cuerpo as { error?: string } | null)?.error ?? `respuesta ${r0.res.status}`
    // Un puente viejo no conoce la acción y cae en el camino de vistas.
    if (/vista inválida|vista invalida/i.test(detalle)) {
      detalle += ' — Puente SQL desactualizado: actualizá puente-sql (acción "stock_valorizado").'
    }
    return res.status(502).json({ error: `Puente SQL: ${detalle}` })
  }

  const datos = (cuerpo ?? {}) as Partial<StockValorizado>
  if (!Array.isArray(datos.bases)) return res.status(502).json({ error: 'Respuesta inesperada del Puente SQL' })

  return res.status(200).json({
    servidor: datos.servidor ?? '',
    bases: datos.bases,
    articulos: Array.isArray(datos.articulos) ? datos.articulos : [],
    sin_costo: Array.isArray(datos.sin_costo) ? datos.sin_costo : [],
    costo: datos.costo ?? { lista: 'LISTA0', lista_nombre: 'Compra', articulos_con_costo: 0 },
    calculado: datos.calculado ?? null,
    cacheado: datos.cacheado === true,
    segundos: datos.segundos ?? null,
  })
}
