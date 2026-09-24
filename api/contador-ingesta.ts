/**
 * Ingesta del contador de clientes.
 *
 * Flujo:  PC del local (contador-camaras/contador.py) -> esta función
 *         -> valida token del dispositivo (sha256 en contador_dispositivos)
 *         -> upsert en contador_visitas con service role.
 *
 * El local sale del dispositivo registrado, NUNCA del body: un token robado
 * solo puede escribir conteos de su propio local.
 *
 * Contrato:
 *   POST  header  X-Contador-Token: <token del dispositivo>
 *         body    {
 *                   tramos: [{ camara, desde (ISO UTC, múltiplo de 15 min), entradas, salidas,
 *                              transeuntes?, empleados?, nuevos?, reingresos? }],
 *                   estado?: { version, camaras: [{ nombre, ok, fps, error }] }
 *                 }
 *   -> 200 { ok: true, guardados: n, local }
 *
 * Variables de entorno en Vercel (sin prefijo VITE_):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createHash } from 'node:crypto'

type Req = {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body?: string | Record<string, unknown>
}

type Res = {
  status(code: number): Res
  setHeader(name: string, value: string): Res
  json(body: unknown): void
}

interface Tramo {
  camara: string
  desde: string
  entradas: number
  salidas: number
  transeuntes: number
  empleados: number
  nuevos: number
  reingresos: number
}

const OPCIONALES = ['transeuntes', 'empleados', 'nuevos', 'reingresos'] as const

const MAX_TRAMOS = 2000
const QUINCE_MIN = 15 * 60 * 1000

function cabecera(req: Req, nombre: string): string {
  const v = req.headers[nombre.toLowerCase()]
  return (Array.isArray(v) ? v[0] : v) ?? ''
}

function entero(v: unknown): number | null {
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 && n < 1_000_000 ? n : null
}

function validarTramo(t: unknown): Tramo | null {
  if (!t || typeof t !== 'object') return null
  const o = t as Record<string, unknown>
  const camara = typeof o.camara === 'string' ? o.camara.trim().slice(0, 60) : ''
  const fecha = typeof o.desde === 'string' ? new Date(o.desde) : null
  const entradas = entero(o.entradas)
  const salidas = entero(o.salidas)
  if (!camara || !fecha || isNaN(fecha.getTime()) || entradas === null || salidas === null) return null
  // Campos agregados en la v2 del agente: si faltan valen 0 (agentes viejos siguen andando)
  const extra = {} as Record<(typeof OPCIONALES)[number], number>
  for (const k of OPCIONALES) {
    const n = o[k] === undefined ? 0 : entero(o[k])
    if (n === null) return null
    extra[k] = n
  }
  const ms = fecha.getTime()
  // Sin tramos futuros (margen 1 tramo por relojes corridos) ni más viejos que 60 días
  if (ms % QUINCE_MIN !== 0 || ms > Date.now() + QUINCE_MIN || ms < Date.now() - 60 * 864e5) return null
  return { camara, desde: fecha.toISOString(), entradas, salidas, ...extra }
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

  const url = process.env.SUPABASE_URL?.replace(/\/$/, '')
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !service) return res.status(500).json({ error: 'Falta SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY' })
  const h = { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' }

  const token = cabecera(req, 'x-contador-token').trim()
  if (token.length < 32) return res.status(401).json({ error: 'Token inválido' })
  const hash = createHash('sha256').update(token).digest('hex')

  const dRes = await fetch(
    `${url}/rest/v1/contador_dispositivos?token_hash=eq.${hash}&activo=eq.true&select=id,local`,
    { headers: h },
  )
  const disp = ((await dRes.json().catch(() => [])) as { id: string; local: string }[])[0]
  if (!dRes.ok || !disp) return res.status(401).json({ error: 'Dispositivo no registrado o inactivo' })

  let body: Record<string, unknown> = {}
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  } catch {
    return res.status(400).json({ error: 'JSON inválido' })
  }

  const crudos = Array.isArray(body.tramos) ? body.tramos : []
  if (crudos.length > MAX_TRAMOS) return res.status(413).json({ error: `Máximo ${MAX_TRAMOS} tramos por envío` })
  const tramos = crudos.map(validarTramo)
  if (tramos.some((t) => t === null)) return res.status(400).json({ error: 'Hay tramos con formato inválido' })

  const ahora = new Date().toISOString()
  if (tramos.length) {
    const filas = (tramos as Tramo[]).map((t) => ({ ...t, local: disp.local, dispositivo_id: disp.id, updated_at: ahora }))
    const up = await fetch(`${url}/rest/v1/contador_visitas?on_conflict=local,camara,desde`, {
      method: 'POST',
      headers: { ...h, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(filas),
    })
    if (!up.ok) {
      const detalle = await up.text().catch(() => '')
      return res.status(502).json({ error: 'No se pudieron guardar los conteos', detalle: detalle.slice(0, 300) })
    }
  }

  const estado = body.estado && typeof body.estado === 'object' ? body.estado : null
  await fetch(`${url}/rest/v1/contador_dispositivos?id=eq.${disp.id}`, {
    method: 'PATCH',
    headers: { ...h, Prefer: 'return=minimal' },
    body: JSON.stringify(estado ? { ultimo_latido: ahora, estado } : { ultimo_latido: ahora }),
  }).catch(() => undefined)

  return res.status(200).json({ ok: true, guardados: tramos.length, local: disp.local })
}
