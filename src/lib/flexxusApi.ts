/**
 * Administración > Flexxus (lado Vercel).
 *
 *   GET /api/sql/flexxus?consulta=ventas&desde=AAAA-MM-DD&hasta=AAAA-MM-DD[&forzar=1]
 *   GET /api/sql/flexxus?consulta=saldos[&forzar=1]
 *   GET /api/sql/flexxus?consulta=asientos&desde=&hasta=   (hasta 93 días)
 *   GET /api/sql/flexxus?consulta=balance&desde=&hasta=    (sumas y saldos por cuenta)
 *
 * Acción propia del Puente SQL (`{ accion: 'flexxus' }` → puente-sql/flexxus.js), que
 * lee la base Firebird de Flexxus por el servidor vinculado FLEXXUS del SQL local.
 * Solo lectura. Permiso `flexxus.view` (los admins pasan igual).
 * Se cuelga del router api/sql/[ruta].ts como el resto de las acciones del puente.
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

const PERMISO = 'flexxus.view'
const CONSULTAS = ['ventas', 'saldos', 'asientos', 'balance'] as const
const FECHA = /^\d{4}-\d{2}-\d{2}$/

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

  const consulta = primero(req.query.consulta).trim() as (typeof CONSULTAS)[number]
  if (!CONSULTAS.includes(consulta)) return res.status(400).json({ error: 'Consulta inválida' })
  const desde = primero(req.query.desde).trim()
  const hasta = primero(req.query.hasta).trim()
  if (consulta !== 'saldos' && (!FECHA.test(desde) || !FECHA.test(hasta))) {
    return res.status(400).json({ error: 'Faltan las fechas desde/hasta (AAAA-MM-DD)' })
  }
  const forzar = /^(1|true|si|sí)$/i.test(primero(req.query.forzar))

  const destino = await urlDestino()
  if (!destino) return res.status(500).json({ error: 'Falta configurar la URL del Puente SQL' })
  if (/\.logic\.azure\.com/i.test(destino)) {
    return res.status(500).json({ error: 'Flexxus solo se lee por el Puente SQL local.' })
  }
  const tokenPuente = process.env.SQL_BRIDGE_TOKEN ?? ''
  if (!tokenPuente) return res.status(500).json({ error: 'Falta la variable SQL_BRIDGE_TOKEN en Vercel' })

  const r0 = await postAlPuente(
    destino,
    {
      headers: { 'Content-Type': 'application/json', 'X-Puente-Token': tokenPuente },
      body: JSON.stringify({ accion: 'flexxus', consulta, desde, hasta, forzar }),
    },
    { timeoutMs: 55_000, intentos: 2 },
  )
  if (!r0.ok) {
    return res.status(502).json({
      error: r0.motivo === 'timeout' ? 'Flexxus tardó demasiado en responder' : 'No se pudo contactar el Puente SQL de la PC central',
      intentos: r0.intentos,
    })
  }
  const cuerpo = (await r0.res.json().catch(() => null)) as Record<string, unknown> | null
  if (!r0.res.ok || !cuerpo) {
    let detalle = (cuerpo as { error?: string } | null)?.error ?? `respuesta ${r0.res.status}`
    if (/vista inválida|vista invalida/i.test(detalle)) {
      detalle += ' — Puente SQL desactualizado: falta reiniciarlo para que tome la acción "flexxus".'
    }
    return res.status(502).json({ error: `Puente SQL: ${detalle}` })
  }
  return res.status(200).json(cuerpo)
}
