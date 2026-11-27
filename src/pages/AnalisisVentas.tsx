import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, CalendarDays, Download, Lightbulb, Loader2, RefreshCw, Scale, Table2, TriangleAlert } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import FiltroDesplegable from '@/components/reparto/FiltroDesplegable'
import { coloresUnicos } from '@/lib/coloresUnicos'
import { FILTROS } from '@/lib/reparto'
import {
  DIMS_TABLA, NO_MINORISTAS, RAPIDOS, SIGUIENTE, TITULO_DIM, pedirAnalisis, rangoRapido,
  type Analisis, type Comparar, type Dim, type DimFiltro, type FilaTabla, type Gran, type Origen, type PedidoAnalisis, type Rapido, type Totales,
} from '@/lib/analisisVentas'

/**
 * Compras > Análisis ventas (/compras/analisis-ventas, solo admin: permiso analisis_ventas.view).
 * Venta de los locales por día/semana/mes/año: $, tickets, unidades, ticket promedio, por proveedor,
 * línea, grupo, material, familia, temporada, año, género (las tipificaciones del Reparto manual),
 * local y artículo, contra el mismo período del año pasado o el anterior.
 * Todo lo calcula el Puente SQL (puente-sql/analisis-ventas.js) con la venta por ticket guardada por día.
 * Maqueta: mockups/analisis-ventas.html
 */

const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const num = (n: number) => nf.format(Math.round(n))
const plata = (n: number) => `$ ${nf.format(Math.round(n))}`
const millones = (n: number) =>
  Math.abs(n) >= 1e6 ? `$ ${(n / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M` : plata(n)
