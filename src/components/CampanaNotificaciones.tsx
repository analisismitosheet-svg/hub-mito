import { useEffect, useState } from 'react'
import { Bell, UserCheck, ClipboardList, Truck, CalendarX, FileText, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

interface Notificacion {
  id: string
  tipo: 'usuarios' | 'guias' | 'facturacion' | 'facturacion_sin_fact' | 'nota_credito'
  titulo: string
  detalle: string
  ruta: string
  fecha: string
  destinoId: string | null
}

function fmtFecha(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso))
  } catch {
    return iso
  }
}

/**
 * Campana de notificaciones en el header. Muestra cada evento individual,
 * ordenado de más viejo a más nuevo.
 * - Administradores: usuarios pendientes de autorizar.
 * - Rol mayorista: cada guía sin finalizar y cada registro de facturación sin fecha de envío.
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
      // 1) Usuarios pendientes (admin) — una por usuario
      if (isAdmin) {
        const { data } = await sb.from('usuarios').select('id,nombre,email,created_at').eq('estado', 'pendiente')
        if (activo && data) {
          for (const u of data as { id: string; nombre: string | null; email: string | null; created_at: string }[]) {
            notis.push({ id: `u-${u.id}`, tipo: 'usuarios', titulo: 'Usuarios por autorizar', detalle: `${u.nombre || u.email || 'Solicitud'}`, ruta: '/configuraciones', fecha: u.created_at, destinoId: u.id })
          }
        }
      }
      // 2) Guías y facturación (mayorista)
      if (esMayorista) {
        // Mapa guia_id -> finalizado
        const { data: guias } = await sb.from('guias').select('id,finalizado')
        const estadoGuia = new Map<string, boolean>()
        if (guias) {
          for (const g of guias as { id: string; finalizado: boolean }[]) estadoGuia.set(g.id, g.finalizado)
        }
        // Cada guía no finalizada
        const { data: gNoFin } = await sb.from('guias').select('id,nro_pedido,razon_social,fecha,created_at').eq('finalizado', false)
        if (activo && gNoFin) {
          for (const g of gNoFin as { id: string; nro_pedido: string | null; razon_social: string | null; fecha: string | null; created_at: string }[]) {
            notis.push({ id: `g-${g.id}`, tipo: 'guias', titulo: 'Guía sin finalizar', detalle: `N° ${g.nro_pedido || '-'} · ${g.razon_social || ''}`, ruta: `/mayorista/guias?abrir=${g.id}`, fecha: g.fecha || g.created_at, destinoId: g.id })
          }
        }
        // Facturación sin fecha de envío — solo si la guía está finalizada o no tiene guía
        const { data: sinEnvio } = await sb.from('facturacion_fabrica').select('id,guia_id,razon_social,n_remito,fecha_fact,created_at').is('fecha_envio', null)
        if (activo && sinEnvio) {
          for (const f of sinEnvio as { id: string; guia_id: string | null; razon_social: string | null; n_remito: string | null; fecha_fact: string | null; created_at: string }[]) {
            const guiaFinalizada = f.guia_id ? estadoGuia.get(f.guia_id) === true : true
            if (guiaFinalizada) {
              notis.push({ id: `f-${f.id}`, tipo: 'facturacion', titulo: 'Facturación sin enviar', detalle: `${f.razon_social || ''}${f.n_remito ? ` · R. ${f.n_remito}` : ''}`, ruta: `/mayorista/facturacion-fabrica?abrir=${f.id}`, fecha: f.fecha_fact || f.created_at, destinoId: f.id })
            }
          }
        }
        // Facturación sin fecha de facturación — solo si la guía está finalizada o no tiene guía
        const { data: sinFact } = await sb.from('facturacion_fabrica').select('id,guia_id,razon_social,n_remito,created_at').is('fecha_fact', null)
        if (activo && sinFact) {
          for (const f of sinFact as { id: string; guia_id: string | null; razon_social: string | null; n_remito: string | null; created_at: string }[]) {
            const guiaFinalizada = f.guia_id ? estadoGuia.get(f.guia_id) === true : true
            if (guiaFinalizada) {
              notis.push({ id: `ff-${f.id}`, tipo: 'facturacion_sin_fact', titulo: 'Facturación sin fecha de facturación', detalle: `${f.razon_social || ''}${f.n_remito ? ` · R. ${f.n_remito}` : ''}`, ruta: `/mayorista/facturacion-fabrica?abrir=${f.id}`, fecha: f.created_at, destinoId: f.id })
            }
          }
        }
      }
      // 5) Notas de crédito pendientes (mayorista)
      if (esMayorista) {
        const { data } = await sb.from('notas_credito').select('id,nro_pedido,razon_social,fecha,created_at').eq('estado', 'PENDIENTE')
        if (activo && data) {
          for (const n of data as { id: string; nro_pedido: string | null; razon_social: string | null; fecha: string | null; created_at: string }[]) {
            notis.push({ id: `nc-${n.id}`, tipo: 'nota_credito', titulo: 'Nota de crédito pendiente', detalle: `N° ${n.nro_pedido || '-'} · ${n.razon_social || ''}`, ruta: `/mayorista/notas-credito?abrir=${n.id}`, fecha: n.fecha || n.created_at, destinoId: n.id })
          }
        }
      }
      // Ordenar de más viejo a más nuevo
      if (activo) {
        notis.sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime())
        setItems(notis)
        setCargando(false)
      }
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
    facturacion_sin_fact: <CalendarX size={15} aria-hidden />,
    nota_credito: <FileText size={15} aria-hidden />,
  }
  const colores = {
    usuarios: 'bg-amber-500/15 text-amber-400',
    guias: 'bg-sky-500/15 text-sky-400',
    facturacion: 'bg-emerald-500/15 text-emerald-400',
    facturacion_sin_fact: 'bg-red-500/15 text-red-400',
    nota_credito: 'bg-orange-500/15 text-orange-400',
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
          <div className="absolute right-0 top-full z-50 mt-2 w-96 overflow-hidden rounded-2xl border border-line bg-surface shadow-soft-lg">
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
                <ul className="divide-y divide-line/50">
                  {items.map((n) => (
                    <li key={n.id}>
                      <button
                        onClick={() => { setAbierto(false); navigate(n.ruta) }}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-line/30"
                      >
                        <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${colores[n.tipo]}`}>
                          {iconos[n.tipo]}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">{n.titulo}</span>
                          <span className="block truncate text-xs text-sub">{n.detalle}</span>
                        </span>
                        <span className="shrink-0 text-[10px] text-sub/70">{fmtFecha(n.fecha)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}