import { useEffect, useState } from 'react'
import { Bell, UserCheck, ClipboardList, Truck, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

interface Notificacion {
  id: string
  icono: 'usuarios' | 'guias' | 'facturacion'
  titulo: string
  detalle: string
  ruta: string
}

/**
 * Campana de notificaciones en el header.
 * - Administradores: usuarios pendientes de autorizar.
 * - Rol mayorista: guías no finalizadas y registros de facturación sin fecha de envío.
 */
export default function CampanaNotificaciones() {
  const { isAdmin, perfil } = useAuth()
  const navigate = useNavigate()
  const [abierto, setAbierto] = useState(false)
  const [items, setItems] = useState<Notificacion[]>([])
  const [cargando, setCargando] = useState(true)

  const esMayorista = String(perfil?.rol) === 'mayorista' || (perfil?.roles ?? []).includes('mayorista')
  const visible = isAdmin || esMayorista

  useEffect(() => {
    if (!supabase || !visible) { setItems([]); setCargando(false); return }
    let activo = true
    const sb = supabase
    async function cargar() {
      const notis: Notificacion[] = []
      // 1) Usuarios pendientes (admin)
      if (isAdmin) {
        const { count } = await sb.from('usuarios').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente')
        if (activo && count) notis.push({ id: 'usuarios', icono: 'usuarios', titulo: 'Usuarios por autorizar', detalle: `${count} solicitud${count > 1 ? 'es' : ''} pendiente${count > 1 ? 's' : ''}.`, ruta: '/configuraciones' })
      }
      // 2) Guías no finalizadas (mayorista)
      if (esMayorista) {
        const { count } = await sb.from('guias').select('id', { count: 'exact', head: true }).eq('finalizado', false)
        if (activo && count) notis.push({ id: 'guias', icono: 'guias', titulo: 'Guías sin finalizar', detalle: `${count} guía${count > 1 ? 's' : ''} sin estado FINALIZADO.`, ruta: '/mayorista/guias' })
      }
      // 3) Facturación sin fecha de envío (mayorista)
      if (esMayorista) {
        const { count } = await sb.from('facturacion_fabrica').select('id', { count: 'exact', head: true }).is('fecha_envio', null)
        if (activo && count) notis.push({ id: 'facturacion', icono: 'facturacion', titulo: 'Facturación sin enviar', detalle: `${count} registro${count > 1 ? 's' : ''} sin fecha de envío.`, ruta: '/mayorista/facturacion-fabrica' })
      }
      if (activo) { setItems(notis); setCargando(false) }
    }
    void cargar()
    const intervalo = setInterval(cargar, 30000)
    return () => { activo = false; clearInterval(intervalo) }
  }, [isAdmin, esMayorista, visible])

  if (!visible || !supabase) return null

  const total = items.length

  const iconos = {
    usuarios: <UserCheck size={15} aria-hidden />,
    guias: <ClipboardList size={15} aria-hidden />,
    facturacion: <Truck size={15} aria-hidden />,
  }
  const colores = {
    usuarios: 'bg-amber-500/15 text-amber-400',
    guias: 'bg-sky-500/15 text-sky-400',
    facturacion: 'bg-emerald-500/15 text-emerald-400',
  }

  return (
    <div className="relative">
      <button
        onClick={() => setAbierto((o) => !o)}
        className="btn-press relative flex cursor-pointer items-center justify-center rounded-xl border border-line bg-surface p-2 text-ink outline-none hover:border-line2 hover:bg-surface2 focus-visible:ring-2 focus-visible:ring-brand-500/50"
        title="Notificaciones"
        aria-label="Notificaciones"
      >
        <Bell size={16} aria-hidden />
        {total > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {total > 99 ? '99+' : total}
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
              {cargando ? (
                <p className="px-4 py-8 text-center text-sm text-sub">Cargando...</p>
              ) : items.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-sub">Sin notificaciones.</p>
              ) : (
                items.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => { setAbierto(false); navigate(n.ruta) }}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-line/30"
                  >
                    <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${colores[n.icono]}`}>
                      {iconos[n.icono]}
                    </span>
                    <span>
                      <span className="block text-sm font-medium text-ink">{n.titulo}</span>
                      <span className="block text-xs text-sub">{n.detalle}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}