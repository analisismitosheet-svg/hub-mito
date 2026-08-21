/**
 * Proxy de lectura al SQL Server de la empresa (solo SELECT).
 *
 * Flujo:  PWA (JWT Supabase) -> esta función -> Logic App (On-Premises Data Gateway) -> SQL Server
 *
 * Contrato con la Logic App: POST { vista: string, top: number } -> JSON array de filas.
 * El secreto (SAS del trigger) vive SOLO en variables de entorno de Vercel.
 *
 * Variables de entorno requeridas en Vercel (sin prefijo VITE_):
 *   SUPABASE_URL       - mismo proyecto que usa la app
 *   SUPABASE_ANON_KEY  - anon key (para validar el JWT del usuario)
 *   SQL_LOGICAPP_URL   - URL completa del trigger HTTP del Logic App (incluye sp/sv/sig)
 *   SQL_VIEWS          - whitelist fija opcional, ej: vw_stock,vw_precios
 *   SQL_MAX_ROWS       - (opcional, default 1000) tope de filas por consulta
 *
 * La whitelist efectiva = SQL_VIEWS (env) + vistas guardadas en config_app clave 'sql_vistas'
 * (editables desde Configuraciones > Conexión SQL).
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

const SQL_VIEWS = (process.env.SQL_VIEWS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const MAX_ROWS = Number(process.env.SQL_MAX_ROWS ?? 1000) || 1000

/** Valida el JWT de Supabase contra /auth/v1/user. */
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

function primerQuery(q: string | string[] | undefined): string {
  if (Array.isArray(q)) return typeof q[0] === 'string' ? q[0] : ''
  return q ?? ''
}

/** Vistas habilitadas guardadas en config_app (clave 'sql_vistas'), usando el token del usuario. */
async function vistasDeDb(token: string): Promise<string[]> {
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
    return lista
      .map((v) => (typeof v === 'object' && v !== null ? String((v as Record<string, unknown>).vista ?? '') : ''))
      .filter((v) => /^[A-Za-z0-9_]+$/.test(v))
  } catch {
    return []
  }
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' })
  }

  const auth = req.headers.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token || !(await usuarioValido(token))) {
    return res.status(401).json({ error: 'No autorizado' })
  }

  const vista = primerQuery(req.query.view)
  const habilitadas = new Set([...SQL_VIEWS, ...(await vistasDeDb(token))])
  if (!/^[A-Za-z0-9_]+$/.test(vista) || !habilitadas.has(vista)) {
    return res.status(400).json({ error: 'Vista no habilitada' })
  }

  const logicUrl = process.env.SQL_LOGICAPP_URL
  if (!logicUrl) {
    return res.status(500).json({ error: 'SQL_LOGICAPP_URL no configurada' })
  }

  const pedido = parseInt(primerQuery(req.query.limit), 10)
  const top = Math.min(Number.isFinite(pedido) && pedido > 0 ? pedido : MAX_ROWS, MAX_ROWS)

  let la: Response
  try {
    la = await fetch(logicUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vista, top }),
    })
  } catch {
    return res.status(504).json({ error: 'No se pudo contactar la Logic App' })
  }

  if (!la.ok) {
    const detalle = (await la.text().catch(() => '')).slice(0, 300)
    return res.status(502).json({ error: `Logic App respondió ${la.status}`, detalle })
  }

  let filas: unknown = await la.json().catch(() => null)
  // La Logic App puede devolver el array directo o envuelto en ResultSets
  if (filas && typeof filas === 'object' && !Array.isArray(filas)) {
    const obj = filas as Record<string, unknown>
    const rs = obj.ResultSets ?? obj.resultSets
    if (Array.isArray(rs)) filas = rs
  }
  if (!Array.isArray(filas)) {
    return res.status(502).json({ error: 'Respuesta inesperada de la Logic App' })
  }

  return res.status(200).json({ vista, filas })
}
