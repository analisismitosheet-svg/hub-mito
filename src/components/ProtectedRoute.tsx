import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

function Cargando() {
  return (
    <div className="flex min-h-screen items-center justify-center gap-2 bg-paper text-sub">
      <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando…
    </div>
  )
}

/**
 * Puerta base: exige sesión y estado APROBADO.
 * - Sin sesión → /login
 * - Autenticado pero no aprobado (pendiente/rechazado/desactivado) → /acceso
 * Si Supabase no está configurado, deja pasar (modo demo de UI).
 */
export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { loading, configured, user, isApproved } = useAuth()
  if (loading) return <Cargando />
  if (configured && !user) return <Navigate to="/login" replace />
  if (configured && user && !isApproved) return <Navigate to="/acceso" replace />
  return <>{children}</>
}
