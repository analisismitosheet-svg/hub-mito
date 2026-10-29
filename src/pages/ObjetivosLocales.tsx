import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2, MapPin, RefreshCw, Target, Trash2, TriangleAlert } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

/* ------------------------------------------------------------------ */
/*  Locales → Objetivos.                                                */
/*  Objetivo 2026 = venta 2025 del mismo día de la semana (fecha − 364) */
/*  × IPC acumulado de los 12 meses que terminan en el mes de objetivos */
/*  (va del 26 al 25: del 26/10 al 25/11 son los objetivos de noviembre). */
/*  CFR4 sale de CFR9: el domingo de cada semana se reparte entre       */
/*  lunes y sábado según lo que vendió cada día (domingo cerrado).      */
/*  El admin ve todos los locales, el detalle, el comparativo, el IPC y */
/*  los feriados; el resto ve solo el calendario de su local (lo filtra */
/*  la RPC con usuarios.local).                                          */
/*  Datos: sql/objetivos_locales.sql (RPC objetivos_locales_dia), venta */
/*  diaria que sube puente-sql/scripts/sync-ventas-locales.js.          */
/* ------------------------------------------------------------------ */

interface FilaObj {
  local: string; fecha: string; fecha_base: string; venta_base: number | null; ipc: number
  objetivo: number | null; opera: boolean; feriado: boolean; venta: number | null; manual: boolean
}
interface Ipc { anio: number; mes: number; pct: number | null; interanual: number | null }
interface Feriado { id: number; fecha: string; local: string | null; motivo: string | null }
interface Dia { fecha: string; objetivo: number; venta: number | null; feriado: boolean; opera: boolean; sinVenta: boolean }
/** día que ya pasó y el local no vendió nada: no se le calcula objetivo */
const sinVentaPasada = (f: FilaObj, hoy: string) => f.fecha < hoy && !f.venta

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const DIAS_NOMBRE = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const plata = (n: number) => `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pct = (n: number, dec = 1) => `${n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec })} %`
const dow = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay()
const iso = (a: number, m: number, d: number) => new Date(Date.UTC(a, m - 1, d)).toISOString().slice(0, 10)
const sumarDias = (f: string, n: number) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`
const ddmmaaaa = (f: string) => `${ddmm(f)}/${f.slice(0, 4)}`
const hoyIso = () => new Date().toLocaleDateString('sv-SE')
/** mes de objetivos de una fecha: del 26 en adelante cuenta para el mes siguiente */
function periodoDe(f: string) {
  const a = Number(f.slice(0, 4)), m = Number(f.slice(5, 7)), d = Number(f.slice(8, 10))
  return d >= 26 ? (m === 12 ? { anio: a + 1, mes: 1 } : { anio: a, mes: m + 1 }) : { anio: a, mes: m }
}
const rangoPeriodo = (anio: number, mes: number) => ({ desde: iso(anio, mes - 1, 26), hasta: iso(anio, mes, 25) })
const numerico = (f: FilaObj): FilaObj => ({
  ...f, ipc: Number(f.ipc),
  venta_base: f.venta_base == null ? null : Number(f.venta_base),
  objetivo: f.objetivo == null ? null : Number(f.objetivo),
  venta: f.venta == null ? null : Number(f.venta),
})
/** color del cumplimiento: verde desde 100%, naranja 80-99%, rojo abajo */
const tono = (p: number) => (p >= 100 ? 'ok' : p >= 80 ? 'medio' : 'mal')
const BORDE = { ok: 'border-l-emerald-500', medio: 'border-l-amber-500', mal: 'border-l-red-500' } as const
const TEXTO = { ok: 'text-emerald-400', medio: 'text-amber-400', mal: 'text-red-400' } as const

