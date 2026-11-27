import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, CalendarClock, Check, ChevronRight, Loader2, Package, Search, Undo2, X } from 'lucide-react'
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
  escaneadas?: number
}

/** Un SKU (artículo + color + talle) con sus renglones (de uno o varios locales y lotes) */
interface Sku {
  clave: string
  articulo: string
  color: string
  talle: string
  descripcion: string
  caja: number | null
  renglones: Renglon[]
  total: number
}

type Estado = 'pendiente' | 'hecho' | 'faltante'

const norm = (v: unknown) => String(v ?? '').trim().toUpperCase()
const claveSku = (r: Renglon) => `${norm(r.articulo)}|${norm(r.color)}|${norm(r.talle)}`
const fmtTalle = (t: string) => (/^\d+(\.0+)?$/.test(t) ? String(parseInt(t, 10)) : t)
const unidades = (rs: Renglon[]) => rs.reduce((s, r) => s + r.cantidad, 0)

/** Estado de un grupo de renglones: hecho si no queda nada pendiente y algo se hizo; faltante si todo faltó */
function estadoDe(rs: Renglon[]): Estado {
  if (rs.length > 0 && rs.every((r) => r.estado === 'faltante')) return 'faltante'
  if (rs.some((r) => r.estado === 'pendiente')) return 'pendiente'
  return 'hecho'
}

/* ---------- Repo diaria (lotes CASCADA): Indo la ve lunes y jueves ----------
 * El lunes ve la repo de viernes, sábado y domingo; el jueves la de lunes, martes
 * y miércoles. Cuenta el día de la repo (el «CASCADA 25-11» del nombre), no el de
 * carga. La de hoy queda guardada para el próximo corte; lo que no se terminó sigue. */
const esRepoDiaria = (r: Renglon) => /CASCADA/i.test(r.lote_nombre ?? '')
const DIAS_CORTE = [1, 4] // lunes, jueves
const inicioDia = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
/** Día de la repo: el dd-mm del nombre (año del lote); si no tiene, el día de carga */
function diaRepo(r: Renglon): Date {
  const creado = new Date(r.lote_creado)
  const m = /CASCADA\s+(\d{1,2})-(\d{1,2})/i.exec(r.lote_nombre ?? '')
  if (!m) return inicioDia(creado)
  const d = new Date(creado.getFullYear(), Number(m[2]) - 1, Number(m[1]))
  // repo de diciembre cargada en enero
  if (d.getTime() - creado.getTime() > 7 * 86_400_000) d.setFullYear(d.getFullYear() - 1)
  return d
}
/** Último lunes/jueves (hoy incluido): se ve la repo de los días ANTERIORES a ese */
function ultimoCorte(hoy = new Date()): Date {
  const d = inicioDia(hoy)
  while (!DIAS_CORTE.includes(d.getDay())) d.setDate(d.getDate() - 1)
  return d
}
/** Próximo lunes/jueves después del corte vigente */
function proximoCorte(corte: Date): Date {
  const d = new Date(corte)
  do d.setDate(d.getDate() + 1)
  while (!DIAS_CORTE.includes(d.getDay()))
  return d
}
const DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const fmtDia = (d: Date) => `${DIA[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`

function Chip({ children, tono }: { children: React.ReactNode; tono: 'color' | 'talle' }) {
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
        tono === 'color' ? 'bg-sky-500/15 text-sky-400' : 'bg-violet-500/15 text-violet-400'
      }`}
    >
      {children}
    </span>
  )
}

function Tilde({ on, disabled, onClick, label, chica }: { on: boolean; disabled?: boolean; onClick?: () => void; label: string; chica?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={`btn-press flex shrink-0 items-center justify-center rounded-lg border-2 transition disabled:opacity-60 ${
        chica ? 'h-8 w-8' : 'h-9 w-9'
      } ${on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-line2 bg-surface hover:border-emerald-500'}`}
    >
      {on && <Check size={chica ? 16 : 18} strokeWidth={3} aria-hidden />}
    </button>
  )
}

