/**
 * Compras > Repo diaria.
 *
 *   GET /api/sql/repo-diaria[?fechas=YYYY-MM-DD,YYYY-MM-DD][&forzar=1]
 *     -> { estado: 'calculando', desde }                     (el puente está leyendo el DWH)
 *     -> { estado: 'listo', filas, resumen, dias, ... }       (ver RepoDiaria en src/lib/repoDiaria.ts)
 *
 * Reemplaza a TRANSFER.pbix + repo_diaria.py. El cálculo lo hace el Puente SQL
 * (`POST / {accion:'repo_diaria'}` → puente-sql/sql/repo-diaria.sql + repo-diaria.js):
 * venta del día anterior por local, repartiendo el stock REAL de MITO
 * (físico - comprometido) por prioridad de local, sin pasarse nunca.
 *
 * Leer el DWH tarda ~45 s, más que una función de Vercel: el puente lo hace por
 * detrás y contesta "calculando"; la pantalla vuelve a preguntar cada pocos segundos.
 *
 * Cuelga del router api/sql/[ruta].ts (tope de 12 Serverless Functions del plan Hobby).
 * Permiso: el mismo de importar transferencias (`transferencias.import`).
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

/** Parámetros guardados de la cascada (repo_auto_config.cascada_params); {} = los de siempre. */
async function paramsGuardados(): Promise<Record<string, unknown>> {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !service) return {}
  try {
    const res = await fetch(`${url}/rest/v1/repo_auto_config?id=eq.1&select=cascada_params`, {
      headers: { Authorization: `Bearer ${service}`, apikey: service },
    })
    if (!res.ok) return {}
    const filas = (await res.json().catch(() => null)) as Array<{ cascada_params?: Record<string, unknown> }> | null
    return filas?.[0]?.cascada_params ?? {}
  } catch {
    return {}
  }
}

function primero(q: string | string[] | undefined): string {
  if (Array.isArray(q)) return typeof q[0] === 'string' ? q[0] : ''
  return q ?? ''
}

/**
 *   POST /api/sql/repo-diaria  body: { modo: 'cascada', fechas, foto, params } -> { foto, cascada }
 *   Recalcula solo la cascada entre locales con otros parámetros, sobre la misma foto.
 *
 *   POST /api/sql/repo-diaria  body: { modo: 'revisar' | 'cargar' | 'estado', fechas, foto, locales?, confirmo? }
 *     -> { carga: { obs, fecha_str, en_curso, en_seco, locales: [{ cliente, renglones, unidades, lista, estado, numero, error }] } }
 *   Carga la repo en Dragon como pedidos de venta VTD (uno por local) desde el Puente.
 *   'cargar' va UNA sola vez al puente (sin reintento: es un alta).
 */
