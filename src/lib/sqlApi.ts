import { supabase } from '@/lib/supabase'

export interface FilaSql {
  [columna: string]: unknown
}

export interface VistaDef {
  vista: string
  label: string
}

/**
 * Lee una vista del SQL Server vía el proxy /api/sql/<vista>.
 * Requiere sesión activa: el JWT de Supabase viaja en el header Authorization.
 */
export async function leerVista(vista: string, limit?: number): Promise<FilaSql[]> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sin sesión activa.')

  const qs = limit ? `?limit=${encodeURIComponent(String(limit))}` : ''
  const res = await fetch(`/api/sql/${encodeURIComponent(vista)}${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = (await res.json().catch(() => null)) as
    | { error?: string; detalle?: string; filas?: FilaSql[] }
    | null
  if (!res.ok) {
    const msg = body?.error ?? `Error ${res.status} consultando ${vista}`
    throw new Error(body?.detalle ? `${msg} — ${body.detalle}` : msg)
  }
  return body?.filas ?? []
}

/**
 * Columnas por las que se puede filtrar una vista. Es la misma lista blanca
 * que valida el servidor (api/sql) y el Puente SQL (PUENTE_FILTRO_COLS):
 * el nombre de la columna nunca sale del servidor y el valor va siempre
 * parametrizado. Si el destino es el Logic App (no el puente), el filtro se
 * ignora allá y el llamador tiene que filtrar en el cliente.
 */
export const COLUMNAS_BUSQUEDA = [
  'ARTCOD',
  'ID_ARTICULO',
  'ARTICULO',
  'NOMBRE_COMPLETO',
  'DESCRIPCION',
  'ARTDES',
  'ARTDESADIC',
]

export interface OpcionesLectura {
  /** columnas de COLUMNAS_BUSQUEDA; se combinan con OR */
  donde?: string[]
  /** texto a buscar; con `coincide: 'contiene'` se busca con LIKE %valor% */
  valor?: string
  coincide?: 'igual' | 'contiene'
  limit?: number
}

/** Igual que leerVista, pero con filtro en el SQL (WHERE [col] LIKE @v). */
export async function leerVistaFiltrada(vista: string, opts: OpcionesLectura = {}): Promise<FilaSql[]> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sin sesión activa.')

  const q = new URLSearchParams()
  if (opts.limit) q.set('limit', String(opts.limit))
  if (opts.donde?.length) q.set('where', opts.donde.join(','))
  if (opts.valor) q.set('value', opts.valor)
  if (opts.coincide) q.set('match', opts.coincide)

  const res = await fetch(`/api/sql/${encodeURIComponent(vista)}${q.size ? `?${q}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = (await res.json().catch(() => null)) as
    | { error?: string; detalle?: string; filas?: FilaSql[] }
    | null
  if (!res.ok) {
    const msg = body?.error ?? `Error ${res.status} consultando ${vista}`
    throw new Error(body?.detalle ? `${msg} — ${body.detalle}` : msg)
  }
  return body?.filas ?? []
}

/**
 * Vistas fijas por env: VITE_SQL_VISTAS="vista|Etiqueta,vista2|Etiqueta2".
 * Se usan como fallback cuando no hay nada guardado en config_app.
 */
export function vistasEnv(): VistaDef[] {
  const raw = (import.meta.env.VITE_SQL_VISTAS as string | undefined)?.trim() || ''
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((par) => {
      const [vista, label] = par.split('|').map((x) => x.trim())
      return { vista, label: label || vista }
    })
    .filter((v) => /^([A-Za-z0-9_-]+:)?[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+){0,2}$/.test(v.vista))
}

function aVistas(valor: unknown): VistaDef[] {
  let lista: unknown = valor
  if (typeof lista === 'string') {
    try {
      lista = JSON.parse(lista)
    } catch {
      return []
    }
  }
  if (!Array.isArray(lista)) return []
  const out = new Map<string, VistaDef>()
  for (const v of lista) {
    if (typeof v !== 'object' || v === null) continue
    const nombre = String((v as Record<string, unknown>).vista ?? '').trim()
    if (!/^([A-Za-z0-9_-]+:)?[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+){0,2}$/.test(nombre)) continue
    out.set(nombre, { vista: nombre, label: String((v as Record<string, unknown>).label ?? '').trim() || nombre })
  }
  return [...out.values()]
}

/** Vistas habilitadas: primero config_app ('sql_vistas'), si no hay, el env. */
export async function cargarVistas(): Promise<VistaDef[]> {
  if (!supabase) return vistasEnv()
  const { data } = await supabase.from('config_app').select('valor').eq('clave', 'sql_vistas').maybeSingle()
  const deDb = aVistas((data as { valor?: unknown } | null)?.valor)
  return deDb.length > 0 ? deDb : vistasEnv()
}

/** Guarda la lista completa de vistas en config_app (requiere ser admin por RLS). */
export async function guardarVistas(vistas: VistaDef[]): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase no está configurado.' }
  const limpias = aVistas(vistas)
  const { error } = await supabase
    .from('config_app')
    .upsert({ clave: 'sql_vistas', valor: limpias }, { onConflict: 'clave' })
  return { error: error?.message ?? null }
}

/**
 * Nombre de la vista que reporta qué artículos YA salieron/remitieron del
 * SQL Server local. Se guarda en config_app bajo la clave 'sql_vista_salidas'
 * (configurable desde Configuraciones > Conexión SQL, sin redeploy).
 *
 * Fallback a la variable de entorno VITE_SQL_VISTA_SALIDAS.
 *
 * Columnas esperadas (case-insensitive):
 *   origen (local), articulo, color, talle
 */
export async function cargarVistaSalidas(): Promise<string> {
  if (!supabase) return import.meta.env.VITE_SQL_VISTA_SALIDAS as string | undefined ?? ''
  const { data } = await supabase
    .from('config_app')
    .select('valor')
    .eq('clave', 'sql_vista_salidas')
    .maybeSingle()
  const deDb = (data as { valor?: unknown } | null)?.valor
  const nombre = typeof deDb === 'string' ? deDb.trim() : ''
  if (nombre && /^([A-Za-z0-9_-]+:)?[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+){0,2}$/.test(nombre)) return nombre
  return (import.meta.env.VITE_SQL_VISTA_SALIDAS as string | undefined)?.trim() ?? ''
}

/** Guarda el nombre de la vista de salidas en config_app (admin por RLS). */
export async function guardarVistaSalidas(nombre: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase no está configurado.' }
  const limpio = nombre.trim()
  if (limpio && !/^([A-Za-z0-9_-]+:)?[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+){0,2}$/.test(limpio)) return { error: 'Nombre de vista inválido.' }
  const { error } = await supabase
    .from('config_app')
    .upsert({ clave: 'sql_vista_salidas', valor: limpio }, { onConflict: 'clave' })
  return { error: error?.message ?? null }
}

/** Estado server-side de la conexión (api/sql/status). */
export interface EstadoSql {
  logicApp: boolean
  origen: 'db' | 'env' | null
  /** Opcionales: una versión vieja del endpoint no los manda */
  esPuente?: boolean
  tokenPuente?: boolean
  /** ¿Responde el destino ahora? null = sin URL configurada, o no se pudo probar */
  alcanzable?: boolean | null
  /** Motivo corto para el cartel: "ok", o por qué no llega */
  detalleConexion?: string | null
  maxRows: number | null
  vistasEnv: string[]
  vistasDb: VistaDef[]
}

export async function estadoConexion(): Promise<EstadoSql> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sin sesión activa.')
  const res = await fetch('/api/sql/status', { headers: { Authorization: `Bearer ${token}` } })
  const body = (await res.json().catch(() => null)) as (EstadoSql & { error?: string }) | null
  if (!res.ok || !body) throw new Error(body?.error ?? `Error ${res.status} consultando el estado`)
  return body
}

/** Tabla o vista del SQL Server, tal como la lista el explorador. */
export interface ObjetoSql {
  esquema: string
  nombre: string
  tipo: 'tabla' | 'vista'
}

/** Explorador (solo admins): GET /api/sql/catalogo con los parámetros dados. */
async function catalogo<T>(params: Record<string, string>): Promise<T> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sin sesión activa.')
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`/api/sql/catalogo${qs ? `?${qs}` : ''}`, { headers: { Authorization: `Bearer ${token}` } })
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok || !body) throw new Error(body?.error ?? `Error ${res.status} consultando el explorador`)
  return body
}

/** SQL Server que maneja el puente. El principal se nombra sin prefijo; los otros, "ALIAS:BASE.esquema.obj". */
export interface ServidorSql {
  alias: string
  principal: boolean
}

export async function listarServidores(): Promise<ServidorSql[]> {
  return (await catalogo<{ servidores: ServidorSql[] }>({ servidores: '1' })).servidores
}

/** Bases del SQL Server a las que el usuario del puente tiene acceso (sin servidor = el principal). */
export async function listarBases(servidor?: string): Promise<string[]> {
  return (await catalogo<{ bases: string[] }>(servidor ? { servidor } : {})).bases
}

/** Tablas y vistas de una base. */
export async function listarObjetos(base: string, servidor?: string): Promise<ObjetoSql[]> {
  return (await catalogo<{ objetos: ObjetoSql[] }>(servidor ? { base, servidor } : { base })).objetos
}

/** Primeras 20 filas de BASE.esquema.objeto, para previsualizar antes de habilitarla. */
export async function muestraObjeto(nombreCompleto: string): Promise<FilaSql[]> {
  return (await catalogo<{ filas: FilaSql[] }>({ muestra: nombreCompleto })).filas
}

/** Fila única de configuración de la conexión (tabla sql_conexion, solo admins por RLS). */
export interface ConexionSql {
  logicapp_url: string | null
  max_rows: number | null
}

export async function cargarConexion(): Promise<ConexionSql | null> {
  if (!supabase) return null
  const { data } = await supabase
    .from('sql_conexion')
    .select('logicapp_url,max_rows')
    .eq('id', 1)
    .maybeSingle()
  return (data as ConexionSql | null) ?? null
}

/** Guarda URL del Logic App y tope de filas. URL vacía = volver a usar la variable de entorno. */
export async function guardarConexion(
  logicappUrl: string,
  maxRows: number | null,
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Supabase no está configurado.' }
  const url = logicappUrl.trim()
  if (url && !/^https:\/\/.+/i.test(url)) return { error: 'La URL debe empezar con https://' }
  if (!url && !confirm('Vas a borrar la URL guardada: se usará la variable de entorno SQL_LOGICAPP_URL (si existe). ¿Continuar?')) {
    return { error: null }
  }
  const { error } = await supabase
    .from('sql_conexion')
    .upsert(
      { id: 1, logicapp_url: url || null, max_rows: maxRows, updated_at: new Date().toISOString() },
      { onConflict: 'id' },
    )
  return { error: error?.message ?? null }
}
