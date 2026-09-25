/**
 * Sistemas > Réplicas.
 *
 *   GET /api/replicas  ->  { replicas: [...], agente, consultado }
 *
 * Los datos NO salen del SQL remoto: los toma el Puente SQL —que corre en la
 * PC central del Replicador SQL (DESKTOP-OA4GU6I)— con `POST / {accion:'replicas'}`:
 *
 *   - sql/replicas.sql      -> MAX(actualizado) de dbo._sync_estado por base copiada
 *   - C:\ReplicadorSQL\config.json     -> nombre de cada sucursal + servidor origen
 *   - C:\ReplicadorSQL\historial.csv   -> última corrida (estado + ultimo_error)
 *   - C:\ReplicadorSQL\agent_heartbeat  -> ¿el agente está vivo?
 *
 * Ver puente-sql/server.js (acción 'replicas'). Requiere el Puente, no el
 * Logic App, porque es una acción propia del Puente.
 *
 * Variables de entorno (mismas que api/sql/[view].ts):
 *   SUPABASE_URL / SUPABASE_ANON_KEY  - para validar el JWT
 *   SUPABASE_SERVICE_ROLE_KEY         - lee sql_conexion bypaseando RLS
 *   SQL_LOGICAPP_URL                  - fallback si no hay URL guardada en BD
 *   SQL_BRIDGE_TOKEN                  - token del Puente SQL local
 */

type Req = {
  method?: string
  headers: { authorization?: string }
}

type Res = {
  status(code: number): Res
  setHeader(name: string, value: string): Res
  json(body: unknown): void
}

/** Réplica cruda, tal como la devuelve el Puente. */
export interface ReplicaPuente {
  base: string
  sucursal?: string
  origen?: string
  actualizacion: string | null
  tablas?: number
  corrida_fin?: string
  estado?: string
  errores?: string
  ultimo_error?: string
}

/** true si el JWT es válido (misma comprobación que api/sql/[view].ts). */
async function usuarioValido(token: string): Promise<boolean> {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anon) return false
  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anon },
    })
    return res.ok
  } catch {
    return false
  }
}

function serviceHeaders(): Record<string, string> | null {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !service) return null
  return { Authorization: `Bearer ${service}`, apikey: service }
}

/** URL efectiva del Puente/Logic App: la guardada en sql_conexion, si no el env. */
async function urlDestino(): Promise<string> {
  const headers = serviceHeaders()
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  if (url && headers) {
    try {
      const res = await fetch(`${url}/rest/v1/sql_conexion?id=eq.1&select=logicapp_url`, { headers })
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

  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' })

  const auth = req.headers.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token || !(await usuarioValido(token))) return res.status(401).json({ error: 'No autorizado' })

  const destino = await urlDestino()
  if (!destino) return res.status(500).json({ error: 'Falta configurar la URL del Puente SQL' })
  if (/\.logic\.azure\.com/i.test(destino)) {
    return res.status(500).json({
      error: 'La acción "replicas" sólo existe en el Puente SQL local: la URL guardada apunta a una Logic App.',
    })
  }
  const tokenPuente = process.env.SQL_BRIDGE_TOKEN ?? ''
  if (!tokenPuente) return res.status(500).json({ error: 'Falta la variable SQL_BRIDGE_TOKEN en Vercel' })

  let cuerpo: unknown
  try {
    const r = await fetch(destino, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Puente-Token': tokenPuente },
      body: JSON.stringify({ accion: 'replicas' }),
    })
    cuerpo = await r.json().catch(() => null)
    if (!r.ok) {
      let detalle = (cuerpo as { error?: string } | null)?.error ?? `respuesta ${r.status}`
      // Un puente viejo no conoce la acción 'replicas' y cae en el camino de vistas.
      if (/vista inválida|vista invalida/i.test(detalle)) {
        detalle += ' — el Puente SQL desactualizado: actualizá puente-sql/server.js (acción "replicas").'
      }
      return res.status(502).json({ error: `Puente SQL: ${detalle}` })
    }
  } catch {
    return res.status(502).json({ error: 'No se pudo contactar el Puente SQL de la PC central' })
  }

  const datos = (cuerpo ?? {}) as { servidor?: string; replicas?: ReplicaPuente[]; agente?: unknown }
  if (!Array.isArray(datos.replicas)) return res.status(502).json({ error: 'Respuesta inesperada del Puente SQL' })

  const replicas = datos.replicas
    .filter((r) => typeof r?.base === 'string')
    .map((r) => ({
      base: r.base,
      sucursal: (r.sucursal ?? '').trim(),
      origen: (r.origen ?? '').trim(),
      actualizacion: r.actualizacion ?? null,
      tablas: Number(r.tablas) || 0,
      corrida_fin: (r.corrida_fin ?? '').trim(),
      estado: (r.estado ?? '').trim(),
      ultimo_error: (r.ultimo_error ?? '').trim(),
    }))

  return res.status(200).json({
    servidor: datos.servidor ?? '',
    replicas,
    agente: datos.agente ?? { vivo: false, ultimo_latido: null },
    consultado: new Date().toISOString(),
  })
}