async function cargaDragon(req: Req, res: Res, destino: string, tokenPuente: string) {
  const b = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {}) as Record<string, unknown>
  const modo = String(b.modo ?? '')
  if (!['revisar', 'cargar', 'estado', 'cascada'].includes(modo)) return res.status(400).json({ error: 'Modo inválido' })
  const fechas = (Array.isArray(b.fechas) ? b.fechas : []).map(String).filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f))
  // Recalcular solo la cascada con otros parámetros (los que se están editando en pantalla)
  if (modo === 'cascada') {
    const params = b.params && typeof b.params === 'object' && !Array.isArray(b.params) ? b.params : {}
    if (JSON.stringify(params).length > 20_000) return res.status(400).json({ error: 'Parámetros demasiado grandes' })
    const rc = await postAlPuente(
      destino,
      {
        headers: { 'Content-Type': 'application/json', 'X-Puente-Token': tokenPuente },
        body: JSON.stringify({ accion: 'repo_diaria_cascada', fechas, foto: String(b.foto ?? ''), params }),
      },
      { timeoutMs: 25_000, intentos: 2 },
    )
    if (!rc.ok) return res.status(502).json({ error: 'No se pudo contactar el Puente SQL de la PC central' })
    const cc = (await rc.res.json().catch(() => null)) as ({ error?: string } & Record<string, unknown>) | null
    if (!rc.res.ok || !cc) {
      let detalle = cc?.error ?? `respuesta ${rc.res.status}`
      if (/vista inv[aá]lid[ao]/i.test(detalle)) detalle += ' — Puente SQL desactualizado: reiniciá puente-sql.'
      return res.status(rc.res.status === 400 ? 400 : 502).json({ error: detalle })
    }
    return res.status(200).json(cc)
  }
  const locales = (Array.isArray(b.locales) ? b.locales : []).map(String).filter((l) => /^[A-Z0-9]{1,12}$/i.test(l))
  const r0 = await postAlPuente(
    destino,
    {
      headers: { 'Content-Type': 'application/json', 'X-Puente-Token': tokenPuente },
      body: JSON.stringify({
        accion: 'repo_diaria_dragon', modo, fechas, locales,
        foto: String(b.foto ?? ''), confirmo: String(b.confirmo ?? ''),
      }),
    },
    { timeoutMs: 25_000, intentos: modo === 'cargar' ? 1 : 2 },
  )
  if (!r0.ok) {
    return res.status(502).json({
      error: r0.motivo === 'timeout' ? 'El Puente SQL no respondió a tiempo' : 'No se pudo contactar el Puente SQL de la PC central',
    })
  }
  const cuerpo = (await r0.res.json().catch(() => null)) as ({ error?: string } & Record<string, unknown>) | null
  if (!r0.res.ok || !cuerpo) {
    let detalle = cuerpo?.error ?? `respuesta ${r0.res.status}`
    if (/vista inv[aá]lid[ao]/i.test(detalle)) detalle += ' — Puente SQL desactualizado: reiniciá puente-sql.'
    return res.status(r0.res.status === 400 ? 400 : 502).json({ error: detalle })
  }
  return res.status(200).json(cuerpo)
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

  const token = tokenDe(req.headers.authorization as string | undefined)
  if (!token || !(await autorizado(token, [PERMISO]))) return res.status(401).json({ error: 'No autorizado' })

  const destino = await urlDestino()
  if (!destino) return res.status(500).json({ error: 'Falta configurar la URL del Puente SQL' })
  if (/\.logic\.azure\.com/i.test(destino)) {
    return res.status(500).json({ error: 'La repo diaria sólo la calcula el Puente SQL local: la URL guardada apunta a una Logic App.' })
  }
  const tokenPuente = process.env.SQL_BRIDGE_TOKEN ?? ''
  if (!tokenPuente) return res.status(500).json({ error: 'Falta la variable SQL_BRIDGE_TOKEN en Vercel' })
  if (req.method === 'POST') return cargaDragon(req, res, destino, tokenPuente)

  const fechas = primero(req.query.fechas)
    .split(',')
    .map((f) => f.trim())
    .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f))
  const forzar = /^(1|true|si|sí)$/i.test(primero(req.query.forzar))

  const r0 = await postAlPuente(
    destino,
    {
      headers: { 'Content-Type': 'application/json', 'X-Puente-Token': tokenPuente },
      body: JSON.stringify({ accion: 'repo_diaria', fechas, forzar, params: await paramsGuardados() }),
    },
    // El puente contesta enseguida (calculando o el resultado de la foto en memoria)
    { timeoutMs: 25_000, intentos: 2 },
  )
  if (!r0.ok) {
    return res.status(502).json({
      error: r0.motivo === 'timeout' ? 'El Puente SQL no respondió a tiempo' : 'No se pudo contactar el Puente SQL de la PC central',
      intentos: r0.intentos,
    })
  }

  const cuerpo = (await r0.res.json().catch(() => null)) as ({ estado?: string; error?: string } & Record<string, unknown>) | null
  if (!r0.res.ok || !cuerpo) {
    let detalle = cuerpo?.error ?? `respuesta ${r0.res.status}`
    // Un puente viejo no conoce la acción y cae en el camino de vistas
    if (/vista inv[aá]lid[ao]/i.test(detalle)) {
      detalle += ' — Puente SQL desactualizado: reiniciá puente-sql (acción "repo_diaria").'
    }
    // 400 del puente = algo del pedido (ej. "Sin ventas para 2026-11-10"): se le muestra tal cual
    return res.status(r0.res.status === 400 ? 400 : 502).json({ error: r0.res.status === 400 ? detalle : `Puente SQL: ${detalle}` })
  }
  if (cuerpo.estado !== 'calculando' && cuerpo.estado !== 'listo') {
    return res.status(502).json({ error: 'Respuesta inesperada del Puente SQL' })
  }
  return res.status(200).json(cuerpo)
}
