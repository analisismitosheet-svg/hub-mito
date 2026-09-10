import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { cargarAccionesArea, accionesDe, moduloDePermiso, APPS, type AccionArea } from '@/config/areas'

export interface PermisosArea {
  ver: boolean
  crear: boolean
  editar: boolean
  edicionUnica: boolean
  borrar: boolean
}

/** Claves de rol por acción cuando no hay config en app_area_acciones.
 *  Módulos con nombres de permiso no estándar (ej. transferencias usa .import en vez de .create). */
const FALLBACK_CLAVES: Record<string, Partial<Record<keyof PermisosArea, string>>> = {
  transferencias: {
    ver: 'transferencias.view',
    crear: 'transferencias.import',
    editar: 'transferencias.view', // marcar ítems lo hace el local con acceso
    borrar: '',
  },
  opiniones: {
    borrar: 'opiniones.borrar',
  },
}

/**
 * Permisos de acciones para la app actual, resueltos por (app, área de origen).
 *
 * Regla:
 *  - Si hay config en app_area_acciones para esa (app, área) → la usa.
 *  - Si no hay config → cae al `can()` de roles actual (compatibilidad).
 *  - Admin siempre puede todo.
 */
export function usePermisosArea(modulo: string): PermisosArea {
  const { can, isAdmin } = useAuth()
  const location = useLocation()
  const areaId = (location.state as { fromArea?: string } | null)?.fromArea
  const [, setTick] = useState(0)

  useEffect(() => {
    let activo = true
    void cargarAccionesArea().then(() => { if (activo) setTick((t) => t + 1) })
    return () => { activo = false }
  }, [])

  const app = APPS.find((a) => moduloDePermiso(a.permiso) === modulo)

  const config = app ? accionesDe(app.id, areaId) : undefined
  const tiene = (accion: AccionArea) => !!config?.includes(accion)

  if (isAdmin) return { ver: true, crear: true, editar: true, edicionUnica: false, borrar: true }

  if (config) {
    return {
      ver: tiene('ver'),
      crear: tiene('crear'),
      editar: tiene('editar'),
      edicionUnica: tiene('edicion_unica'),
      borrar: tiene('borrar'),
    }
  }

  // Fallback: permisos por rol
  const fb = FALLBACK_CLAVES[modulo] ?? {}
  const clave = (accion: keyof PermisosArea) => {
    const c = fb[accion]
    if (c === '') return false
    if (c) return can(c)
    return can(`${modulo}.${accion === 'edicionUnica' ? 'edit' : accion}`)
  }

  return {
    ver: clave('ver'),
    crear: clave('crear'),
    editar: clave('editar'),
    edicionUnica: false,
    borrar: clave('borrar'),
  }
}

export type { AccionArea }