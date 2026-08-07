import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

/**
 * Protege rutas exclusivas de administrador (ej. /configuraciones).
 * No es solo ocultación visual: bloquea el acceso directo por URL.
 * La RLS de Supabase también exige es_admin() en las operaciones sensibles.
 */
export default function AdminRoute({ children }: { children: ReactNode }) {
  const { loading, configured, user, isApproved, isAdmin } = useAuth()
  if (loading)
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 bg-paper text-sub">
        <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando…
      </div>
    )
  if (configured && !user) return <Navigate to="/login" replace />
  if (configured && user && !isApproved) return <Navigate to="/acceso" replace />
  if (!isAdmin) return <Navigate to="/denegado" replace />
  return <>{children}</>
}
