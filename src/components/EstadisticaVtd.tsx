import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, Download, Loader2, PackageX, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { descripcionesMaestro } from '@/lib/descripcionArticulos'
import { cargarStockSku, stockSkuDe, type StockSku } from '@/lib/stockSku'

/* ------------------------------------------------------------------ */
/*  Estadística VTD (repos), dentro de Eficiencia mayorista: como la    */
/*  planilla de reposición, armada                                       */
/*  sola con la repo y lo que se hace en Mi repo.                       */
/*  Usa el período de la pantalla (FiltroPeriodo): en un día, esa repo; */
/*  en más días, una fila por repo del período. Siempre el cuadro por   */
/*  local.                                                              */
/*  HS total = reloj de la repo: del primer escaneo al último, contando una   */
/*  sola vez a las personas que trabajan en paralelo (no se suman los         */
/*  cronómetros de cada uno). Horas (por persona) = cronómetro ÷ personas;    */
/*  Prendas/HS = repo ÷ HS total.                                             */
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
  /** Reloj de la fila: primer escaneo (aceptado) y último (hecho) */
  inicio: string | null
  fin: string | null
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
  /** Cronómetro sumado (por persona) */
  segundos: number
  /** Reloj de la repo: del primer al último escaneo */
  reloj: number
  uniCrono: number
  personas: number
}

