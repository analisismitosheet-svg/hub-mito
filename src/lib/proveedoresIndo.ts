/* ------------------------------------------------------------------ */
/*  Recepción INDO: catálogo de proveedores del depósito.               */
/*                                                                       */
/*  La lista canónica sale de DRAGONFISH_INDOD.dbo.PROVEEDORES_INDO     */
/*  (1.518 proveedores). Va sembrada en public.recepcion_indo_          */
/*  proveedores con sql/recepcion_indo_proveedores.sql, así el          */
/*  desplegable anda aunque el Puente SQL esté caído.                    */
/*                                                                       */
/*  Se puede refrescar desde la pantalla leyendo la vista por            */
/*  /api/sql (como hace Consulta artículos): eso sí necesita la vista     */
/*  habilitada en Configuraciones > Conexión SQL.                        */
/* ------------------------------------------------------------------ */

import { supabase } from '@/lib/supabase'
import { leerVista } from '@/lib/sqlApi'
import { normalizar } from '@/lib/recepcionIndo'

export interface Proveedor {
  codigo: string
  nombre: string
}

/** Nombre de la vista en el SQL Server (configurable sin redeploy). */
export const VISTA_PROVEEDORES = 'DRAGONFISH_INDOD.dbo.PROVEEDORES_INDO'

/** Clave de config_app donde se puede overridear el nombre de la vista. */
const CLAVE_VISTA = 'sql_vista_proveedores_indo'

/** Caché en el navegador: la lista cambia una vez cada tanto y son 1.518 filas. */
// v2: la versión anterior guardaba solo 1.000 (tope de Supabase por consulta) y faltaban de la T en adelante
const CLAVE_CACHE = 'recepcionIndo.proveedores.v2'
const TTL_CACHE_MS = 12 * 60 * 60 * 1000 // 12 h

interface Cache {
  guardado: number
  lista: Proveedor[]
}

function leerCache(): Cache | null {
  try {
    const crudo = localStorage.getItem(CLAVE_CACHE)
    if (!crudo) return null
    const c = JSON.parse(crudo) as Cache
    if (!Array.isArray(c.lista) || !c.guardado) return null
    return c
  } catch {
    return null
  }
}

function guardarCache(lista: Proveedor[]) {
  try {
    localStorage.setItem(CLAVE_CACHE, JSON.stringify({ guardado: Date.now(), lista } satisfies Cache))
  } catch {
    /* sin almacenamiento (modo privado): se lee siempre del servidor */
  }
}

/**
 * El SQL Server manda "Codigo"/"Nombre" con espacios al final; según la versión
 * pueden venir en minúscula o con otro alias. Se resuelve por fila, no por
 * posición, como hace articulosConsulta.
 */
