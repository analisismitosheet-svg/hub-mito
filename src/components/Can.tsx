import type { ReactNode } from 'react'
import { useAuth } from '@/context/AuthContext'

interface CanProps {
  /** clave de permiso (ej: 'mayorista.facturacion.create') */
  permiso?: string
  /** true = solo admin ve el contenido */
  soloAdmin?: boolean
  children: ReactNode
  /** renderizado alternativo cuando no hay permiso (por defecto: nada) */
  fallback?: ReactNode
}

/**
 * Componente declarativo de autorización: oculta/muestra contenido según el
 * permiso del usuario (equivalent del patrón <Can> de Vue/React).
 *
 * <Can permiso="mayorista.facturacion.create">...</Can>
 * <Can soloAdmin>...</Can>
 */
export function Can({ permiso, soloAdmin, children, fallback = null }: CanProps) {
  const { can, isAdmin } = useAuth()
  const ok = (permiso != null && can(permiso)) || (soloAdmin === true && isAdmin)
  return <>{ok ? children : fallback}</>
}
