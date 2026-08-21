/**
 * Estado de la conexión SQL para Configuraciones > Conexión SQL.
 * Requiere JWT válido. NO expone secretos: solo flags, origen de la config y listas de vistas.
 *
 * GET /api/sql/status -> {
 *   logicApp: boolean,                    // ¿hay URL efectiva (BD o env)?
 *   origen: 'db' | 'env' | null,          // de dónde sale la URL
 *   maxRows: number | null,               // tope de filas efectivo (BD > env)
 *   vistasEnv: string[],                  // whitelist fija por env (SQL_VIEWS)
 *   vistasDb: { vista, label }[],         // vistas guardadas en config_app
 * }
 */

type Req = { headers: { authorization?: string } }

type Res = {
  status(code: number): Res
  setHeader(name: string, value: string): Res
  json(body: unknown): void
}

const VISTAS_ENV = (process.env.SQL_VIEWS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const MAX_ROWS_ENV = Number(process.env.SQL_MAX_ROWS ?? 1000) || 1000

async function usuarioValido(token: string): Promise<boolean> {
  const url = process.env.SUPABASE_URL
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
  const url = process.env.SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !service) return null
  return { Authorization: `Bearer ${service}`, apikey: service }
}

interface ConexionDb {
  logicapp_url?: string | null
  max_rows?: number | null
}

/** Fila única de sql_conexion, leída con service role (bypass RLS). */
async function conexionDeDb(): Promise<ConexionDb | null> {
  const url = process.env.SUPABASE_URL
  const headers = serviceHeaders()
  if (!url || !headers) return null
  try {
    const res = await fetch(`${url}/rest/v1/sql_conexion?id=eq.1&select=logicapp_url,max_rows`, {
      headers,
    })
    if (!res.ok) return null
    const filas = (await res.json().catch(() => null)) as ConexionDb[] | null
    return filas?.[0] ?? null
  } catch {
    return null
  }
}

interface VistaDb {
  vista: string
  label: string
}

async function vistasDeDb(): Promise<VistaDb[]> {
  const url = process.env.SUPABASE_URL
  const headers = serviceHeaders()
  if (!url || !headers) return []
  try {
    const res = await fetch(`${url}/rest/v1/config_app?clave=eq.sql_vistas&select=valor`, {
      headers,
    })
    if (!res.ok) return []
    const filas = (await res.json().catch(() => null)) as Array<{ valor?: unknown }> | null
    const raw = filas?.[0]?.valor
    const lista = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(lista)) return []
    const out: VistaDb[] = []
    for (const v of lista) {
      if (typeof v !== 'object' || v === null) continue
      const vista = String((v as Record<string, unknown>).vista ?? '')
      if (!/^[A-Za-z0-9_]+$/.test(vista)) continue
      out.push({ vista, label: String((v as Record<string, unknown>).label ?? '') || vista })
    }
    return out
  } catch {
    return []
  }
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')

  const auth = req.headers.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token || !(await usuarioValido(token))) {
    return res.status(401).json({ error: 'No autorizado' })
  }

  const conexion = await conexionDeDb()
  const urlDb = conexion?.logicapp_url?.trim() || ''
  const urlEnv = process.env.SQL_LOGICAPP_URL ?? ''

  return res.status(200).json({
    logicApp: Boolean(urlDb || urlEnv),
    origen: urlDb ? 'db' : urlEnv ? 'env' : null,
    maxRows: Number(conexion?.max_rows) > 0 ? Number(conexion!.max_rows) : MAX_ROWS_ENV,
    vistasEnv: VISTAS_ENV,
    vistasDb: await vistasDeDb(),
  })
}