function aProveedores(filas: Record<string, unknown>[]): Proveedor[] {
  const out: Proveedor[] = []
  const vistos = new Set<string>()
  for (const f of filas) {
    let codigo = ''
    let nombre = ''
    for (const [k, v] of Object.entries(f)) {
      const col = normalizar(k)
      const val = String(v ?? '').trim()
      if (!val) continue
      if (col === 'CODIGO' || col === 'COD PROVEEDOR' || col === 'PROVEEDOR') codigo ||= val
      if (col === 'NOMBRE' || col === 'DESCRIPCION' || col === 'RAZON SOCIAL') nombre ||= val
    }
    if (!nombre) continue
    if (!codigo) codigo = nombre.slice(0, 8).toUpperCase() // sin código: se fabrique
    if (vistos.has(codigo)) continue
    vistos.add(codigo)
    out.push({ codigo, nombre })
  }
  return out.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

/** Nombre configurado de la vista (config_app > env > el de DRAGONFISH_INDOD). */
export async function nombreVistaProveedores(): Promise<string> {
  const porDefecto = (import.meta.env.VITE_SQL_VISTA_PROVEEDORES as string | undefined)?.trim() || VISTA_PROVEEDORES
  if (!supabase) return porDefecto
  const { data } = await supabase.from('config_app').select('valor').eq('clave', CLAVE_VISTA).maybeSingle()
  const valor = (data as { valor?: unknown } | null)?.valor
  const guardado = typeof valor === 'string' ? valor.trim() : ''
  return guardado && /^([A-Za-z0-9_-]+:)?[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+){0,2}$/.test(guardado) ? guardado : porDefecto
}

/** Top de filas que se le pide a la vista (tiene 1.518 filas). */
const TOP = 2000

/**
 * Los proveedores del catálogo de Supabase, que es lo que usa el desplegable.
 * Cachea en el navegador: si no hay nada en la base devuelve [] sin error (todavía
 * no se corrió sql/recepcion_indo_proveedores.sql) y la pantalla avisa.
 */
export async function cargarProveedores(forzar = false): Promise<Proveedor[]> {
  const cache = leerCache()
  if (!forzar && cache && Date.now() - cache.guardado < TTL_CACHE_MS) return cache.lista

  if (supabase) {
    // Supabase devuelve como mucho 1.000 filas por consulta y el catálogo tiene ~1.520: de a tandas
    const lista: Proveedor[] = []
    let error: unknown = null
    for (let desde = 0; desde < 20000; desde += 1000) {
      const r = await supabase
        .from('recepcion_indo_proveedores')
        .select('codigo,nombre')
        .order('nombre')
        .order('codigo')
        .range(desde, desde + 999)
      if (r.error) { error = r.error; break }
      const pagina = (r.data as Proveedor[] | null) ?? []
      lista.push(...pagina)
      if (pagina.length < 1000) break
    }
    if (!error && lista.length > 0) {
      guardarCache(lista)
      return lista
    }
  }

  // Sin catálogo en Supabase: se intenta la vista del SQL Server (una sola vez, y
  // sin guardar, así no pisa el catálogo sembrado).
  try {
    const { crudas } = await vistaProveedores()
    const lista = aProveedores(crudas)
    if (lista.length) return lista
  } catch {
    /* sin Puente SQL o vista sin habilitar: el desplegable queda con lo que hay */
  }
  return cache?.lista ?? []
}

/**
 * Relee DRAGONFISH_INDOD.dbo.PROVEEDORES_INDO y guarda el catálogo en Supabase.
 * Requiere la vista habilitada en Configuraciones > Conexión SQL y el tope de filas
 * subido a 2000 (si el puente corta antes, se avisa con cuántos entraron).
 */
export async function refrescarDesdeSql(): Promise<{ cantidad: number; total: number | null; error?: string }> {
  const vista = await nombreVistaProveedores()
  let crudas: Record<string, unknown>[]
  try {
    crudas = await leerVista(vista, TOP)
  } catch (e) {
    return { cantidad: 0, total: null, error: e instanceof Error ? e.message : String(e) }
  }
  const lista = aProveedores(crudas)
  if (!lista.length) return { cantidad: 0, total: crudas.length, error: `La vista ${vista} no devolvió proveedores.` }

  if (supabase) {
    // El catálogo es chico: va en un solo upsert.
    const { error } = await supabase.from('recepcion_indo_proveedores').upsert(lista, { onConflict: 'codigo' })
    if (error) return { cantidad: lista.length, total: crudas.length, error: error.message }
  }
  guardarCache(lista)
  return { cantidad: lista.length, total: crudas.length }
}

/** Sólo lee la vista del SQL Server, sin tocar Supabase ni la caché. */
async function vistaProveedores(): Promise<{ vista: string; crudas: Record<string, unknown>[] }> {
  const vista = await nombreVistaProveedores()
  return { vista, crudas: await leerVista(vista, TOP) }
}

/**
 * Opciones del desplegable de proveedor de una fila: el catálogo, más lo que ya haya
 * usado el resto de las recepciones (que puede no estar en la vista) y el valor actual.
 */
export function opcionesProveedor(catalogo: Proveedor[], usados: string[], actual: string): Proveedor[] {
  const porNombre = new Map<string, Proveedor>()
  for (const p of catalogo) porNombre.set(p.nombre.toUpperCase(), p)
  for (const u of usados) {
    const n = u.trim()
    if (n && !porNombre.has(n.toUpperCase())) porNombre.set(n.toUpperCase(), { codigo: '', nombre: n })
  }
  const actualTxt = actual.trim()
  if (actualTxt && !porNombre.has(actualTxt.toUpperCase())) {
    porNombre.set(actualTxt.toUpperCase(), { codigo: '', nombre: actualTxt })
  }
  return [...porNombre.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}
