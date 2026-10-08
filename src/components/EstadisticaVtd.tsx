import { useCallback, useEffect, useMemo, useState } from 'react'
import { BarChart3, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'

/* ------------------------------------------------------------------ */
/*  Estadística VTD (repos), dentro de Eficiencia mayorista: como la    */
/*  planilla de reposición, armada                                       */
/*  sola con la repo y lo que se hace en Mi repo.                       */
/*  - Hoy: la repo del día (◀ ▶ para otros días) + cuadro por local.    */
/*  - Por semana: una fila por repo de lunes a domingo + por local.     */
/*  Horas = cronómetro de Mi repo (sin pausas). HS x per = esas horas;  */
/*  Horas = HS x per ÷ personas; Prendas/HS = repo ÷ HS x per.          */
/*  Datos: RPC estadistica_vtd (sql/estadistica_vtd.sql).               */
/* ------------------------------------------------------------------ */

interface Fila {
  lote_id: string
  fecha: string
  venta_fecha: string | null
  lote_nombre: string | null
  lote_estado: string | null
  local: string
  venta: number
  repo: number
  faltante: number
  segundos: number
  uni_crono: number
  responsable: string | null
  responsable_id: string | null
}

interface Repo {
  loteId: string
  fecha: string
  ventaFecha: string | null
  nombre: string
  finalizada: boolean
  locales: number
  venta: number
  repo: number
  noMandados: number
  segundos: number
  uniCrono: number
  personas: number
}

interface PorLocal {
  local: string
  responsable: string
  venta: number
  repo: number
  noMandados: number
  segundos: number
  uniCrono: number
}

const n0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const n2 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num2 = (v: number | null) => (v == null || !isFinite(v) ? '—' : n2.format(v))

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const deIso = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const sumarDias = (s: string, n: number) => { const d = deIso(s); d.setDate(d.getDate() + n); return iso(d) }
const lunesDe = (s: string) => { const d = deIso(s); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return iso(d) }
/** Fecha completa dd/mm/aaaa */
const corta = (s: string | null) => { if (!s) return '—'; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}` }
const nombreCorto = (n: string | null) => {
  if (!n) return '—'
  const p = n.trim().split(/\s+/)
  return p[0] ? p[0].charAt(0) + p[0].slice(1).toLowerCase() : n
}

/** Lo no mandado: si la repo terminó, todo lo que no salió; si no, lo marcado como faltante. */
const noMandadosDe = (f: Fila) => (f.lote_estado === 'finalizado' ? Math.max(0, f.venta - f.repo) : f.faltante)

function agruparRepos(filas: Fila[]): Repo[] {
  const m = new Map<string, Repo & { resp: Set<string> }>()
  for (const f of filas) {
    let r = m.get(f.lote_id)
    if (!r) {
      r = {
        loteId: f.lote_id, fecha: f.fecha, ventaFecha: f.venta_fecha, nombre: f.lote_nombre ?? '',
        finalizada: f.lote_estado === 'finalizado', locales: 0, venta: 0, repo: 0, noMandados: 0, segundos: 0, uniCrono: 0, personas: 0, resp: new Set(),
      }
      m.set(f.lote_id, r)
    }
    r.locales++
    r.venta += f.venta
    r.repo += f.repo
    r.noMandados += noMandadosDe(f)
    r.segundos += f.segundos
    r.uniCrono += f.uni_crono
    if (f.responsable_id) r.resp.add(f.responsable_id)
  }
  return [...m.values()].map(({ resp, ...r }) => ({ ...r, personas: resp.size })).sort((a, b) => a.fecha.localeCompare(b.fecha))
}

function agruparLocales(filas: Fila[]): PorLocal[] {
  const m = new Map<string, PorLocal & { resp: Set<string> }>()
  for (const f of filas) {
    let r = m.get(f.local)
    if (!r) { r = { local: f.local, responsable: '', venta: 0, repo: 0, noMandados: 0, segundos: 0, uniCrono: 0, resp: new Set() }; m.set(f.local, r) }
    r.venta += f.venta
    r.repo += f.repo
    r.noMandados += noMandadosDe(f)
    r.segundos += f.segundos
    r.uniCrono += f.uni_crono
    if (f.responsable) r.resp.add(nombreCorto(f.responsable))
  }
  return [...m.values()].map(({ resp, ...r }) => ({ ...r, responsable: [...resp].join(', ') || '—' })).sort((a, b) => b.venta - a.venta)
}

const horasPer = (r: { segundos: number }) => (r.segundos > 0 ? r.segundos / 3600 : null)
/** Prendas por hora: solo lo escaneado con el cronómetro en marcha, dividido esas horas */
const prendasHs = (r: { segundos: number; uniCrono: number }) => (r.segundos > 0 ? r.uniCrono / (r.segundos / 3600) : null)

function Dif({ a, b }: { a: number; b: number }) {
  if (!b) return null
  const p = Math.round(((a - b) / b) * 100)
  return <span className={p >= 0 ? 'text-emerald-500' : 'text-red-400'}>{p >= 0 ? '▲' : '▼'} {Math.abs(p)}%</span>
}

function Kpi({ titulo, color, valor, pie }: { titulo: string; color: string; valor: string; pie: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border bg-surface p-3" style={{ borderColor: `${color}40` }}>
      <p className="truncate text-[10px] font-bold uppercase tracking-wide" style={{ color }}>{titulo}</p>
      <p className="font-display text-2xl font-extrabold tabular-nums text-ink">{valor}</p>
      <p className="truncate text-[11px] text-sub">{pie}</p>
    </div>
  )
}

export default function EstadisticaVtd() {
  const hoy = iso(new Date())
  const [modo, setModo] = useState<'dia' | 'semana'>('dia')
  const [dia, setDia] = useState(hoy)
  const [filas, setFilas] = useState<Fila[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Se piden las dos semanas que hacen falta para comparar (la del día elegido y la anterior)
  const lunes = lunesDe(dia)
  const desde = sumarDias(lunes, -7)
  const hasta = sumarDias(lunes, 6)

  const cargar = useCallback(async () => {
    if (!supabase) return
    setCargando(true)
    setError(null)
    const { data, error: e } = await supabase.rpc('estadistica_vtd', { p_desde: desde, p_hasta: hasta })
    if (e) setError(e.message)
    else setFilas(((data as Fila[] | null) ?? []).map((f) => ({ ...f, venta: Number(f.venta) || 0, repo: Number(f.repo) || 0, faltante: Number(f.faltante) || 0, segundos: Number(f.segundos) || 0, uni_crono: Number(f.uni_crono) || 0 })))
    setCargando(false)
  }, [desde, hasta])
  useEffect(() => { void cargar() }, [cargar])

  const repos = useMemo(() => agruparRepos(filas), [filas])
  // Día: la repo de esa fecha (si no hubo, la última anterior dentro de lo cargado)
  const repoDia = useMemo(() => [...repos].reverse().find((r) => r.fecha <= dia) ?? null, [repos, dia])
  const repoAnt = useMemo(() => (repoDia ? [...repos].reverse().find((r) => r.fecha < repoDia.fecha) ?? null : null), [repos, repoDia])
  const semana = useMemo(() => repos.filter((r) => r.fecha >= lunes && r.fecha <= hasta), [repos, lunes, hasta])
  const semanaAnt = useMemo(() => repos.filter((r) => r.fecha < lunes), [repos, lunes])

  const filasLocal = useMemo(
    () => agruparLocales(modo === 'dia' ? filas.filter((f) => f.lote_id === repoDia?.loteId) : filas.filter((f) => f.fecha >= lunes)),
    [filas, modo, repoDia, lunes],
  )

  const suma = (rs: Repo[]) => rs.reduce(
    (s, r) => ({ venta: s.venta + r.venta, repo: s.repo + r.repo, noMandados: s.noMandados + r.noMandados, segundos: s.segundos + r.segundos, uniCrono: s.uniCrono + r.uniCrono }),
    { venta: 0, repo: 0, noMandados: 0, segundos: 0, uniCrono: 0 },
  )
  const tot = modo === 'dia' ? (repoDia ?? suma([])) : suma(semana)
  const totAnt = modo === 'dia' ? (repoAnt ?? suma([])) : suma(semanaAnt)
  const conHoras = semana.filter((r) => r.segundos > 0)
  const promHoras = conHoras.length ? conHoras.reduce((s, r) => s + r.segundos / 3600 / Math.max(1, r.personas), 0) / conHoras.length : null
  const promPph = conHoras.length ? conHoras.reduce((s, r) => s + (prendasHs(r) ?? 0), 0) / conHoras.length : null

  const mover = (n: number) => setDia((d) => {
    const nuevo = sumarDias(d, modo === 'dia' ? n : n * 7)
    return nuevo > hoy ? hoy : nuevo
  })
  const etiqueta =
    modo === 'dia'
      ? repoDia
        ? `${repoDia.fecha === hoy ? 'Hoy · ' : ''}Repo del ${corta(repoDia.fecha)}${repoDia.ventaFecha ? ` (venta ${corta(repoDia.ventaFecha)})` : ''}`
        : `Sin repo al ${corta(dia)}`
      : `Semana ${corta(lunes)} – ${corta(hasta)}`
  const vsTxt = modo === 'dia' ? 'vs repo anterior' : 'vs semana anterior'
  const hpTot = horasPer(tot)

  return (
    <section className="mb-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="rounded-xl border p-2" style={{ color: '#0ea5e9', backgroundColor: '#0ea5e924', borderColor: '#0ea5e940' }}>
            <BarChart3 size={18} aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold text-ink">Estadística VTD (repos)</h2>
            <p className="truncate text-sm text-sub">Repos por día y por semana, con lo hecho en Mi repo</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1 rounded-xl border border-line bg-surface px-1 py-1">
            <button type="button" onClick={() => mover(-1)} className="rounded-lg p-1.5 text-ink hover:bg-line" aria-label="Anterior"><ChevronLeft size={16} /></button>
            <span className="min-w-[9.5rem] max-w-[15rem] text-center leading-tight text-xs font-semibold text-ink">{etiqueta}</span>
            <button type="button" onClick={() => mover(1)} disabled={dia >= hoy} className="rounded-lg p-1.5 text-ink hover:bg-line disabled:opacity-30" aria-label="Siguiente"><ChevronRight size={16} /></button>
          </div>
          <div className="inline-flex overflow-hidden rounded-xl border border-line">
            {(['dia', 'semana'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setModo(m); if (m === 'dia') setDia(hoy) }}
                className={`px-4 py-2 text-sm font-bold ${modo === m ? 'bg-sky-500/15 text-sky-400' : 'text-sub hover:text-ink'}`}
              >
                {m === 'dia' ? 'Hoy' : 'Por semana'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}
      {cargando && filas.length === 0 ? (
        <p className="flex items-center gap-2 py-10 text-sm text-sub"><Loader2 size={16} className="animate-spin" /> Cargando…</p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2.5 md:grid-cols-5">
            <Kpi titulo="Cant venta" color="#22c55e" valor={n0.format(tot.venta)} pie={<><Dif a={tot.venta} b={totAnt.venta} /> {vsTxt}</>} />
            <Kpi titulo="Cant repo" color="#38bdf8" valor={n0.format(tot.repo)} pie={tot.venta ? `${Math.round((tot.repo / tot.venta) * 100)}% de la venta` : '—'} />
            <Kpi titulo="No mandados" color="#f87171" valor={n0.format(tot.noMandados)} pie={tot.venta ? `${n2.format((tot.noMandados / tot.venta) * 100)}% de la venta` : '—'} />
            <Kpi titulo="HS x per (Mi repo)" color="#a78bfa" valor={num2(hpTot)} pie={hpTot ? `${num2(prendasHs(tot))} prendas/HS` : 'nadie usó el cronómetro'} />
            <Kpi
              titulo={modo === 'dia' ? 'Personas' : 'Repos'}
              color="#f59e0b"
              valor={String(modo === 'dia' ? (repoDia?.personas ?? 0) : semana.length)}
              pie={modo === 'dia' ? 'responsables de la repo' : 'en la semana'}
            />
          </div>

          {modo === 'semana' && (
            <section className="mb-4 rounded-2xl border border-line bg-surface p-3">
              <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-sub">Repos de la semana</h2>
              <table className="w-full table-fixed text-[12px] sm:text-[13px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-sub">
                    <th className="w-[23%] sm:w-[14%] py-1.5 text-left">Repo</th>
                    <th className="hidden py-1.5 md:table-cell">Venta</th>
                    <th className="py-1.5 text-right">Cant venta</th>
                    <th className="py-1.5 text-right">Cant repo</th>
                    <th className="py-1.5 text-right">No mand.</th>
                    <th className="hidden py-1.5 text-right lg:table-cell">Locales</th>
                    <th className="py-1.5 text-right"><span className="block text-[12px] font-extrabold normal-case text-amber-500">{num2(promHoras)}</span>Horas</th>
                    <th className="hidden py-1.5 text-right sm:table-cell">Pers.</th>
                    <th className="hidden py-1.5 text-right md:table-cell">HS x per</th>
                    <th className="py-1.5 text-right"><span className="block text-[12px] font-extrabold normal-case text-amber-500">{num2(promPph)}</span>Prend/HS</th>
                    <th className="hidden py-1.5 text-right sm:table-cell">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {semana.map((r) => {
                    const hp = horasPer(r)
                    return (
                      <tr key={r.loteId} onClick={() => { setModo('dia'); setDia(r.fecha) }} className="cursor-pointer border-t border-line hover:bg-line/30" title={r.nombre}>
                        <td className="truncate py-1.5 font-semibold text-ink">{corta(r.fecha)}</td>
                        <td className="hidden truncate py-1.5 text-center text-sub md:table-cell">{corta(r.ventaFecha)}</td>
                        <td className="py-1.5 text-right font-bold tabular-nums text-emerald-500">{n0.format(r.venta)}</td>
                        <td className="py-1.5 text-right tabular-nums text-ink">{n0.format(r.repo)}</td>
                        <td className="py-1.5 text-right font-semibold tabular-nums text-red-400">{n0.format(r.noMandados)}</td>
                        <td className="hidden py-1.5 text-right tabular-nums lg:table-cell">{r.locales}</td>
                        <td className="py-1.5 text-right tabular-nums">{hp ? num2(hp / Math.max(1, r.personas)) : '—'}</td>
                        <td className="hidden py-1.5 text-right tabular-nums sm:table-cell">{r.personas}</td>
                        <td className="hidden py-1.5 text-right tabular-nums md:table-cell">{num2(hp)}</td>
                        <td className="py-1.5 text-right font-bold tabular-nums">{num2(prendasHs(r))}</td>
                        <td className="hidden py-1.5 text-right sm:table-cell">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${r.finalizada ? 'bg-emerald-500/15 text-emerald-500' : 'bg-amber-500/15 text-amber-500'}`}>
                            {r.finalizada ? 'FINALIZADA' : 'EN PROCESO'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                  {semana.length === 0 && (
                    <tr><td colSpan={11} className="py-4 text-center text-sub">No hay repos en esta semana.</td></tr>
                  )}
                </tbody>
              </table>
            </section>
          )}

          <section className="rounded-2xl border border-line bg-surface p-3">
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-sub">
              Por local · {modo === 'dia' ? (repoDia ? `repo del ${corta(repoDia.fecha)}` : 'sin repo') : 'suma de la semana'}
            </h2>
            <table className="w-full table-fixed text-[12px] sm:text-[13px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-sub">
                  <th className="w-[22%] py-1.5 text-left sm:w-[14%]">Local</th>
                  <th className="hidden py-1.5 text-left sm:table-cell">Responsable</th>
                  <th className="py-1.5 text-right">Venta</th>
                  <th className="py-1.5 text-right">Repo</th>
                  <th className="py-1.5 text-right">No mand.</th>
                  <th className="hidden py-1.5 pl-3 md:table-cell">Avance</th>
                  <th className="py-1.5 text-right">Horas</th>
                  <th className="hidden py-1.5 text-right sm:table-cell">Prend/HS</th>
                </tr>
              </thead>
              <tbody>
                {filasLocal.map((l) => {
                  const pct = l.venta ? Math.min(100, (l.repo / l.venta) * 100) : 0
                  return (
                    <tr key={l.local} className="border-t border-line">
                      <td className="truncate py-1.5 font-semibold text-ink">{l.local}</td>
                      <td className="hidden truncate py-1.5 text-sub sm:table-cell">{l.responsable}</td>
                      <td className="py-1.5 text-right font-bold tabular-nums text-emerald-500">{n0.format(l.venta)}</td>
                      <td className="py-1.5 text-right tabular-nums">{n0.format(l.repo)}</td>
                      <td className="py-1.5 text-right font-semibold tabular-nums text-red-400">{l.noMandados ? n0.format(l.noMandados) : '—'}</td>
                      <td className="hidden py-1.5 pl-3 md:table-cell">
                        <div className="h-1.5 overflow-hidden rounded-full bg-line">
                          <div className={`h-full rounded-full ${pct >= 99 ? 'bg-emerald-500' : 'bg-sky-500'}`} style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{num2(horasPer(l))}</td>
                      <td className="hidden py-1.5 text-right font-semibold tabular-nums sm:table-cell">{num2(prendasHs(l))}</td>
                    </tr>
                  )
                })}
                {filasLocal.length === 0 && (
                  <tr><td colSpan={8} className="py-4 text-center text-sub">Sin datos.</td></tr>
                )}
              </tbody>
            </table>
          </section>
          <p className="mt-3 text-[11px] text-sub">
            Horas: tiempo con el cronómetro de Mi repo (Iniciar → Finalizar, sin pausas). Si nadie lo usó, queda «—». Tocá una repo de la semana para ver ese día.
          </p>
        </>
      )}
    </section>
  )
}
