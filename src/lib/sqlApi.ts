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
    .filter((v) => /^[A-Za-z0-9_]+$/.test(v.vista))
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
    if (!/^[A-Za-z0-9_]+$/.test(nombre)) continue
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

/** Estado server-side de la conexión (api/sql/status). */
export interface EstadoSql {
  logicApp: boolean
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