const varPct = (a: number, b: number | null | undefined) => (b ? (a / b - 1) * 100 : null)
/** 12,3 con signo (texto de la lectura rápida) */
const dec = (n: number, signo = false) => n.toLocaleString('es-AR', { maximumFractionDigits: 1, minimumFractionDigits: 1, ...(signo ? { signDisplay: 'always' as const } : {}) })
const fechaCorta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`
const DIAS_SEM = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

const [cVenta, cTickets, cUnid, cTkProm, cTkAnio, cUpt, cPrecio, cMarcas, cEvo, cDow, cTabla] = coloresUnicos([
  '#84cc16', '#38bdf8', '#a78bfa', '#f59e0b', '#fb923c', '#f472b6', '#2dd4bf', '#eab308', '#22c55e', '#0ea5e9', '#c084fc',
])

function Variacion({ v, sufijo = '%' }: { v: number | null; sufijo?: string }) {
  if (v == null || !isFinite(v)) return <span className="text-sub">—</span>
  const cls = v > 0.5 ? 'text-emerald-400' : v < -0.5 ? 'text-red-400' : 'text-sub'
  return (
    <span className={`font-semibold ${cls}`}>
      {v > 0 ? '▲' : v < 0 ? '▼' : '='} {Math.abs(v).toLocaleString('es-AR', { maximumFractionDigits: 1 })} {sufijo}
    </span>
  )
}

function Seg<T extends string>({ valor, opciones, onChange }: { valor: T; opciones: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-line" role="radiogroup">
      {opciones.map(([v, t], i) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={valor === v}
          onClick={() => onChange(v)}
          className={`h-8 px-3 text-xs ${valor === v ? 'bg-lime-500/15 font-semibold text-lime-300' : 'text-sub hover:text-ink'} ${i ? 'border-l border-line' : ''}`}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

function Sparkline({ valores, color }: { valores: number[]; color: string }) {
  if (valores.length < 2) return null
  const mx = Math.max(...valores), mn = Math.min(...valores)
  const pts = valores.map((v, i) => `${(i / (valores.length - 1)) * 70},${22 - ((v - mn) / (mx - mn || 1)) * 20}`).join(' ')
  return (
    <svg width="70" height="24" className="absolute bottom-2 right-2 opacity-80" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" />
    </svg>
  )
}

type Metrica = 'monto' | 'tickets' | 'unid' | 'tprom'
const valorDe = (t: Totales, m: Metrica) => (m === 'tprom' ? (t.tickets ? t.monto / t.tickets : 0) : t[m])
const fmtMetrica = (v: number, m: Metrica) => (m === 'monto' ? millones(v) : m === 'tprom' ? plata(v) : num(v))

/** Gráfico de barras (período) + línea punteada (comparado). */
function GraficoEvolucion({ serie, metrica, gran }: { serie: Analisis['serie']; metrica: Metrica; gran: Gran }) {
  const [sobre, setSobre] = useState<number | null>(null)
  const W = 900, H = 260, P = { l: 58, r: 10, t: 14, b: 26 }
  const vals = serie.flatMap((p) => [valorDe(p, metrica), p.comp ? valorDe(p.comp, metrica) : 0])
  const mx = Math.max(1, ...vals) * 1.08
  const ancho = (W - P.l - P.r) / Math.max(1, serie.length)
  const x = (i: number) => P.l + (i + 0.5) * ancho
  const y = (v: number) => H - P.b - (v / mx) * (H - P.t - P.b)
  const bw = Math.min(40, ancho * 0.62)
  const cadaEtiqueta = Math.max(1, Math.ceil(serie.length / 16))
  const conComp = serie.some((p) => p.comp)
  const p = sobre != null ? serie[sobre] : null
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-64 w-full" preserveAspectRatio="none" onMouseLeave={() => setSobre(null)}>
        {[0, 1, 2, 3, 4].map((k) => {
          const v = (mx * k) / 4
          return (
            <g key={k}>
              <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="currentColor" className="text-line" />
              <text x={P.l - 6} y={y(v) + 4} fontSize="10" textAnchor="end" className="fill-sub">
                {metrica === 'monto' ? `${(v / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 0 })}M` : num(v)}
              </text>
            </g>
          )
        })}
        {serie.map((pt, i) => {
          const v = valorDe(pt, metrica)
          const finde = gran === 'dia' && (pt.dow === 0 || pt.dow === 6)
          return (
            <g key={pt.desde} onMouseEnter={() => setSobre(i)}>
              <rect x={x(i) - ancho / 2} y={P.t} width={ancho} height={H - P.t - P.b} fill="transparent" />
              <rect x={x(i) - bw / 2} y={y(v)} width={bw} height={Math.max(0, H - P.b - y(v))} rx="3"
                fill={finde ? 'rgba(163,230,53,.95)' : 'rgba(132,204,22,.55)'} opacity={sobre == null || sobre === i ? 1 : 0.55} />
              {i % cadaEtiqueta === 0 && (
                <text x={x(i)} y={H - 8} fontSize="10" textAnchor="middle" className="fill-sub">{pt.lab}</text>
              )}
            </g>
          )
        })}
        {conComp && (
          <polyline
            points={serie.map((pt, i) => `${x(i)},${y(pt.comp ? valorDe(pt.comp, metrica) : 0)}`).join(' ')}
            fill="none" stroke="#64748b" strokeWidth="2" strokeDasharray="4 3" pointerEvents="none"
          />
        )}
      </svg>
      {p && (
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-lg border border-line bg-[var(--surface-solid)] px-3 py-2 text-xs shadow-xl">
          <b className="text-ink">
            {gran === 'dia' ? `${DIAS_CORTOS[p.dow ?? 0]} ${fechaCorta(p.desde)}` : p.desde === p.hasta ? fechaCorta(p.desde) : `${fechaCorta(p.desde)} al ${fechaCorta(p.hasta)}`}
          </b>
          <div className="text-ink">{millones(p.monto)} · {num(p.tickets)} tickets · {num(p.unid)} u. · ticket prom. {p.tickets ? plata(p.monto / p.tickets) : '—'}</div>
          {p.comp && (
            <div className="text-sub">
              Comparado: {fmtMetrica(valorDe(p.comp, metrica), metrica)} <Variacion v={varPct(valorDe(p, metrica), valorDe(p.comp, metrica))} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function AnalisisVentas() {
  /* ---------------- filtros ---------------- */
  const [rapido, setRapido] = useState<Rapido | null>('mes')
  const [desde, setDesde] = useState(() => rangoRapido('mes')[0])
  const [hasta, setHasta] = useState(() => rangoRapido('mes')[1])
  const [comparar, setComparar] = useState<Comparar>('anio')
  const [origen, setOrigen] = useState<Origen>('')
  const [soloMinoristas, setSoloMinoristas] = useState(true)
  const [locSel, setLocSel] = useState<Set<string>>(new Set())
  const [sel, setSel] = useState<Record<DimFiltro, Set<string>>>(
    () => Object.fromEntries(FILTROS.map((f) => [f.k, new Set<string>()])) as Record<DimFiltro, Set<string>>,
  )
  const [art, setArt] = useState('')
  const [artDebounced, setArtDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setArtDebounced(art), 600)
    return () => clearTimeout(t)
  }, [art])

  /* ---------------- vista ---------------- */
  const [metrica, setMetrica] = useState<Metrica>('monto')
  const [gran, setGran] = useState<Gran>('dia')
  const [dim, setDim] = useState<Dim>('prov')
  const [camino, setCamino] = useState<{ dim: Dim; cod: string; label: string }[]>([])
  const [orden, setOrden] = useState<'monto' | 'unid' | 'tickets' | 'var'>('monto')
  const [top, setTop] = useState(20)
  const [corte, setCorte] = useState<'dia' | 'anio'>('dia')
  const [dowMetrica, setDowMetrica] = useState<'monto' | 'tickets'>('monto')

  /* ---------------- datos ---------------- */
  const [datos, setDatos] = useState<Analisis | null>(null)
  const [opciones, setOpciones] = useState<Analisis['opciones']>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const pedidoActual = useRef(0)

  const pedido = useMemo<PedidoAnalisis>(() => {
    const filtros: PedidoAnalisis['filtros'] = {}
    for (const f of FILTROS) if (sel[f.k].size) filtros[f.k] = [...sel[f.k]]
    if (locSel.size) filtros.locales = [...locSel]
    if (soloMinoristas) filtros.excluir = NO_MINORISTAS
    if (origen) filtros.origen = origen
    if (artDebounced.trim()) filtros.art = artDebounced.trim().toUpperCase()
    // La fila tocada en "Abrir por" (ej. un proveedor) filtra TODA la pantalla, no solo la tabla:
    // KPIs, evolución, día de la semana, ticket del año y marcas por año quedan de ese proveedor.
    for (const c of camino) {
      if (!/^[A-Z0-9 ._/-]{1,40}$/i.test(c.cod)) continue // "(sin dato)" u otro raro: queda solo en la apertura
      if (c.dim === 'local') filtros.locales = [c.cod]
      else if (c.dim !== 'art') filtros[c.dim] = [c.cod]
    }
    return { desde, hasta, comparar, gran, dim, camino: camino.map(({ dim: d, cod }) => ({ dim: d, cod })), corte, filtros }
  }, [desde, hasta, comparar, gran, dim, camino, corte, sel, locSel, soloMinoristas, origen, artDebounced])

  useEffect(() => {
    const id = ++pedidoActual.current
    const ctrl = new AbortController()
    setCargando(true)
    const t = setTimeout(() => {
      pedirAnalisis({ ...pedido, opciones: !opciones }, ctrl.signal)
        .then((d) => {
          if (id !== pedidoActual.current) return
          setDatos(d)
          if (d.opciones) setOpciones(d.opciones)
          setError(null)
        })
        .catch((e: Error) => {
          if (id === pedidoActual.current && e.name !== 'AbortError') setError(e.message)
        })
        .finally(() => {
          if (id === pedidoActual.current) setCargando(false)
        })
    }, 250)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [pedido, vuelta])

  // Mientras el puente baja días del SQL, se vuelve a preguntar cada 5 s
  const incompleto = !!datos && (datos.faltan.periodo > 0 || datos.faltan.comparado > 0)
  useEffect(() => {
    if (!incompleto) return
    const t = setTimeout(() => setVuelta((v) => v + 1), 5000)
    return () => clearTimeout(t)
  }, [incompleto, datos])

  const elegirRapido = (r: Rapido) => {
    const [a, b] = rangoRapido(r)
    setRapido(r); setDesde(a); setHasta(b)
  }
  const elegirDim = (d: Dim) => { setDim(d); setCamino([]) }
  const limpiar = () => {
    setSel(Object.fromEntries(FILTROS.map((f) => [f.k, new Set<string>()])) as Record<DimFiltro, Set<string>>)
    setLocSel(new Set()); setOrigen(''); setArt(''); setSoloMinoristas(true); setCamino([])
  }

  /* ---------------- nombres ---------------- */
  const nombres = useMemo(() => {
    const m = new Map<string, string>()
    if (opciones) for (const k of Object.keys(opciones) as DimFiltro[]) for (const o of opciones[k] ?? []) m.set(`${k}|${o.cod}`, o.nom)
    for (const l of datos?.locales ?? []) if (l.nom) m.set(`local|${l.cod}`, l.nom)
    return m
  }, [opciones, datos?.locales])
  const etiqueta = useCallback(
    (d: Dim, cod: string, nom?: string) => {
      if (!cod) return '(sin dato)'
      const n = nom || nombres.get(`${d}|${cod}`) || ''
      return n ? `${cod} · ${n}` : cod
    },
    [nombres],
  )
  const opcionesDe = (k: DimFiltro) =>
    (opciones?.[k] ?? [])
      .filter((o) => k !== 'prov' || !origen || (origen === 'MITO') === o.cod.startsWith('MO'))
      .map((o) => ({ id: o.cod, label: o.nom ? `${o.cod} ${o.nom}` : o.cod }))
  const opcionesLocales = (datos?.locales ?? [])
    .filter((l) => !soloMinoristas || !NO_MINORISTAS.includes(l.cod))
    .map((l) => ({ id: l.cod, label: l.nom ? `${l.cod} · ${l.nom}` : l.cod }))
  const hayFiltros = FILTROS.some((f) => sel[f.k].size) || locSel.size > 0 || !!origen || !!art || !soloMinoristas

  /* ---------------- derivados ---------------- */
  const act = datos?.kpis.actual
  const cmp = datos?.kpis.comp ?? null
  const textoComp = datos?.comparado
    ? comparar === 'anio' ? `vs ${fechaCorta(datos.comparado.desde)} al ${fechaCorta(datos.comparado.hasta)}` : `vs ${fechaCorta(datos.comparado.desde)} al ${fechaCorta(datos.comparado.hasta)}`
    : ''
  const serie = datos?.serie ?? []

  const filasTabla = useMemo(() => {
    const fs = [...(datos?.tabla.filas ?? [])]
    const total = fs.reduce((a, f) => a + f.monto, 0)
    // ABC por venta (sobre todas las filas, de mayor a menor)
    let acu = 0
    const abc = new Map<string, string>()
    for (const f of [...fs].sort((a, b) => b.monto - a.monto)) {
      acu += f.monto
      abc.set(f.cod, total > 0 && acu / total <= 0.8 ? 'A' : total > 0 && acu / total <= 0.95 ? 'B' : 'C')
    }
    const v = (f: FilaTabla) => varPct(f.monto, f.comp) ?? -Infinity
    fs.sort((a, b) => (orden === 'var' ? v(b) - v(a) : b[orden] - a[orden]))
    return { filas: fs, total, abc }
  }, [datos?.tabla.filas, orden])

  const semanasPeriodo = datos ? Math.max(1, (new Date(`${datos.hasta}T12:00:00`).getTime() - new Date(`${datos.desde}T12:00:00`).getTime()) / 86_400_000 + 1) / 7 : 1

  const insights = useMemo(() => {
    if (!datos || !act || !act.monto) return []
    const out: { icono: string; color: string; texto: string }[] = []
    const vM = varPct(act.monto, cmp?.monto), vT = varPct(act.tickets, cmp?.tickets)
    const vTp = cmp && cmp.tickets && act.tickets ? varPct(act.monto / act.tickets, cmp.monto / cmp.tickets) : null
    if (vM != null) out.push({ icono: vM >= 0 ? '▲' : '▼', color: vM >= 0 ? 'text-emerald-400' : 'text-red-400',
      texto: `Venta $ ${dec(vM, true)} % contra el período comparado.` })
    if (vT != null && vTp != null) out.push({ icono: vT >= 0 ? '▲' : '▼', color: vT >= 0 ? 'text-emerald-400' : 'text-red-400',
      texto: vT < 0 && vTp > 0
        ? `Tickets ${dec(vT)} %: compra menos gente; el ticket promedio (${dec(vTp, true)} %) sostiene la plata.`
        : `Tickets ${dec(vT, true)} % y ticket promedio ${dec(vTp, true)} %.` })
    const tot = datos.dow.reduce((a, w) => a + w.monto * w.dias, 0)
    if (tot > 0 && datos.dow[0].dias + datos.dow[6].dias > 0) {
      const finde = ((datos.dow[0].monto * datos.dow[0].dias + datos.dow[6].monto * datos.dow[6].dias) / tot) * 100
      const mejor = datos.dow.reduce((b, w, i) => (w.monto > datos.dow[b].monto ? i : b), 0)
      out.push({ icono: '★', color: 'text-amber-400', texto: `Sábado y domingo hacen el ${finde.toFixed(0)} % de la venta; el mejor día es el ${DIAS_SEM[mejor].toLowerCase()}.` })
    }
    const nA = [...filasTabla.abc.values()].filter((x) => x === 'A').length
    if (filasTabla.filas.length > 3) out.push({ icono: '◆', color: 'text-violet-400',
      texto: `${nA} de ${filasTabla.filas.length} (${TITULO_DIM[datos.tabla.dim].toLowerCase()}) explican el 80 % de la venta (clase A).` })
    const conVar = filasTabla.filas.filter((f) => f.comp && f.monto > filasTabla.total * 0.02)
    if (conVar.length > 1) {
      const peor = conVar.reduce((b, f) => ((varPct(f.monto, f.comp) ?? 0) < (varPct(b.monto, b.comp) ?? 0) ? f : b))
      const vp = varPct(peor.monto, peor.comp)
      if (vp != null && vp < 0) out.push({ icono: '!', color: 'text-red-400',
        texto: `Ojo con ${etiqueta(datos.tabla.dim, peor.cod, peor.nom)}: ${dec(vp)} % contra el comparado.` })
    }
    return out
  }, [datos, act, cmp, filasTabla, etiqueta])

  /* ---------------- Excel ---------------- */
  async function bajarExcel() {
    if (!datos) return
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const t = filasTabla.filas.map((f) => ({
      [TITULO_DIM[datos.tabla.dim]]: etiqueta(datos.tabla.dim, f.cod, f.nom),
      'Venta $': f.monto, '% part.': filasTabla.total ? f.monto / filasTabla.total : 0, 'Venta $ comparado': f.comp ?? '',
      'Var. %': f.comp ? f.monto / f.comp - 1 : '', Unidades: f.unid, Tickets: f.tickets,
      'Ticket prom.': f.tickets ? f.monto / f.tickets : '', 'Precio prom.': f.unid ? f.monto / f.unid : '',
      'Stock hoy': f.stock ?? '', ABC: filasTabla.abc.get(f.cod) ?? '',
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(t), 'Abrir por')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(datos.serie.map((p) => ({
      Período: p.lab, Desde: p.desde, Hasta: p.hasta, 'Venta $': p.monto, Tickets: p.tickets, Unidades: p.unid,
      'Venta $ comparado': p.comp?.monto ?? '', 'Tickets comparado': p.comp?.tickets ?? '', 'Unidades comparado': p.comp?.unid ?? '',
    }))), 'Evolución')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(datos.marcas.map((m) => ({
      Año: m.anio, Hasta: m.hasta, 'Marcas unidades': m.MARCAS.unid, 'Marcas $': m.MARCAS.monto,
      'Zimith/Captain Fin unidades': m.MITO.unid, 'Zimith/Captain Fin $': m.MITO.monto,
    }))), 'Marcas por año')
    XLSX.writeFile(wb, `analisis-ventas-${datos.desde}-al-${datos.hasta}.xlsx`)
  }

  /* ---------------- render ---------------- */
  const kpis = act
    ? [
        { l: 'Venta $', c: cVenta, v: millones(act.monto), a: act.monto, b: cmp?.monto, s: serie.map((p) => p.monto) },
        { l: 'Tickets', c: cTickets, v: num(act.tickets), a: act.tickets, b: cmp?.tickets, s: serie.map((p) => p.tickets) },
        { l: 'Unidades', c: cUnid, v: num(act.unid), a: act.unid, b: cmp?.unid, s: serie.map((p) => p.unid) },
        { l: 'Ticket promedio', c: cTkProm, v: act.tickets ? plata(act.monto / act.tickets) : '—', a: act.tickets ? act.monto / act.tickets : 0,
          b: cmp?.tickets ? cmp.monto / cmp.tickets : null, s: serie.map((p) => (p.tickets ? p.monto / p.tickets : 0)) },
        ...(datos?.anio.actual
          ? [{ l: 'Ticket prom. del año', c: cTkAnio,
              v: datos.anio.actual.tickets ? plata(datos.anio.actual.monto / datos.anio.actual.tickets) : '—',
              a: datos.anio.actual.tickets ? datos.anio.actual.monto / datos.anio.actual.tickets : 0,
              b: datos.anio.comp?.tickets ? datos.anio.comp.monto / datos.anio.comp.tickets : null, s: [] as number[],
              sub: `1/1 al ${fechaCorta(datos.anio.hasta)}`, cmpTxt: `vs ${Number(datos.anio.desde.slice(0, 4)) - 1} al mismo día` }]
          : []),
        { l: 'Unid. por ticket', c: cUpt, v: act.tickets ? (act.unid / act.tickets).toLocaleString('es-AR', { maximumFractionDigits: 2 }) : '—',
          a: act.tickets ? act.unid / act.tickets : 0, b: cmp?.tickets ? cmp.unid / cmp.tickets : null, s: serie.map((p) => (p.tickets ? p.unid / p.tickets : 0)) },
        { l: 'Precio prom. unidad', c: cPrecio, v: act.unid ? plata(act.monto / act.unid) : '—', a: act.unid ? act.monto / act.unid : 0,
          b: cmp?.unid ? cmp.monto / cmp.unid : null, s: serie.map((p) => (p.unid ? p.monto / p.unid : 0)) },
      ]
    : []

  const dowMax = Math.max(1, ...(datos?.dow ?? []).map((w) => w[dowMetrica]))
  const anios = datos?.marcas ?? []
  const totAnio = (m: (typeof anios)[number]) => ({ unid: m.MITO.unid + m.MARCAS.unid, monto: m.MITO.monto + m.MARCAS.monto })
  const ult = anios[anios.length - 1], ante = anios[anios.length - 2]
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
          <BarChart3 size={22} style={{ color: cVenta }} aria-hidden /> Análisis ventas
        </h1>
        <span className="rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold text-violet-300">Solo admin</span>
        <span className="text-xs text-sub/80">Venta de Dragon · montos con IVA · devoluciones restadas · días cerrados hasta ayer</span>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => setVuelta((v) => v + 1)} className="btn-press inline-flex h-8 items-center gap-1.5 rounded-lg border border-line2 bg-surface2 px-2.5 text-xs font-semibold text-ink hover:bg-line">
            {cargando ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualizar
          </button>
          <button type="button" disabled={!datos} onClick={bajarExcel} className="btn-press inline-flex h-8 items-center gap-1.5 rounded-lg border border-line2 bg-surface2 px-2.5 text-xs font-semibold text-ink hover:bg-line disabled:opacity-40">
            <Download size={14} /> Excel
          </button>
        </div>
      </header>

      {/* ---------- filtros ---------- */}
      <section className="mb-4 rounded-2xl border border-line bg-surface p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap overflow-hidden rounded-lg border border-line">
            {RAPIDOS.map(([r, t], i) => (
              <button key={r} type="button" onClick={() => elegirRapido(r)}
                className={`h-8 px-3 text-xs ${rapido === r ? 'bg-lime-500/15 font-semibold text-lime-300' : 'text-sub hover:text-ink'} ${i ? 'border-l border-line' : ''}`}>
                {t}
              </button>
            ))}
          </div>
          <input type="date" value={desde} min={datos?.desde_min} max={datos?.ayer} onChange={(e) => { setRapido(null); setDesde(e.target.value) }}
            className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs text-ink" />
          <span className="text-xs text-sub">a</span>
          <input type="date" value={hasta} min={datos?.desde_min} max={datos?.ayer} onChange={(e) => { setRapido(null); setHasta(e.target.value) }}
            className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs text-ink" />
          <span className="ml-2 text-xs text-sub">Comparar con</span>
          <Seg valor={comparar} onChange={setComparar} opciones={[['anio', 'Mismo período año pasado'], ['anterior', 'Período anterior'], ['nada', 'Nada']]} />
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Seg valor={origen} onChange={setOrigen} opciones={[['', 'Todos'], ['MITO', 'Zimith / Captain Fin'], ['MARCAS', 'Marcas']]} />
          <Seg valor={soloMinoristas ? 'si' : 'no'} onChange={(v) => { setSoloMinoristas(v === 'si'); setLocSel(new Set()) }}
            opciones={[['si', 'Solo locales'], ['no', 'Con mayorista y depósitos']]} />
          <label className="flex flex-col text-[11px] text-sub">
            Artículo
            <input value={art} onChange={(e) => setArt(e.target.value)} placeholder="Código o comienzo (A|B)"
              className="mt-1 h-9 w-48 rounded-lg border border-line bg-surface2 px-2 text-xs text-ink" />
          </label>
          {hayFiltros && <button type="button" className="h-9 text-xs text-sky-400" onClick={limpiar}>Limpiar filtros</button>}
        </div>
        <div className="mt-3 grid gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <FiltroDesplegable titulo="Locales" todos="Todos" opciones={opcionesLocales} valor={locSel} onChange={setLocSel} />
          {FILTROS.map((f) => (
            <FiltroDesplegable key={f.k} titulo={f.k === 'prov' ? 'Proveedor' : f.titulo} opciones={opcionesDe(f.k)} valor={sel[f.k]}
              onChange={(s) => setSel((p) => ({ ...p, [f.k]: s }))} todos={f.k === 'prov' ? 'Todos' : 'Todas'} />
          ))}
        </div>
      </section>

      {camino.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-100">
          Todo filtrado por
          {camino.map((c, i) => (
            <b key={i} className="rounded-lg border border-sky-500/40 px-2 py-0.5">{TITULO_DIM[c.dim]}: {c.label}</b>
          ))}
          <button type="button" className="ml-auto text-sky-300 underline" onClick={() => { setDim(camino[0].dim); setCamino([]) }}>Ver todo</button>
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {datos && incompleto && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          <Loader2 size={16} className="animate-spin" />
          Bajando del SQL la venta que falta ({datos.faltan.periodo + datos.faltan.comparado} días{datos.carga.desde ? `, ahora ${fechaCorta(datos.carga.desde)} al ${fechaCorta(datos.carga.hasta ?? datos.carga.desde)}` : ''}). Los números se completan solos.
        </div>
      )}
      {!datos && !error && (
        <div className="flex items-center gap-2 p-6 text-sm text-sub"><Loader2 size={16} className="animate-spin" /> Calculando…</div>
      )}

      {datos && act && (
        <>
          {/* ---------- KPIs ---------- */}
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            {kpis.map((k) => (
              <div key={k.l} className="relative overflow-hidden rounded-2xl border border-line bg-surface p-3">
                <div className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: k.c }}>{k.l}</div>
                <div className="mt-1 text-2xl font-extrabold tabular-nums tracking-tight text-ink">{k.v}</div>
                <div className="text-xs"><Variacion v={varPct(k.a, k.b)} /> <span className="text-sub">{'cmpTxt' in k ? k.cmpTxt : textoComp}</span></div>
                {'sub' in k && <div className="text-[11px] text-sub">{k.sub}</div>}
                <Sparkline valores={k.s} color={k.c} />
              </div>
            ))}
          </div>

          {/* ---------- Marcas vs Zimith / Captain Fin ---------- */}
          <section className="mb-4 rounded-2xl border border-line bg-surface p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-sub">
                <Scale size={15} style={{ color: cMarcas }} aria-hidden /> Marcas vs Zimith / Captain Fin · por año
              </h2>
              <div className="ml-auto">
                <Seg valor={corte} onChange={setCorte} opciones={[['dia', `Hasta el mismo día (${fechaCorta(datos.hasta).slice(0, 5)})`], ['anio', 'Año entero']]} />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm tabular-nums [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
                <thead className="text-[10px] uppercase tracking-wider text-sub">
                  <tr>
                    <th className="px-2 py-1 text-left" rowSpan={2}>Marca</th>
                    {anios.map((m) => <th key={m.anio} colSpan={2} className="px-2 py-1 text-center text-xs text-ink">{m.anio}{m.faltan ? ' *' : ''}</th>)}
                    {ante && <th colSpan={2} className="px-2 py-1 text-center text-amber-400">Var. {ult.anio} vs {ante.anio}</th>}
                  </tr>
                  <tr className="border-b border-line">
                    {anios.map((m) => [<th key={`${m.anio}u`} className="px-2 py-1 text-right">Unidades</th>, <th key={`${m.anio}m`} className="px-2 py-1 text-right">$ Total</th>])}
                    {ante && <><th className="px-2 py-1 text-right">Unidades</th><th className="px-2 py-1 text-right">$ Total</th></>}
                  </tr>
                </thead>
                <tbody>
                  {(['MARCAS', 'MITO'] as const).map((k) => (
                    <tr key={k} className="border-b border-line">
                      <td className="px-2 py-1.5 font-semibold text-ink">{k === 'MITO' ? 'ZIMITH / CAPTAIN FIN' : 'MARCAS'}</td>
                      {anios.map((m) => [<td key={`${m.anio}u`} className="px-2 py-1.5 text-right">{num(m[k].unid)}</td>, <td key={`${m.anio}m`} className="px-2 py-1.5 text-right">{plata(m[k].monto)}</td>])}
                      {ante && <><td className="px-2 py-1.5 text-right"><Variacion v={varPct(ult[k].unid, ante[k].unid)} /></td><td className="px-2 py-1.5 text-right"><Variacion v={varPct(ult[k].monto, ante[k].monto)} /></td></>}
                    </tr>
                  ))}
                  <tr className="border-b border-line bg-sky-500/5 font-bold text-ink">
                    <td className="px-2 py-1.5">Total general</td>
                    {anios.map((m) => [<td key={`${m.anio}u`} className="px-2 py-1.5 text-right">{num(totAnio(m).unid)}</td>, <td key={`${m.anio}m`} className="px-2 py-1.5 text-right">{plata(totAnio(m).monto)}</td>])}
                    {ante && <><td className="px-2 py-1.5 text-right"><Variacion v={varPct(totAnio(ult).unid, totAnio(ante).unid)} /></td><td className="px-2 py-1.5 text-right"><Variacion v={varPct(totAnio(ult).monto, totAnio(ante).monto)} /></td></>}
                  </tr>
                  {(['MARCAS', 'MITO'] as const).map((k) => (
                    <tr key={`p${k}`} className="text-sub">
                      <td className="px-2 py-1">% {k === 'MITO' ? 'ZIMITH / CAPTAIN FIN' : 'MARCAS'}</td>
                      {anios.map((m) => [<td key={`${m.anio}u`} className="px-2 py-1 text-right">{pct(m[k].unid, totAnio(m).unid)} %</td>, <td key={`${m.anio}m`} className="px-2 py-1 text-right">{pct(m[k].monto, totAnio(m).monto)} %</td>])}
                      {ante && <>
                        <td className="px-2 py-1 text-right">{(pct(ult[k].unid, totAnio(ult).unid) - pct(ante[k].unid, totAnio(ante).unid)).toLocaleString('es-AR', { signDisplay: 'always' })} pp</td>
                        <td className="px-2 py-1 text-right">{(pct(ult[k].monto, totAnio(ult).monto) - pct(ante[k].monto, totAnio(ante).monto)).toLocaleString('es-AR', { signDisplay: 'always' })} pp</td>
                      </>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-sub">
              Zimith / Captain Fin = proveedores que empiezan con MO; Marcas = el resto. Respeta locales, tipificaciones y artículo, pero no el período:
              {corte === 'dia' ? ` cada año va del 1/1 al ${fechaCorta(datos.hasta).slice(0, 5)}, así la variación es justa.` : ' años completos (el actual hasta ayer).'}
              {anios.some((m) => m.faltan) && ' * todavía faltan días de ese año en el puente.'}
            </p>
          </section>

          {/* ---------- Evolución + día de la semana ---------- */}
          <div className="mb-4 grid gap-4 xl:grid-cols-3">
            <section className="rounded-2xl border border-line bg-surface p-3 xl:col-span-2">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-sub">
                  <CalendarDays size={15} style={{ color: cEvo }} aria-hidden /> Evolución
                </h2>
                <div className="ml-auto flex flex-wrap gap-2">
                  <Seg valor={metrica} onChange={setMetrica} opciones={[['monto', '$ Venta'], ['tickets', 'Tickets'], ['unid', 'Unidades'], ['tprom', 'Ticket prom.']]} />
                  <Seg valor={gran} onChange={setGran} opciones={[['dia', 'Días'], ['sem', 'Semanas'], ['mes', 'Meses'], ['anio', 'Años']]} />
                </div>
              </div>
              <div className="mb-1 flex flex-wrap gap-4 text-[11px] text-sub">
                <span><i className="mr-1 inline-block h-[3px] w-3 rounded bg-lime-500 align-middle" />Período</span>
                {gran !== 'anio' && datos.comparado && <span><i className="mr-1 inline-block h-[3px] w-3 rounded bg-slate-500 align-middle" />Comparado</span>}
                {gran === 'dia' && <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-lime-300 align-middle" />Sábado y domingo</span>}
                {gran === 'mes' && <span>Con un período de menos de 2 meses se ven los últimos 12 meses.</span>}
                {gran === 'anio' && <span>Años completos (el actual hasta ayer), sin importar el período.</span>}
              </div>
              <GraficoEvolucion serie={serie} metrica={metrica} gran={gran} />
            </section>
            <section className="rounded-2xl border border-line bg-surface p-3">
              <div className="mb-2 flex items-center gap-2">
                <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-sub">
                  <CalendarDays size={15} style={{ color: cDow }} aria-hidden /> Día de la semana
                </h2>
                <div className="ml-auto"><Seg valor={dowMetrica} onChange={setDowMetrica} opciones={[['monto', '$ prom.'], ['tickets', 'Tickets prom.']]} /></div>
              </div>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                const w = datos.dow[d]
                return (
                  <div key={d} className="my-1.5 grid grid-cols-[78px_1fr_86px_60px] items-center gap-2 text-xs">
                    <span className="text-ink">{DIAS_SEM[d]}</span>
                    <div className="relative h-1.5 rounded bg-line">
                      <i className={`absolute inset-y-0 left-0 rounded ${d === 0 || d === 6 ? 'bg-sky-400' : 'bg-lime-500'}`} style={{ width: `${(w[dowMetrica] / dowMax) * 100}%` }} />
                    </div>
                    <b className="text-right tabular-nums text-ink">{dowMetrica === 'monto' ? millones(w.monto) : num(w.tickets)}</b>
                    <span className="text-right tabular-nums text-sub">{dowMetrica === 'monto' ? `${num(w.tickets)} tk` : `${w.dias} días`}</span>
                  </div>
                )
              })}
              <h3 className="mb-1 mt-4 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-sub">
                <Lightbulb size={15} className="text-amber-300" aria-hidden /> Lectura rápida
              </h3>
              {insights.map((x, i) => (
                <div key={i} className="flex gap-2 border-b border-line py-1.5 text-xs text-ink last:border-0">
                  <b className={`w-4 shrink-0 text-center ${x.color}`}>{x.icono}</b><span>{x.texto}</span>
                </div>
              ))}
            </section>
          </div>

          {/* ---------- Abrir por ---------- */}
          <section className="mb-4 rounded-2xl border border-line bg-surface p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-sub">
                <Table2 size={15} style={{ color: cTabla }} aria-hidden /> Abrir por
              </h2>
              <div className="flex flex-wrap gap-1">
                {DIMS_TABLA.map((d) => (
                  <button key={d} type="button" onClick={() => elegirDim(d)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${d === dim && !camino.length ? 'border-lime-500/60 bg-lime-500/10 text-lime-200' : d === dim ? 'border-sky-500/50 bg-sky-500/10 text-sky-200' : 'border-line text-sub hover:text-ink'}`}>
                    {TITULO_DIM[d]}
                  </button>
                ))}
              </div>
              <div className="ml-auto flex items-center gap-2 text-xs text-sub">
                Orden
                <select value={orden} onChange={(e) => setOrden(e.target.value as typeof orden)} className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs text-ink">
                  <option value="monto">$ Venta</option><option value="unid">Unidades</option><option value="tickets">Tickets</option><option value="var">Variación %</option>
                </select>
                Mostrar
                <select value={top} onChange={(e) => setTop(Number(e.target.value))} className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs text-ink">
                  <option value={20}>Top 20</option><option value={50}>Top 50</option><option value={100000}>Todos</option>
                </select>
              </div>
            </div>
            <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
              {camino.length ? (
                <>
                  <button type="button" className="text-sky-400 underline" onClick={() => { setDim(camino[0].dim); setCamino([]) }}>Todo</button>
                  {camino.map((c, i) => (
                    <span key={i} className="flex items-center gap-1.5">
                      ›
                      <button type="button" onClick={() => { setDim(SIGUIENTE[c.dim] ?? c.dim); setCamino(camino.slice(0, i + 1)) }}
                        className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 font-semibold text-sky-200">
                        {TITULO_DIM[c.dim]}: {c.label}
                      </button>
                    </span>
                  ))}
                  <span className="text-sub">› abierto por <b className="text-ink">{TITULO_DIM[dim]}</b></span>
                </>
              ) : (
                <span className="text-sub">Sin apertura: total de los filtros. Tocá una fila para abrirla por la siguiente tipificación; toda la pantalla queda filtrada por esa fila.</span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-[13px] tabular-nums [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
                <thead className="text-[10px] uppercase tracking-wider text-sub">
                  <tr className="border-b border-line">
                    <th className="px-2 py-2 text-left">{TITULO_DIM[dim]}</th>
                    <th className={`px-2 py-2 text-right ${orden === 'monto' ? 'text-lime-300' : ''}`}>$ Venta</th>
                    <th className="px-2 py-2 text-right">% part.</th>
                    <th className="px-2 py-2" />
                    <th className={`px-2 py-2 text-right ${orden === 'var' ? 'text-lime-300' : ''}`}>Var. vs comp.</th>
                    <th className={`px-2 py-2 text-right ${orden === 'unid' ? 'text-lime-300' : ''}`}>Unidades</th>
                    <th className={`px-2 py-2 text-right ${orden === 'tickets' ? 'text-lime-300' : ''}`}>Tickets</th>
                    <th className="px-2 py-2 text-right">Ticket prom.</th>
                    <th className="px-2 py-2 text-right">Precio prom.</th>
                    {datos.tabla.stock && <th className="px-2 py-2 text-right" title="Stock de hoy en todas las bases de los artículos que se vendieron">Stock hoy</th>}
                    {datos.tabla.stock && <th className="px-2 py-2 text-right" title="Stock hoy / unidades vendidas por semana en el período">Semanas stock</th>}
                    <th className="px-2 py-2 text-right">ABC</th>
                  </tr>
                </thead>
                <tbody>
                  {filasTabla.filas.slice(0, top).map((f) => {
                    const max = filasTabla.filas.reduce((m, x) => Math.max(m, x.monto), 1)
                    const sem = f.stock != null && f.unid > 0 ? f.stock / (f.unid / semanasPeriodo) : null
                    const sig = SIGUIENTE[dim]
                    const cl = filasTabla.abc.get(f.cod)
                    return (
                      <tr key={f.cod || '(vacío)'} className={`border-b border-line ${sig ? 'cursor-pointer hover:bg-white/[.04]' : ''}`}
                        onClick={() => { if (!sig) return; setCamino([...camino, { dim, cod: f.cod, label: etiqueta(dim, f.cod, f.nom) }]); setDim(sig) }}>
                        <td className="max-w-[340px] truncate px-2 py-1.5 font-semibold text-ink" title={etiqueta(dim, f.cod, f.nom)}>{etiqueta(dim, f.cod, f.nom)}</td>
                        <td className="px-2 py-1.5 text-right text-ink">{millones(f.monto)}</td>
                        <td className="px-2 py-1.5 text-right">{filasTabla.total ? ((f.monto / filasTabla.total) * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 }) : 0} %</td>
                        <td className="w-28 px-2 py-1.5">
                          <div className="relative h-1.5 rounded bg-line"><i className="absolute inset-y-0 left-0 rounded bg-gradient-to-r from-lime-700 to-lime-400" style={{ width: `${Math.max(0, (f.monto / max) * 100)}%` }} /></div>
                        </td>
                        <td className="px-2 py-1.5 text-right">{f.comp == null ? <span className="text-sub">—</span> : f.comp === 0 ? <span className="text-sky-300">nuevo</span> : <Variacion v={varPct(f.monto, f.comp)} />}</td>
                        <td className="px-2 py-1.5 text-right">{num(f.unid)}</td>
                        <td className="px-2 py-1.5 text-right">{num(f.tickets)}</td>
                        <td className="px-2 py-1.5 text-right">{f.tickets ? plata(f.monto / f.tickets) : '—'}</td>
                        <td className="px-2 py-1.5 text-right">{f.unid ? plata(f.monto / f.unid) : '—'}</td>
                        {datos.tabla.stock && <td className="px-2 py-1.5 text-right">{f.stock == null ? '—' : num(f.stock)}</td>}
                        {datos.tabla.stock && (
                          <td className={`px-2 py-1.5 text-right ${sem == null ? '' : sem < 2 ? 'text-red-400' : sem > 12 ? 'text-amber-400' : ''}`}>
                            {sem == null ? '—' : sem.toLocaleString('es-AR', { maximumFractionDigits: 1 })}
                          </td>
                        )}
                        <td className="px-2 py-1.5 text-right">
                          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-extrabold ${cl === 'A' ? 'bg-emerald-500/15 text-emerald-300' : cl === 'B' ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-500/15 text-slate-300'}`}>{cl}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-bold text-ink">
                    <td className="px-2 py-2">Total ({num(filasTabla.filas.length)})</td>
                    <td className="px-2 py-2 text-right">{millones(filasTabla.total)}</td>
                    <td className="px-2 py-2 text-right">100 %</td>
                    <td />
                    <td className="px-2 py-2 text-right"><Variacion v={varPct(act.monto, cmp?.monto)} /></td>
                    <td className="px-2 py-2 text-right">{num(act.unid)}</td>
                    <td className="px-2 py-2 text-right" title="Tickets distintos (no la suma de la columna)">{num(act.tickets)}*</td>
                    <td className="px-2 py-2 text-right">{act.tickets ? plata(act.monto / act.tickets) : '—'}</td>
                    <td className="px-2 py-2 text-right">{act.unid ? plata(act.monto / act.unid) : '—'}</td>
                    {datos.tabla.stock && <td />}
                    {datos.tabla.stock && <td />}
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-sub">
              ABC: A = 80 % de la venta, B = 15 %, C = 5 %. * Un ticket con prendas de dos valores cuenta en los dos: la suma de la columna Tickets da más que el total.
              {datos.tabla.stock && ' Semanas de stock: en rojo menos de 2, en ámbar más de 12.'}
            </p>
          </section>

          <section className="rounded-2xl border border-dashed border-amber-500/40 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-100/90">
            <b>Cómo se cuenta.</b> Venta $ = total del renglón con IVA (MNTPTOT) de facturas y tickets (TFC, FEN, FCV) menos notas de crédito
            (TNC, CEN, NCV), de las bases Dragon de cada local (mismos criterios que la vista del DWH). Tickets = comprobantes de venta distintos (una
            devolución no suma ticket). Unidades = vendidas menos devueltas. Ticket promedio = $ / tickets · UPT = unidades / tickets · Precio prom. =
            $ / unidades. «Solo locales» deja afuera la base mayorista MITO, Polo 52, Indo, Fábrica y otras que no son locales a la calle.
            Los días cerrados quedan guardados en el puente (D:\memoria ia\analisis), por eso la pantalla contesta en un segundo.
            {datos.carga.pendientes > 0 && ` Faltan ${num(datos.carga.pendientes)} días del historial (desde ${fechaCorta(datos.desde_min)}): se bajan solos por detrás.`}
          </section>
        </>
      )}
    </Layout>
  )
}
