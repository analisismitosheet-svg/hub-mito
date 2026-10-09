/**
 * Estado de la conexión SQL para Configuraciones > Conexión SQL.
 * Requiere JWT válido. NO expone secretos: solo flags, origen de la config y listas de vistas.
 *
 * GET /api/sql/status -> {
 *   logicApp: boolean,                    // ¿hay URL efectiva (BD o env)?
 *   origen: 'db' | 'env' | null,          // de dónde sale la URL
 *   esPuente: boolean,                    // el destino es el Puente SQL local (no Azure)
 *   tokenPuente: boolean,                 // ¿está cargada SQL_BRIDGE_TOKEN? (sin el valor)
 *   alcanzable: boolean | null,           // ¿responde ahora el destino? (null = no se pudo probar)
 *   detalleConexion: string | null,       // por qué no, o "ok" (para el cartel de la pantalla)
 *   maxRows: number | null,               // tope de filas efectivo (BD > env)
 *   vistasEnv: string[],                  // whitelist fija por env (SQL_VIEWS)
 *   vistasDb: { vista, label }[],         // vistas guardadas en config_app
 * }
 */

import { getAlDestino } from './puenteRetry.js'

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

/** Cuánto se espera al destino antes de darlo por caído. Corto a propósito: esta
 *  pantalla se abre seguido y no puede quedar colgada esperando al túnel. */
const PING_TIMEOUT_MS = Number(process.env.SQL_PING_TIMEOUT_MS ?? 6000) || 6000

/** El sondeo se cachea: varias pantallas preguntan el estado al mismo tiempo y
 *  cada ping es un viaje de ida y vuelta por el túnel. */
const PING_TTL_MS = 15_000
let cachePing = { en: 0, valor: null as { alcanzable: boolean | null; detalle: string | null } | null }

/**
 * ¿Responde el destino ahora mismo?
 *
 * Antes esto solo miraba que la URL estuviera cargada, así que el túnel caído se
 * veía igual que el sano: todo en verde y recién al agregar una vista aparecía el
 * error. Un GET al destino alcanza para distinguirlo: si hay respuesta HTTP
 * (aunque sea 405, porque un destino mal apuntado no tiene /health) el túnel está
 * vivo; si no hay respuesta, está caído.
 */
async function sondear(url: string): Promise<{ alcanzable: boolean | null; detalle: string | null }> {
  const ahora = Date.now()
  if (cachePing.valor && ahora - cachePing.en < PING_TTL_MS) return cachePing.valor

  // Un intento y sin reintento: esta pantalla se abre seguido y el sondeo es un
  // termómetro, no una fuente de datos. Un parpadeo del túnel se ve como caída un
  // instante y al refrescar aparece el color real, sin dejar la pantalla colgada.
  const r = await getAlDestino(url, { intentos: 1, timeoutMs: PING_TIMEOUT_MS })

  const valor = r.ok
    ? { alcanzable: true, detalle: r.res.ok ? 'ok' : `El destino respondió ${r.res.status}` }
    : {
        alcanzable: false,
        detalle:
          r.motivo === 'timeout'
            ? 'tardó demasiado en responder'
            : 'no se pudo contactar el destino',
      }

  cachePing = { en: ahora, valor }
  return valor
}

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
      if (!/^([A-Za-z0-9_-]+:)?[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+){0,2}$/.test(vista)) continue
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
  const urlEfectiva = urlDb || urlEnv

  // Solo se prueba si hay destino. Sin URL no hay nada que sondear: null, no false,
  // para no confundir "no configurado" con "caído".
  const ping = urlEfectiva ? await sondear(urlEfectiva) : { alcanzable: null, detalle: null }

  return res.status(200).json({
    logicApp: Boolean(urlEfectiva),
    origen: urlDb ? 'db' : urlEnv ? 'env' : null,
    // Solo si el destino es el Puente SQL (no Azure) y si el token está cargado; nunca su valor
    esPuente: Boolean(urlEfectiva) && !/\.logic\.azure\.com/i.test(urlEfectiva),
    tokenPuente: Boolean(process.env.SQL_BRIDGE_TOKEN),
    alcanzable: ping.alcanzable,
    detalleConexion: ping.detalle,
    maxRows: Number(conexion?.max_rows) > 0 ? Number(conexion!.max_rows) : MAX_ROWS_ENV,
    vistasEnv: VISTAS_ENV,
    vistasDb: await vistasDeDb(),
  })
}
