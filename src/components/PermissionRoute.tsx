import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

/**
 * Protege una ruta por permiso concreto (ej. "cuentas_amigos.view").
 * Encadena: sesión → aprobado → permiso. Sin permiso → /denegado.
 * La RLS de Supabase valida igual cada operación en la BD.
 */
export default function PermissionRoute({
  permiso,
  soloLegajo = false,
  children,
}: {
  permiso: string
  /** además del permiso, solo cuentas de legajo (ni siquiera admins) */
  soloLegajo?: boolean
  children: ReactNode
}) {
  const { loading, configured, user, isApproved, can, esLegajo } = useAuth()
  if (loading)
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 bg-paper text-sub">
        <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando…
      </div>
    )
  if (configured && !user) return <Navigate to="/login" replace />
  if (configured && user && !isApproved) return <Navigate to="/acceso" replace />
  if (!can(permiso)) return <Navigate to="/denegado" replace />
  if (configured && soloLegajo && !esLegajo) return <Navigate to="/denegado" replace />
  return <>{children}</>
}
