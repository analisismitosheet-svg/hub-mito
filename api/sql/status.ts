/**
 * Estado de la conexión SQL para Configuraciones > Conexión SQL.
 * Requiere JWT válido. NO expone secretos: solo flags y listas de vistas.
 *
 * GET /api/sql/status -> {
 *   logicApp: boolean,                    // ¿SQL_LOGICAPP_URL configurada?
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

interface VistaDb {
  vista: string
  label: string
}

async function vistasDeDb(token: string): Promise<VistaDb[]> {
  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anon) return []
  try {
    const res = await fetch(`${url}/rest/v1/config_app?clave=eq.sql_vistas&select=valor`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anon },
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

  return res.status(200).json({
    logicApp: Boolean(process.env.SQL_LOGICAPP_URL),
    vistasEnv: VISTAS_ENV,
    vistasDb: await vistasDeDb(token),
  })
}