/** ✕ faltante, o deshacer si ya está faltante */
function BotonFaltante({ faltante, disabled, onClick, chica }: { faltante: boolean; disabled?: boolean; onClick: () => void; chica?: boolean }) {
  return faltante ? (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title="Deshacer faltante"
      aria-label="Deshacer faltante"
      className={`btn-press shrink-0 rounded-lg border border-line text-sub hover:bg-line ${chica ? 'p-1.5' : 'p-2'}`}
    >
      <Undo2 size={15} aria-hidden />
    </button>
  ) : (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title="Faltante (no está)"
      aria-label="Marcar faltante"
      className={`btn-press shrink-0 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 ${chica ? 'p-1.5' : 'p-2'}`}
    >
      <X size={15} aria-hidden />
    </button>
  )
}

/**
 * Mi repo · Transferencias Depósito Indo (26/11/2026). Dos formas de ver y marcar
 * lo MISMO (estado Hecho / Faltante de cada renglón); lo que se marca en una se ve
 * marcado en la otra:
 *  - Por artículo y caja: por caja (Mapeo de cajas) → SKU con el total de todos
 *    los locales. Tilde = todo el SKU hecho; desplegable con cada local y su
 *    cantidad, que también se tilda de a uno.
 *  - Por local: una tarjeta por local; adentro, sus SKU para tildar.
 * La repo diaria (lotes CASCADA) se acumula y aparece lunes y jueves.
 */
