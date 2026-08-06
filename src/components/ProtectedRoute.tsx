import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '@/context/AuthContext'

/**
 * Protege rutas: si Supabase está configurado y no hay sesión, redirige al login.
 * Si Supabase NO está configurado, deja pasar (modo demo/desarrollo de UI).
 */
export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading, configured } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
        Cargando…
      </div>
    )
  }

  if (configured && !user) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
