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
  /** el SKU ya se sacó de la caja (sql/transferencias_deposito_juntar.sql) */
  juntado_at?: string | null
}

/** Un SKU (artículo + color + talle) con todos sus renglones, de todos los locales y lotes */
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

const norm = (v: unknown) => String(v ?? '').trim().toUpperCase()
const claveSku = (r: Renglon) => `${norm(r.articulo)}|${norm(r.color)}|${norm(r.talle)}`
const fmtTalle = (t: string) => (/^\d+(\.0+)?$/.test(t) ? String(parseInt(t, 10)) : t)

const juntadoR = (r: Renglon) => r.estado === 'hecho' || !!r.juntado_at
const todosFaltante = (rs: Renglon[]) => rs.length > 0 && rs.every((r) => r.estado === 'faltante')
const todosJuntados = (rs: Renglon[]) => rs.some((r) => r.estado !== 'faltante') && rs.every((r) => r.estado === 'faltante' || juntadoR(r))
const unidades = (rs: Renglon[]) => rs.reduce((s, r) => s + r.cantidad, 0)

/* ---------- Repo diaria (lotes CASCADA): Indo la ve lunes y jueves ---------- */
const esRepoDiaria = (r: Renglon) => /CASCADA/i.test(r.lote_nombre ?? '')
const DIAS_CORTE = [1, 4] // lunes, jueves
/** Fin del último lunes/jueves (hoy incluido): lo de la repo diaria cargado después se va acumulando */
function finUltimoCorte(hoy = new Date()): Date {
  const d = new Date(hoy)
  d.setHours(0, 0, 0, 0)
  while (!DIAS_CORTE.includes(d.getDay())) d.setDate(d.getDate() - 1)
  d.setDate(d.getDate() + 1)
  return d
}
/** Próximo lunes/jueves después del corte vigente */
function proximoCorte(fin: Date): Date {
  const d = new Date(fin)
  while (!DIAS_CORTE.includes(d.getDay())) d.setDate(d.getDate() + 1)
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

function Tilde({ on, disabled, onClick, label }: { on: boolean; disabled?: boolean; onClick?: () => void; label: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={`btn-press flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-2 transition disabled:cursor-not-allowed ${
        on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-line2 bg-surface hover:border-emerald-500'
      } ${disabled && !on ? 'border-dashed opacity-50' : ''}`}
    >
      {on && <Check size={18} strokeWidth={3} aria-hidden />}
    </button>
  )
}

/**
 * Mi repo · Transferencias Depósito Indo en dos pasos (26/11/2026):
 *  1) Juntar: lista por caja (Mapeo de cajas) → SKU con el total de todos los
 *     locales; se tilda el SKU cuando se sacaron todas las unidades. Desplegable
 *     por SKU con cuánto va a cada local. ✕ = faltante (todo el SKU).
 *  2) Separar por local: una tarjeta por local; se tilda a mano lo que se le
 *     pone (queda Hecho). Lo que no se juntó todavía no se puede tildar.
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
  const [paso, setPaso] = useState<'juntar' | 'separar'>('juntar')
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

  // Repo diaria: lo cargado después del último lunes/jueves se guarda para el próximo
  const fin = useMemo(() => finUltimoCorte(), [])
  const { renglones, acumulando } = useMemo(() => {
    const vis: Renglon[] = []
    let acu = 0
    for (const r of todos) {
      if (esRepoDiaria(r) && new Date(r.lote_creado) >= fin) acu += r.estado === 'pendiente' ? r.cantidad : 0
      else vis.push(r)
    }
    return { renglones: vis, acumulando: acu }
  }, [todos, fin])

  const codigos = useMemo(() => renglones.map((r) => String(r.articulo ?? '')), [renglones])
  const cajas = useCajasMapeo(codigos)
  const cajaDe = useCallback((art: string | null) => cajas.get(norm(art))?.[0] ?? null, [cajas])

  const compararSku = useCallback(
    (a: { caja: number | null; articulo: string; color: string; talle: string }, b: typeof a) =>
      (a.caja != null && b.caja != null ? a.caja - b.caja : a.caja != null ? -1 : b.caja != null ? 1 : 0) ||
      a.articulo.localeCompare(b.articulo, 'es', { numeric: true }) ||
      a.color.localeCompare(b.color, 'es', { numeric: true }) ||
      compararTalles(a.talle, b.talle),
    [],
  )

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
      return [...m.values()].sort(compararSku)
    },
    [cajaDe, compararSku],
  )

  const skus = useMemo(() => armarSkus(renglones), [armarSkus, renglones])

  const filtrados = useMemo(() => {
    const q = busca.trim().toUpperCase()
    if (!q) return skus
    const num = /^\d+$/.test(q) ? Number(q) : null
    return skus.filter(
      (s) =>
        (num != null && s.caja === num) ||
        `${s.articulo} ${s.color} ${s.talle} ${s.descripcion}`.toUpperCase().includes(q),
    )
  }, [skus, busca])

  const porCaja = useMemo(() => {
    const g: { caja: number | null; skus: Sku[] }[] = []
    for (const s of filtrados) {
      const ult = g[g.length - 1]
      if (ult && ult.caja === s.caja) ult.skus.push(s)
      else g.push({ caja: s.caja, skus: [s] })
    }
    return g
  }, [filtrados])

  const resumen = useMemo(() => {
    const vivos = skus.filter((s) => !todosFaltante(s.renglones))
    const juntados = vivos.filter((s) => todosJuntados(s.renglones))
    return {
      skus: vivos.length,
      juntados: juntados.length,
      u: unidades(vivos.flatMap((s) => s.renglones.filter((r) => r.estado !== 'faltante'))),
      uJuntadas: unidades(juntados.flatMap((s) => s.renglones.filter((r) => r.estado !== 'faltante'))),
    }
  }, [skus])

  /* ---------- Acciones ---------- */
  async function juntar(s: Sku, juntado: boolean) {
    if (!supabase) return
    if (!juntado && s.renglones.some((r) => r.estado === 'hecho')) {
      setError(`${s.articulo} ${s.color} ${s.talle}: ya se separó en algún local. Destildalo primero en «Separar por local».`)
      return
    }
    const ids = s.renglones.filter((r) => r.estado !== 'faltante').map((r) => r.id)
    const at = juntado ? new Date().toISOString() : null
    setTodos((arr) => arr.map((r) => (ids.includes(r.id) ? { ...r, juntado_at: at } : r)))
    setOcupado(true)
    const { error: e } = await supabase.rpc('transferencia_juntar_deposito', { p_ids: ids, p_juntado: juntado, p_deposito: 'INDO' })
    setOcupado(false)
    if (e) { setError(e.message); await cargar() } else setError(null)
  }

  async function marcar(ids: string[], estado: 'pendiente' | 'hecho' | 'faltante') {
    if (!supabase || !ids.length) return
    const at = estado === 'pendiente' ? null : new Date().toISOString()
    setTodos((arr) => arr.map((r) => (ids.includes(r.id) ? { ...r, estado, hecho_at: at } : r)))
    setOcupado(true)
    const { error: e } = await supabase.rpc('transferencia_marcar_deposito', { p_ids: ids, p_estado: estado, p_deposito: 'INDO' })
    setOcupado(false)
    if (e) { setError(e.message); await cargar() } else setError(null)
  }

  function alternar(clave: string) {
    setAbiertos((prev) => {
      const n = new Set(prev)
      if (n.has(clave)) n.delete(clave)
      else n.add(clave)
      return n
    })
  }

  /* ---------- Separar: locales ---------- */
  const locales = useMemo(() => {
    const m = new Map<string, Renglon[]>()
    for (const r of renglones) m.set(r.destino, [...(m.get(r.destino) ?? []), r])
    return [...m.entries()]
      .map(([destino, rs]) => {
        const vivos = rs.filter((r) => r.estado !== 'faltante')
        return {
          destino,
          renglones: rs,
          total: unidades(vivos),
          separadas: unidades(vivos.filter((r) => r.estado === 'hecho')),
          paraSeparar: unidades(vivos.filter((r) => r.estado === 'pendiente' && r.juntado_at)),
        }
      })
      .sort((a, b) => Number(a.separadas >= a.total) - Number(b.separadas >= b.total) || a.destino.localeCompare(b.destino, 'es'))
  }, [renglones])

  const localAbierto = paso === 'separar' && localSel ? locales.find((l) => l.destino === localSel) ?? null : null

  useEffect(() => {
    alAbrir?.(!!localAbierto)
    return () => alAbrir?.(false)
  }, [localAbierto, alAbrir])

  const avisoCorte = acumulando > 0 && (
    <p className="flex items-start gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-400">
      <CalendarClock size={15} className="mt-px shrink-0" aria-hidden />
      <span>
        Repo diaria: se van juntando <b className="tabular-nums">{acumulando}</b> unidades para el{' '}
        <b>{fmtDia(proximoCorte(fin))}</b>. Depósito Indo la ve lunes y jueves.
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

  /* ---------- Separar: un local abierto ---------- */
  if (localAbierto) {
    const skusLocal = armarSkus(localAbierto.renglones)
    const paraSeparar = skusLocal.filter((s) => s.renglones.some((r) => r.estado === 'pendiente' && r.juntado_at))
    const sinJuntar = skusLocal.filter((s) => s.renglones.some((r) => r.estado === 'pendiente' && !r.juntado_at))
    const separados = skusLocal.filter((s) => s.renglones.some((r) => r.estado === 'hecho'))
    const faltantes = skusLocal.filter((s) => s.renglones.some((r) => r.estado === 'faltante'))
    const idsPara = paraSeparar.flatMap((s) => s.renglones.filter((r) => r.estado === 'pendiente' && r.juntado_at).map((r) => r.id))
    const pct = localAbierto.total > 0 ? Math.round((localAbierto.separadas / localAbierto.total) * 100) : 0

    const filaLocal = (s: Sku, tipo: 'para' | 'sin' | 'hecho' | 'faltante') => {
      const rs = s.renglones.filter((r) =>
        tipo === 'para' ? r.estado === 'pendiente' && r.juntado_at
          : tipo === 'sin' ? r.estado === 'pendiente' && !r.juntado_at
            : r.estado === tipo,
      )
      const ids = rs.map((r) => r.id)
      return (
        <li key={`${tipo}|${s.clave}`} className={`flex items-center gap-3 px-3 py-2 ${tipo === 'sin' || tipo === 'hecho' ? 'opacity-60' : ''}`}>
          {tipo === 'faltante' ? (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-600/15 text-red-500"><X size={18} aria-hidden /></span>
          ) : (
            <Tilde
              on={tipo === 'hecho'}
              disabled={ocupado || tipo === 'sin'}
              label={tipo === 'hecho' ? 'Deshacer separado' : tipo === 'sin' ? 'Todavía no se juntó' : 'Marcar separado'}
              onClick={() => void marcar(ids, tipo === 'hecho' ? 'pendiente' : 'hecho')}
            />
          )}
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-[15px] font-semibold text-ink">{s.articulo}</span>
              {s.color && <Chip tono="color">{s.color}</Chip>}
              {s.talle && <Chip tono="talle">{fmtTalle(s.talle)}</Chip>}
              {tipo === 'sin' && s.caja != null && <span className="text-[11px] text-sub">caja {s.caja}</span>}
            </span>
            {s.descripcion && <span className="block truncate text-xs text-sub">{s.descripcion}</span>}
          </span>
          <span className="shrink-0 font-display text-base font-bold tabular-nums text-ink">{unidades(rs)}</span>
          {tipo === 'faltante' && (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => void marcar(ids, 'pendiente')}
              title="Deshacer faltante"
              aria-label="Deshacer faltante"
              className="btn-press rounded-lg border border-line p-2 text-sub hover:bg-line"
            >
              <Undo2 size={15} aria-hidden />
            </button>
          )}
        </li>
      )
    }
    const bloque = (titulo: string, lista: Sku[], tipo: 'para' | 'sin' | 'hecho' | 'faltante', tono = 'text-sub') =>
      lista.length > 0 && (
        <section>
          <h3 className={`mb-1.5 px-1 text-xs font-bold uppercase tracking-wide ${tono}`}>
            {titulo} <span className="font-normal">({unidades(lista.flatMap((s) => s.renglones.filter((r) =>
              tipo === 'para' ? r.estado === 'pendiente' && r.juntado_at : tipo === 'sin' ? r.estado === 'pendiente' && !r.juntado_at : r.estado === tipo)))} u.)</span>
          </h3>
          <ul className="divide-y divide-line/40 overflow-hidden rounded-xl border border-line bg-surface">{lista.map((s) => filaLocal(s, tipo))}</ul>
        </section>
      )

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
            <span className="text-xs tabular-nums text-sub">{localAbierto.separadas} de {localAbierto.total} u. separadas</span>
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-line">
            <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-orange-500'}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
        {errorBox}
        {bloque('Juntado, para separar', paraSeparar, 'para', 'text-orange-500')}
        {paraSeparar.length === 0 && sinJuntar.length === 0 && (
          <p className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center text-sm font-semibold text-emerald-400">
            ✓ Todo separado para {localAbierto.destino}
          </p>
        )}
        {bloque('Todavía sin juntar', sinJuntar, 'sin')}
        {bloque('Separados', separados, 'hecho', 'text-emerald-500')}
        {bloque('Faltantes', faltantes, 'faltante', 'text-red-500')}
        {idsPara.length > 0 && (
          <button
            onClick={() => void marcar(idsPara, 'hecho')}
            disabled={ocupado}
            className="btn-press ml-14 flex h-12 w-[calc(100%-3.5rem)] items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-base font-semibold text-white shadow-soft transition hover:bg-emerald-700 disabled:opacity-60 sm:ml-0 sm:w-full"
          >
            <Check size={18} aria-hidden /> Todo lo juntado de {localAbierto.destino}
          </button>
        )}
      </div>
    )
  }

  const pctJ = resumen.u > 0 ? Math.round((resumen.uJuntadas / resumen.u) * 100) : 0

  return (
    <section className="mb-5 space-y-2.5">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink">
        <ArrowRightLeft size={18} className="text-violet-500" aria-hidden /> Transferencias Depósito Indo
      </h2>
      {avisoCorte}

      <div className="grid grid-cols-2 gap-1.5" role="tablist">
        {(['juntar', 'separar'] as const).map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={paso === p}
            onClick={() => setPaso(p)}
            className={`btn-press h-10 rounded-xl border text-sm font-semibold transition ${
              paso === p ? 'border-orange-600 bg-orange-600 text-white' : 'border-line bg-surface text-sub hover:bg-surface2'
            }`}
          >
            {p === 'juntar' ? '1 · Juntar' : '2 · Separar por local'}
          </button>
        ))}
      </div>
      {errorBox}

      {paso === 'juntar' ? (
        <>
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

          <div className="space-y-1.5">
            <p className="flex flex-wrap gap-x-3 text-xs text-sub">
              <span><b className="tabular-nums text-ink">{resumen.juntados} de {resumen.skus}</b> SKU juntados</span>
              <span><b className="tabular-nums text-ink">{resumen.uJuntadas} de {resumen.u}</b> unidades</span>
            </p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
              <div className={`h-full rounded-full transition-all ${pctJ === 100 ? 'bg-emerald-500' : 'bg-orange-500'}`} style={{ width: `${pctJ}%` }} />
            </div>
          </div>

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
                  const falt = todosFaltante(s.renglones)
                  const junt = !falt && todosJuntados(s.renglones)
                  const abierto = abiertos.has(s.clave)
                  const porLocal = new Map<string, Renglon[]>()
                  for (const r of s.renglones) porLocal.set(r.destino, [...(porLocal.get(r.destino) ?? []), r])
                  const listaLocales = [...porLocal.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'))
                  return (
                    <li key={s.clave} className={abierto ? 'bg-orange-500/[0.06]' : ''}>
                      <div className="flex items-center gap-2.5 px-3 py-2">
                        {falt ? (
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-600/15 text-red-500" title="Faltante">
                            <X size={18} aria-hidden />
                          </span>
                        ) : (
                          <Tilde on={junt} disabled={ocupado} label={junt ? 'Destildar' : 'Marcar juntado'} onClick={() => void juntar(s, !junt)} />
                        )}
                        <button
                          type="button"
                          onClick={() => alternar(s.clave)}
                          aria-expanded={abierto}
                          className={`min-w-0 flex-1 text-left ${junt || falt ? 'opacity-55' : ''}`}
                        >
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className={`text-[15px] font-semibold text-ink ${junt ? 'line-through' : ''}`}>{s.articulo}</span>
                            {s.color && <Chip tono="color">{s.color}</Chip>}
                            {s.talle && <Chip tono="talle">{fmtTalle(s.talle)}</Chip>}
                          </span>
                          {s.descripcion && <span className="block truncate text-xs text-sub">{s.descripcion}</span>}
                        </button>
                        <span className="shrink-0 rounded-lg bg-line px-2 py-1 text-sm font-bold tabular-nums text-ink">×{s.total}</span>
                        {falt ? (
                          <button
                            type="button"
                            disabled={ocupado}
                            onClick={() => void marcar(s.renglones.map((r) => r.id), 'pendiente')}
                            title="Deshacer faltante"
                            aria-label="Deshacer faltante"
                            className="btn-press rounded-lg border border-line p-2 text-sub hover:bg-line"
                          >
                            <Undo2 size={15} aria-hidden />
                          </button>
                        ) : (
                          !junt && (
                            <button
                              type="button"
                              disabled={ocupado}
                              onClick={() => void marcar(s.renglones.filter((r) => r.estado === 'pendiente').map((r) => r.id), 'faltante')}
                              title="Faltante (no está)"
                              aria-label="Marcar faltante"
                              className="btn-press rounded-lg bg-red-600 p-2 text-white hover:bg-red-700 disabled:opacity-60"
                            >
                              <X size={15} aria-hidden />
                            </button>
                          )
                        )}
                        <button
                          type="button"
                          onClick={() => alternar(s.clave)}
                          aria-label={abierto ? 'Cerrar locales' : 'Ver locales'}
                          className="flex h-9 w-7 shrink-0 items-center justify-center text-sub"
                        >
                          <ChevronRight size={18} aria-hidden className={`transition-transform ${abierto ? 'rotate-90 text-orange-500' : ''}`} />
                        </button>
                      </div>
                      {abierto && (
                        <div className="mb-2.5 ml-[3.25rem] mr-3 overflow-hidden rounded-lg border border-line bg-surface2">
                          {listaLocales.map(([dest, rs]) => {
                            const est = rs.every((r) => r.estado === 'hecho') ? 'hecho' : rs.every((r) => r.estado === 'faltante') ? 'faltante' : null
                            return (
                              <div key={dest} className="flex items-center justify-between border-b border-line/50 px-3 py-1.5 text-sm last:border-b-0">
                                <span className="text-ink">{dest}</span>
                                <span className="flex items-center gap-2">
                                  {est === 'hecho' && <span className="text-xs font-medium text-emerald-500">✓ separado</span>}
                                  {est === 'faltante' && <span className="text-xs font-medium text-red-500">✕ faltante</span>}
                                  <b className="tabular-nums text-orange-500">{unidades(rs)}</b>
                                </span>
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
            const pct = l.total > 0 ? Math.round((l.separadas / l.total) * 100) : 100
            return (
              <button
                key={l.destino}
                onClick={() => setLocalSel(l.destino)}
                className="flex min-h-[4rem] w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left shadow-soft transition active:scale-[0.99] hover:bg-surface2"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center justify-between gap-2">
                    <span className="font-display font-semibold text-ink">{l.destino}</span>
                    <span className="text-xs tabular-nums text-sub">
                      {pct === 100 ? <span className="font-medium text-emerald-400">✓ Listo</span> : `${l.separadas} de ${l.total} u.`}
                    </span>
                  </p>
                  {l.paraSeparar > 0 && (
                    <p className="mt-0.5 text-xs font-medium text-orange-500">{l.paraSeparar} u. juntadas para separar</p>
                  )}
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
