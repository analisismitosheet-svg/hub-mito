import { Navigate } from 'react-router-dom'
import { Clock, XCircle, Ban, LogOut } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'

/**
 * Pantalla para usuarios autenticados pero NO aprobados.
 * Muestra el estado (pendiente / rechazado / desactivado) y permite cerrar sesión.
 */
export default function Acceso() {
  const { configured, user, isApproved, perfil, signOut, loading } = useAuth()

  if (loading) return null
  if (configured && !user) return <Navigate to="/login" replace />
  if (!configured || isApproved) return <Navigate to="/" replace />

  const estado = perfil?.estado ?? 'pendiente'
  const mapa: Record<string, { icon: typeof Clock; color: string; titulo: string; texto: string }> = {
    pendiente: {
      icon: Clock,
      color: '#f59e0b',
      titulo: 'Tu solicitud está pendiente',
      texto:
        'Un administrador tiene que aprobar tu acceso antes de que puedas usar la aplicación. Te avisaremos por email cuando esté aprobada.',
    },
    rechazado: {
      icon: XCircle,
      color: '#e11d2e',
      titulo: 'Tu solicitud fue rechazada',
      texto:
        perfil?.motivo_rechazo ||
        'El administrador no aprobó tu acceso. Si creés que es un error, comunicate con el administrador.',
    },
    desactivado: {
      icon: Ban,
      color: '#e11d2e',
      titulo: 'Tu cuenta está desactivada',
      texto:
        'Tu acceso fue desactivado por un administrador. Comunicate con el administrador para reactivarlo.',
    },
  }
  const info = mapa[estado] ?? {
    icon: Clock,
    color: '#f59e0b',
    titulo: 'Acceso no disponible',
    texto: 'Tu cuenta todavía no está habilitada.',
  }

  const Icon = info.icon

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 text-center shadow-soft-lg">
        <div
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
          style={{ backgroundColor: `${info.color}1f`, color: info.color }}
        >
          <Icon size={26} aria-hidden />
        </div>
        <h1 className="font-display text-xl font-semibold text-ink">{info.titulo}</h1>
        <p className="mt-2 text-sm text-sub">{info.texto}</p>
        {perfil?.email && (
          <p className="mt-4 rounded-xl border border-line bg-surface2 px-3 py-2 text-xs text-sub">
            Sesión: <span className="text-ink">{perfil.email}</span>
          </p>
        )}
        <button
          onClick={() => signOut()}
          className="btn-press mt-6 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-line bg-surface2 py-2.5 text-sm font-medium text-ink hover:bg-line"
        >
          <LogOut size={15} aria-hidden /> Cerrar sesión
        </button>
      </div>
    </div>
  )
}
