import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'

/** Pantalla única de las cuentas de piso. */
export const RUTA_PISO = '/mayorista/mi-repo'

/**
 * Las cuentas de piso "puras" (solo rol empleado, ver AuthContext.soloPiso) no
 * ven el menú ni las áreas: se las manda directo a Mi repo.
 */
export default function SoloPisoRedirect({ children }: { children: ReactNode }) {
  const { soloPiso } = useAuth()
  if (soloPiso) return <Navigate to={RUTA_PISO} replace />
  return <>{children}</>
}
