import { useEffect, useState } from 'react'
import { Bell, UserCheck, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

/**
 * Campana de notificaciones en el header. Por ahora muestra a los
 * administradores cuántos usuarios hay pendientes de autorizar.
 */
export default function CampanaNotificaciones() {
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const [pendientes, setPendientes] = useState(0)
  const [abierto, setAbierto] = useState(false)

  useEffect(() => {
    if (!supabase || !isAdmin) { setPendientes(0); return }
    let activo = true
    const sb = supabase
    async function contar() {
      const { count } = await sb
        .from('usuarios')
        .select('id', { count: 'exact', head: true })
        .eq('estado', 'pendiente')
      if (activo) setPendientes(count ?? 0)
    }
    void contar()
    const intervalo = setInterval(contar, 30000)
    return () => { activo = false; clearInterval(intervalo) }
  }, [isAdmin])

  if (!isAdmin || !supabase) return null

  return (
    <div className="relative">
      <button
        onClick={() => setAbierto((o) => !o)}
        className="btn-press relative flex cursor-pointer items-center justify-center rounded-xl border border-line bg-surface p-2 text-ink outline-none hover:border-line2 hover:bg-surface2 focus-visible:ring-2 focus-visible:ring-brand-500/50"
        title="Notificaciones"
        aria-label="Notificaciones"
      >
        <Bell size={16} aria-hidden />
        {pendientes > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {pendientes > 99 ? '99+' : pendientes}
          </span>
        )}
      </button>

      {abierto && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAbierto(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-line bg-surface shadow-soft-lg">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink"><Bell size={15} aria-hidden /> Notificaciones</h3>
              <button onClick={() => setAbierto(false)} className="rounded-lg p-1 text-sub hover:bg-line hover:text-ink" aria-label="Cerrar"><X size={15} aria-hidden /></button>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {pendientes === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-sub">Sin notificaciones.</p>
              ) : (
                <button
                  onClick={() => { setAbierto(false); navigate('/configuraciones') }}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-line/30"
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
                    <UserCheck size={15} aria-hidden />
                  </span>
                  <span>
                    <span className="block text-sm font-medium text-ink">Usuarios por autorizar</span>
                    <span className="block text-xs text-sub">Tenés {pendientes} solicitud{pendientes > 1 ? 'es' : ''} pendiente{pendientes > 1 ? 's' : ''}.</span>
                  </span>
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}