/** Avance de los pedidos de un motivo en el período (avance_vtd_rep) */
interface AvanceMotivo {
  motivo: string
  pedidos: number
  completos: number
  unidades: number
  unidades_ok: number
  /** faltantes: no se mandaron y no cuentan para el total */
  no_mandados: number
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

/** Una fila del detalle de lo no mandado (RPC vtd_no_mandados_det) */
interface FilaDetalle {
  local: string
  fecha: string
  pedido: number | null
  articulo: string
  descripcion: string | null
  color: string | null
  talle: string | null
  cantidad: number
  repuesto: number
  no_mandado: number
}

/**
 * Filas del Excel: una por artículo + color + talle (ordenado por esos tres),
 * con las cantidades sumadas y el stock real de ese SKU. Las filas que venían de
 * varios locales/pedidos quedan en una sola.
 */
function agruparParaExcel(filas: FilaDetalle[], stock: StockSku | null) {
  const grupos = new Map<string, { articulo: string; descripcion: string; color: string; talle: string; cantidad: number; noMandado: number; stock: number | null }>()
  for (const f of filas) {
    const clave = `${f.articulo}|${f.color ?? ''}|${f.talle ?? ''}`
    const g = grupos.get(clave)
    if (g) {
      g.cantidad += f.cantidad
      g.noMandado += f.no_mandado
      if (!g.descripcion && f.descripcion) g.descripcion = f.descripcion
    } else {
      grupos.set(clave, {
        articulo: f.articulo,
        descripcion: f.descripcion ?? '',
        color: f.color ?? '',
        talle: f.talle ?? '',
        cantidad: f.cantidad,
        noMandado: f.no_mandado,
        stock: stockSkuDe(stock, f.articulo, f.color, f.talle),
      })
    }
  }
  const orden = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  return [...grupos.values()]
    .sort((a, b) => orden(a.articulo, b.articulo) || orden(a.color, b.color) || orden(a.talle, b.talle))
    .map((g) => ({
      Articulo: g.articulo,
      Descripcion: g.descripcion,
      Color: g.color,
      Talle: g.talle,
      Cantidad: g.cantidad,
      'Stock real': g.stock ?? '—',
      'No mandado': g.noMandado,
    }))
}

const n0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const n2 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num2 = (v: number | null) => (v == null || !isFinite(v) ? '—' : n2.format(v))
/** Segundos como horas y minutos: 8 min · 1 h 40 min */
const hm = (seg: number) => {
  if (!seg || seg <= 0) return '—'
  const min = Math.round(seg / 60)
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const deIso = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const sumarDias = (s: string, n: number) => { const d = deIso(s); d.setDate(d.getDate() + n); return iso(d) }
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
  const m = new Map<string, Repo & { resp: Set<string>; ini: number | null; fin: number | null }>()
  for (const f of filas) {
    let r = m.get(f.lote_id)
    if (!r) {
      r = {
        loteId: f.lote_id, fecha: f.fecha, ventaFecha: f.venta_fecha, nombre: f.lote_nombre ?? '',
        finalizada: f.lote_estado === 'finalizado', locales: 0, venta: 0, repo: 0, noMandados: 0, segundos: 0, reloj: 0, uniCrono: 0, personas: 0,
        resp: new Set(), ini: null, fin: null,
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
    // Reloj de la repo: el primer escaneo y el último, sin sumar a cada persona
    const i = f.inicio ? new Date(f.inicio).getTime() : null
    const x = f.fin ? new Date(f.fin).getTime() : null
    if (i != null && (r.ini == null || i < r.ini)) r.ini = i
    if (x != null && (r.fin == null || x > r.fin)) r.fin = x
  }
  return [...m.values()]
    .map(({ resp, ini, fin, ...r }) => ({ ...r, personas: resp.size, reloj: ini != null && fin != null && fin > ini ? Math.round((fin - ini) / 1000) : 0 }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
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
  return [...m.values()].map(({ resp, ...r }) => ({ ...r, responsable: [...resp].join(', ') || '—' })).sort((a, b) => a.local.localeCompare(b.local, 'es')) // por local, en orden alfabético
}

/**
 * % mandado (verde) y % no mandado (rojo) sobre el total pedido. Cuando ya no queda nada
 * pendiente, los dos suman 100 (ej. 98 % + 2 %); lo que falta hacer queda en gris.
 */
function porcentajes(total: number, ok: number, no: number): { ok: number; no: number; terminado: boolean } {
  if (total <= 0) return { ok: 0, no: 0, terminado: false }
  const terminado = ok + no >= total
  const pNo = Math.round((no / total) * 100)
  const pOk = terminado ? 100 - pNo : Math.min(100 - pNo, Math.floor((ok / total) * 100))
  return { ok: pOk, no: pNo, terminado }
}

/** Barra de dos colores: mandado (verde) + no mandado (rojo); el resto, pendiente */
function BarraAvance({ ok, no, alto = 'h-2.5' }: { ok: number; no: number; alto?: string }) {
  return (
    <div className={`flex ${alto} w-full overflow-hidden rounded-full bg-line`}>
      <div className="h-full bg-emerald-500 transition-all" style={{ width: `${ok}%` }} />
      <div className="h-full bg-red-500 transition-all" style={{ width: `${no}%` }} />
    </div>
  )
}

const horasPer = (r: { segundos: number }) => (r.segundos > 0 ? r.segundos / 3600 : null)
/** Prendas por hora: solo lo escaneado con el cronómetro en marcha, dividido esas horas */
const prendasHs = (r: { segundos: number; uniCrono: number }) => (r.segundos > 0 ? r.uniCrono / (r.segundos / 3600) : null)
/** Horas del reloj de la repo (del primer al último escaneo) */
const horasReloj = (r: { reloj: number }) => (r.reloj > 0 ? r.reloj / 3600 : null)
/** Prendas por hora con el reloj de la repo: no se suman las personas que trabajan en paralelo */
const prendasHsReloj = (r: { reloj: number; uniCrono: number }) => (r.reloj > 0 ? r.uniCrono / (r.reloj / 3600) : null)

function Dif({ a, b }: { a: number; b: number }) {
  if (!b) return null
  const p = Math.round(((a - b) / b) * 100)
  return <span className={p >= 0 ? 'text-emerald-500' : 'text-red-400'}>{p >= 0 ? '▲' : '▼'} {Math.abs(p)}%</span>
}

function Kpi({ titulo, color, valor, pie, onClick, ayuda }: {
  titulo: string; color: string; valor: string; pie: React.ReactNode; onClick?: () => void; ayuda?: string
}) {
  const cuerpo = (
    <>
      <p className="truncate text-[10px] font-bold uppercase tracking-wide" style={{ color }}>{titulo}</p>
      <p className="font-display text-2xl font-extrabold tabular-nums text-ink">{valor}</p>
      <p className="truncate text-[11px] text-sub">{pie}</p>
    </>
  )
  if (!onClick) {
    return <div className="min-w-0 rounded-2xl border bg-surface p-3" style={{ borderColor: `${color}40` }}>{cuerpo}</div>
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={ayuda}
      className="group relative min-w-0 rounded-2xl border bg-surface p-3 text-left transition hover:bg-surface2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500/60"
      style={{ borderColor: `${color}40` }}
    >
      <span aria-hidden className="absolute right-2 top-1.5 text-lg leading-none transition group-hover:opacity-100" style={{ color, opacity: 0.45 }}>›</span>
      {cuerpo}
    </button>
  )
}

export default function EstadisticaVtd({ desde, hasta, onVerDia }: {
  /** Período de la pantalla (FiltroPeriodo): el mismo para todas las secciones */
  desde: string
  hasta: string
  /** Tocar una repo del período: la pantalla pasa a ese día */
  onVerDia?: (fecha: string) => void
}) {
  const unDia = desde === hasta
  const largo = Math.max(1, Math.round((new Date(hasta + 'T12:00').getTime() - new Date(desde + 'T12:00').getTime()) / 86400000) + 1)
  // Para comparar: el período anterior del mismo largo (en un día, la última repo anterior: 14 días hacia atrás)
  const desdeAnt = sumarDias(desde, unDia ? -14 : -largo)
  const [filas, setFilas] = useState<Fila[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Detalle de lo no mandado: se abre al tocar el recuadro (RPC vtd_no_mandados_det)
  const [det, setDet] = useState<FilaDetalle[] | null>(null)
  const [detCargando, setDetCargando] = useState(false)
  const [detError, setDetError] = useState<string | null>(null)
  // Stock real por SKU (Puente SQL): reemplaza a lo repuesto en el detalle y en el Excel
  const [stock, setStock] = useState<StockSku | null>(null)
  // Cada apertura lleva un número: si cerrás el detalle antes de que llegue la respuesta, se descarta
  const detSeq = useRef(0)

  const cerrarDetalle = useCallback(() => { detSeq.current++; setDet(null) }, [])

  const abrirDetalle = useCallback(async () => {
    const seq = ++detSeq.current
    setDet([]); setDetCargando(true); setDetError(null)
    // El stock real (Puente SQL) se trae en paralelo y queda cacheado: si falla, se muestra «—»
    cargarStockSku()
      .then((s) => { if (seq === detSeq.current) setStock(s) })
      .catch(() => {})
    if (!supabase) { setDetCargando(false); return }
    const { data, error: e } = await supabase.rpc('vtd_no_mandados_det', { p_desde: desde, p_hasta: hasta })
    if (seq !== detSeq.current) return
    if (e) { setDetError(e.message); setDetCargando(false); return }
    const detalle = ((data as FilaDetalle[] | null) ?? []).map((f) => ({
      ...f,
      cantidad: Number(f.cantidad) || 0,
      repuesto: Number(f.repuesto) || 0,
      no_mandado: Number(f.no_mandado) || 0,
    }))
    setDet(detalle)
    setDetCargando(false)
    // Las repos subidas no traen descripción: la buscamos en el maestro de artículos
    const faltan = [...new Set(detalle.filter((f) => !f.descripcion).map((f) => f.articulo).filter(Boolean))]
    if (faltan.length === 0) return
    const maestro = await descripcionesMaestro(faltan)
    if (seq !== detSeq.current || maestro.size === 0) return
    setDet((prev) => (prev ?? []).map((f) => (f.descripcion ? f : { ...f, descripcion: maestro.get((f.articulo ?? '').trim().toUpperCase()) ?? null })))
  }, [desde, hasta])

  /** Baja el detalle a Excel: agrupado por artículo + color + talle, con las cantidades sumadas y el stock real. */
  const bajarDetalle = useCallback(async () => {
    if (!det || det.length === 0) return
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(agruparParaExcel(det, stock)), 'No mandados')
    XLSX.writeFile(wb, `no_mandados_${desde}_a_${hasta}.xlsx`)
  }, [det, stock, desde, hasta])

  const cargar = useCallback(async () => {
    if (!supabase) return
    setCargando(true)
    setError(null)
    const { data, error: e } = await supabase.rpc('estadistica_vtd', { p_desde: desdeAnt, p_hasta: hasta })
    if (e) setError(e.message)
    else setFilas(((data as Fila[] | null) ?? []).map((f) => ({ ...f, venta: Number(f.venta) || 0, repo: Number(f.repo) || 0, faltante: Number(f.faltante) || 0, segundos: Number(f.segundos) || 0, uni_crono: Number(f.uni_crono) || 0 })))
    setCargando(false)
  }, [desdeAnt, hasta])
  useEffect(() => { void cargar() }, [cargar])

  // Avance del total de pedidos VTD y REP del período (sql/avance_vtd_rep.sql)
  const [avance, setAvance] = useState<AvanceMotivo[]>([])
  useEffect(() => {
    if (!supabase) return
    let vivo = true
    void supabase.rpc('avance_vtd_rep', { p_desde: desde, p_hasta: hasta }).then(({ data }) => {
      if (vivo) setAvance(((data as AvanceMotivo[] | null) ?? []).map((a) => ({ ...a, unidades: Number(a.unidades) || 0, unidades_ok: Number(a.unidades_ok) || 0, no_mandados: Number(a.no_mandados) || 0 })))
    })
    return () => { vivo = false }
  }, [desde, hasta, filas])

  const repos = useMemo(() => agruparRepos(filas), [filas])
  const periodo = useMemo(() => repos.filter((r) => r.fecha >= desde && r.fecha <= hasta), [repos, desde, hasta])
  // Anterior: en un día, la última fecha con repo antes; si no, el período anterior del mismo largo
  const anterior = useMemo(() => {
    const previas = repos.filter((r) => r.fecha < desde)
    if (!unDia) return previas
    const ultima = previas[previas.length - 1]?.fecha
    return ultima ? previas.filter((r) => r.fecha === ultima) : []
  }, [repos, desde, unDia])
  const filasPeriodo = useMemo(() => filas.filter((f) => f.fecha >= desde && f.fecha <= hasta), [filas, desde, hasta])
  const filasLocal = useMemo(() => agruparLocales(filasPeriodo), [filasPeriodo])
  const personas = useMemo(() => new Set(filasPeriodo.map((f) => f.responsable_id).filter(Boolean)).size, [filasPeriodo])

  const suma = (rs: Repo[]) => rs.reduce(
    (s, r) => ({ venta: s.venta + r.venta, repo: s.repo + r.repo, noMandados: s.noMandados + r.noMandados, segundos: s.segundos + r.segundos, reloj: s.reloj + r.reloj, uniCrono: s.uniCrono + r.uniCrono }),
    { venta: 0, repo: 0, noMandados: 0, segundos: 0, reloj: 0, uniCrono: 0 },
  )
  const tot = suma(periodo)
  const totAnt = suma(anterior)
  const conHoras = periodo.filter((r) => r.segundos > 0)
  const conReloj = periodo.filter((r) => r.reloj > 0)
  const promHoras = conHoras.length ? conHoras.reduce((s, r) => s + r.segundos / 3600 / Math.max(1, r.personas), 0) / conHoras.length : null
  const promPph = conReloj.length ? conReloj.reduce((s, r) => s + (prendasHsReloj(r) ?? 0), 0) / conReloj.length : null
  const vsTxt = unDia ? 'vs repo anterior' : 'vs período anterior'
  // Totales del detalle de lo no mandado que está abierto (el stock no se suma)
  const totDet = (det ?? []).reduce(
    (s, f) => ({ cantidad: s.cantidad + f.cantidad, noMandado: s.noMandado + f.no_mandado }),
    { cantidad: 0, noMandado: 0 },
  )
  const localesDet = new Set((det ?? []).map((f) => f.local)).size

  return (
    <section className="mb-6">
      <div className="mb-3 flex min-w-0 items-center gap-3">
        <div className="rounded-xl border p-2" style={{ color: '#0ea5e9', backgroundColor: '#0ea5e924', borderColor: '#0ea5e940' }}>
          <BarChart3 size={18} aria-hidden />
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-ink">Estadística VTD (repos)</h2>
          <p className="truncate text-sm text-sub">
            {unDia
              ? periodo[0]?.ventaFecha ? `Repo del ${corta(desde)} · venta ${corta(periodo[0].ventaFecha)}` : `Repo del ${corta(desde)}`
              : `${periodo.length} repo${periodo.length === 1 ? '' : 's'} del ${corta(desde)} al ${corta(hasta)}`}
            {' '}· con lo hecho en Mi repo
          </p>
        </div>
      </div>

      {/* Cómo va el total de VTD y REP del día (o del período) */}
      {avance.length > 0 && (
        <div className="mb-4 grid gap-2 sm:grid-cols-2">
          {[...avance].sort((a, b) => a.motivo.localeCompare(b.motivo)).reverse().map((a) => {
            const pc = porcentajes(a.unidades, a.unidades_ok, a.no_mandados)
            const faltan = Math.max(0, a.unidades - a.unidades_ok - a.no_mandados)
            const color = a.motivo === 'VTD' ? '#14b8a6' : '#ec4899'
            return (
              <div key={a.motivo} className="rounded-2xl border bg-surface p-3" style={{ borderColor: `${color}40` }}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color }}>
                    {a.motivo === 'VTD' ? 'Venta diaria (VTD)' : 'Reposición (REP)'} · unidades
                  </p>
                  <p className="font-display text-2xl font-extrabold tabular-nums">
                    <span className="text-emerald-500">{pc.ok}%</span>
                    {pc.no > 0 && <span className="ml-1.5 text-red-500">{pc.no}%</span>}
                  </p>
                </div>
                <div className="mt-1.5"><BarraAvance ok={pc.ok} no={pc.no} /></div>
                <p className="mt-1 text-sm text-sub">
                  <span className="text-emerald-500"><b className="tabular-nums">{n0.format(a.unidades_ok)}</b> mandadas</span>
                  {a.no_mandados > 0 && <> · <span className="text-red-400"><b className="tabular-nums">{n0.format(a.no_mandados)}</b> no mandadas</span></>}
                  {' '}de <b className="tabular-nums text-ink">{n0.format(a.unidades)}</b>
                  {faltan > 0 ? <> · faltan <b className="tabular-nums text-ink">{n0.format(faltan)}</b></> : ''}
                  <span className="ml-1 text-[11px]">({a.completos}/{a.pedidos} pedidos completos)</span>
                </p>
              </div>
            )
          })}
        </div>
      )}

      {error && <p className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}
      {cargando && filas.length === 0 ? (
        <p className="flex items-center gap-2 py-10 text-sm text-sub"><Loader2 size={16} className="animate-spin" /> Cargando…</p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2.5 md:grid-cols-5">
            <Kpi titulo="Cant venta" color="#22c55e" valor={n0.format(tot.venta)} pie={<><Dif a={tot.venta} b={totAnt.venta} /> {vsTxt}</>} />
            <Kpi titulo="Cant repo" color="#38bdf8" valor={n0.format(tot.repo)} pie={tot.venta ? `${Math.round((tot.repo / tot.venta) * 100)}% de la venta` : '—'} />
            <Kpi
              titulo="No mandados"
              color="#f87171"
              valor={n0.format(tot.noMandados)}
              pie={tot.venta ? `${n2.format((tot.noMandados / tot.venta) * 100)}% de la venta` : '—'}
              onClick={() => void abrirDetalle()}
              ayuda="Ver los artículos que no se encontraron"
            />
            <Kpi titulo="HS total (Mi repo)" color="#a78bfa" valor={hm(tot.reloj)} pie={tot.reloj > 0 ? `${num2(prendasHsReloj(tot))} prendas/HS` : 'sin horario de Mi repo'} />
            <Kpi
              titulo={unDia ? 'Personas' : 'Repos'}
              color="#f59e0b"
              valor={String(unDia ? personas : periodo.length)}
              pie={unDia ? 'que trabajaron la repo' : `${personas} personas en el período`}
            />
          </div>

          {!unDia && (
            <section className="mb-4 rounded-2xl border border-line bg-surface p-3">
              <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-sub">Repos del período</h2>
              <table className="w-full table-fixed text-[12px] sm:text-[13px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-sub">
                    <th className="w-[23%] sm:w-[14%] py-1.5 text-left">Repo</th>
                    <th className="hidden py-1.5 md:table-cell">Venta</th>
                    <th className="py-1.5 text-right">Cant venta</th>
                    <th className="py-1.5 text-right">Cant repo</th>
                    <th className="py-1.5 text-right">No mand.</th>
                    <th className="hidden py-1.5 text-right lg:table-cell">Locales</th>
                    <th className="py-1.5 text-right"><span className="block text-[12px] font-extrabold normal-case text-amber-500">{num2(promHoras)}</span><span title="Promedio por persona: cronómetro ÷ personas">Horas</span></th>
                    <th className="hidden py-1.5 text-right sm:table-cell">Pers.</th>
                    <th className="hidden py-1.5 text-right md:table-cell" title="Reloj de la repo: del primer escaneo al último (el trabajo en paralelo cuenta una sola vez)">HS total</th>
                    <th className="py-1.5 text-right" title="Prendas escaneadas con el cronómetro ÷ HS total"><span className="block text-[12px] font-extrabold normal-case text-amber-500">{num2(promPph)}</span>Prend/HS</th>
                    <th className="hidden py-1.5 text-right sm:table-cell">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {periodo.map((r) => {
                    const hp = horasPer(r)
                    return (
                      <tr
                        key={r.loteId}
                        onClick={() => onVerDia?.(r.fecha)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onVerDia?.(r.fecha) } }}
                        tabIndex={0}
                        role="button"
                        aria-label={`Ver el repo del ${corta(r.fecha)}`}
                        className="cursor-pointer border-t border-line outline-none hover:bg-line/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500/60"
                        title={r.nombre}
                      >
                        <td className="truncate py-1.5 font-semibold text-ink">{corta(r.fecha)}</td>
                        <td className="hidden truncate py-1.5 text-center text-sub md:table-cell">{corta(r.ventaFecha)}</td>
                        <td className="py-1.5 text-right font-bold tabular-nums text-emerald-500">{n0.format(r.venta)}</td>
                        <td className="py-1.5 text-right tabular-nums text-ink">{n0.format(r.repo)}</td>
                        <td className="py-1.5 text-right font-semibold tabular-nums text-red-400">{n0.format(r.noMandados)}</td>
                        <td className="hidden py-1.5 text-right tabular-nums lg:table-cell">{r.locales}</td>
                        <td className="py-1.5 text-right tabular-nums">{hp ? num2(hp / Math.max(1, r.personas)) : '—'}</td>
                        <td className="hidden py-1.5 text-right tabular-nums sm:table-cell">{r.personas}</td>
                        <td className="hidden py-1.5 text-right tabular-nums md:table-cell">{num2(horasReloj(r))}</td>
                        <td className="py-1.5 text-right font-bold tabular-nums">{num2(prendasHsReloj(r))}</td>
                        <td className="hidden py-1.5 text-right sm:table-cell">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${r.finalizada ? 'bg-emerald-500/15 text-emerald-500' : 'bg-amber-500/15 text-amber-500'}`}>
                            {r.finalizada ? 'FINALIZADA' : 'EN PROCESO'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                  {periodo.length === 0 && (
                    <tr><td colSpan={11} className="py-4 text-center text-sub">No hay repos en este período.</td></tr>
                  )}
                </tbody>
              </table>
            </section>
          )}

          <section className="rounded-2xl border border-line bg-surface p-3">
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-sub">
              Por local · {unDia ? (periodo.length ? `repo del ${corta(desde)}` : 'sin repo ese día') : 'suma del período'}
            </h2>
            <table className="w-full table-fixed text-[12px] sm:text-[13px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-sub">
                  <th className="w-[22%] py-1.5 text-left sm:w-[14%]">Local</th>
                  <th className="hidden py-1.5 text-left sm:table-cell">Responsable</th>
                  <th className="py-1.5 text-right">Venta</th>
                  <th className="py-1.5 text-right">Repo</th>
                  <th className="py-1.5 text-right">No mand.</th>
                  <th className="py-1.5 pl-2 text-right sm:pl-3 md:text-left">Avance</th>
                  <th className="py-1.5 text-right">Horas</th>
                  <th className="hidden py-1.5 text-right sm:table-cell">Prend/HS</th>
                </tr>
              </thead>
              <tbody>
                {filasLocal.map((l) => {
                  // mismo criterio que la barra de arriba: mandado (verde) + no mandado (rojo)
                  const pc = porcentajes(l.venta, l.repo, l.noMandados)
                  return (
                    <tr key={l.local} className="border-t border-line">
                      <td className="truncate py-1.5 font-semibold text-ink">{l.local}</td>
                      <td className="hidden truncate py-1.5 text-sub sm:table-cell">{l.responsable}</td>
                      <td className="py-1.5 text-right font-bold tabular-nums text-emerald-500">{n0.format(l.venta)}</td>
                      <td className="py-1.5 text-right tabular-nums">{n0.format(l.repo)}</td>
                      <td className="py-1.5 text-right font-semibold tabular-nums text-red-400">{l.noMandados ? n0.format(l.noMandados) : '—'}</td>
                      <td className="py-1.5 pl-2 sm:pl-3">
                        <div className="flex items-center gap-2">
                          <div className="hidden flex-1 md:block"><BarraAvance ok={pc.ok} no={pc.no} alto="h-1.5" /></div>
                          <span className="shrink-0 text-right text-[11px] font-bold tabular-nums">
                            <span className="text-emerald-500">{pc.ok}%</span>
                            {pc.no > 0 && <span className="ml-1 text-red-500">{pc.no}%</span>}
                          </span>
                        </div>
                      </td>
                      <td className="py-1.5 text-right leading-tight tabular-nums">{hm(l.segundos)}</td>
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
            HS total: el reloj de la repo, del primer escaneo al último, contando una sola vez a las personas que trabajaron en paralelo
            (no se suman los cronómetros). Horas: promedio por persona (cronómetro ÷ personas). En el cuadro por local, las horas son las de
            ese local (cronómetro del armado). Si nadie usó el cronómetro, queda «—». Tocá una repo del período para ver ese día.
          </p>
        </>
      )}

      {/* Detalle de lo no mandado: una fila por artículo que no se encontró */}
      {det !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 backdrop-blur-sm sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Artículos no mandados"
          onClick={cerrarDetalle}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-soft-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 border-b border-line px-5 py-3">
              <div>
                <h2 className="flex items-center gap-2 font-display font-semibold text-ink">
                  <PackageX size={17} className="text-red-400" aria-hidden /> Artículos no mandados
                </h2>
                <p className="mt-0.5 text-xs text-sub">
                  No se encontraron en el depósito · {unDia ? `repo del ${corta(desde)}` : `del ${corta(desde)} al ${corta(hasta)}`}
                </p>
              </div>
              <button type="button" onClick={cerrarDetalle} aria-label="Cerrar" className="rounded-lg p-1.5 text-sub transition hover:bg-line hover:text-ink">
                <X size={18} aria-hidden />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-3">
              {detError && <p role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{detError}</p>}
              {detCargando && det.length === 0 ? (
                <p className="flex items-center gap-2 py-10 text-sm text-sub"><Loader2 size={16} className="animate-spin" aria-hidden /> Cargando…</p>
              ) : det.length === 0 ? (
                <p className="py-8 text-center text-sm text-sub">No hay artículos no mandados en este período.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-line">
                  <table className="w-full table-auto border-collapse text-[12.5px] leading-tight">
                    <thead>
                      <tr className="table-head text-left text-[10px] font-semibold uppercase tracking-wider">
                        <th className="whitespace-nowrap px-3 py-2">Local</th>
                        <th className="whitespace-nowrap px-3 py-2">Pedido</th>
                        <th className="whitespace-nowrap px-3 py-2">Artículo</th>
                        <th className="px-3 py-2">Descripción</th>
                        <th className="px-3 py-2 text-center">Color</th>
                        <th className="px-3 py-2 text-center">Talle</th>
                        <th className="px-3 py-2 text-center">Pedido</th>
                        <th className="px-3 py-2 text-center">Stock</th>
                        <th className="px-3 py-2 text-center">No mand.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {det.map((f, i) => {
                        const st = stockSkuDe(stock, f.articulo, f.color, f.talle)
                        return (
                          <tr key={`${f.local}-${f.pedido ?? 'r'}-${f.articulo}-${f.color ?? ''}-${f.talle ?? ''}-${i}`}>
                            <td className="whitespace-nowrap px-3 py-2 font-semibold text-ink">{f.local}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-sub">{f.pedido ? `N° ${n0.format(f.pedido)}` : '—'}</td>
                            <td className="whitespace-nowrap px-3 py-2 font-medium text-ink">{f.articulo}</td>
                            <td className="px-3 py-2 text-sub">{f.descripcion || '—'}</td>
                            <td className="px-3 py-2 text-center text-sub">{f.color || '—'}</td>
                            <td className="px-3 py-2 text-center text-sub">{f.talle || '—'}</td>
                            <td className="px-3 py-2 text-center tabular-nums">{n0.format(f.cantidad)}</td>
                            <td className={`px-3 py-2 text-center tabular-nums ${st === null ? 'text-sub' : st > 0 ? 'font-semibold text-emerald-500' : 'font-semibold text-red-400'}`} title="Stock real de MITO de ese color y talle">
                              {st === null ? '—' : n0.format(st)}
                            </td>
                            <td className="px-3 py-2 text-center font-bold tabular-nums text-red-400">{n0.format(f.no_mandado)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-line text-[12px]" style={{ backgroundColor: 'rgba(255,255,255,.04)' }}>
                        <td className="px-3 py-2 font-semibold text-ink" colSpan={6}>
                          {n0.format(det.length)} artículo{det.length === 1 ? '' : 's'} en {n0.format(localesDet)} local{localesDet === 1 ? '' : 'es'}
                        </td>
                        <td className="px-3 py-2 text-center font-bold tabular-nums text-ink">{n0.format(totDet.cantidad)}</td>
                        <td className="px-3 py-2 text-center font-bold text-sub" title="El stock no se suma">—</td>
                        <td className="px-3 py-2 text-center font-bold tabular-nums text-red-400">{n0.format(totDet.noMandado)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
              <p className="min-w-0 text-[11px] text-sub">Lo marcado como <b className="text-ink">faltante</b> en Mi repo. El <b className="text-ink">Stock</b> es el real de MITO de ese color y talle. El Excel sale agrupado por artículo + color + talle.</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void bajarDetalle()}
                  disabled={det.length === 0}
                  className="btn-press inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink transition hover:bg-surface2 disabled:opacity-50"
                >
                  <Download size={15} aria-hidden /> Excel
                </button>
                <button type="button" onClick={cerrarDetalle} className="btn-press inline-flex h-9 items-center rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink transition hover:bg-surface2">
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
