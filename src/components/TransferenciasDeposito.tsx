import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, Check, ChevronRight, Loader2, Package, Undo2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { suscribirCambios } from '@/lib/realtime'
import { compararTalles } from '@/lib/ordenPiso'
import { useCajasMapeo } from '@/lib/useCajasMapeo'

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

/** Lo que se prepara para un local de un lote (una tarjeta, como una repo del mayorista) */
interface TarjetaLocal {
  clave: string
  loteNombre: string
  destino: string
  renglones: Renglon[]
  total: number
  listas: number
}

/**
 * Transferencias de Depósito Indo dentro de Mi repo (sql/transferencias_deposito.sql).
 * La ven el rol deposito y los legajos con ubicación Depósito Indo: lotes de los
 * últimos 7 días. Igual que Mi repo del mayorista: una tarjeta por local con su
 * avance; al tocarla se abre ese local con lo que falta preparar ordenado por caja
 * (Mapeo de cajas) y ✓ Hecho / Faltante por renglón o ✓ Todo.
 * Los marcados hoy quedan a la vista para poder deshacer.
 */
/** `mostrarVacio`: cuando es lo único que tiene Mi repo (rol deposito sin legajo), avisa que no hay nada.
 *  `alAbrir`: avisa si hay un local abierto (Mi repo esconde lo demás, como con una repo abierta). */
