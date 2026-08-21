/**
 * Proxy de lectura al SQL Server de la empresa (solo SELECT).
 *
 * Flujo:  PWA (JWT Supabase) -> esta función -> Logic App (On-Premises Data Gateway) -> SQL Server
 *
 * Contrato con la Logic App: POST { vista: string, top: number } -> JSON array de filas.
 * El secreto (SAS del trigger) vive en la tabla sql_conexion (solo admins por RLS)
 * o como variable de entorno; NUNCA se envía al navegador.
 *
 * Variables de entorno en Vercel (sin prefijo VITE_):
 *   SUPABASE_URL                - mismo proyecto que usa la app
 *   SUPABASE_ANON_KEY           - anon key (para validar el JWT del usuario)
 *   SUPABASE_SERVICE_ROLE_KEY   - service role (lee sql_conexion/config_app bypaseando RLS)
 *   SQL_LOGICAPP_URL            - fallback si no hay URL guardada en BD
 *   SQL_VIEWS                   - whitelist fija opcional, ej: vw_stock,vw_precios
 *   SQL_MAX_ROWS                - fallback del tope de filas (default 1000)
 *
 * La configuración completa se gestiona desde Configuraciones > Conexión SQL:
 *   - URL de la Logic App + tope de filas: tabla sql_conexion (prioridad sobre env)
 *   - Whitelist efectiva = SQL_VIEWS (env) + vistas guardadas en config_app clave 'sql_vistas'
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

/** Vistas habilitadas guardadas en config_app (clave 'sql_vistas'). */
async function vistasDeDb(): Promise<string[]> {
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
    return lista
      .map((v) => (typeof v === 'object' && v !== null ? String((v as Record<string, unknown>).vista ?? '') : ''))
      .filter((v) => /^[A-Za-z0-9_]+$/.test(v))
  } catch {
    return []
  }
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
  if (!token || !(await usuarioValido(token))) {
    return res.status(401).json({ error: 'No autorizado' })
  }

  const vista = primerQuery(req.query.view)
  const habilitadas = new Set([...SQL_VIEWS, ...(await vistasDeDb())])
  if (!/^[A-Za-z0-9_]+$/.test(vista) || !habilitadas.has(vista)) {
    return res.status(400).json({ error: 'Vista no habilitada' })
  }

  // URL efectiva: primero la guardada en BD, si no el env
  const conexion = await conexionDeDb()
  const logicUrl = conexion?.logicapp_url?.trim() || process.env.SQL_LOGICAPP_URL
  if (!logicUrl) {
    return res.status(500).json({ error: 'Falta configurar la URL del Logic App (BD o env)' })
  }

  const maxRowsBase = Number(conexion?.max_rows) > 0 ? Number(conexion!.max_rows) : MAX_ROWS
  const pedido = parseInt(primerQuery(req.query.limit), 10)
  const top = Math.min(Number.isFinite(pedido) && pedido > 0 ? pedido : maxRowsBase, maxRowsBase)

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