export default function ObjetivosLocales() {
  const { isAdmin, perfil } = useAuth()
  const miLocal = perfil?.local ?? null
  const inicial = periodoDe(hoyIso())
  const [periodo, setPeriodo] = useState(inicial)
  const rango = useMemo(() => rangoPeriodo(periodo.anio, periodo.mes), [periodo])
  const [filas, setFilas] = useState<FilaObj[]>([])
  const [nombres, setNombres] = useState<Record<string, string>>({})
  const [localSel, setLocalSel] = useState<string>('')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [vista, setVista] = useState<'dias' | 'comparativo' | 'ipc' | 'feriados'>('dias')

  // Detalle (admin): rango libre, por defecto el período hasta ayer
  const ayer = sumarDias(hoyIso(), -1)
  const [desde, setDesde] = useState(rango.desde)
  const [hasta, setHasta] = useState(rango.hasta < ayer ? rango.hasta : ayer)
  const [detalle, setDetalle] = useState<FilaObj[]>([])
  useEffect(() => {
    setDesde(rango.desde)
    setHasta(rango.hasta < ayer ? rango.hasta : ayer < rango.desde ? rango.desde : ayer)
  }, [rango, ayer])

  useEffect(() => {
    if (supabase) void supabase.from('locales').select('codigo,nombre').then(({ data }) =>
      setNombres(Object.fromEntries(((data as { codigo: string; nombre: string | null }[] | null) ?? []).map((l) => [l.codigo, l.nombre ?? '']))))
  }, [])

  const cargar = useCallback(async () => {
    if (!supabase) return
    setCargando(true)
    setError(null)
    const { data, error: e } = await supabase.rpc('objetivos_locales_dia', { p_desde: rango.desde, p_hasta: rango.hasta })
    setCargando(false)
    if (e) { setError(e.message); setFilas([]); return }
    setFilas(((data as FilaObj[] | null) ?? []).map(numerico))
  }, [rango])
  useEffect(() => { void cargar() }, [cargar])

  const cargarDetalle = useCallback(async () => {
    if (!supabase || !isAdmin || !desde || !hasta || hasta < desde) return
    const { data, error: e } = await supabase.rpc('objetivos_locales_dia', { p_desde: desde, p_hasta: hasta })
    if (e) { setError(e.message); return }
    setDetalle(((data as FilaObj[] | null) ?? []).map(numerico))
  }, [isAdmin, desde, hasta])
  useEffect(() => { void cargarDetalle() }, [cargarDetalle])

  const locales = useMemo(() => {
    const tot = new Map<string, number>()
    for (const f of filas) tot.set(f.local, (tot.get(f.local) ?? 0) + (f.objetivo ?? 0))
    return [...tot.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l)
  }, [filas])
  const nom = useCallback((l: string) => nombres[l] || l, [nombres])

  // El que no es admin recibe solo su local; el admin elige (vacío = todos)
  const verLocal = isAdmin ? localSel : (locales[0] ?? miLocal ?? '')
  const dias = useMemo<Dia[]>(() => {
    const hoy = hoyIso()
    const m = new Map<string, Dia>()
    for (const f of filas) {
      if (verLocal && f.local !== verLocal) continue
      const d = m.get(f.fecha) ?? { fecha: f.fecha, objetivo: 0, venta: null, feriado: true, opera: false, sinVenta: true }
      const sinVenta = sinVentaPasada(f, hoy)
      d.objetivo += sinVenta ? 0 : f.objetivo ?? 0
      if (f.venta != null) d.venta = (d.venta ?? 0) + f.venta
      d.feriado = d.feriado && f.feriado
      d.opera = d.opera || f.opera
      d.sinVenta = d.sinVenta && sinVenta
      m.set(f.fecha, d)
    }
    return [...m.values()].sort((a, b) => a.fecha.localeCompare(b.fecha))
  }, [filas, verLocal])

  const nombreMes = `${MESES[periodo.mes - 1][0].toUpperCase()}${MESES[periodo.mes - 1].slice(1)} ${periodo.anio}`
  const mover = (n: number) => setPeriodo((p) => {
    const t = p.anio * 12 + (p.mes - 1) + n
    return { anio: Math.floor(t / 12), mes: (t % 12) + 1 }
  })

  const pestañas = isAdmin
    ? ([['dias', 'Objetivos por día'], ['comparativo', 'Comparativo por local'], ['ipc', 'IPC mensual'], ['feriados', 'Feriados']] as const)
    : null

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2 flex flex-wrap items-center gap-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <Target size={22} className="text-lime-500" aria-hidden /> Objetivos
        </h1>
        <span className="text-xs text-sub/70">El mes de objetivos va del 26 al 25</span>
        <button onClick={() => { void cargar(); void cargarDetalle() }}
          className="btn-press ml-auto inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface2 px-2.5 text-xs font-medium text-ink hover:bg-line">
          <RefreshCw size={13} className={cargando ? 'animate-spin' : ''} aria-hidden /> Actualizar
        </button>
      </header>

      {pestañas && (
        <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="Vistas">
          {pestañas.map(([v, t]) => (
            <button key={v} onClick={() => setVista(v)} aria-pressed={vista === v}
              className={`h-9 rounded-xl px-3 text-sm font-medium transition ${vista === v ? 'bg-brand-600 text-white' : 'border border-line bg-surface text-ink hover:bg-surface2'}`}>{t}</button>
          ))}
        </nav>
      )}

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      {(vista === 'dias' || vista === 'comparativo') && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button onClick={() => mover(-1)} aria-label="Mes anterior" className="btn-press grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface2 text-ink hover:bg-line"><ChevronLeft size={16} aria-hidden /></button>
          <span className="text-base font-semibold text-ink">{nombreMes} <span className="text-xs font-normal text-sub">{ddmm(rango.desde)} al {ddmm(rango.hasta)}</span></span>
          <button onClick={() => mover(1)} aria-label="Mes siguiente" className="btn-press grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface2 text-ink hover:bg-line"><ChevronRight size={16} aria-hidden /></button>
          {vista === 'dias' && (isAdmin ? (
            <select value={localSel} onChange={(e) => setLocalSel(e.target.value)} aria-label="Local"
              className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs text-ink">
              <option value="">Todos los locales</option>
              {[...locales].sort((a, b) => nom(a).localeCompare(nom(b))).map((l) => <option key={l} value={l}>{nom(l)}</option>)}
            </select>
          ) : verLocal ? (
            <span className="inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface2 px-2.5 text-xs text-ink"><MapPin size={13} aria-hidden /> {nom(verLocal)}</span>
          ) : null)}
          {vista === 'dias' && isAdmin && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-sub">
              <label className="flex items-center gap-1">Desde <input id="obj-desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs text-ink" /></label>
              <label className="flex items-center gap-1">Hasta <input id="obj-hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs text-ink" /></label>
            </div>
          )}
        </div>
      )}

      {vista === 'dias' && (
        cargando && !filas.length ? (
          <p className="flex items-center gap-2 py-10 text-sub"><Loader2 size={16} className="animate-spin" aria-hidden /> Calculando…</p>
        ) : !dias.length ? (
          <div className="rounded-2xl border border-line bg-surface p-4 text-sm text-sub">
            {isAdmin
              ? <>Faltan IPC para {MESES[periodo.mes - 1]} {periodo.anio}: cargá el interanual de {MESES[periodo.mes - 1]} o los 12 mensuales que terminan en él, en <button onClick={() => setVista('ipc')} className="font-semibold text-brand-400 underline">IPC mensual</button> y los objetivos del {ddmm(rango.desde)} al {ddmm(rango.hasta)} se arman solos.</>
              : `Todavía no están los objetivos de ${MESES[periodo.mes - 1]} ${periodo.anio}.`}
          </div>
        ) : (
          <Calendario dias={dias} />
        )
      )}

      {vista === 'dias' && isAdmin && <DetalleObjetivos filas={detalle} desde={desde} hasta={hasta} nom={nom} />}

      {vista === 'comparativo' && isAdmin && <Comparativo filas={filas} locales={locales} nom={nom} />}
      {vista === 'ipc' && isAdmin && <IpcMensual onCambio={() => void cargar()} />}
      {vista === 'feriados' && isAdmin && <Feriados locales={locales} nom={nom} onCambio={() => { void cargar(); void cargarDetalle() }} />}
    </Layout>
  )
}