export default function TransferenciasDeposito({
  mostrarVacio = false,
  alAbrir,
}: {
  mostrarVacio?: boolean
  alAbrir?: (abierto: boolean) => void
}) {
  const [renglones, setRenglones] = useState<Renglon[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** Local abierto: `${lote_id}|${destino}` */
  const [sel, setSel] = useState<string | null>(null)
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

  // Cajas del Mapeo de cajas (como las ubicaciones en el armado de pedidos):
  // chip al lado del artículo y recorrido por número de caja. Se actualizan solas.
  const codigos = useMemo(() => renglones.map((r) => String(r.articulo ?? '')), [renglones])
  const cajas = useCajasMapeo(codigos)
  const cajasDe = useCallback((r: Renglon) => cajas.get(String(r.articulo ?? '').trim().toUpperCase()) ?? [], [cajas])

  /** Recorrido: caja → artículo → color → talle; los que no están en ninguna caja, al final */
  const compararRecorrido = useCallback(
    (a: Renglon, b: Renglon) => {
      const ca = cajasDe(a)[0]
      const cb = cajasDe(b)[0]
      const porCaja = ca != null && cb != null ? ca - cb : ca != null ? -1 : cb != null ? 1 : 0
      const t = (v: unknown) => String(v ?? '').trim().toUpperCase()
      return (
        porCaja ||
        t(a.articulo).localeCompare(t(b.articulo), 'es', { numeric: true }) ||
        t(a.color).localeCompare(t(b.color), 'es', { numeric: true }) ||
        compararTalles(a.talle, b.talle)
      )
    },
    [cajasDe],
  )

  // Lote → destino → renglones
  const lotes = useMemo(() => {
    const m = new Map<string, { id: string; nombre: string; creado: string; destinos: Map<string, Renglon[]> }>()
    for (const r of renglones) {
      let l = m.get(r.lote_id)
      if (!l) { l = { id: r.lote_id, nombre: r.lote_nombre, creado: r.lote_creado, destinos: new Map() }; m.set(r.lote_id, l) }
      l.destinos.set(r.destino, [...(l.destinos.get(r.destino) ?? []), r])
    }
    for (const l of m.values()) for (const [d, rs] of l.destinos) l.destinos.set(d, [...rs].sort(compararRecorrido))
    return [...m.values()]
  }, [renglones, compararRecorrido])

  async function marcar(ids: string[], estado: Estado) {
    if (!supabase || !ids.length) return
    setEnviando((s) => new Set([...s, ...ids]))
    const at = estado === 'pendiente' ? null : new Date().toISOString()
    setRenglones((arr) => arr.map((r) => (ids.includes(r.id) ? { ...r, estado, hecho_at: at } : r)))
    const { error: e } = await supabase.rpc('transferencia_marcar_deposito', { p_ids: ids, p_estado: estado })
    setEnviando((s) => { const n = new Set(s); for (const i of ids) n.delete(i); return n })
    if (e) { setError(e.message); await cargar() }
  }

  /** Un renglón: artículo, caja, unidades y ✓ / ✕ (o el estado con Deshacer) */
  function fila(r: Renglon) {
    const ocupado = enviando.has(r.id)
    const cs = cajasDe(r)
    return (
      <li key={r.id} className={'flex items-center gap-2 rounded-xl border border-line bg-surface px-2.5 py-2 ' + (r.estado !== 'pendiente' ? 'opacity-60' : '')}>
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm font-semibold text-ink">
            <span className="truncate">{[r.articulo, r.color, r.talle].filter(Boolean).join(' · ') || 'Artículo'}</span>
            {cs.length > 0 && (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-md bg-orange-500/15 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-orange-500"
                title="Caja del Mapeo de cajas"
              >
                <Package size={11} aria-hidden />
                {cs.length === 1 ? `Caja ${cs[0]}` : `Cajas ${cs.join(' · ')}`}
              </span>
            )}
          </p>
          {r.descripcion && <p className="truncate text-xs text-sub">{r.descripcion}</p>}
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{r.cantidad} u.</span>
        {r.estado === 'pendiente' ? (
          <>
            <button type="button" disabled={ocupado} onClick={() => void marcar([r.id], 'hecho')} title="Hecho" aria-label="Marcar hecho" className="btn-press rounded-lg bg-emerald-600 p-2 text-white hover:bg-emerald-700 disabled:opacity-50">
              <Check size={16} aria-hidden />
            </button>
            <button type="button" disabled={ocupado} onClick={() => void marcar([r.id], 'faltante')} title="Faltante" aria-label="Marcar faltante" className="btn-press rounded-lg bg-red-600 p-2 text-white hover:bg-red-700 disabled:opacity-50">
              <X size={16} aria-hidden />
            </button>
          </>
        ) : (
          <>
            <span className={'shrink-0 text-xs font-medium ' + (r.estado === 'hecho' ? 'text-emerald-500' : 'text-red-500')}>
              {r.estado === 'hecho' ? 'Hecho' : r.estado === 'faltante' ? 'Faltante' : 'Señado'}
            </span>
            <button type="button" disabled={ocupado} onClick={() => void marcar([r.id], 'pendiente')} title="Deshacer" aria-label="Deshacer" className="btn-press rounded-lg border border-line p-2 text-sub hover:bg-line disabled:opacity-50">
              <Undo2 size={16} aria-hidden />
            </button>
          </>
        )}
      </li>
    )
  }

  /** Una tarjeta por local (destino) de cada lote, como las repos de Mi repo del mayorista */
  const tarjetas = useMemo(() => {
    const out: TarjetaLocal[] = []
    for (const l of lotes) {
      for (const [destino, rs] of l.destinos) {
        const total = rs.reduce((s, r) => s + r.cantidad, 0)
        const listas = rs.filter((r) => r.estado !== 'pendiente').reduce((s, r) => s + r.cantidad, 0)
        out.push({ clave: `${l.id}|${destino}`, loteNombre: l.nombre, destino, renglones: rs, total, listas })
      }
    }
    // Primero los que tienen algo por preparar; después, por local
    return out.sort(
      (a, b) => Number(a.listas >= a.total) - Number(b.listas >= b.total) || a.destino.localeCompare(b.destino, 'es'),
    )
  }, [lotes])

  const abierta = sel ? tarjetas.find((t) => t.clave === sel) ?? null : null

  // Avisa a Mi repo para que esconda lo demás mientras hay un local abierto
  useEffect(() => {
    alAbrir?.(!!abierta)
    return () => alAbrir?.(false)
  }, [abierta, alAbrir])

  if (cargando) {
    return (
      <div className="mb-4 flex items-center gap-2 text-sm text-sub">
        <Loader2 size={15} className="animate-spin" aria-hidden /> Cargando transferencias de Depósito Indo…
      </div>
    )
  }
  if (!tarjetas.length && !error) {
    if (!mostrarVacio) return null
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line2 bg-surface/50 px-4 py-14 text-center text-sub">
        <ArrowRightLeft size={28} aria-hidden />
        <p>No hay transferencias pendientes que salgan de Depósito Indo.</p>
        <p className="text-xs">Cuando se cargue una, aparece acá.</p>
      </div>
    )
  }

  /* ---------- Un local abierto: lo que falta por caja, como el repo del mayorista ---------- */
  if (abierta) {
    const pendientes = abierta.renglones.filter((r) => r.estado === 'pendiente')
    const listos = abierta.renglones.filter((r) => r.estado !== 'pendiente')
    const pct = abierta.total > 0 ? Math.round((abierta.listas / abierta.total) * 100) : 0
    return (
      <div className="space-y-3 pb-4">
        <button
          onClick={() => setSel(null)}
          className="-ml-1 inline-flex min-h-[2.5rem] items-center gap-1 px-1 text-sm font-medium text-sub transition hover:text-ink"
        >
          <ChevronRight size={16} aria-hidden className="rotate-180" /> Mis locales
        </button>

        <div className="sticky top-0 z-[5] -mx-4 space-y-2 border-b border-line bg-paper px-4 pb-2.5 pt-1 sm:top-[61px] sm:mx-0 sm:rounded-2xl sm:border sm:bg-surface sm:p-4 sm:shadow-soft">
          <div className="flex items-center gap-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-sm font-bold leading-tight text-ink sm:text-base">{abierta.loteNombre}</p>
              <p className="flex items-center gap-1.5 text-xs leading-tight text-sub">
                <span className="font-semibold text-orange-500">{abierta.destino}</span>
                <span aria-hidden>·</span>
                <span className="tabular-nums">{abierta.listas} de {abierta.total} unidades</span>
              </p>
            </div>
            {pendientes.length > 0 && (
              <button
                type="button"
                onClick={() => void marcar(pendientes.map((r) => r.id), 'hecho')}
                className="btn-press inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white shadow-soft transition hover:bg-emerald-700"
              >
                <Check size={16} aria-hidden /> Todo
              </button>
            )}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-line">
            <div
              className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-orange-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}

        {pendientes.length > 0 ? (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink">
              Faltan preparar <span className="font-normal text-sub">({pendientes.length})</span>
            </h3>
            <ul className="space-y-1.5">{pendientes.map(fila)}</ul>
          </section>
        ) : (
          <p className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center text-sm font-semibold text-emerald-400">
            ✓ {abierta.destino} está completo
          </p>
        )}

        {listos.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-sub">Listos ({listos.length})</h3>
            <ul className="space-y-1.5">{listos.map(fila)}</ul>
          </section>
        )}
      </div>
    )
  }

  /* ---------- Lista: una tarjeta por local ---------- */
  return (
    <section className="mb-5 space-y-2.5">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink">
        <ArrowRightLeft size={18} className="text-violet-500" aria-hidden /> Transferencias Depósito Indo
      </h2>
      {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-500">{error}</p>}
      {tarjetas.map((t) => {
        const pct = t.total > 0 ? Math.round((t.listas / t.total) * 100) : 0
        return (
          <button
            key={t.clave}
            onClick={() => setSel(t.clave)}
            className="flex min-h-[4.5rem] w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 text-left shadow-soft transition active:scale-[0.99] hover:bg-surface2"
          >
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 font-display font-semibold text-ink">
                <span className="shrink-0 rounded-full bg-orange-500/15 px-2 py-0.5 text-xs font-semibold text-orange-500">
                  {t.destino}
                </span>
                <span className="truncate">{t.loteNombre}</span>
              </p>
              <p className="mt-1 text-xs text-sub">
                <span className="tabular-nums">{t.listas} de {t.total} unidades</span>
                {pct === 100 && <span className="ml-2 font-medium text-emerald-400">✓ Listo</span>}
              </p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line">
                <div
                  className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-orange-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
            <ChevronRight size={20} aria-hidden className="shrink-0 text-sub" />
          </button>
        )
      })}
    </section>
  )
}