export default function TransferenciasIndo({
  mostrarVacio = false,
  alAbrir,
}: {
  mostrarVacio?: boolean
  alAbrir?: (abierto: boolean) => void
}) {
  const [todos, setTodos] = useState<Renglon[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [vista, setVista] = useState<'articulo' | 'local'>('articulo')
  const [busca, setBusca] = useState('')
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  const [localSel, setLocalSel] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(async () => {
    if (!supabase) return
    const { data, error: e } = await supabase.rpc('transferencias_deposito_items', { p_deposito: 'INDO' })
    if (e) setError(e.message)
    else { setError(null); setTodos((data ?? []) as Renglon[]) }
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
    const desuscribir = suscribirCambios(['transfer_items'], () => void cargar())
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') void cargar() }, 60_000)
    return () => { desuscribir(); window.clearInterval(id) }
  }, [cargar])

  // Repo diaria: lo de los días desde el último lunes/jueves se guarda para el próximo
  const corte = useMemo(() => ultimoCorte(), [])
  const { renglones, acumulando } = useMemo(() => {
    const vis: Renglon[] = []
    let acu = 0
    for (const r of todos) {
      if (esRepoDiaria(r) && diaRepo(r) >= corte) acu += r.estado === 'pendiente' ? r.cantidad : 0
      else vis.push(r)
    }
    return { renglones: vis, acumulando: acu }
  }, [todos, corte])

  const codigos = useMemo(() => renglones.map((r) => String(r.articulo ?? '')), [renglones])
  const cajas = useCajasMapeo(codigos)
  const cajaDe = useCallback((art: string | null) => cajas.get(norm(art))?.[0] ?? null, [cajas])

  const armarSkus = useCallback(
    (rs: Renglon[]): Sku[] => {
      const m = new Map<string, Sku>()
      for (const r of rs) {
        const k = claveSku(r)
        let s = m.get(k)
        if (!s) {
          s = {
            clave: k,
            articulo: norm(r.articulo),
            color: String(r.color ?? '').trim(),
            talle: String(r.talle ?? '').trim(),
            descripcion: String(r.descripcion ?? '').replace(/^\(\)\s*/, ''),
            caja: cajaDe(r.articulo),
            renglones: [],
            total: 0,
          }
          m.set(k, s)
        }
        s.renglones.push(r)
        s.total += r.cantidad
      }
      return [...m.values()].sort(
        (a, b) =>
          (a.caja != null && b.caja != null ? a.caja - b.caja : a.caja != null ? -1 : b.caja != null ? 1 : 0) ||
          a.articulo.localeCompare(b.articulo, 'es', { numeric: true }) ||
          a.color.localeCompare(b.color, 'es', { numeric: true }) ||
          compararTalles(a.talle, b.talle),
      )
    },
    [cajaDe],
  )

  const skus = useMemo(() => armarSkus(renglones), [armarSkus, renglones])

  const coincide = useCallback(
    (s: Sku, q: string) => {
      if (!q) return true
      const num = /^\d+$/.test(q) ? Number(q) : null
      return (num != null && s.caja === num) || `${s.articulo} ${s.color} ${s.talle} ${s.descripcion}`.toUpperCase().includes(q)
    },
    [],
  )
  const q = busca.trim().toUpperCase()

  const porCaja = useMemo(() => {
    const g: { caja: number | null; skus: Sku[] }[] = []
    for (const s of skus.filter((s) => coincide(s, q))) {
      const ult = g[g.length - 1]
      if (ult && ult.caja === s.caja) ult.skus.push(s)
      else g.push({ caja: s.caja, skus: [s] })
    }
    return g
  }, [skus, q, coincide])

  const resumen = useMemo(() => {
    const vivos = renglones.filter((r) => r.estado !== 'faltante')
    return {
      u: unidades(vivos),
      hechas: unidades(vivos.filter((r) => r.estado === 'hecho')),
      skus: skus.length,
      skusHechos: skus.filter((s) => estadoDe(s.renglones) !== 'pendiente').length,
    }
  }, [renglones, skus])

  /* ---------- Marcar (lo mismo desde las dos vistas) ---------- */
  async function marcar(ids: string[], estado: Estado) {
    if (!supabase || !ids.length) return
    const at = estado === 'pendiente' ? null : new Date().toISOString()
    setTodos((arr) => arr.map((r) => (ids.includes(r.id) ? { ...r, estado, hecho_at: at } : r)))
    setOcupado(true)
    const { error: e } = await supabase.rpc('transferencia_marcar_deposito', { p_ids: ids, p_estado: estado, p_deposito: 'INDO' })
    setOcupado(false)
    if (e) { setError(e.message); await cargar() } else setError(null)
  }
  /** Tilde de un grupo: si queda algo pendiente lo pasa a hecho; si ya está hecho, vuelve a pendiente */
  const tildar = (rs: Renglon[]) =>
    estadoDe(rs) === 'pendiente'
      ? marcar(rs.filter((r) => r.estado === 'pendiente').map((r) => r.id), 'hecho')
      : marcar(rs.filter((r) => r.estado === 'hecho').map((r) => r.id), 'pendiente')
  const faltar = (rs: Renglon[]) =>
    estadoDe(rs) === 'faltante'
      ? marcar(rs.map((r) => r.id), 'pendiente')
      : marcar(rs.filter((r) => r.estado === 'pendiente').map((r) => r.id), 'faltante')

  function alternar(clave: string) {
    setAbiertos((prev) => {
      const n = new Set(prev)
      if (n.has(clave)) n.delete(clave)
      else n.add(clave)
      return n
    })
  }

  /* ---------- Por local ---------- */
  const locales = useMemo(() => {
    const m = new Map<string, Renglon[]>()
    for (const r of renglones) m.set(r.destino, [...(m.get(r.destino) ?? []), r])
    return [...m.entries()]
      .map(([destino, rs]) => {
        const vivos = rs.filter((r) => r.estado !== 'faltante')
        return { destino, renglones: rs, total: unidades(vivos), hechas: unidades(vivos.filter((r) => r.estado === 'hecho')) }
      })
      .sort((a, b) => Number(a.hechas >= a.total) - Number(b.hechas >= b.total) || a.destino.localeCompare(b.destino, 'es'))
  }, [renglones])

  const localAbierto = vista === 'local' && localSel ? locales.find((l) => l.destino === localSel) ?? null : null

  useEffect(() => {
    alAbrir?.(!!localAbierto)
    return () => alAbrir?.(false)
  }, [localAbierto, alAbrir])

  const avisoCorte = acumulando > 0 && (
    <p className="flex items-start gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-400">
      <CalendarClock size={15} className="mt-px shrink-0" aria-hidden />
      <span>
        Repo diaria: se van juntando <b className="tabular-nums">{acumulando}</b> unidades para el{' '}
        <b>{fmtDia(proximoCorte(corte))}</b>. Depósito Indo la ve los lunes (viernes a domingo) y los jueves (lunes a miércoles).
      </span>
    </p>
  )

  if (cargando) {
    return (
      <div className="mb-4 flex items-center gap-2 text-sm text-sub">
        <Loader2 size={15} className="animate-spin" aria-hidden /> Cargando transferencias de Depósito Indo…
      </div>
    )
  }
  if (!renglones.length && !error) {
    if (!mostrarVacio && !acumulando) return null
    return (
      <div className="mb-5 space-y-2.5">
        {avisoCorte}
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line2 bg-surface/50 px-4 py-14 text-center text-sub">
          <ArrowRightLeft size={28} aria-hidden />
          <p>No hay transferencias pendientes que salgan de Depósito Indo.</p>
          <p className="text-xs">Cuando se cargue una, aparece acá.</p>
        </div>
      </div>
    )
  }

  const errorBox = error && (
    <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-500">{error}</p>
  )

  const buscador = (
    <div className="relative">
      <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" />
      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar artículo, color o caja…"
        aria-label="Buscar artículo, color o caja"
        autoComplete="off"
        className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-9 text-sm text-ink outline-none transition placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
      />
      {busca && (
        <button
          onClick={() => setBusca('')}
          aria-label="Limpiar búsqueda"
          className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-sub hover:bg-surface2 hover:text-ink"
        >
          <X size={15} aria-hidden />
        </button>
      )}
    </div>
  )

  /** Fila de un SKU (en las dos vistas): tilde, código, cantidad, ✕ */
  const filaSku = (s: Sku, extra?: React.ReactNode) => {
    const est = estadoDe(s.renglones)
    const listo = est !== 'pendiente'
    const pend = unidades(s.renglones.filter((r) => r.estado === 'pendiente'))
    return (
      <div className="flex items-center gap-2.5 px-3 py-2">
        {est === 'faltante' ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-600/15 text-red-500" title="Faltante">
            <X size={18} aria-hidden />
          </span>
        ) : (
          <Tilde on={est === 'hecho'} disabled={ocupado} label={est === 'hecho' ? 'Deshacer' : 'Marcar hecho'} onClick={() => void tildar(s.renglones)} />
        )}
        <button
          type="button"
          onClick={() => alternar(s.clave)}
          aria-expanded={abiertos.has(s.clave)}
          className={`min-w-0 flex-1 text-left ${listo ? 'opacity-55' : ''}`}
        >
          <span className="flex flex-wrap items-center gap-1.5">
            <span className={`text-[15px] font-semibold text-ink ${est === 'hecho' ? 'line-through' : ''}`}>{s.articulo}</span>
            {s.color && <Chip tono="color">{s.color}</Chip>}
            {s.talle && <Chip tono="talle">{fmtTalle(s.talle)}</Chip>}
            {extra}
          </span>
          {s.descripcion && <span className="block truncate text-xs text-sub">{s.descripcion}</span>}
        </button>
        <span
          className={`shrink-0 rounded-lg px-2 py-1 text-sm font-bold tabular-nums ${
            !listo && pend < s.total ? 'bg-amber-500/15 text-amber-500' : 'bg-line text-ink'
          }`}
          title={!listo && pend < s.total ? `Faltan ${pend} de ${s.total}` : undefined}
        >
          {!listo && pend < s.total ? `${s.total - pend}/${s.total}` : `×${s.total}`}
        </span>
        {est !== 'hecho' && <BotonFaltante faltante={est === 'faltante'} disabled={ocupado} onClick={() => void faltar(s.renglones)} />}
      </div>
    )
  }

  /* ---------- Por local: un local abierto ---------- */
  if (localAbierto) {
    const skusLocal = armarSkus(localAbierto.renglones).filter((s) => coincide(s, q))
    const pendientes = skusLocal.filter((s) => estadoDe(s.renglones) === 'pendiente')
    const listos = skusLocal.filter((s) => estadoDe(s.renglones) !== 'pendiente')
    const idsPend = pendientes.flatMap((s) => s.renglones.filter((r) => r.estado === 'pendiente').map((r) => r.id))
    const pct = localAbierto.total > 0 ? Math.round((localAbierto.hechas / localAbierto.total) * 100) : 100
    const porCajaLocal: { caja: number | null; skus: Sku[] }[] = []
    for (const s of pendientes) {
      const ult = porCajaLocal[porCajaLocal.length - 1]
      if (ult && ult.caja === s.caja) ult.skus.push(s)
      else porCajaLocal.push({ caja: s.caja, skus: [s] })
    }

    return (
      <div className="space-y-3 pb-4">
        <button
          onClick={() => setLocalSel(null)}
          className="-ml-1 inline-flex min-h-[2.5rem] items-center gap-1 px-1 text-sm font-medium text-sub transition hover:text-ink"
        >
          <ChevronRight size={16} aria-hidden className="rotate-180" /> Todos los locales
        </button>
        <div className="space-y-2 rounded-2xl border border-line bg-surface p-3 shadow-soft">
          <p className="flex items-center justify-between gap-2">
            <span className="font-display text-lg font-bold text-orange-500">{localAbierto.destino}</span>
            <span className="text-xs tabular-nums text-sub">{localAbierto.hechas} de {localAbierto.total} u. hechas</span>
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-line">
            <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-orange-500'}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
        {buscador}
        {errorBox}
        {porCajaLocal.map((g) => (
          <div key={g.caja ?? 'sin'} className="overflow-hidden rounded-xl border border-line bg-surface">
            <div className={`flex items-center justify-between border-b border-line px-3 py-2 ${g.caja === null ? 'bg-surface2' : 'bg-orange-500/10'}`}>
              <span className="flex items-center gap-1.5 font-display text-base font-bold text-ink">
                {g.caja === null ? 'Sin caja' : (<><Package size={16} className="text-orange-500" aria-hidden /> Caja {g.caja}</>)}
              </span>
              <span className="text-xs tabular-nums text-sub">{unidades(g.skus.flatMap((s) => s.renglones))} u.</span>
            </div>
            <ul className="divide-y divide-line/40">{g.skus.map((s) => <li key={s.clave}>{filaSku(s)}</li>)}</ul>
          </div>
        ))}
        {pendientes.length === 0 && !q && (
          <p className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center text-sm font-semibold text-emerald-400">
            ✓ Todo hecho para {localAbierto.destino}
          </p>
        )}
        {listos.length > 0 && (
          <section>
            <h3 className="mb-1.5 px-1 text-xs font-bold uppercase tracking-wide text-emerald-500">Listos ({listos.length})</h3>
            <ul className="divide-y divide-line/40 overflow-hidden rounded-xl border border-line bg-surface">
              {listos.map((s) => <li key={s.clave}>{filaSku(s)}</li>)}
            </ul>
          </section>
        )}
        {idsPend.length > 0 && !q && (
          <button
            onClick={() => void marcar(idsPend, 'hecho')}
            disabled={ocupado}
            className="btn-press ml-14 flex h-12 w-[calc(100%-3.5rem)] items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-base font-semibold text-white shadow-soft transition hover:bg-emerald-700 disabled:opacity-60 sm:ml-0 sm:w-full"
          >
            <Check size={18} aria-hidden /> Todo {localAbierto.destino}
          </button>
        )}
      </div>
    )
  }

  const pctT = resumen.u > 0 ? Math.round((resumen.hechas / resumen.u) * 100) : 0

  return (
    <section className="mb-5 space-y-2.5">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink">
        <ArrowRightLeft size={18} className="text-violet-500" aria-hidden /> Transferencias Depósito Indo
      </h2>
      {avisoCorte}

      <div className="grid grid-cols-2 gap-1.5" role="tablist">
        {(['articulo', 'local'] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={vista === v}
            onClick={() => setVista(v)}
            className={`btn-press h-10 rounded-xl border text-sm font-semibold transition ${
              vista === v ? 'border-orange-600 bg-orange-600 text-white' : 'border-line bg-surface text-sub hover:bg-surface2'
            }`}
          >
            {v === 'articulo' ? 'Por artículo y caja' : 'Por local'}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        <p className="flex flex-wrap gap-x-3 text-xs text-sub">
          <span><b className="tabular-nums text-ink">{resumen.skusHechos} de {resumen.skus}</b> SKU listos</span>
          <span><b className="tabular-nums text-ink">{resumen.hechas} de {resumen.u}</b> unidades hechas</span>
        </p>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
          <div className={`h-full rounded-full transition-all ${pctT === 100 ? 'bg-emerald-500' : 'bg-orange-500'}`} style={{ width: `${pctT}%` }} />
        </div>
      </div>
      {errorBox}

      {vista === 'articulo' ? (
        <>
          {buscador}
          {porCaja.length === 0 && (
            <p className="rounded-xl border border-line bg-surface px-4 py-8 text-center text-sm text-sub">Nada coincide con «{busca}».</p>
          )}
          {porCaja.map((g) => (
            <div key={g.caja ?? 'sin'} className="overflow-hidden rounded-xl border border-line bg-surface">
              <div className={`flex items-center justify-between border-b border-line px-3 py-2 ${g.caja === null ? 'bg-surface2' : 'bg-orange-500/10'}`}>
                <span className="flex items-center gap-1.5 font-display text-base font-bold text-ink">
                  {g.caja === null ? 'Sin caja' : (<><Package size={16} className="text-orange-500" aria-hidden /> Caja {g.caja}</>)}
                </span>
                <span className="text-xs tabular-nums text-sub">
                  {g.skus.length} SKU · {unidades(g.skus.flatMap((s) => s.renglones))} u.
                </span>
              </div>
              <ul className="divide-y divide-line/40">
                {g.skus.map((s) => {
                  const abierto = abiertos.has(s.clave)
                  const porLocal = new Map<string, Renglon[]>()
                  for (const r of s.renglones) porLocal.set(r.destino, [...(porLocal.get(r.destino) ?? []), r])
                  const listaLocales = [...porLocal.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'))
                  return (
                    <li key={s.clave} className={abierto ? 'bg-orange-500/[0.06]' : ''}>
                      <div className="flex items-center">
                        <div className="min-w-0 flex-1">{filaSku(s)}</div>
                        <button
                          type="button"
                          onClick={() => alternar(s.clave)}
                          aria-label={abierto ? 'Cerrar locales' : 'Ver locales'}
                          className="mr-2 flex h-9 w-7 shrink-0 items-center justify-center text-sub"
                        >
                          <ChevronRight size={18} aria-hidden className={`transition-transform ${abierto ? 'rotate-90 text-orange-500' : ''}`} />
                        </button>
                      </div>
                      {abierto && (
                        <div className="mb-2.5 ml-[3.25rem] mr-3 overflow-hidden rounded-lg border border-line bg-surface2">
                          {listaLocales.map(([dest, rs]) => {
                            const est = estadoDe(rs)
                            return (
                              <div key={dest} className="flex items-center gap-2.5 border-b border-line/50 px-2.5 py-1.5 text-sm last:border-b-0">
                                {est === 'faltante' ? (
                                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-600/15 text-red-500"><X size={16} aria-hidden /></span>
                                ) : (
                                  <Tilde chica on={est === 'hecho'} disabled={ocupado} label={`${dest}: ${est === 'hecho' ? 'deshacer' : 'hecho'}`} onClick={() => void tildar(rs)} />
                                )}
                                <span className={`min-w-0 flex-1 truncate text-ink ${est !== 'pendiente' ? 'opacity-55' : ''} ${est === 'hecho' ? 'line-through' : ''}`}>{dest}</span>
                                <b className="tabular-nums text-orange-500">{unidades(rs)}</b>
                                {est !== 'hecho' && <BotonFaltante chica faltante={est === 'faltante'} disabled={ocupado} onClick={() => void faltar(rs)} />}
                              </div>
                            )
                          })}
                          <div className="flex justify-between border-t border-line bg-white/[0.03] px-3 py-1.5 text-xs font-bold text-sub">
                            <span>{listaLocales.length} {listaLocales.length === 1 ? 'local' : 'locales'}</span>
                            <span>Total {s.total}</span>
                          </div>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </>
      ) : (
        <div className="space-y-2">
          {locales.map((l) => {
            const pct = l.total > 0 ? Math.round((l.hechas / l.total) * 100) : 100
            return (
              <button
                key={l.destino}
                onClick={() => { setLocalSel(l.destino); setBusca('') }}
                className="flex min-h-[4rem] w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left shadow-soft transition active:scale-[0.99] hover:bg-surface2"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center justify-between gap-2">
                    <span className="font-display font-semibold text-ink">{l.destino}</span>
                    <span className="text-xs tabular-nums text-sub">
                      {pct === 100 ? <span className="font-medium text-emerald-400">✓ Listo</span> : `${l.hechas} de ${l.total} u.`}
                    </span>
                  </p>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line">
                    <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-orange-500'}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <ChevronRight size={20} aria-hidden className="shrink-0 text-sub" />
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
