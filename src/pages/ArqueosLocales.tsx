import { useCallback, useEffect, useMemo, useState } from 'react'
import { Banknote, BellOff, Bell, RefreshCw, Search, X } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import {
  COLOR_ZONA, HORARIOS_ARQUEO, ahoraCordoba, arqueosDelDia, colorBillete, arqueosMarcados, estadoHorarios, etiquetaHorario, excluidos as leerExcluidos,
  excluirLocal, hhmm, minutos, numero, pesos, ultimosArqueos, ultimoSync, type Arqueo, type Horario,
} from '@/lib/arqueos'

/* ------------------------------------------------------------------ */
/*  Tesorería → Arqueos de locales.                                     */
/*  Efectivo del último arqueo de cada local por billete, agrupado por  */
/*  zona, y la grilla de los horarios fijos (10, 14, 19 y 22) con quién */
/*  arqueó y quién no. Datos: arqueos_locales (copia del puente de      */
/*  DWH.dbo.vw_FACT_ARQUEO cada 2 min). Ver sql/arqueos_locales.sql.    */
/* ------------------------------------------------------------------ */

interface Local { codigo: string; nombre: string; zona: string | null }

const titulo = (s: string) => s.toLowerCase().replace(/(^|\s)(\S)/g, (_, a: string, b: string) => a + b.toUpperCase())
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`

const ESTILO_HORARIO: Record<Horario['estado'], string> = {
  ok: 'bg-emerald-500/15 text-emerald-300',
  tarde: 'bg-amber-500/15 text-amber-300',
  marcado: 'bg-sky-500/15 text-sky-300',
  avisando: 'bg-red-500/20 text-red-300 animate-pulse',
  no: 'bg-red-500/15 text-red-300',
  pendiente: 'text-sub/60',
}
function textoHorario(h: Horario): string {
  if (h.estado === 'ok') return `✓ ${h.hora}`
  if (h.estado === 'tarde') return `tarde ${h.hora}`
  if (h.estado === 'marcado') return '✓ marcado'
  if (h.estado === 'avisando') return 'avisando'
  if (h.estado === 'no') return '✕ no hizo'
  return '—'
}

/** Suma por billete (de mayor a menor) y aparte las monedas, de una lista de arqueos. */
function sumarBilletes(ls: Arqueo[]) {
  const suma = new Map<number, { cant: number; tot: number }>()
  let monedas = 0
  let cantMonedas = 0
  for (const l of ls) for (const b of l.billetes) {
    if (b.tipo !== 'Billete') { monedas += b.tot; cantMonedas += b.cant; continue }
    const x = suma.get(b.valor) ?? { cant: 0, tot: 0 }
    x.cant += b.cant
    x.tot += b.tot
    suma.set(b.valor, x)
  }
  const billetes = [...suma.entries()].map(([v, x]) => ({ v, ...x })).filter((x) => x.cant > 0).sort((a, b) => b.v - a.v)
  return { billetes, monedas, cantMonedas }
}

export default function ArqueosLocales() {
  const { isAdmin, can } = useAuth()
  const puedeEditar = isAdmin || can('arqueos.edit')
  const hoy = ahoraCordoba().fecha
  const [fecha, setFecha] = useState(hoy)
  const [locales, setLocales] = useState<Local[]>([])
  const [ultimos, setUltimos] = useState<Arqueo[]>([])
  const [delDia, setDelDia] = useState<Arqueo[]>([])
  const [fuera, setFuera] = useState<Set<string>>(new Set())
  const [sync, setSync] = useState<string | null>(null)
  const [marcados, setMarcados] = useState<Map<string, number[]>>(new Map())
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [zona, setZona] = useState('TODAS')
  const [orden, setOrden] = useState<'total' | 'viejo' | 'nombre'>('total')
  const [sel, setSel] = useState<string | null>(null)
  const [reloj, setReloj] = useState(() => Date.now())

  useEffect(() => {
    if (supabase) void supabase.from('locales').select('codigo,nombre,zona').then(({ data }) => setLocales((data as Local[] | null) ?? []))
  }, [])

  const cargar = useCallback(async () => {
    try {
      const [u, d, x, s, m] = await Promise.all([ultimosArqueos(fecha), arqueosDelDia(fecha), leerExcluidos(), ultimoSync(), arqueosMarcados(fecha)])
      setUltimos(u)
      setDelDia(d)
      setFuera(x)
      setSync(s)
      setMarcados(m)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron leer los arqueos')
    } finally {
      setCargando(false)
      setReloj(Date.now())
    }
  }, [fecha])

  useEffect(() => {
    setCargando(true)
    void cargar()
    const t = setInterval(() => { if (document.visibilityState === 'visible') void cargar() }, 60_000)
    return () => clearInterval(t)
  }, [cargar])

  const info = useCallback((cod: string) => {
    const l = locales.find((x) => x.codigo.toUpperCase() === cod.toUpperCase())
    return { nombre: titulo(l?.nombre || cod), zona: (l?.zona || 'SIN ZONA').toUpperCase() }
  }, [locales])

  const esHoy = fecha === hoy
  const ahoraMin = esHoy ? ahoraCordoba(new Date(reloj)).min : 24 * 60 + 1

  const datos = useMemo(() => ultimos.map((a) => ({ ...a, ...info(a.local), delDia: a.fecha === fecha })), [ultimos, info, fecha])

  // Grilla de horarios: todos los locales activos, con las horas de arqueo del día
  const grilla = useMemo(() => {
    const horas = new Map<string, string[]>()
    for (const a of delDia) horas.set(a.local, [...(horas.get(a.local) ?? []), a.hora])
    return datos
      .map((l) => ({ local: l.local, nombre: l.nombre, zona: l.zona, excluido: fuera.has(l.local), horarios: estadoHorarios(horas.get(l.local) ?? [], ahoraMin, marcados.get(l.local)) }))
      .sort((a, b) => a.zona.localeCompare(b.zona) || a.nombre.localeCompare(b.nombre))
  }, [datos, delDia, fuera, ahoraMin, marcados])

  const total = datos.reduce((s, l) => s + l.total, 0)
  const conArqueo = datos.filter((l) => l.delDia).length
  const ultimo = [...datos].filter((l) => l.delDia).sort((a, b) => minutos(b.hora) - minutos(a.hora))[0]
  const mayor = [...datos].sort((a, b) => b.total - a.total)[0]
  const cumplidos = grilla.filter((g) => !g.excluido).flatMap((g) => g.horarios).filter((h) => h.estado === 'ok' || h.estado === 'tarde' || h.estado === 'marcado').length
  const faltaron = grilla.filter((g) => !g.excluido).flatMap((g) => g.horarios).filter((h) => h.estado === 'no' || h.estado === 'avisando').length

  const billetes = useMemo(() => sumarBilletes(datos).billetes, [datos])
  const maxBillete = Math.max(1, ...billetes.map((b) => b.tot))

  const zonas = useMemo(() => ['TODAS', ...new Set(datos.map((l) => l.zona))], [datos])
  const grupos = useMemo(() => {
    const t = busca.trim().toLowerCase()
    const lista = datos
      .filter((l) => (zona === 'TODAS' || l.zona === zona) && (!t || `${l.nombre} ${l.vendedor ?? ''} ${l.local}`.toLowerCase().includes(t)))
      .sort(orden === 'total' ? (a, b) => b.total - a.total
        : orden === 'viejo' ? (a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`)
          : (a, b) => a.nombre.localeCompare(b.nombre))
    const m = new Map<string, typeof lista>()
    for (const l of lista) m.set(l.zona, [...(m.get(l.zona) ?? []), l])
    const suma = (ls: typeof lista) => ls.reduce((s, l) => s + l.total, 0)
    return [...m.entries()].sort((a, b) => suma(b[1]) - suma(a[1])).map(([z, ls]) => ({ zona: z, locales: ls, total: suma(ls) }))
  }, [datos, busca, zona, orden])

  const syncViejo = esHoy && (!sync || Date.now() - new Date(sync).getTime() > 10 * 60_000)

  async function alternar(local: string) {
    try {
      await excluirLocal(local, !fuera.has(local))
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cambiar')
    }
  }

  function estadoCard(l: (typeof datos)[number]) {
    if (!l.delDia) return { c: '#ef4444', t: `Sin arqueo ${esHoy ? 'hoy' : 'ese día'} · último ${ddmm(l.fecha)} ${hhmm(l.hora)}` }
    if (!esHoy) return { c: '#10b981', t: `Último del día ${hhmm(l.hora)}` }
    const hace = ahoraMin - minutos(l.hora)
    const txt = hace < 60 ? `hace ${hace} min` : `hace ${Math.floor(hace / 60)} h${hace % 60 ? ` ${hace % 60} min` : ''}`
    return hace <= 180 ? { c: '#10b981', t: `Hoy ${hhmm(l.hora)} · ${txt}` } : { c: '#f59e0b', t: `Hoy ${hhmm(l.hora)} · ${txt}` }
  }

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
            <Banknote size={22} className="text-emerald-500" aria-hidden /> Arqueos de locales
          </h1>
          <p className="mt-1 text-sm text-sub">Efectivo contado en el último arqueo de cada local, por billete. Horarios: 10, 14, 19 y 22.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {esHoy && (
            <span className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-semibold ${syncViejo ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'}`}>
              <span className={`h-2 w-2 rounded-full ${syncViejo ? 'bg-amber-400' : 'animate-pulse bg-emerald-400'}`} />
              {syncViejo ? 'Sin datos nuevos de Dragon' : 'En vivo'}
              {sync && ` · ${new Date(sync).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`}
            </span>
          )}
          <input type="date" value={fecha} max={hoy} onChange={(e) => e.target.value && setFecha(e.target.value)} aria-label="Día"
            className="h-8 rounded-lg border border-line bg-surface2 px-2 text-sm text-ink" />
          <button type="button" onClick={() => void cargar()} className="btn-press inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface2 px-3 text-xs font-semibold text-ink">
            <RefreshCw size={13} aria-hidden /> Actualizar
          </button>
        </div>
      </header>

      {error && <p role="alert" className="mb-3 text-sm text-brand-400">{error}</p>}
      {cargando && !datos.length ? (
        <p className="py-10 text-center text-sm text-sub">Cargando arqueos…</p>
      ) : !datos.length ? (
        <p className="py-10 text-center text-sm text-sub">No hay arqueos de los últimos 14 días.</p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {[
              ['Efectivo en locales', pesos(total), `${datos.length} locales`],
              [esHoy ? 'Arquearon hoy' : 'Arquearon ese día', `${conArqueo} de ${datos.length}`, datos.length - conArqueo ? `${datos.length - conArqueo} sin arqueo` : 'todos'],
              ['Horarios cumplidos', numero(cumplidos), faltaron ? `${faltaron} que faltaron` : 'ninguno faltó'],
              ['Más efectivo', mayor ? pesos(mayor.total) : '—', mayor?.nombre ?? ''],
            ].map(([t, v, p]) => (
              <div key={t} className="rounded-2xl border border-line bg-surface p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-sub">{t}</p>
                <p className="mt-0.5 font-display text-xl font-bold tabular-nums text-ink">{v}</p>
                <p className="truncate text-xs text-sub">{p}</p>
              </div>
            ))}
          </div>

          {/* Filtros */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <label className="relative min-w-[180px] flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sub" aria-hidden />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar local o vendedor" aria-label="Buscar"
                className="h-9 w-full rounded-lg border border-line bg-surface2 pl-8 pr-2 text-sm text-ink" />
            </label>
            <select value={orden} onChange={(e) => setOrden(e.target.value as typeof orden)} aria-label="Orden" className="h-9 rounded-lg border border-line bg-surface2 px-2 text-sm text-ink">
              <option value="total">Más efectivo primero</option>
              <option value="viejo">Arqueo más viejo primero</option>
              <option value="nombre">Por nombre</option>
            </select>
            <div className="flex flex-wrap gap-1.5">
              {zonas.map((z) => (
                <button key={z} type="button" onClick={() => setZona(z)}
                  className={`h-8 rounded-full border px-3 text-xs font-semibold ${zona === z ? 'border-white bg-white text-black' : 'border-line text-sub hover:text-ink'}`}>
                  {z === 'TODAS' ? 'Todas' : titulo(z)}
                </button>
              ))}
            </div>
          </div>

          {/* Zonas: locales a la izquierda, total por billete de la zona a la derecha */}
          {!grupos.length && <p className="py-6 text-center text-sm text-sub">Ningún local coincide con la búsqueda.</p>}
          {grupos.map((g, i) => {
            const sinArqueo = g.locales.filter((l) => !l.delDia).length
            const lsel = g.locales.find((l) => l.local === sel)
            const bz = sumarBilletes(lsel ? [lsel] : g.locales)
            const maxZ = Math.max(1, ...bz.billetes.map((b) => b.tot))
            return (
              <section key={g.zona} className="mb-5">
                <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line pb-2">
                  <h3 className="flex items-center gap-2 font-display text-[15px] font-semibold text-ink">
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-bold tabular-nums text-ink" title="Orden para ir: la zona con más efectivo primero">{i + 1}°</span>
                    <i className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_ZONA[g.zona] ?? '#64748b' }} aria-hidden />{titulo(g.zona)}
                  </h3>
                  <span className="text-xs text-sub">
                    <b className="text-base tabular-nums text-ink">{pesos(g.total)}</b> · {g.locales.length} local{g.locales.length === 1 ? '' : 'es'} ·{' '}
                    {sinArqueo ? <span className="text-red-300">{sinArqueo} sin arqueo</span> : 'todos arquearon'}
                  </span>
                </div>
                <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(230px,1fr))] sm:gap-2.5">
                    {g.locales.map((l) => {
                      const e = estadoCard(l)
                      const bills = l.billetes.filter((b) => b.tot > 0)
                      return (
                        <button key={l.local} type="button" onClick={() => setSel(sel === l.local ? null : l.local)}
                          className={`min-w-0 rounded-2xl border p-2.5 text-left transition sm:p-3 ${sel === l.local ? 'border-emerald-500/60 bg-emerald-500/5' : 'border-line bg-surface hover:border-line2'}`}>
                          <div className="flex items-start justify-between gap-2">
                            <span className="min-w-0 text-sm font-semibold leading-tight text-ink sm:text-base">{l.nombre}</span>
                            <span className="shrink-0 rounded-full border border-line2 px-1.5 text-[10px] font-semibold text-sub sm:px-2 sm:text-[11px]">Caja {l.caja}</span>
                          </div>
                          <p className="mt-1 font-display text-lg font-bold tabular-nums text-ink sm:text-xl">{pesos(l.total)}</p>
                          <div className="my-2 flex h-2 overflow-hidden rounded-full bg-white/5">
                            {bills.map((b) => (
                              <i key={`${b.tipo}${b.valor}`} title={`${pesos(b.valor)}: ${b.cant} u.`} style={{ width: `${(100 * b.tot) / (l.total || 1)}%`, background: colorBillete(b.valor) }} />
                            ))}
                          </div>
                          <span className="flex items-start gap-1.5 text-[11px] font-semibold leading-snug sm:text-xs" style={{ color: e.c }}>
                            <i className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: e.c }} aria-hidden />{e.t}
                          </span>
                          {l.vendedor && <p className="mt-0.5 truncate text-xs text-sub">{l.vendedor}</p>}
                        </button>
                      )
                    })}
                  </div>
                  <aside className="order-first rounded-xl border border-line bg-surface px-2.5 py-2 lg:order-none">
                    {lsel ? (
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-emerald-300">Billetes de {lsel.nombre}</p>
                          <p className="truncate text-[10px] text-sub">Arqueo N° {lsel.arqueo} · {ddmm(lsel.fecha)} {hhmm(lsel.hora)}</p>
                        </div>
                        <button type="button" onClick={() => setSel(null)} title="Volver a la zona" aria-label="Volver a la zona"
                          className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-line text-sub hover:text-ink">
                          <X size={11} aria-hidden />
                        </button>
                      </div>
                    ) : (
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-sub">Billetes de la zona</p>
                    )}
                    <div className="grid gap-px">
                      {bz.billetes.map((b) => (
                        <div key={b.v} className="grid grid-cols-[56px_1fr_30px_80px] items-center gap-1.5 text-[11px] leading-[18px]">
                          <span className="font-semibold tabular-nums text-ink">{pesos(b.v)}</span>
                          <span className="h-1.5 overflow-hidden rounded-full bg-white/5">
                            <i className="block h-full rounded-full" style={{ width: `${Math.max(2, (100 * b.tot) / maxZ)}%`, background: colorBillete(b.v) }} />
                          </span>
                          <span className="text-right tabular-nums text-sub">{numero(b.cant)}</span>
                          <span className="text-right tabular-nums text-ink">{pesos(b.tot)}</span>
                        </div>
                      ))}
                      {bz.monedas > 0 && (
                        <div className="grid grid-cols-[56px_1fr_30px_80px] items-center gap-1.5 text-[11px] leading-[18px] text-sub">
                          <span>Monedas</span><span /><span className="text-right tabular-nums">{numero(bz.cantMonedas)}</span>
                          <span className="text-right tabular-nums">{pesos(bz.monedas)}</span>
                        </div>
                      )}
                      <div className="mt-0.5 grid grid-cols-[1fr_80px] border-t border-line pt-1 text-[11px] font-bold text-ink">
                        <span>Total</span><span className="text-right tabular-nums">{pesos(lsel ? lsel.total : g.total)}</span>
                      </div>
                    </div>
                  </aside>
                </div>
              </section>
            )
          })}

          {/* Billetes en todos los locales */}
          {billetes.length > 0 && (
            <section className="mb-4 rounded-2xl border border-line bg-surface p-4">
              <h2 className="mb-2 font-display text-base font-semibold text-ink">Billetes en todos los locales</h2>
              <div className="grid gap-1.5">
                {billetes.map((b) => (
                  <div key={b.v} className="grid grid-cols-[84px_1fr_64px_110px] items-center gap-2 text-sm sm:grid-cols-[96px_1fr_80px_130px]">
                    <b className="tabular-nums text-ink">{pesos(b.v)}</b>
                    <span className="h-2.5 overflow-hidden rounded-full bg-white/5">
                      <i className="block h-full rounded-full" style={{ width: `${Math.max(1, (100 * b.tot) / maxBillete)}%`, background: colorBillete(b.v) }} />
                    </span>
                    <span className="text-right tabular-nums text-sub">{numero(b.cant)} u.</span>
                    <b className="text-right tabular-nums text-ink">{pesos(b.tot)}</b>
                  </div>
                ))}
              </div>
            </section>
          )}


          {/* Horarios del día */}
          <section className="mt-2 mb-4 rounded-2xl border border-line bg-surface p-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-base font-semibold text-ink">Horarios {esHoy ? 'de hoy' : `del ${ddmm(fecha)}`}</h2>
              <p className="text-xs text-sub">
                Vale desde 1 h 30 antes hasta 1 h después · avisa a los 15 min y cada 15 min{ultimo ? ` · último arqueo ${hhmm(ultimo.hora)} (${ultimo.nombre})` : ''}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-sub/70">
                  <tr>
                    <th className="py-1.5 text-left font-semibold">Local</th>
                    {HORARIOS_ARQUEO.map((h) => <th key={h} className="py-1.5 text-center font-semibold">{etiquetaHorario(h)}</th>)}
                    {puedeEditar && <th className="py-1.5 text-right font-semibold">Avisos</th>}
                  </tr>
                </thead>
                <tbody>
                  {grilla.map((g) => (
                    <tr key={g.local} className={`border-t border-line ${g.excluido ? 'opacity-50' : ''}`}>
                      <td className="py-1.5 pr-2">
                        <span className="mr-2 inline-block h-2 w-2 rounded-sm" style={{ background: COLOR_ZONA[g.zona] ?? '#64748b' }} aria-hidden />
                        <span className="font-semibold text-ink">{g.nombre}</span>
                        {g.excluido && <span className="ml-2 text-xs text-sub">sin avisos</span>}
                      </td>
                      {g.horarios.map((h) => (
                        <td key={h.horario} className="py-1.5 text-center">
                          <span className={`inline-block min-w-[78px] rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${ESTILO_HORARIO[g.excluido && h.estado !== 'ok' && h.estado !== 'tarde' ? 'pendiente' : h.estado]}`}>
                            {g.excluido && h.estado !== 'ok' && h.estado !== 'tarde' ? '—' : textoHorario(h)}
                          </span>
                        </td>
                      ))}
                      {puedeEditar && (
                        <td className="py-1.5 text-right">
                          <button type="button" onClick={() => void alternar(g.local)} title={g.excluido ? 'Volver a avisarle' : 'Dejar de avisarle (cerrado, en obra…)'}
                            className="btn-press inline-flex h-7 items-center gap-1 rounded-full border border-line px-2 text-xs text-sub hover:text-ink">
                            {g.excluido ? <><BellOff size={12} aria-hidden /> Apagados</> : <><Bell size={12} aria-hidden /> Activos</>}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

        </>
      )}
    </Layout>
  )
}