/* ------------------------------------------------------------------ */
/*  Calendario lunes a domingo + total por semana                       */
/* ------------------------------------------------------------------ */
function Calendario({ dias }: { dias: Dia[] }) {
  const hoy = hoyIso()
  const pasado = (d: Dia) => d.fecha < hoy
  const objTotal = dias.reduce((s, d) => s + d.objetivo, 0)
  const ventaTotal = dias.reduce((s, d) => s + (d.venta ?? 0), 0)
  const objALaFecha = dias.filter(pasado).reduce((s, d) => s + d.objetivo, 0)
  const ventaALaFecha = dias.filter(pasado).reduce((s, d) => s + (d.venta ?? 0), 0)

  // Grilla: huecos hasta el lunes de la primera semana y hasta el domingo de la última
  const celdas: (Dia | null)[] = [...Array((dow(dias[0].fecha) + 6) % 7).fill(null), ...dias]
  while (celdas.length % 7) celdas.push(null)
  const semanas = Array.from({ length: celdas.length / 7 }, (_, i) => celdas.slice(i * 7, i * 7 + 7))

  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Kpi titulo="Objetivo del período" valor={plata(objTotal)} />
        <Kpi titulo="Venta del período" valor={plata(ventaTotal)} />
        <Kpi titulo="% cumplido a la fecha" valor={objALaFecha ? pct((100 * ventaALaFecha) / objALaFecha) : '—'} />
        <Kpi titulo="Falta para el objetivo" valor={plata(Math.max(0, objTotal - ventaTotal))} />
      </div>
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface p-2">
        <div className="grid min-w-[1340px] grid-cols-[repeat(7,minmax(160px,1fr))_minmax(170px,1.1fr)] gap-1 tabular-nums">
          {DIAS_SEMANA.map((d) => <div key={d} className="py-1 text-center text-xs text-sub">{d}</div>)}
          <div className="py-1 text-center text-xs font-semibold text-lime-400">Total semana</div>
          {semanas.map((sem, i) => {
            let obj = 0, venta = 0, objPas = 0
            for (const d of sem) {
              if (!d) continue
              obj += d.objetivo
              if (d.venta != null) venta += d.venta
              if (pasado(d)) objPas += d.objetivo
            }
            const p = objPas ? (100 * venta) / objPas : null
            return [
              ...sem.map((d, j) => <CeldaDia key={d?.fecha ?? `v${i}-${j}`} d={d} hoy={hoy} />),
              <div key={`s${i}`} className={`rounded-lg border border-lime-500/60 border-l-4 bg-paper px-2 py-1.5 ${p != null ? BORDE[tono(p)] : ''}`}>
                <p className="mb-1 text-[11px] text-sub">Semana {i + 1}</p>
                <Fila t="Venta" v={venta ? plata(venta) : '—'} />
                <Fila t="Objetivo" v={plata(obj)} />
                <Fila t="Dif." v={venta ? plata(venta - objPas) : '—'} />
                <Fila t="%" v={p != null ? <span className={`font-bold ${TEXTO[tono(p)]}`}>{pct(p)}</span> : '—'} />
              </div>,
            ]
          })}
        </div>
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-sub">
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />100% o más</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-amber-500" />80% a 99%</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-red-500" />menos de 80%</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-slate-500" />feriado, no abre o no vendió: sin objetivo</span>
        <span>El % y la diferencia cuentan solo los días que ya pasaron.</span>
      </p>
    </>
  )
}

