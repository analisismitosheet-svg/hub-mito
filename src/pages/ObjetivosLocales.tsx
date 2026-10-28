import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Loader2, RefreshCw, Target, TriangleAlert } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

/* ------------------------------------------------------------------ */
/*  Locales → Objetivos.                                                */
/*  Objetivo 2026 = venta 2025 del mismo día de la semana (fecha − 364) */
/*  × (1 + IPC del mes). Se arma solo apenas se carga el IPC del mes.   */
/*  CFR4 sale de CFR9: el domingo de cada semana se reparte entre       */
/*  lunes y sábado según lo que vendió cada día (domingo cerrado).      */
/*  Datos: sql/objetivos_locales.sql (RPC objetivos_locales_dia), venta */
/*  diaria que sube puente-sql/scripts/sync-ventas-locales.js.          */
/* ------------------------------------------------------------------ */

interface FilaObj { local: string; fecha: string; fecha_base: string; venta_base: number | null; ipc: number; objetivo: number | null; opera: boolean }
interface Ipc { anio: number; mes: number; pct: number }

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const DIAS = ['D', 'L', 'M', 'X', 'J', 'V', 'S']
const pesos = (n: number) => `$ ${Math.round(n).toLocaleString('es-AR')}`
/** 4.523.000 -> «4,5 M» (en las celdas del pivote; el número entero va en el title) */
const corto = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M` : `${Math.round(n / 1e3).toLocaleString('es-AR')} k`)
const pct = (n: number, dec = 1) => `${n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec })}%`
const dow = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay()
const diaMes = (iso: string) => Number(iso.slice(8, 10))
const ultimoDia = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate()
const iso = (a: number, m: number, d: number) => `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
/** lunes de la semana ISO */
const semanaIso = (f: string) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10) }

