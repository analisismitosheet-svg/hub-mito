/**
 * Explorador del SQL Server para Configuraciones > Conexión SQL (solo administradores).
 *
 *   GET /api/sql/catalogo                      -> { bases: string[] }
 *   GET /api/sql/catalogo?base=X               -> { objetos: { esquema, nombre, tipo }[] }
 *   GET /api/sql/catalogo?muestra=BASE.ESQ.OBJ -> { filas } (primeras 20, para previsualizar)
 *
 * Solo funciona con el Puente SQL (el Logic App no sabe listar). Lo que se ve depende
 * de los permisos del usuario SQL del puente. Mismas variables de entorno que [view].ts.
 */

type Req = {
  method?: string
  headers: { authorization?: string }
  query: Record<string, string | string[] | undefined>
}

type Res = {
  status(code: number): Res
  setHeader(name: string, value: string): Res
  json(body: unknown): void
}

const NOMBRE = /^[A-Za-z0-9_-]{1,128}(\.[A-Za-z0-9_-]{1,128}){0,2}$/
const PARTE = /^[A-Za-z0-9_-]{1,128}$/

/** true solo si el JWT es válido y el usuario es administrador (public.soy_admin). */
async function esAdmin(token: string): Promise<boolean> {
  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anon) return false
  try {
    const res = await fetch(`${url}/rest/v1/rpc/soy_admin`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: anon, 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (!res.ok) return false
    return (await res.json().catch(() => false)) === true
  } catch {
    return false
  }
}

/** URL efectiva del puente: la guardada en sql_conexion, si no el env. */
async function urlDestino(): Promise<string> {
  const url = process.env.SUPABASE_URL
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

function primerQuery(q: string | string[] | undefined): string {
  if (Array.isArray(q)) return typeof q[0] === 'string' ? q[0] : ''
  return q ?? ''
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' })
  }

  const auth = req.headers.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token || !(await esAdmin(token))) {
    return res.status(403).json({ error: 'Solo los administradores pueden explorar la base' })
  }

  const destino = await urlDestino()
  if (!destino) return res.status(500).json({ error: 'Falta configurar la URL del Puente SQL' })
  if (/\.logic\.azure\.com/i.test(destino)) {
    return res.status(400).json({ error: 'El explorador solo funciona con el Puente SQL' })
  }
  if (!process.env.SQL_BRIDGE_TOKEN) {
    return res.status(500).json({ error: 'Falta la variable SQL_BRIDGE_TOKEN en Vercel' })
  }

  const base = primerQuery(req.query.base)
  const muestra = primerQuery(req.query.muestra)
  let pedido: Record<string, unknown>
  if (muestra) {
    if (!NOMBRE.test(muestra)) return res.status(400).json({ error: 'Nombre inválido' })
    pedido = { vista: muestra, top: 20 }
  } else if (base) {
    if (!PARTE.test(base)) return res.status(400).json({ error: 'Base inválida' })
    pedido = { accion: 'objetos', base }
  } else {
    pedido = { accion: 'bases' }
  }

  let r: Response
  try {
    r = await fetch(destino, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Puente-Token': process.env.SQL_BRIDGE_TOKEN },
      body: JSON.stringify(pedido),
    })
  } catch {
    return res.status(504).json({ error: 'No se pudo contactar el Puente SQL' })
  }

  const cuerpo = (await r.json().catch(() => null)) as unknown
  if (r.status === 401) {
    return res.status(502).json({ error: 'El Puente SQL rechazó el token (SQL_BRIDGE_TOKEN no coincide)' })
  }
  if (!r.ok) {
    const msg = (cuerpo as { error?: string } | null)?.error ?? `Puente SQL respondió ${r.status}`
    return res.status(502).json({ error: msg })
  }
  if (!Array.isArray(cuerpo)) {
    // Un puente viejo ignora "accion" y responde otra cosa
    return res.status(502).json({ error: 'El Puente SQL no soporta el explorador: actualizalo y reinicialo' })
  }

  if (muestra) return res.status(200).json({ filas: cuerpo })
  if (base) return res.status(200).json({ objetos: cuerpo })
  return res.status(200).json({ bases: cuerpo })
}