function CeldaDia({ d, hoy }: { d: Dia | null; hoy: string }) {
  if (!d) return <div />
  const sinObjetivo = d.objetivo === 0 && (d.feriado || !d.opera || d.sinVenta)
  const p = d.fecha < hoy && d.objetivo ? (100 * (d.venta ?? 0)) / d.objetivo : null
  if (sinObjetivo) {
    return (
      <div className="rounded-lg border border-line border-l-4 border-l-slate-500 bg-paper px-2 py-1.5"
        style={{ backgroundImage: 'repeating-linear-gradient(135deg, rgba(148,163,184,.10) 0 8px, transparent 8px 16px)' }}>
        <p className="mb-1 flex items-center justify-between text-[11px] text-sub">{ddmm(d.fecha)}
          <span className="rounded-full bg-line px-1.5 text-[10px] text-ink">{d.feriado ? 'Feriado' : !d.opera ? 'No abre' : 'Sin venta'}</span></p>
        <Fila t="Venta" v={d.venta != null ? plata(d.venta) : '—'} />
        <Fila t="Objetivo" v="sin objetivo" />
        <Fila t="Dif." v="—" />
        <Fila t="%" v="—" />
      </div>
    )
  }
  return (
    <div className={`rounded-lg border border-line border-l-4 bg-paper px-2 py-1.5 ${p != null ? BORDE[tono(p)] : ''} ${d.fecha === hoy ? 'ring-2 ring-amber-400' : ''}`}>
      <p className="mb-1 text-[11px] text-sub">{ddmm(d.fecha)}</p>
      <Fila t="Venta" v={d.venta != null ? plata(d.venta) : '—'} />
      <Fila t="Objetivo" v={plata(d.objetivo)} />
      <Fila t="Dif." v={p != null ? plata((d.venta ?? 0) - d.objetivo) : '—'} />
      <Fila t="%" v={p != null ? <span className={`font-bold ${TEXTO[tono(p)]}`}>{pct(p)}</span> : '—'} />
    </div>
  )
}

function Fila({ t, v }: { t: string; v: ReactNode }) {
  return <p className="flex justify-between gap-2 text-xs leading-5"><span className="text-sub">{t}</span><b className="whitespace-nowrap font-semibold text-ink">{v}</b></p>
}

