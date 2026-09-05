import { useEffect, useState } from 'react'
import { History, Loader2 } from 'lucide-react'
import { obtenerHistorial, type HistorialEntry } from '@/lib/historial'

const ACCION_LABEL: Record<HistorialEntry['accion'], { label: string; cls: string }> = {
  creacion: { label: 'Creación', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  modificacion: { label: 'Modificación', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  borrado: { label: 'Borrado', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
}

export default function HistorialLista({ entidad, registroId }: { entidad: 'guia' | 'facturacion' | 'nota_credito'; registroId: string }) {
  const [items, setItems] = useState<HistorialEntry[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let activo = true
    void obtenerHistorial(entidad, registroId).then((d) => { if (activo) { setItems(d); setCargando(false) } })
    return () => { activo = false }
  }, [entidad, registroId])

  return (
    <section className="rounded-xl border border-line bg-surface2 p-4">
      <h3 className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-sub/70"><History size={12} aria-hidden /> Historial</h3>
      {cargando ? (
        <div className="flex items-center gap-2 py-4 text-xs text-sub"><Loader2 size={14} className="animate-spin" aria-hidden /> Cargando historial...</div>
      ) : items.length === 0 ? (
        <p className="py-4 text-center text-xs text-sub">Sin eventos registrados.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((h) => {
            const a = ACCION_LABEL[h.accion] ?? ACCION_LABEL.modificacion
            const fecha = new Date(h.created_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
            return (
              <li key={h.id} className="rounded-lg border border-line/60 bg-surface px-2.5 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className={'inline-block whitespace-nowrap rounded-full border px-1.5 py-px text-[9px] font-medium leading-tight ' + a.cls}>{a.label}</span>
                  <span className="text-[10px] text-sub/70">{fecha}</span>
                </div>
                <div className="mt-1 text-[11px] text-ink">{h.usuario_nombre || h.usuario_email || 'Usuario desconocido'}</div>
                {h.detalle && <div className="mt-0.5 text-[10px] text-sub">{h.detalle}</div>}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}