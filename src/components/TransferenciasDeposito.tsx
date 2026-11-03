import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, Check, ChevronDown, ChevronRight, Loader2, Undo2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { suscribirCambios } from '@/lib/realtime'

/** Renglón de transferencia que sale de Depósito Indo (RPC transferencias_deposito_items). */
interface Renglon {
  id: string
  lote_id: string
  lote_nombre: string
  lote_creado: string
  origen: string
  destino: string
  articulo: string | null
  descripcion: string | null
  color: string | null
  talle: string | null
  cantidad: number
  estado: 'pendiente' | 'hecho' | 'faltante' | 'senado'
  hecho_at: string | null
}

type Estado = 'pendiente' | 'hecho' | 'faltante'

/**
 * Transferencias de Depósito Indo dentro de Mi repo (sql/transferencias_deposito.sql).
 * La ven el rol deposito y los legajos con ubicación Depósito Indo: lotes de los
 * últimos 7 días, por destino, con ✓ Hecho / Faltante por renglón o por destino.
 * Los marcados hoy quedan a la vista para poder deshacer.
 */
export default function TransferenciasDeposito() {
  const [renglones, setRenglones] = useState<Renglon[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  const [enviando, setEnviando] = useState<Set<string>>(new Set())

  const cargar = useCallback(async () => {
    if (!supabase) return
    const { data, error: e } = await supabase.rpc('transferencias_deposito_items')
    if (e) setError(e.message)
    else { setError(null); setRenglones((data ?? []) as Renglon[]) }
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
    const desuscribir = suscribirCambios(['transfer_items'], () => void cargar())
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') void cargar() }, 60_000)
    return () => { desuscribir(); window.clearInterval(id) }
  }, [cargar])

  // Lote → destino → renglones
  const lotes = useMemo(() => {
    const m = new Map<string, { id: string; nombre: string; creado: string; destinos: Map<string, Renglon[]> }>()
    for (const r of renglones) {
      let l = m.get(r.lote_id)
      if (!l) { l = { id: r.lote_id, nombre: r.lote_nombre, creado: r.lote_creado, destinos: new Map() }; m.set(r.lote_id, l) }
      l.destinos.set(r.destino, [...(l.destinos.get(r.destino) ?? []), r])
    }
    return [...m.values()]
  }, [renglones])

  async function marcar(ids: string[], estado: Estado) {
    if (!supabase || !ids.length) return
    setEnviando((s) => new Set([...s, ...ids]))
    const at = estado === 'pendiente' ? null : new Date().toISOString()
    setRenglones((arr) => arr.map((r) => (ids.includes(r.id) ? { ...r, estado, hecho_at: at } : r)))
    const { error: e } = await supabase.rpc('transferencia_marcar_deposito', { p_ids: ids, p_estado: estado })
    setEnviando((s) => { const n = new Set(s); for (const i of ids) n.delete(i); return n })
    if (e) { setError(e.message); await cargar() }
  }

  const alternar = (k: string) => setAbiertos((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })

  if (cargando) {
    return (
      <div className="mb-4 flex items-center gap-2 text-sm text-sub">
        <Loader2 size={15} className="animate-spin" aria-hidden /> Cargando transferencias de Depósito Indo…
      </div>
    )
  }
  if (!lotes.length && !error) return null

  return (
    <section className="mb-5 rounded-2xl border border-line bg-surface p-3 sm:p-4">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold text-ink">
        <ArrowRightLeft size={18} className="text-violet-500" aria-hidden /> Transferencias Depósito Indo
      </h2>
      {error && <p role="alert" className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}

      <div className="space-y-3">
        {lotes.map((l) => {
          const todos = [...l.destinos.values()].flat()
          const pendientes = todos.filter((r) => r.estado === 'pendiente')
          const uPend = pendientes.reduce((s, r) => s + r.cantidad, 0)
          return (
            <div key={l.id} className="rounded-xl border border-line bg-surface2/50">
              <div className="border-b border-line px-3 py-2">
                <p className="font-semibold text-ink">{l.nombre}</p>
                <p className="text-xs text-sub">
                  {pendientes.length ? `${pendientes.length} renglones · ${uPend} u. por preparar` : '✓ Todo marcado'}
                </p>
              </div>
              {[...l.destinos.entries()].map(([destino, rs]) => {
                const k = `${l.id}|${destino}`
                const abierto = abiertos.has(k)
                const pend = rs.filter((r) => r.estado === 'pendiente')
                return (
                  <div key={k} className="border-b border-line last:border-b-0">
                    <div className="flex items-center gap-2 px-3 py-2">
                      <button type="button" onClick={() => alternar(k)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                        {abierto ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
                        <span className="truncate font-medium text-ink">{destino}</span>
                        <span className="shrink-0 text-xs text-sub">
                          {pend.length ? `${pend.reduce((s, r) => s + r.cantidad, 0)} u. pendientes` : '✓ listo'}
                        </span>
                      </button>
                      {pend.length > 0 && (
                        <button
                          type="button"
                          onClick={() => void marcar(pend.map((r) => r.id), 'hecho')}
                          className="btn-press shrink-0 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                        >
                          ✓ Todo
                        </button>
                      )}
                    </div>
                    {abierto && (
                      <ul className="space-y-1 px-3 pb-3">
                        {rs.map((r) => {
                          const ocupado = enviando.has(r.id)
                          return (
                            <li key={r.id} className={'flex items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1.5 ' + (r.estado !== 'pendiente' ? 'opacity-60' : '')}>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-ink">
                                  {[r.articulo, r.color, r.talle].filter(Boolean).join(' · ') || 'Artículo'}
                                </p>
                                {r.descripcion && <p className="truncate text-xs text-sub">{r.descripcion}</p>}
                              </div>
                              <span className="shrink-0 text-sm font-semibold text-ink">{r.cantidad} u.</span>
                              {r.estado === 'pendiente' ? (
                                <>
                                  <button type="button" disabled={ocupado} onClick={() => void marcar([r.id], 'hecho')} title="Hecho" aria-label="Marcar hecho" className="btn-press rounded-lg bg-emerald-600 p-1.5 text-white hover:bg-emerald-700 disabled:opacity-50">
                                    <Check size={15} aria-hidden />
                                  </button>
                                  <button type="button" disabled={ocupado} onClick={() => void marcar([r.id], 'faltante')} title="Faltante" aria-label="Marcar faltante" className="btn-press rounded-lg bg-red-600 p-1.5 text-white hover:bg-red-700 disabled:opacity-50">
                                    <X size={15} aria-hidden />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <span className={'shrink-0 text-xs font-medium ' + (r.estado === 'hecho' ? 'text-emerald-500' : 'text-red-500')}>
                                    {r.estado === 'hecho' ? 'Hecho' : r.estado === 'faltante' ? 'Faltante' : 'Señado'}
                                  </span>
                                  <button type="button" disabled={ocupado} onClick={() => void marcar([r.id], 'pendiente')} title="Deshacer" aria-label="Deshacer" className="btn-press rounded-lg border border-line p-1.5 text-sub hover:bg-line disabled:opacity-50">
                                    <Undo2 size={15} aria-hidden />
                                  </button>
                                </>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </section>
  )
}
