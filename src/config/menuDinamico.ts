import { useEffect, useState } from 'react'
import { Boxes } from 'lucide-react'
import { AREAS, APPS, appsDeArea, getArea, type AppDef, type AreaDef } from '@/config/areas'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'

/**
 * Menú dinámico desde la DB (tablas modules/submodules de rbac_dinamico).
 *
 * Nivel 1 (áreas)  -> modules activos de la DB, resueltos a AREAS (icono/color/nombre).
 * Nivel 2 (apps)   -> submodules activos del módulo, mapeados a una AppDef de APPS
 *                     mediante SUBMODULO_APP (moduleKey.submoduleKey -> app id).
 *                     Se completan con las apps del APPS del área que NO son submódulos
 *                     (externas tipo Google Forms, especiales: datos-sql, réplicas...).
 *
 * Fallback robusto: si la DB no responde (tabla aún no aplicada), se usa el menú
 * estático (AREAS / appsDeArea) exactamente como antes. La app NO se rompe.
 */

interface ModuleDb {
  id: number
  key: string
  name: string
  icon: string | null
  order: number
  is_active: boolean
}

interface SubmoduleDb {
  id: number
  module_id: number
  key: string
  name: string
  has_scope: boolean
  is_active: boolean
}

/** moduleKey.submoduleKey -> id de la AppDef en APPS que la representa. */
const SUBMODULO_APP: Record<string, string> = {
  'mayorista.facturacion': 'mayorista-facturacion',
  'mayorista.transportes': 'mayorista-transportes',
  'mayorista.clientes': 'mayorista-clientes',
  'mayorista.guias': 'mayorista-guias',
  'locales.reposiciones': 'transferencias',
  'locales.cuentas_amigos': 'cuenta-amigos',
  'locales.manuales': 'manuales',
  'locales.opiniones': 'opiniones',
  'locales.carga_requerimientos': 'carga-requerimientos',
  'locales.errores_tarjetas': 'errores-tarjetas',
  'locales.control_vidrieras': 'control-vidrieras',
  'locales.transporte': 'transporte',
  'locales.control_locales': 'control-locales',
}

/** Apps del APPS que NO corresponden a un submódulo (siempre presentes por su areaId). */
const APPS_SIN_SUBMODULO = new Set([
  'mayorista-repo',
  'deposito-repo',
  'datos-sql',
  'replicas',
  'polo52-facturacion',
])

/** Módulos de modules que NO son áreas de menú (p. ej. 'configuraciones' = card admin). */
const MODULOS_NO_AREA = new Set(['configuraciones'])

type EstadoDb = 'cargando' | 'ok' | 'sin-db'

/** Lee modules + submodules activos de la DB una sola vez (compartido). */
function useMenuDb() {
  const [modulos, setModulos] = useState<ModuleDb[]>([])
  const [submodulos, setSubmodulos] = useState<SubmoduleDb[]>([])
  const [estado, setEstado] = useState<EstadoDb>('cargando')

  useEffect(() => {
    if (!supabase) {
      setEstado('sin-db')
      return
    }
    let activo = true
    ;(async () => {
      const [{ data: m }, { data: s }] = await Promise.all([
        supabase.from('modules').select('id,key,name,icon,order,is_active').order('order'),
        supabase
          .from('submodules')
          .select('id,module_id,key,name,has_scope,is_active'),
      ])
      if (!activo) return
      // Si la tabla no existe (PGRST205) => sin DB dinámica, usar fallback.
      if (!m && !s) {
        setEstado('sin-db')
        return
      }
      setModulos(Array.isArray(m) ? (m as ModuleDb[]) : [])
      setSubmodulos(Array.isArray(s) ? (s as SubmoduleDb[]) : [])
      setEstado('ok')
    })()
    return () => {
      activo = false
    }
  }, [])

  return { modulos, submodulos, estado }
}

/** Área con datos de DB (para extender AreaDef sin mutarlo). */
export interface AreaDinamica extends AreaDef {
  dbId?: number
  dbOrder?: number
}

/** Nivel 1: áreas activas del menú. Origen DB + AREAS (icono/color), filtrado por permiso. */
export function useMenuNivel1(): { areas: AreaDinamica[]; scopes: Record<string, string> } {
  const { can, scopes, isAdmin } = useAuth()
  const { modulos, estado } = useMenuDb()

  if (estado === 'sin-db') {
    const areas: AreaDinamica[] = [...AREAS]
      .filter((a) => isAdmin || can(`area_${a.id}.view`))
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
    return { areas, scopes }
  }

  // DB ok: módulos activos + permiso area_<key>.view (admin ve todo).
  const porKey = new Map(AREAS.map((a) => [a.id, a]))
  const areas: AreaDinamica[] = modulos
    .filter((m) => m.is_active && !MODULOS_NO_AREA.has(m.key))
    .filter((m) => isAdmin || can(`area_${m.key}.view`))
    .map((m) => {
      const base = porKey.get(m.key)
      return {
        id: m.key,
        name: base?.name ?? m.name,
        icon: base?.icon ?? placeholderIcon,
        accent: base?.accent ?? 'text-slate-600',
        color: base?.color ?? '#64748b',
        dbId: m.id,
        dbOrder: m.order,
      }
    })
    .sort((a, b) => (a.dbOrder ?? 0) - (b.dbOrder ?? 0) || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))

  return { areas, scopes }
}

/** Icono de respaldo si el módulo de la DB no existe en AREAS (nombre de icono != componente). */
const placeholderIcon = Boxes

const appPorId = new Map(APPS.map((a) => [a.id, a]))

/**
 * Nivel 2: apps del área. Desde submodules activos de la DB (resueltos a AppDef)
 * completados con las apps del APPS del área que no son submódulos.
 * Devuelve null mientras carga (para no parpadear con el fallback).
 */
export function useMenuNivel2(areaId: string): { apps: AppDef[] | null; subs: SubmoduleDb[] } {
  const { can, scopes } = useAuth()
  const { modulos, submodulos, estado } = useMenuDb()

  if (estado === 'sin-db') {
    const apps = appsDeArea(areaId)
      .filter((a) => !a.permiso || can(a.permiso))
      .sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }))
    return { apps, subs: [] }
  }

  const modulo = modulos.find((m) => m.key === areaId)
  const subs = modulo ? submodulos.filter((s) => s.module_id === modulo.id && s.is_active) : []

  // Mientras la DB carga devolvemos null para no parpadear con una lista parcial.
  if (estado === 'cargando') return { apps: null, subs: [] }

  // 1) App por cada submódulo activo mapeado; filtrada por permiso.
  const idsSubs = new Set<string>()
  const appsSubs: AppDef[] = []
  for (const s of subs) {
    const appId = SUBMODULO_APP[`${areaId}.${s.key}`]
    if (!appId) continue
    const app = appPorId.get(appId)
    if (!app) continue
    idsSubs.add(app.id)
    if (!app.permiso || can(app.permiso)) appsSubs.push(app)
  }

  // 2) Apps del APPS de esta área que NO sean submodulos (externas y especiales).
  const appsAdicionales = appsDeArea(areaId).filter(
    (a) => !idsSubs.has(a.id) && APPS_SIN_SUBMODULO.has(a.id),
  )
  const apps = [...appsSubs, ...appsAdicionales]
    .filter((a) => !a.permiso || can(a.permiso))
    .sort((a, b) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }))

  return { apps, subs }
}

export { getArea }
export type { SubmoduleDb }
// re-export útil para páginas que quieran pintar scopes
export type { ModuleDb }
