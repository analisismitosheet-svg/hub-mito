/**
 * Proxy de lectura al SQL Server de la empresa (solo SELECT).
 *
 * Flujo:  PWA (JWT Supabase) -> esta función -> Logic App (On-Premises Data Gateway) -> SQL Server
 *
 * Contrato con la Logic App: POST { vista: string, top: number } -> JSON array de filas.
 * El Puente SQL además acepta { donde, valor, coincide } (filtro). Si el destino es
 * el Logic App, esos campos se ignoran y el llamador filtra en el cliente.
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
 *   SQL_FILTER_COLS             - columnas por las que se puede filtrar (lista blanca)
 *   SQL_BRIDGE_TOKEN            - si el destino es el Puente SQL local, el mismo
 *                                 valor que su PUENTE_TOKEN (el Logic App lo ignora)
 *
 * La configuración completa se gestiona desde Configuraciones > Conexión SQL:
 *   - URL de la Logic App + tope de filas: tabla sql_conexion (prioridad sobre env)
 *   - Whitelist efectiva = SQL_VIEWS (env) + vistas guardadas en config_app clave 'sql_vistas'
 */

import { postAlPuente } from './puenteRetry.js'

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

/**
 * Columnas por las que se puede filtrar. Es una lista blanca: el nombre de la
 * columna NUNCA se arma en el navegador ni se interpola sin validar, y el valor
 * viaja como parámetro (el Puente SQL lo vuelve a parameterizar).
 * Tiene que coincidir con PUENTE_FILTRO_COLS del puente.
 */
const SQL_FILTER_COLS = (
  process.env.SQL_FILTER_COLS ?? 'ARTCOD,ID_ARTICULO,ARTICULO,NOMBRE_COMPLETO,DESCRIPCION,ARTDES,ARTDESADIC'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

/** Texto a buscar: sin caracteres de control y acotado (va a un parámetro del SQL). */
function valorValido(v: string): boolean {
  return v.length > 0 && v.length <= 100 && !/[\u0000-\u001f]/.test(v)
}

interface Filtro {
  donde: string[]
  valor: string
  coincide: 'igual' | 'contiene'
}

/** Filtro pedido (?where=ARTCOD,ARTICULO&value=reloj&match=contiene) o null. */
function filtroDe(q: Record<string, string | string[] | undefined>): Filtro | null | string {
  const pedido = primerQuery(q.where)
  const valor = primerQuery(q.value).trim()
  const coincide = primerQuery(q.match).trim().toLowerCase() === 'contiene' ? 'contiene' : 'igual'
  if (!pedido && !valor) return null
  if (!valor || !valorValido(valor)) return 'Filtro inválido: el texto a buscar no puede quedar vacío.'

  const donde = pedido
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => SQL_FILTER_COLS.find((w) => w.toLowerCase() === c.toLowerCase()))
    .filter((c): c is string => !!c)
  if (donde.length === 0) {
    return `Filtro inválido: 'where' debe ser una de: ${SQL_FILTER_COLS.join(', ')}.`
  }
  return { donde, valor, coincide }
}

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
      .filter((v) => /^([A-Za-z0-9_-]+:)?[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+){0,2}$/.test(v))
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
  if (!/^([A-Za-z0-9_-]+:)?[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+){0,2}$/.test(vista) || !habilitadas.has(vista)) {
    return res.status(400).json({ error: 'Vista no habilitada' })
  }

  // URL efectiva: primero la guardada en BD, si no el env
  const conexion = await conexionDeDb()
  const logicUrl = conexion?.logicapp_url?.trim() || process.env.SQL_LOGICAPP_URL
  if (!logicUrl) {
    return res.status(500).json({ error: 'Falta configurar la URL del Logic App (BD o env)' })
  }

  // El Logic App de Azure no usa token; cualquier otro destino es el Puente SQL local,
  // que rechaza todo si no le llega el mismo valor que su PUENTE_TOKEN.
  const esPuente = !/\.logic\.azure\.com/i.test(logicUrl)
  if (esPuente && !process.env.SQL_BRIDGE_TOKEN) {
    return res.status(500).json({
      error: 'Falta la variable SQL_BRIDGE_TOKEN en Vercel (tiene que ser igual al PUENTE_TOKEN del Puente SQL)',
    })
  }

  const maxRowsBase = Number(conexion?.max_rows) > 0 ? Number(conexion!.max_rows) : MAX_ROWS
  const pedido = parseInt(primerQuery(req.query.limit), 10)
  const top = Math.min(Number.isFinite(pedido) && pedido > 0 ? pedido : maxRowsBase, maxRowsBase)

  // Filtro opcional: solo lo entiende el Puente SQL (el Logic App lo ignora).
  const filtro = filtroDe(req.query)
  if (typeof filtro === 'string') return res.status(400).json({ error: filtro })

  const r0 = await postAlPuente(
    logicUrl,
    {
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.SQL_BRIDGE_TOKEN ? { 'X-Puente-Token': process.env.SQL_BRIDGE_TOKEN } : {}),
      },
      body: JSON.stringify({
        vista,
        top,
        ...(filtro
          ? { donde: filtro.donde.join(','), valor: filtro.valor, coincide: filtro.coincide }
          : {}),
      }),
    },
    // Una consulta larga es normal (tope de filas de 29 M): el reintento solo entra si
    // el fallo fue rápido, o sea un parpadeo del túnel y no una consulta que se demora.
    { timeoutMs: 60_000 }
  )
  if (!r0.ok) {
    return res.status(504).json({
      error:
        r0.motivo === 'timeout'
          ? 'La Logic App / Puente SQL tardó demasiado en responder'
          : 'No se pudo contactar la Logic App / Puente SQL',
      intentos: r0.intentos,
    })
  }
  const la = r0.res

  if (esPuente && la.status === 401) {
    return res.status(502).json({
      error: 'El Puente SQL rechazó el token: SQL_BRIDGE_TOKEN en Vercel no coincide con el PUENTE_TOKEN del puente',
    })
  }
  if (!la.ok) {
    const detalle = (await la.text().catch(() => '')).slice(0, 300)
    return res.status(502).json({ error: `${esPuente ? 'Puente SQL' : 'Logic App'} respondió ${la.status}`, detalle })
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