function Kpi({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2">
      <p className="text-[11px] text-sub">{titulo}</p>
      <p className="text-base font-bold tabular-nums text-ink">{valor}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Detalle objetivos (admin): por local en el rango Desde / Hasta      */
/* ------------------------------------------------------------------ */
type ColDetalle = 'tienda' | 'obj' | 'venta' | 'pct' | 'dif'
interface FilaDetalle { l: string; nombre: string; o: number; v: number; p: number; d: number }
const COLS_DETALLE: { k: ColDetalle; t: string; num?: boolean; val: (r: FilaDetalle) => number | string }[] = [
  { k: 'tienda', t: 'Tienda', val: (r) => r.nombre },
  { k: 'obj', t: 'Objetivo', num: true, val: (r) => r.o },
  { k: 'venta', t: 'Venta', num: true, val: (r) => r.v },
  { k: 'pct', t: '% completado', val: (r) => r.p },
  { k: 'dif', t: 'Diferencia', num: true, val: (r) => r.d },
]
const FRANJA = { ok: 'border-l-emerald-500', medio: 'border-l-amber-500', mal: 'border-l-red-500' } as const
const BARRA = { ok: 'bg-emerald-500', medio: 'bg-amber-500', mal: 'bg-red-500' } as const

/** barra de avance hasta 130%; la rayita marca el 100% */
function BarraPct({ p }: { p: number }) {
  const t = tono(p)
  return (
    <div className="flex min-w-[170px] items-center gap-2.5">
      <div className="relative h-1.5 flex-1 rounded-full bg-surface2">
        <i className={`absolute inset-y-0 left-0 rounded-full ${BARRA[t]}`} style={{ width: `${Math.min(p, 130) / 1.3}%` }} />
        <i className="absolute -inset-y-[3px] w-px bg-line2" style={{ left: `${100 / 1.3}%` }} />
      </div>
      <b className={`w-12 text-right font-bold ${TEXTO[t]}`}>{Math.round(p)} %</b>
    </div>
  )
}

function DetalleObjetivos({ filas, desde, hasta, nom }: { filas: FilaObj[]; desde: string; hasta: string; nom: (l: string) => string }) {
  // Clic en una columna = de mayor a menor (Tienda: A a Z); otro clic = al revés
  const [orden, setOrden] = useState<{ k: ColDetalle; asc: boolean }>({ k: 'pct', asc: false })
  const datos = useMemo<FilaDetalle[]>(() => {
    // Solo cuentan los días con venta: sin venta (cerró, todavía no pasó) no hay objetivo que medir
    const m = new Map<string, { o: number; v: number }>()
    for (const f of filas) {
      const x = m.get(f.local) ?? { o: 0, v: 0 }
      x.o += f.venta ? f.objetivo ?? 0 : 0
      x.v += f.venta ?? 0
      m.set(f.local, x)
    }
    return [...m.entries()].filter(([, x]) => x.o > 0).map(([l, x]) => ({ l, nombre: nom(l), o: x.o, v: x.v, p: (100 * x.v) / x.o, d: x.v - x.o }))
  }, [filas, nom])
  const ordenadas = useMemo(() => {
    const col = COLS_DETALLE.find((c) => c.k === orden.k)!
    return [...datos].sort((a, b) => {
      const x = col.val(a), y = col.val(b)
      const c = typeof x === 'string' ? x.localeCompare(String(y), 'es') : x - Number(y)
      return orden.asc ? c : -c
    })
  }, [datos, orden])
  if (!datos.length) return null

  const to = datos.reduce((s, r) => s + r.o, 0), tv = datos.reduce((s, r) => s + r.v, 0)
  const pt = (100 * tv) / to
  const cuenta = { ok: 0, medio: 0, mal: 0 }
  for (const r of datos) cuenta[tono(r.p)]++
  const td = 'whitespace-nowrap px-2.5 py-2'
  const ordenar = (k: ColDetalle) => setOrden((o) => (o.k === k ? { k, asc: !o.asc } : { k, asc: k === 'tienda' }))

  return (
    <section className="mt-5 rounded-2xl border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <h2 className="flex items-center gap-2 text-[17px] font-semibold text-ink"><i className="inline-block h-2 w-2 rounded-full bg-lime-500" /> Detalle objetivos</h2>
        <span className="text-xs text-sub">{ddmmaaaa(desde)} al {ddmmaaaa(hasta)}</span>
        <div className="ml-auto flex flex-wrap gap-1.5 text-[11px] text-sub">
          <span className="rounded-full border border-line bg-surface2 px-2 py-0.5"><b className="text-emerald-400">{cuenta.ok}</b> cumplen</span>
          <span className="rounded-full border border-line bg-surface2 px-2 py-0.5"><b className="text-amber-400">{cuenta.medio}</b> cerca</span>
          <span className="rounded-full border border-line bg-surface2 px-2 py-0.5"><b className="text-red-400">{cuenta.mal}</b> abajo</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm tabular-nums">
          <thead>
            <tr className="border-b border-line2">
              {COLS_DETALLE.map((c) => {
                const on = orden.k === c.k
                return (
                  <th key={c.k} aria-sort={on ? (orden.asc ? 'ascending' : 'descending') : 'none'}
                    className={`px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider ${c.num ? 'text-right' : 'text-left'}`}>
                    <button onClick={() => ordenar(c.k)}
                      className={`-mx-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 uppercase hover:bg-surface2 hover:text-ink ${on ? 'text-lime-400' : 'text-sub/70'}`}>
                      {c.t}<span className={`text-[9px] ${on ? '' : 'opacity-50'}`}>{on ? (orden.asc ? '▲' : '▼') : '↕'}</span>
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {ordenadas.map((r) => {
              const t = tono(r.p)
              return (
                <tr key={r.l} className="border-b border-line hover:bg-surface2">
                  <td className={`${td} border-l-[3px] ${FRANJA[t]}`}><b className="font-semibold text-ink">{r.nombre}</b>{r.nombre !== r.l && <span className="ml-1.5 text-[11px] text-sub">{r.l}</span>}</td>
                  <td className={`${td} text-right text-sub`}>{plata(r.o)}</td>
                  <td className={`${td} text-right font-semibold text-ink`}>{plata(r.v)}</td>
                  <td className={td}><BarraPct p={r.p} /></td>
                  <td className={`${td} text-right font-semibold ${r.d >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{plata(r.d)}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line2 font-bold">
              <td className={`${td} border-l-[3px] ${FRANJA[tono(pt)]} text-ink`}>Total</td>
              <td className={`${td} text-right text-ink`}>{plata(to)}</td>
              <td className={`${td} text-right text-ink`}>{plata(tv)}</td>
              <td className={td}><BarraPct p={pt} /></td>
              <td className={`${td} text-right ${tv - to >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{plata(tv - to)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-sub">La rayita de la barra marca el 100%. Tocá el título de una columna para ordenar; otra vez, al revés.</p>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  Comparativo por local (admin)                                       */
/* ------------------------------------------------------------------ */
/** lunes de la semana ISO */
const semanaIso = (f: string) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10) }

function Comparativo({ filas, locales, nom }: { filas: FilaObj[]; locales: string[]; nom: (l: string) => string }) {
  const tot = (l: string, campo: 'objetivo' | 'venta_base') => filas.reduce((s, f) => (f.local === l && f.objetivo != null ? s + (f[campo] ?? 0) : s), 0)
  const baseGeneral = locales.reduce((s, l) => s + tot(l, 'venta_base'), 0)
  const objGeneral = locales.reduce((s, l) => s + tot(l, 'objetivo'), 0)
  const controles = useMemo(() => {
    const fechas = new Set(filas.map((f) => f.fecha)).size
    const dowMal = filas.filter((f) => dow(f.fecha) !== dow(f.fecha_base)).length
    const ratioMal = filas.filter((f) => !f.manual && f.objetivo != null && f.venta_base && Math.abs(f.objetivo / f.venta_base - (1 + f.ipc / 100)) > 1e-4).length
    const cargados = filas.filter((f) => f.manual).length
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
    return { fechas, dowMal, ratioMal, cargados, semanas: enteras.length, t9, t4, okCfr: enteras.length > 0 && Math.abs(t9 - t4) < 1 }
  }, [filas])

  if (!filas.length) return <div className="rounded-2xl border border-line bg-surface p-4 text-sm text-sub">Sin IPC cargado para este período.</div>
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface p-4">
      <p className="mb-2 text-xs text-sub">Venta 2025 corrida 364 días (mismo día de la semana), sin feriados ni días que no abre. En los meses con objetivos cargados (Excel), el % aumento es el que resulta de esos objetivos.</p>
      <table className="w-full text-sm tabular-nums">
        <thead className="text-left text-[11px] uppercase tracking-wider text-sub/70">
          <tr>
            <th className="py-1.5 pr-3">Local</th>
            <th className="py-1.5 pr-3 text-right">Venta 2025 (mapeada)</th>
            <th className="py-1.5 pr-3 text-right">Objetivo</th>
            <th className="py-1.5 text-right">% aumento</th>
          </tr>
        </thead>
        <tbody>
          {locales.map((l) => {
            const b = tot(l, 'venta_base'), o = tot(l, 'objetivo')
            return (
              <tr key={l} className="border-t border-line">
                <td className="py-1.5 pr-3 font-medium text-ink">{nom(l)} <span className="text-xs font-normal text-sub">{l}{l === 'CFR4' ? ' · desde CFR9' : ''}</span></td>
                <td className="py-1.5 pr-3 text-right text-sub">{plata(b)}</td>
                <td className="py-1.5 pr-3 text-right font-semibold text-ink">{plata(o)}</td>
                <td className="py-1.5 text-right text-lime-400">{b ? pct(100 * (o / b - 1)) : '—'}</td>
              </tr>
            )
          })}
          <tr className="border-t-2 border-line2 font-semibold">
            <td className="py-1.5 pr-3 text-ink">Total</td>
            <td className="py-1.5 pr-3 text-right text-sub">{plata(baseGeneral)}</td>
            <td className="py-1.5 pr-3 text-right text-ink">{plata(objGeneral)}</td>
            <td className="py-1.5 text-right text-lime-400">{baseGeneral ? pct(100 * (objGeneral / baseGeneral - 1)) : '—'}</td>
          </tr>
        </tbody>
      </table>

      {/* Controles de la cuenta */}
      <div className="mt-4 grid gap-2 md:grid-cols-3">
        <Control ok={controles.dowMal === 0} titulo="Mismo día de la semana" texto={controles.dowMal === 0 ? `Las ${controles.fechas} fechas caen el mismo día que en 2025.` : `${controles.dowMal} fechas no coinciden.`} />
        <Control ok={controles.okCfr} titulo="CFR9 = CFR4 (redistribuido)"
          texto={controles.semanas ? `${controles.semanas} semanas enteras: CFR9 ${plata(controles.t9)} · CFR4 ${plata(controles.t4)}.` : 'No hay semanas enteras en el rango para comparar.'} />
        <Control ok={controles.ratioMal === 0} titulo="Objetivo / venta = 1 + IPC" texto={`${controles.ratioMal === 0 ? 'Todas las celdas calculadas dan exacto.' : `${controles.ratioMal} celdas no dan.`}${controles.cargados ? ` ${controles.cargados} días usan el objetivo cargado (Excel), no el cálculo.` : ''}`} />
      </div>
    </div>
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

/* ------------------------------------------------------------------ */
/*  IPC mensual (admin)                                                 */
/* ------------------------------------------------------------------ */
function IpcMensual({ onCambio }: { onCambio: () => void }) {
  const [anio, setAnio] = useState(periodoDe(hoyIso()).anio)
  const [ipcs, setIpcs] = useState<Ipc[]>([])
  const [guardando, setGuardando] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cargarIpc = useCallback(async () => {
    if (!supabase) return
    const { data, error: e } = await supabase.from('ipc_mensual').select('anio,mes,pct,interanual').order('anio').order('mes')
    if (e) setError(e.message)
    setIpcs(((data as Ipc[] | null) ?? []).map((i) => ({
      ...i, pct: i.pct == null ? null : Number(i.pct), interanual: i.interanual == null ? null : Number(i.interanual),
    })))
  }, [])
  useEffect(() => { void cargarIpc() }, [cargarIpc])

  const del = (a: number, m: number) => ipcs.find((x) => x.anio === a && x.mes === m)

  /** IPC que usa el objetivo de anio/m: el interanual si está; si no, el acumulado de 12 mensuales */
  function usado(m: number) {
    const ia = del(anio, m)?.interanual
    if (ia != null) return { pct: ia, faltan: 0, interanual: true }
    let f = 1, faltan = 0
    for (let k = 0; k < 12; k++) {
      const t = anio * 12 + (m - 1) - k
      const v = del(Math.floor(t / 12), (t % 12) + 1)?.pct
      if (v == null) faltan++
      else f *= 1 + v / 100
    }
    return { pct: (f - 1) * 100, faltan, interanual: false }
  }

  async function guardar(m: number, campo: 'pct' | 'interanual', valor: string) {
    if (!supabase) return
    const txt = valor.trim().replace(',', '.')
    const fila = del(anio, m)
    const nuevo = txt === '' ? null : Number(txt)
    if (nuevo != null && !Number.isFinite(nuevo)) { setError('Escribí un número, por ejemplo 2,4'); return }
    if (nuevo === (fila?.[campo] ?? null)) return
    const otro = campo === 'pct' ? fila?.interanual ?? null : fila?.pct ?? null
    setGuardando(`${m}-${campo}`)
    setError(null)
    const { error: e } = nuevo == null && otro == null
      ? await supabase.from('ipc_mensual').delete().eq('anio', anio).eq('mes', m)
      : await supabase.from('ipc_mensual').upsert({ anio, mes: m, pct: fila?.pct ?? null, interanual: fila?.interanual ?? null, [campo]: nuevo, actualizado_at: new Date().toISOString() })
    setGuardando(null)
    if (e) setError(e.message)
    await cargarIpc()
    onCambio()
  }

  const campo = (m: number, c: 'pct' | 'interanual', titulo: string) => {
    const v = del(anio, m)?.[c]
    return (
      <span className="mt-1 flex items-center gap-1">
        <span className="w-16 shrink-0 text-[10px] text-sub">{titulo}</span>
        <input key={`${anio}-${m}-${c}-${v ?? ''}`} defaultValue={v ?? ''} inputMode="decimal" placeholder="—" aria-label={`${titulo} ${MESES[m - 1]} ${anio}`}
          onBlur={(e) => void guardar(m, c, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className="h-8 w-full min-w-0 rounded-lg border border-line2 bg-surface2 px-2 text-right text-sm text-ink" />
        <span className="text-xs text-sub">%</span>
        {guardando === `${m}-${c}` && <Loader2 size={12} className="animate-spin text-sub" aria-hidden />}
      </span>
    )
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="text-sm text-sub">
          El objetivo de un mes (del 26 del mes anterior al 25) usa el IPC <b className="text-ink">interanual</b> de ese mes si lo cargás.
          Si no, acumula los <b className="text-ink">12 IPC mensuales</b> que terminan en él (tienen que estar los 12).
        </p>
        <select value={anio} onChange={(e) => setAnio(Number(e.target.value))} aria-label="Año" className="ml-auto h-8 rounded-lg border border-line bg-surface2 px-2 text-xs text-ink">
          {[2025, 2026, 2027].map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      {error && <p role="alert" className="mb-3 text-sm text-brand-400">{error}</p>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
        {MESES.map((n, i) => {
          const r = rangoPeriodo(anio, i + 1)
          const u = usado(i + 1)
          return (
            <div key={n} className="rounded-xl border border-line bg-paper p-2">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-sub">{n}</span>
              <span className="block text-[10px] text-sub/70">objetivos del {ddmm(r.desde)} al {ddmm(r.hasta)}</span>
              {campo(i + 1, 'pct', 'Mensual')}
              {campo(i + 1, 'interanual', 'Interanual')}
              {u.faltan
                ? <span className="mt-1 block text-[11px] text-sub/60">{u.faltan === 12 ? 'sin IPC' : `faltan ${u.faltan} mensuales (o cargá el interanual)`}</span>
                : <span className="mt-1 block text-[11px] text-lime-400">usa {pct(u.pct, 2)} {u.interanual ? '(interanual)' : '(12 mensuales)'}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Feriados sin objetivo (admin)                                       */
/* ------------------------------------------------------------------ */
function Feriados({ locales, nom, onCambio }: { locales: string[]; nom: (l: string) => string; onCambio: () => void }) {
  const [lista, setLista] = useState<Feriado[]>([])
  const [fecha, setFecha] = useState('')
  const [local, setLocal] = useState('')
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cargarLista = useCallback(async () => {
    if (!supabase) return
    const { data, error: e } = await supabase.from('objetivos_feriados').select('id,fecha,local,motivo').order('fecha', { ascending: false })
    if (e) setError(e.message)
    setLista((data as Feriado[] | null) ?? [])
  }, [])
  useEffect(() => { void cargarLista() }, [cargarLista])

  async function agregar(e: FormEvent) {
    e.preventDefault()
    if (!supabase || !fecha) return
    setOcupado(true)
    setError(null)
    const { error: err } = await supabase.from('objetivos_feriados').insert({ fecha, local: local || null, motivo: motivo.trim() || null })
    setOcupado(false)
    if (err) { setError(err.code === '23505' ? 'Ese feriado ya está cargado.' : err.message); return }
    setFecha(''); setMotivo('')
    await cargarLista()
    onCambio()
  }

  async function quitar(id: number) {
    if (!supabase) return
    const { error: err } = await supabase.from('objetivos_feriados').delete().eq('id', id)
    if (err) { setError(err.message); return }
    await cargarLista()
    onCambio()
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="mb-3 text-sm text-sub">Ese día el local no lleva objetivo: no suma al objetivo de la semana ni del mes.</p>
      <form onSubmit={(e) => void agregar(e)} className="mb-4 flex flex-wrap items-center gap-2">
        <input id="fer-fecha" type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} aria-label="Fecha"
          className="h-9 rounded-lg border border-line bg-surface2 px-2 text-sm text-ink" />
        <select id="fer-local" value={local} onChange={(e) => setLocal(e.target.value)} aria-label="Local" className="h-9 rounded-lg border border-line bg-surface2 px-2 text-sm text-ink">
          <option value="">Todos los locales</option>
          {[...locales].sort((a, b) => nom(a).localeCompare(nom(b))).map((l) => <option key={l} value={l}>{nom(l)}</option>)}
        </select>
        <input id="fer-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (opcional)" aria-label="Motivo"
          className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface2 px-2 text-sm text-ink" />
        <button type="submit" disabled={ocupado || !fecha} className="btn-press h-9 rounded-lg bg-lime-500 px-3 text-sm font-semibold text-black disabled:opacity-50">
          {ocupado ? 'Guardando…' : 'Agregar feriado'}
        </button>
      </form>
      {error && <p role="alert" className="mb-3 text-sm text-brand-400">{error}</p>}
      {lista.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wider text-sub/70">
              <tr><th className="py-1.5 pr-3">Fecha</th><th className="py-1.5 pr-3">Día</th><th className="py-1.5 pr-3">Local</th><th className="py-1.5 pr-3">Motivo</th><th /></tr>
            </thead>
            <tbody>
              {lista.map((f) => (
                <tr key={f.id} className="border-t border-line">
                  <td className="py-1.5 pr-3 tabular-nums text-ink">{ddmmaaaa(f.fecha)}</td>
                  <td className="py-1.5 pr-3 text-sub">{DIAS_NOMBRE[dow(f.fecha)]}</td>
                  <td className="py-1.5 pr-3 text-ink">{f.local ? nom(f.local) : 'Todos los locales'}</td>
                  <td className="py-1.5 pr-3 text-sub">{f.motivo ?? ''}</td>
                  <td className="py-1.5 text-right">
                    <button onClick={() => void quitar(f.id)} className="inline-flex items-center gap-1 text-xs text-red-400 hover:underline"><Trash2 size={13} aria-hidden /> Quitar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="text-sm text-sub">No hay feriados cargados.</p>}
    </div>
  )
}