export default function ObjetivosLocales() {
  const { can, isAdmin } = useAuth()
  const puedeEditar = isAdmin || can('objetivos.edit')
  const [anio, setAnio] = useState(2026)
  const [ipcs, setIpcs] = useState<Ipc[]>([])
  const [mes, setMes] = useState<number | 'todos'>('todos')
  const [filas, setFilas] = useState<FilaObj[]>([])
  const [nombres, setNombres] = useState<Record<string, string>>({})
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [vista, setVista] = useState<'dias' | 'comparativo' | 'ipc'>('dias')
  const [guardando, setGuardando] = useState<number | null>(null)

  const mesesConIpc = useMemo(() => ipcs.filter((i) => i.anio === anio).map((i) => i.mes).sort((a, b) => a - b), [ipcs, anio])

  const cargarIpc = useCallback(async () => {
    if (!supabase) return
    const { data, error: e } = await supabase.from('ipc_mensual').select('anio,mes,pct').order('anio').order('mes')
    if (e) setError(e.message)
    setIpcs(((data as Ipc[] | null) ?? []).map((i) => ({ ...i, pct: Number(i.pct) })))
  }, [])

  useEffect(() => {
    void cargarIpc()
    if (supabase) void supabase.from('locales').select('codigo,nombre').then(({ data }) =>
      setNombres(Object.fromEntries(((data as { codigo: string; nombre: string | null }[] | null) ?? []).map((l) => [l.codigo, l.nombre ?? '']))))
  }, [cargarIpc])

  // Mes elegido: si deja de tener IPC (o cambia el año) vuelve a «todos»
  useEffect(() => { if (mes !== 'todos' && !mesesConIpc.includes(mes)) setMes(mesesConIpc[mesesConIpc.length - 1] ?? 'todos') }, [mesesConIpc, mes])

  const cargar = useCallback(async () => {
    if (!supabase) return
    if (!mesesConIpc.length) { setFilas([]); return }
    const m1 = mes === 'todos' ? mesesConIpc[0] : mes
    const m2 = mes === 'todos' ? mesesConIpc[mesesConIpc.length - 1] : mes
    setCargando(true)
    setError(null)
    const { data, error: e } = await supabase.rpc('objetivos_locales_dia', { p_desde: iso(anio, m1, 1), p_hasta: iso(anio, m2, ultimoDia(anio, m2)) })
    setCargando(false)
    if (e) { setError(e.message); return }
    setFilas(((data as FilaObj[] | null) ?? []).map((f) => ({ ...f, venta_base: f.venta_base == null ? null : Number(f.venta_base), objetivo: f.objetivo == null ? null : Number(f.objetivo), ipc: Number(f.ipc) })))
  }, [anio, mes, mesesConIpc])
  useEffect(() => { void cargar() }, [cargar])

  async function guardarIpc(m: number, valor: string) {
    if (!supabase || !puedeEditar) return
    const txt = valor.trim().replace(',', '.')
    const actual = ipcs.find((i) => i.anio === anio && i.mes === m)?.pct
    setGuardando(m)
    setError(null)
    const { error: e } = txt === ''
      ? await supabase.from('ipc_mensual').delete().eq('anio', anio).eq('mes', m)
      : Number.isFinite(Number(txt)) && Number(txt) !== actual
        ? await supabase.from('ipc_mensual').upsert({ anio, mes: m, pct: Number(txt), actualizado_at: new Date().toISOString() })
        : { error: null }
    setGuardando(null)
    if (e) setError(e.message)
    await cargarIpc()
  }

  /* ---------------- pivote ---------------- */
  const fechas = useMemo(() => [...new Set(filas.map((f) => f.fecha))].sort(), [filas])
  const locales = useMemo(() => {
    const tot = new Map<string, number>()
    for (const f of filas) tot.set(f.local, (tot.get(f.local) ?? 0) + (f.objetivo ?? 0))
    return [...tot.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l)
  }, [filas])
  const celda = useMemo(() => new Map(filas.map((f) => [`${f.local}|${f.fecha}`, f])), [filas])
  const totLocal = (l: string, campo: 'objetivo' | 'venta_base') => filas.reduce((s, f) => (f.local === l ? s + (f[campo] ?? 0) : s), 0)
  const totFecha = (d: string) => filas.reduce((s, f) => (f.fecha === d ? s + (f.objetivo ?? 0) : s), 0)
  const totGeneral = filas.reduce((s, f) => s + (f.objetivo ?? 0), 0)
  const baseGeneral = filas.reduce((s, f) => s + (f.venta_base ?? 0), 0)

  /** escala de color por local: del día más flojo (claro) al más fuerte (verde intenso) */
  const escala = useMemo(() => {
    const m = new Map<string, { min: number; max: number }>()
    for (const f of filas) {
      if (!f.opera || f.objetivo == null) continue
      const e = m.get(f.local) ?? { min: Infinity, max: -Infinity }
      e.min = Math.min(e.min, f.objetivo); e.max = Math.max(e.max, f.objetivo)
      m.set(f.local, e)
    }
    return m
  }, [filas])
  const fondo = (f: FilaObj | undefined) => {
    if (!f || !f.opera || f.objetivo == null) return 'rgba(148,163,184,.14)'
    const e = escala.get(f.local)
    const t = e && e.max > e.min ? (f.objetivo - e.min) / (e.max - e.min) : 0.5
    return `rgba(16,185,129,${(0.08 + t * 0.5).toFixed(2)})`
  }

  /* ---------------- controles ---------------- */
  const controles = useMemo(() => {
    const dowMal = filas.filter((f) => dow(f.fecha) !== dow(f.fecha_base)).length
    const ratioMal = filas.filter((f) => f.opera && f.venta_base && Math.abs((f.objetivo ?? 0) / f.venta_base - (1 + f.ipc / 100)) > 1e-4).length
    // CFR9 vs CFR4: solo semanas ISO enteras dentro del rango base
    const porSemana = new Map<string, { dias: number; cfr9: number; cfr4: number }>()
    for (const f of filas) {
      if (f.local !== 'CFR9' && f.local !== 'CFR4') continue
      const s = semanaIso(f.fecha_base)
      const x = porSemana.get(s) ?? { dias: 0, cfr9: 0, cfr4: 0 }
      if (f.local === 'CFR9') { x.dias++; x.cfr9 += f.venta_base ?? 0 } else x.cfr4 += f.venta_base ?? 0
      porSemana.set(s, x)
    }
    const enteras = [...porSemana.values()].filter((x) => x.dias === 7)
    const t9 = enteras.reduce((s, x) => s + x.cfr9, 0)
    const t4 = enteras.reduce((s, x) => s + x.cfr4, 0)
    return { dowMal, ratioMal, semanas: enteras.length, t9, t4, okCfr: enteras.length > 0 && Math.abs(t9 - t4) < 1 }
  }, [filas])

  const nom = (l: string) => nombres[l] || l
  const thSub = 'px-1.5 py-1 text-[10px] font-semibold text-sub'

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2 flex flex-wrap items-center gap-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <Target size={22} className="text-lime-500" aria-hidden /> Objetivos
        </h1>
        <span className="text-xs text-sub/70">Venta 2025 del mismo día de la semana × (1 + IPC del mes)</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs text-ink">
            {[2026, 2027].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          {vista !== 'ipc' && (
            <select value={mes} onChange={(e) => setMes(e.target.value === 'todos' ? 'todos' : Number(e.target.value))} disabled={!mesesConIpc.length}
              className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs text-ink disabled:opacity-50">
              <option value="todos">Todos los meses con IPC</option>
              {mesesConIpc.map((m) => <option key={m} value={m}>{MESES[m - 1]} {anio}</option>)}
            </select>
          )}
          <button onClick={() => void cargar()} className="btn-press inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface2 px-2.5 text-xs font-medium text-ink hover:bg-line">
            <RefreshCw size={13} className={cargando ? 'animate-spin' : ''} aria-hidden /> Actualizar
          </button>
        </div>
      </header>

      <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="Vistas">
        {([['dias', 'Objetivos por día'], ['comparativo', 'Comparativo por local'], ['ipc', 'IPC mensual']] as const).map(([v, t]) => (
          <button key={v} onClick={() => setVista(v)} aria-pressed={vista === v}
            className={`h-9 rounded-xl px-3 text-sm font-medium transition ${vista === v ? 'bg-brand-600 text-white' : 'border border-line bg-surface text-ink hover:bg-surface2'}`}>{t}</button>
        ))}
      </nav>

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      {vista !== 'ipc' && !mesesConIpc.length && (
        <div className="rounded-2xl border border-line bg-surface p-4 text-sm text-sub">
          Todavía no hay IPC cargado para {anio}. Cargalo en <button onClick={() => setVista('ipc')} className="font-semibold text-brand-400 underline">IPC mensual</button> y el objetivo de ese mes se arma solo.
        </div>
      )}

      {/* ---------------- Objetivos por día ---------------- */}
      {vista === 'dias' && mesesConIpc.length > 0 && (
        cargando && !filas.length ? (
          <p className="flex items-center gap-2 py-10 text-sub"><Loader2 size={16} className="animate-spin" aria-hidden /> Calculando…</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="border-collapse text-[11.5px] tabular-nums">
              <thead>
                <tr className="bg-surface2">
                  <th rowSpan={2} className="sticky left-0 z-10 bg-surface2 px-3 py-2 text-left text-[11px] uppercase tracking-wide text-sub">Local</th>
                  {fechas.map((d) => (
                    <th key={d} className={`px-1.5 pt-2 text-center text-[11px] font-semibold ${diaMes(d) === 1 ? 'border-l-2 border-line2' : ''} ${dow(d) === 0 ? 'text-amber-400' : 'text-ink'}`}>
                      {diaMes(d) === 1 || d === fechas[0] ? `${diaMes(d)}/${d.slice(5, 7)}` : diaMes(d)}
                    </th>
                  ))}
                  <th rowSpan={2} className="px-3 py-2 text-right text-[11px] uppercase tracking-wide text-sub">Total</th>
                </tr>
                <tr className="bg-surface2">
                  {fechas.map((d) => <th key={d} className={`${thSub} text-center ${dow(d) === 0 ? 'text-amber-400' : ''}`}>{DIAS[dow(d)]}</th>)}
                </tr>
              </thead>
              <tbody>
                {locales.map((l) => (
                  <tr key={l} className="border-t border-line">
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-paper px-3 py-1.5 font-medium text-ink">{nom(l)}</td>
                    {fechas.map((d) => {
                      const f = celda.get(`${l}|${d}`)
                      return (
                        <td key={d} title={f?.opera ? `${nom(l)} · ${d}\nObjetivo ${pesos(f.objetivo ?? 0)}\nVenta ${f.fecha_base}: ${pesos(f.venta_base ?? 0)} · IPC ${pct(f.ipc)}` : `${nom(l)} · ${d}: no opera`}
                          style={{ background: fondo(f) }}
                          className={`min-w-[46px] px-1.5 py-1.5 text-right ${diaMes(d) === 1 ? 'border-l-2 border-line2' : ''} ${f?.opera ? 'text-ink' : 'text-sub/50'}`}>
                          {f?.opera && f.objetivo != null ? corto(f.objetivo) : ''}
                        </td>
                      )
                    })}
                    <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold text-ink">{pesos(totLocal(l, 'objetivo'))}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-line2 bg-surface2 font-semibold">
                  <td className="sticky left-0 z-10 bg-surface2 px-3 py-1.5 text-ink">Total</td>
                  {fechas.map((d) => <td key={d} className={`px-1.5 py-1.5 text-right text-ink ${diaMes(d) === 1 ? 'border-l-2 border-line2' : ''}`} title={pesos(totFecha(d))}>{corto(totFecha(d))}</td>)}
                  <td className="whitespace-nowrap px-3 py-1.5 text-right text-lime-400">{pesos(totGeneral)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )
      )}
      {vista === 'dias' && mesesConIpc.length > 0 && (
        <p className="mt-2 text-[11px] text-sub">Celdas en millones (M) o miles (k); pasá el mouse para ver el número entero, la fecha de 2025 que se usó y el IPC. Más verde = día más fuerte de ese local. Gris = el local no operó ese día base (CFR4 cierra los domingos).</p>
      )}

      {/* ---------------- Comparativo ---------------- */}
      {vista === 'comparativo' && mesesConIpc.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface p-4">
          <p className="mb-2 text-xs text-sub">
            {mes === 'todos' ? `Meses con IPC de ${anio}: ${mesesConIpc.map((m) => MESES[m - 1]).join(', ')}` : `${MESES[mes - 1]} ${anio}`} · venta 2025 corrida 364 días (mismo día de la semana)
          </p>
          <table className="w-full text-sm tabular-nums">
            <thead className="text-left text-[11px] uppercase tracking-wider text-sub/70">
              <tr>
                <th className="py-1.5 pr-3">Local</th>
                <th className="py-1.5 pr-3 text-right">Venta 2025 (mapeada)</th>
                <th className="py-1.5 pr-3 text-right">Objetivo {anio}</th>
                <th className="py-1.5 text-right">% aumento</th>
              </tr>
            </thead>
            <tbody>
              {locales.map((l) => {
                const b = totLocal(l, 'venta_base'), o = totLocal(l, 'objetivo')
                return (
                  <tr key={l} className="border-t border-line">
                    <td className="py-1.5 pr-3 font-medium text-ink">{nom(l)} <span className="text-xs font-normal text-sub">{l}{l === 'CFR4' ? ' · desde CFR9' : ''}</span></td>
                    <td className="py-1.5 pr-3 text-right text-sub">{pesos(b)}</td>
                    <td className="py-1.5 pr-3 text-right font-semibold text-ink">{pesos(o)}</td>
                    <td className="py-1.5 text-right text-lime-400">{b ? pct(100 * (o / b - 1)) : '—'}</td>
                  </tr>
                )
              })}
              <tr className="border-t-2 border-line2 font-semibold">
                <td className="py-1.5 pr-3 text-ink">Total</td>
                <td className="py-1.5 pr-3 text-right text-sub">{pesos(baseGeneral)}</td>
                <td className="py-1.5 pr-3 text-right text-ink">{pesos(totGeneral)}</td>
                <td className="py-1.5 text-right text-lime-400">{baseGeneral ? pct(100 * (totGeneral / baseGeneral - 1)) : '—'}</td>
              </tr>
            </tbody>
          </table>

          {/* Controles de la cuenta */}
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            <Control ok={controles.dowMal === 0} titulo="Mismo día de la semana" texto={controles.dowMal === 0 ? `Las ${fechas.length} fechas caen el mismo día que en 2025.` : `${controles.dowMal} fechas no coinciden.`} />
            <Control ok={controles.okCfr} titulo="CFR9 = CFR4 (redistribuido)"
              texto={controles.semanas ? `${controles.semanas} semanas enteras: CFR9 ${pesos(controles.t9)} · CFR4 ${pesos(controles.t4)}.` : 'No hay semanas enteras en el rango para comparar.'} />
            <Control ok={controles.ratioMal === 0} titulo="Objetivo / venta = 1 + IPC" texto={controles.ratioMal === 0 ? 'Todas las celdas dan exacto.' : `${controles.ratioMal} celdas no dan.`} />
          </div>
        </div>
      )}

      {/* ---------------- IPC ---------------- */}
      {vista === 'ipc' && (
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="mb-3 text-sm text-sub">
            Cargá el IPC (%) de cada mes de {anio}. Apenas se guarda, el objetivo de ese mes se arma solo con la venta de {anio - 1} del mismo día de la semana.
            {!puedeEditar && <b className="text-amber-400"> Solo lectura: falta el permiso «Cargar el IPC de los objetivos».</b>}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
            {MESES.map((n, i) => {
              const v = ipcs.find((x) => x.anio === anio && x.mes === i + 1)?.pct
              return (
                <label key={n} className="rounded-xl border border-line bg-paper p-2">
                  <span className="block text-[11px] font-semibold uppercase tracking-wide text-sub">{n}</span>
                  <span className="mt-1 flex items-center gap-1">
                    <input key={`${anio}-${i}-${v ?? ''}`} defaultValue={v ?? ''} disabled={!puedeEditar} inputMode="decimal" placeholder="—"
                      onBlur={(e) => void guardarIpc(i + 1, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      className="h-9 w-full rounded-lg border border-line2 bg-surface2 px-2 text-right text-sm text-ink disabled:opacity-60" />
                    <span className="text-sm text-sub">%</span>
                    {guardando === i + 1 && <Loader2 size={13} className="animate-spin text-sub" aria-hidden />}
                  </span>
                  <span className={`mt-1 block text-[11px] ${v != null ? 'text-lime-400' : 'text-sub/60'}`}>{v != null ? 'objetivo armado' : 'sin IPC'}</span>
                </label>
              )
            })}
          </div>
        </div>
      )}
    </Layout>
  )
}

function Control({ ok, titulo, texto }: { ok: boolean; titulo: string; texto: string }) {
  return (
    <div className={`rounded-xl border p-3 text-xs ${ok ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/10'}`}>
      <p className={`flex items-center gap-1.5 font-semibold ${ok ? 'text-emerald-400' : 'text-amber-400'}`}>
        {ok ? <CheckCircle2 size={14} aria-hidden /> : <TriangleAlert size={14} aria-hidden />} {titulo}
      </p>
      <p className="mt-1 text-sub">{texto}</p>
    </div>
  )
}
