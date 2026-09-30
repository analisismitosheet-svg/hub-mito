/**
 * Botón "Actualizar datos" de Pedidos de compra: fuerza la copia en el momento.
 *
 * Flujo:  PWA (JWT Supabase) -> esta función -> Puente SQL (PC con el SQL local)
 *         -> scripts/sync-pedidos-compra.js -> Supabase
 *
 * Solo pasa quien puede ver los pedidos: se consulta pedidos_compra_sync con el JWT
 * del usuario y la RLS (pedidos_compra.view o admin) decide. El token del puente
 * (SQL_BRIDGE_TOKEN) nunca llega al navegador.
 *
 * Variables de entorno (las mismas de api/sql): SUPABASE_URL, SUPABASE_ANON_KEY,
 * SUPABASE_SERVICE_ROLE_KEY, SQL_BRIDGE_TOKEN (+ SQL_LOGICAPP_URL como respaldo).
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

/** ¿El usuario puede ver pedidos de compra? (la RLS de pedidos_compra_sync lo decide) */
async function puedeVer(token: string): Promise<boolean> {
  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anon) return false
  try {
    const res = await fetch(`${url}/rest/v1/pedidos_compra_sync?id=eq.1&select=id`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anon },
    })
    if (!res.ok) return false
    const filas = (await res.json().catch(() => null)) as unknown[] | null
    return Array.isArray(filas) && filas.length > 0
  } catch {
    return false
  }
}

/** URL del puente guardada en sql_conexion (con service role: la tabla es solo de admins) */
async function urlPuente(): Promise<string | null> {
  const url = process.env.SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (url && service) {
    try {
      const res = await fetch(`${url}/rest/v1/sql_conexion?id=eq.1&select=logicapp_url`, {
        headers: { Authorization: `Bearer ${service}`, apikey: service },
      })
      if (res.ok) {
        const filas = (await res.json().catch(() => null)) as Array<{ logicapp_url?: string | null }> | null
        const guardada = filas?.[0]?.logicapp_url?.trim()
        if (guardada) return guardada
      }
    } catch {
      /* respaldo: env */
    }
  }
  return process.env.SQL_LOGICAPP_URL?.trim() || null
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  if (!token || !(await puedeVer(token))) return res.status(401).json({ error: 'No autorizado' })

  const destino = await urlPuente()
  if (!destino || /\.logic\.azure\.com/i.test(destino)) {
    return res.status(500).json({ error: 'El Puente SQL no está configurado (Configuraciones > Conexión SQL)' })
  }
  if (!process.env.SQL_BRIDGE_TOKEN) {
    return res.status(500).json({ error: 'Falta SQL_BRIDGE_TOKEN en Vercel' })
  }

  let r: Response
  try {
    r = await fetch(destino, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Puente-Token': process.env.SQL_BRIDGE_TOKEN },
      body: JSON.stringify({ accion: 'sync_pedidos_compra' }),
      signal: AbortSignal.timeout(55_000),
    })
  } catch {
    return res.status(504).json({ error: 'No se pudo contactar la PC del SQL (¿está prendida?)' })
  }
  const cuerpo = (await r.json().catch(() => null)) as { ok?: boolean; mensaje?: string; error?: string } | null
  if (!r.ok || !cuerpo?.ok) {
    return res.status(502).json({ error: cuerpo?.error ?? cuerpo?.mensaje ?? `El puente respondió ${r.status}` })
  }
  return res.status(200).json({ ok: true, mensaje: cuerpo.mensaje ?? 'Datos actualizados' })
}
