import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Loader2, TrendingUp, TrendingDown, Boxes, Building2, CheckCircle2, Timer, X, RefreshCw,
  Download, AlertTriangle, Clock, Minus,
} from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, Legend,
  ComposedChart, Area, Line,
} from 'recharts'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'

interface ItemTf {
  id: string
  lote_id: string
  origen: string
  destino: string
  articulo: string | null
  cantidad: number
  estado: string
  created_at?: string
  hecho_at?: string | null
}
interface LoteTf { id: string; nombre: string; motivo: string | null; fecha: string; created_at: string }

const PALETA = ['#8b5cf6', '#22d3ee', '#f472b6', '#34d399', '#fbbf24', '#60a5fa', '#f87171', '#a3e635', '#e879f9', '#fb923c', '#c084fc', '#94a3b8']
const NOMBRES_ESTADO: Record<string, string> = { pendiente: 'Pendiente', hecho: 'Hecho', faltante: 'Faltante', senado: 'Señado' }
const ESTADOS_LISTOS = new Set(['hecho', 'senado'])
const REFRESCO_MS = 45000

/** Tooltip con los colores del tema (el de recharts viene blanco). */
const TOOLTIP = {
  contentStyle: {
    background: 'var(--surface)',
    border: '1px solid var(--line)',
    borderRadius: 12,
    fontSize: 12,
    color: 'var(--ink)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
  },
  labelStyle: { color: 'var(--sub)', fontSize: 11, marginBottom: 2 },
  itemStyle: { color: 'var(--ink)' },
  cursor: { fill: 'rgba(148,163,184,0.12)' },
}

async function traerTodo<T>(fn: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<{ filas: T[]; error: string | null }> {
  const out: T[] = []
  const B = 1000
  for (let from = 0; from < 100000; from += B) {
    const { data, error } = await fn(from, from + B - 1)
    if (error) return { filas: out, error: error.message }
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < B) break
  }
  return { filas: out, error: null }
}

function horasEntre(a: string, b: string): number | null {
  const t1 = new Date(a).getTime()
  const t2 = new Date(b).getTime()
  if (isNaN(t1) || isNaN(t2)) return null
  const ms = t2 - t1
  return ms > 0 ? ms / 3600000 : null
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const sumarDias = (fechaIso: string, dias: number) => {
  const d = new Date(fechaIso + 'T00:00:00')
  d.setDate(d.getDate() + dias)
  return iso(d)
}
const diasEntre = (a: string, b: string) =>
  Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000)

type Preset = 'hoy' | '7d' | '30d' | 'mes' | 'mesPasado' | 'todo' | 'custom'
const PRESETS: { id: Preset; label: string }[] = [
  { id: 'hoy', label: 'Hoy' },
  { id: '7d', label: '7 días' },
  { id: '30d', label: '30 días' },
  { id: 'mes', label: 'Este mes' },
  { id: 'mesPasado', label: 'Mes pasado' },
  { id: 'todo', label: 'Todo' },
]

/** Rango de fechas según el preset elegido. */
function resolverRango(preset: Preset, desde: string, hasta: string): { desde: string; hasta: string } {
  const hoy = iso(new Date())
  switch (preset) {
    case 'hoy': return { desde: hoy, hasta: hoy }
    case '7d': return { desde: sumarDias(hoy, -6), hasta: hoy }
    case '30d': return { desde: sumarDias(hoy, -29), hasta: hoy }
    case 'mes': return { desde: hoy.slice(0, 8) + '01', hasta: hoy }
    case 'mesPasado': {
      const d = new Date(hoy + 'T00:00:00')
      const fin = new Date(d.getFullYear(), d.getMonth(), 0)
      const ini = new Date(d.getFullYear(), d.getMonth() - 1, 1)
      return { desde: iso(ini), hasta: iso(fin) }
    }
    case 'todo': return { desde: '', hasta: '' }
    default: return { desde, hasta }
  }
}

type Gran = 'dia' | 'semana' | 'mes'
/** Etiqueta del período al que pertenece una fecha. */
function clavePeriodo(fechaIso: string, gran: Gran): string {
  if (gran === 'mes') return fechaIso.slice(0, 7)
  if (gran === 'dia') return fechaIso
  const d = new Date(fechaIso + 'T00:00:00')
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // lunes de esa semana
  return iso(d)
}

const nf = (n: number) => n.toLocaleString('es-AR')

export default function EstadisticasTransferencias() {
  const [params, setParams] = useSearchParams()
  const [items, setItems] = useState<ItemTf[]>([])
  const [lotes, setLotes] = useState<LoteTf[]>([])
  const [cargando, setCargando] = useState(true)
  const [refrescando, setRefrescando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [auto, setAuto] = useState(true)
  const [actualizado, setActualizado] = useState<Date | null>(null)
  const [ahora, setAhora] = useState(Date.now())
  const firma = useRef<string>('')

  // ── Filtros (viven en la URL para poder compartir el link) ───────────────
  const preset = (params.get('preset') as Preset) || '30d'
  const desdeParam = params.get('desde') ?? ''
  const hastaParam = params.get('hasta') ?? ''
  const gran = (params.get('gran') as Gran) || 'dia'
  const fLocal = params.get('local') ?? ''
  const fOrigen = params.get('origen') ?? ''
  const fDestino = params.get('destino') ?? ''
  const fMotivo = params.get('motivo') ?? ''
  const fEstado = params.get('estado') ?? ''

  const setFiltro = useCallback((clave: string, valor: string) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev)
      if (!valor) p.delete(clave)
      else p.set(clave, valor)
      return p
    }, { replace: true })
  }, [setParams])

  /** Clic en un gráfico: si ya estaba ese valor, lo saca (alterna). */
  const alternar = useCallback((clave: string, valor: string) => {
    const actual = params.get(clave) ?? ''
    setFiltro(clave, actual === valor ? '' : valor)
  }, [params, setFiltro])

  const limpiar = () => setParams(new URLSearchParams(), { replace: true })

  const rango = useMemo(() => resolverRango(preset, desdeParam, hastaParam), [preset, desdeParam, hastaParam])
  /** Período anterior del mismo largo, para comparar. */
  const rangoPrevio = useMemo(() => {
    if (!rango.desde || !rango.hasta) return null
    const largo = diasEntre(rango.desde, rango.hasta) + 1
    return { desde: sumarDias(rango.desde, -largo), hasta: sumarDias(rango.desde, -1) }
  }, [rango])

  // ── Carga ────────────────────────────────────────────────────────────────
  const cargar = useCallback(async (silencioso = false) => {
    const sb = supabase
    if (!sb) { setCargando(false); return }
    if (silencioso) setRefrescando(true)
    else setCargando(true)
    setError(null)

    // Se traen también los lotes del período anterior para poder comparar
    let qLotes = sb.from('transfer_lotes').select('id,nombre,motivo,fecha,created_at').order('fecha', { ascending: false })
    const desdeCarga = rangoPrevio?.desde ?? rango.desde
    if (desdeCarga) qLotes = qLotes.gte('fecha', desdeCarga)
    if (rango.hasta) qLotes = qLotes.lte('fecha', rango.hasta)
    const { data: lts, error: e1 } = await qLotes
    if (e1) { setError(e1.message); setCargando(false); setRefrescando(false); return }
    const lotesList = (lts as LoteTf[]) ?? []

    let its: ItemTf[] = []
    if (lotesList.length > 0) {
      const ids = lotesList.map((l) => l.id)
      const { filas, error: e2 } = await traerTodo<ItemTf>((d, h) =>
        sb.from('transfer_items')
          .select('id,lote_id,origen,destino,articulo,cantidad,estado,created_at,hecho_at')
          .in('lote_id', ids).order('created_at', { ascending: false }).range(d, h),
      )
      if (e2) { setError(e2); setCargando(false); setRefrescando(false); return }
      its = filas
    }
    setLotes(lotesList)
    setItems(its)
    setActualizado(new Date())
    setCargando(false)
    setRefrescando(false)
  }, [rango.desde, rango.hasta, rangoPrevio])

  useEffect(() => { void cargar() }, [cargar])

  /**
   * Refresco automático: primero pregunta si algo cambió (consulta liviana) y
   * recién ahí vuelve a traer los datos.
   */
  useEffect(() => {
    if (!auto) return
    const sb = supabase
    if (!sb) return
    const id = setInterval(async () => {
      const [{ count }, { data: ultimo }] = await Promise.all([
        sb.from('transfer_items').select('id', { count: 'exact', head: true }),
        sb.from('transfer_items').select('hecho_at').order('hecho_at', { ascending: false, nullsFirst: false }).limit(1),
      ])
      const nueva = `${count ?? 0}|${(ultimo as { hecho_at: string | null }[] | null)?.[0]?.hecho_at ?? ''}`
      if (firma.current && firma.current !== nueva) void cargar(true)
      firma.current = nueva
    }, REFRESCO_MS)
    return () => clearInterval(id)
  }, [auto, cargar])

  // Para el texto "actualizado hace X"
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 15000)
    return () => clearInterval(id)
  }, [])

  // ── Cálculos ─────────────────────────────────────────────────────────────
  const datos = useMemo(() => {
    const fechaPorLote = new Map(lotes.map((l) => [l.id, (l.fecha || l.created_at || '').slice(0, 10)]))
    const motivoPorLote = new Map(lotes.map((l) => [l.id, l.motivo || 'SIN MOTIVO']))
    const fechaDe = (i: ItemTf) => fechaPorLote.get(i.lote_id) || (i.created_at || '').slice(0, 10)
    const uni = (i: ItemTf) => Number(i.cantidad) || 1
    const enRango = (f: string, r: { desde: string; hasta: string } | null) =>
      !r ? true : (!r.desde || f >= r.desde) && (!r.hasta || f <= r.hasta)

    /** Filtros de tablero (los que se activan al hacer clic en un gráfico). */
    const pasaFiltros = (i: ItemTf) => {
      if (fLocal && i.origen !== fLocal && i.destino !== fLocal) return false
      if (fOrigen && i.origen !== fOrigen) return false
      if (fDestino && i.destino !== fDestino) return false
      if (fMotivo && (motivoPorLote.get(i.lote_id) || 'SIN MOTIVO') !== fMotivo) return false
      if (fEstado && (NOMBRES_ESTADO[i.estado] || i.estado) !== fEstado) return false
      return true
    }

    const visibles: ItemTf[] = []
    const previos: ItemTf[] = []
    for (const i of items) {
      if (!pasaFiltros(i)) continue
      const f = fechaDe(i)
      if (enRango(f, rango.desde || rango.hasta ? rango : null)) visibles.push(i)
      else if (rangoPrevio && enRango(f, rangoPrevio)) previos.push(i)
    }

    const resumen = (lista: ItemTf[]) => {
      const unidades = lista.reduce((s, i) => s + uni(i), 0)
      const listos = lista.filter((i) => ESTADOS_LISTOS.has(i.estado)).length
      let sum = 0
      let n = 0
      for (const i of lista) {
        if (!ESTADOS_LISTOS.has(i.estado) || !i.hecho_at || !i.created_at) continue
        const h = horasEntre(i.created_at, i.hecho_at)
        if (h != null) { sum += h; n++ }
      }
      return {
        items: lista.length,
        unidades,
        lotes: new Set(lista.map((i) => i.lote_id)).size,
        locales: new Set(lista.flatMap((i) => [i.origen, i.destino])).size,
        cumplido: lista.length ? Math.round((listos / lista.length) * 100) : 0,
        tiempo: n ? Math.round((sum / n) * 10) / 10 : 0,
      }
    }
    const act = resumen(visibles)
    const prev = previos.length ? resumen(previos) : null

    // Agregados
    const porDestino = new Map<string, number>()
    const porOrigen = new Map<string, number>()
    const porMotivo = new Map<string, number>()
    const porEstado = new Map<string, number>()
    const serie = new Map<string, { unidades: number; listos: number; total: number }>()
    for (const i of visibles) {
      const q = uni(i)
      porDestino.set(i.destino, (porDestino.get(i.destino) ?? 0) + q)
      porOrigen.set(i.origen, (porOrigen.get(i.origen) ?? 0) + q)
      const m = motivoPorLote.get(i.lote_id) || 'SIN MOTIVO'
      porMotivo.set(m, (porMotivo.get(m) ?? 0) + q)
      const es = NOMBRES_ESTADO[i.estado] || i.estado
      porEstado.set(es, (porEstado.get(es) ?? 0) + q)
      const k = clavePeriodo(fechaDe(i), gran)
      const s = serie.get(k) ?? { unidades: 0, listos: 0, total: 0 }
      s.unidades += q
      s.total++
      if (ESTADOS_LISTOS.has(i.estado)) s.listos++
      serie.set(k, s)
    }

    const top = (mapa: Map<string, number>, n: number) =>
      Array.from(mapa.entries()).map(([name, valor]) => ({ name, valor })).sort((a, b) => b.valor - a.valor).slice(0, n)

    // Tiempos por local (el origen es quien marca hecho)
    const tiempos = new Map<string, { sum: number; n: number }>()
    for (const i of visibles) {
      if (!ESTADOS_LISTOS.has(i.estado) || !i.hecho_at || !i.created_at) continue
      const h = horasEntre(i.created_at, i.hecho_at)
      if (h == null) continue
      const acc = tiempos.get(i.origen) ?? { sum: 0, n: 0 }
      acc.sum += h; acc.n++
      tiempos.set(i.origen, acc)
    }
    const tiempoLocal = Array.from(tiempos.entries()).map(([local, a]) => ({
      local,
      promedioHs: Math.round((a.sum / a.n) * 10) / 10,
      promedioDias: Math.round((a.sum / a.n / 24) * 100) / 100,
      n: a.n,
    })).sort((a, b) => b.promedioHs - a.promedioHs)

    // Pendientes por antigüedad (aging)
    const ahoraMs = Date.now()
    const edadHs = (i: ItemTf) => {
      const base = i.created_at || (fechaDe(i) ? fechaDe(i) + 'T00:00:00' : '')
      if (!base) return 0
      const t = new Date(base).getTime()
      return isNaN(t) ? 0 : Math.max(0, (ahoraMs - t) / 3600000)
    }
    const BUCKETS = [
      { id: 'b1', label: 'Menos de 24 h', min: 0, max: 24, color: '#34d399' },
      { id: 'b2', label: '24 a 48 h', min: 24, max: 48, color: '#fbbf24' },
      { id: 'b3', label: '2 a 7 días', min: 48, max: 168, color: '#fb923c' },
      { id: 'b4', label: 'Más de 7 días', min: 168, max: Infinity, color: '#f87171' },
    ]
    const pendientes = visibles.filter((i) => i.estado === 'pendiente')
    const conteoBuckets = BUCKETS.map((b) => ({
      ...b,
      cantidad: pendientes.filter((i) => { const h = edadHs(i); return h >= b.min && h < b.max }).length,
    }))
    const agingLocal = new Map<string, { b1: number; b2: number; b3: number; b4: number; total: number; masViejo: number }>()
    for (const i of pendientes) {
      const h = edadHs(i)
      const a = agingLocal.get(i.origen) ?? { b1: 0, b2: 0, b3: 0, b4: 0, total: 0, masViejo: 0 }
      const b = BUCKETS.find((x) => h >= x.min && h < x.max)
      if (b) (a as unknown as Record<string, number>)[b.id]++
      a.total++
      a.masViejo = Math.max(a.masViejo, h)
      agingLocal.set(i.origen, a)
    }
    const aging = Array.from(agingLocal.entries())
      .map(([local, a]) => ({ local, ...a, masViejoDias: Math.round((a.masViejo / 24) * 10) / 10 }))
      .sort((x, y) => (y.b4 - x.b4) || (y.b3 - x.b3) || (y.total - x.total))

    // Faltantes por local
    const faltantes = new Map<string, { faltante: number; total: number }>()
    for (const i of visibles) {
      const a = faltantes.get(i.origen) ?? { faltante: 0, total: 0 }
      a.total++
      if (i.estado === 'faltante') a.faltante++
      faltantes.set(i.origen, a)
    }
    const faltantesLocal = Array.from(faltantes.entries())
      .map(([local, a]) => ({ local, ...a, porcentaje: a.total ? Math.round((a.faltante / a.total) * 1000) / 10 : 0 }))
      .filter((r) => r.faltante > 0)
      .sort((a, b) => b.porcentaje - a.porcentaje)

    return {
      act,
      prev,
      pendientes: pendientes.length,
      conteoBuckets,
      aging,
      faltantesLocal,
      porDestino: top(porDestino, 12),
      porOrigen: top(porOrigen, 12),
      porMotivo: top(porMotivo, 8),
      porEstado: Array.from(porEstado.entries()).map(([name, valor]) => ({ name, valor })),
      serie: Array.from(serie.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([name, s]) => ({
        name,
        unidades: s.unidades,
        cumplido: s.total ? Math.round((s.listos / s.total) * 100) : 0,
      })),
      tiempoLocal,
      locales: Array.from(new Set(items.flatMap((i) => [i.origen, i.destino]))).sort((a, b) => a.localeCompare(b, 'es')),
      tabla: Array.from(new Set([...porDestino.keys(), ...porOrigen.keys()]))
        .map((local) => ({ local, enviado: porOrigen.get(local) ?? 0, recibido: porDestino.get(local) ?? 0 }))
        .sort((a, b) => (b.enviado + b.recibido) - (a.enviado + a.recibido)),
      visibles,
      fechaDe,
      motivoPorLote,
    }
  }, [items, lotes, rango, rangoPrevio, gran, fLocal, fOrigen, fDestino, fMotivo, fEstado])

  // ── Exportar a Excel ─────────────────────────────────────────────────────
  async function exportar() {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const hoja = (nombre: string, filas: Record<string, unknown>[]) => {
      if (!filas.length) return
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), nombre.slice(0, 31))
    }
    hoja('Resumen', [{
      Desde: rango.desde || 'todo', Hasta: rango.hasta || 'todo',
      Ítems: datos.act.items, Unidades: datos.act.unidades, Lotes: datos.act.lotes,
      Locales: datos.act.locales, 'Cumplido %': datos.act.cumplido, 'Tiempo prom. hs': datos.act.tiempo,
      Pendientes: datos.pendientes,
    }])
    hoja('Por local', datos.tabla.map((r) => ({ Local: r.local, Enviado: r.enviado, Recibido: r.recibido, Total: r.enviado + r.recibido })))
    hoja('Tiempos', datos.tiempoLocal.map((r) => ({ Local: r.local, 'Prom. hs': r.promedioHs, 'Prom. días': r.promedioDias, Ítems: r.n })))
    hoja('Pendientes', datos.aging.map((r) => ({
      Local: r.local, Total: r.total, '<24h': r.b1, '24-48h': r.b2, '2-7d': r.b3, '+7d': r.b4, 'Más viejo (días)': r.masViejoDias,
    })))
    hoja('Ítems', datos.visibles.map((i) => ({
      Fecha: datos.fechaDe(i), Origen: i.origen, Destino: i.destino, Artículo: i.articulo ?? '',
      Cantidad: Number(i.cantidad) || 1, Estado: NOMBRES_ESTADO[i.estado] || i.estado,
      Motivo: datos.motivoPorLote.get(i.lote_id) ?? '', Creado: i.created_at ?? '', Hecho: i.hecho_at ?? '',
    })))
    XLSX.writeFile(wb, `transferencias_${rango.desde || 'todo'}_${rango.hasta || 'hoy'}.xlsx`)
  }

  // ── UI ───────────────────────────────────────────────────────────────────
  const chips: { clave: string; texto: string }[] = [
    fLocal && { clave: 'local', texto: `Local: ${fLocal}` },
    fOrigen && { clave: 'origen', texto: `Origen: ${fOrigen}` },
    fDestino && { clave: 'destino', texto: `Destino: ${fDestino}` },
    fMotivo && { clave: 'motivo', texto: `Motivo: ${fMotivo}` },
    fEstado && { clave: 'estado', texto: `Estado: ${fEstado}` },
  ].filter(Boolean) as { clave: string; texto: string }[]

  const hace = actualizado ? Math.max(0, Math.round((ahora - actualizado.getTime()) / 60000)) : null
  const clicBarra = (clave: string) => (d: unknown) => {
    const p = d as { name?: string; payload?: { name?: string; local?: string }; local?: string }
    const valor = p?.payload?.name ?? p?.name ?? p?.payload?.local ?? p?.local
    if (valor) alternar(clave, String(valor))
  }

  const tarjeta = 'rounded-2xl border border-line bg-surface p-4'
  const btnChico = 'btn-press h-8 rounded-lg border border-line bg-surface2 px-2.5 text-xs font-medium text-ink transition hover:bg-line'

  return (
    <Layout wide>
      <BackButton />
      <header className="mb-3 mt-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
            <TrendingUp size={22} className="text-lime-500" aria-hidden /> Estadísticas Transferencias
          </h1>
          <span className="text-xs text-sub/70">
            {rango.desde ? `${rango.desde} → ${rango.hasta}` : 'todo el historial'}
            {hace != null && ` · actualizado hace ${hace === 0 ? 'menos de 1 min' : `${hace} min`}`}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => setAuto((a) => !a)} title="Refresco automático cada 45 segundos" className={btnChico + (auto ? ' border-emerald-600/50 text-emerald-400' : '')}>
              {auto ? 'Auto ON' : 'Auto OFF'}
            </button>
            <button onClick={() => void cargar(true)} className={btnChico + ' inline-flex items-center gap-1'}>
              <RefreshCw size={13} className={refrescando ? 'animate-spin' : ''} aria-hidden /> Actualizar
            </button>
            <button onClick={() => void exportar()} className={btnChico + ' inline-flex items-center gap-1'}>
              <Download size={13} aria-hidden /> Excel
            </button>
          </div>
        </div>

        {/* Filtros */}
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-surface p-3">
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => { setParams((prev) => { const q = new URLSearchParams(prev); q.set('preset', p.id); q.delete('desde'); q.delete('hasta'); return q }, { replace: true }) }}
                className={'h-8 rounded-lg px-2.5 text-xs font-medium transition ' + (preset === p.id ? 'bg-brand-600 text-white' : 'border border-line bg-surface2 text-sub hover:text-ink')}
              >
                {p.label}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-medium text-sub">Desde</span>
            <input
              type="date" value={rango.desde}
              onChange={(e) => { setParams((prev) => { const q = new URLSearchParams(prev); q.set('preset', 'custom'); q.set('desde', e.target.value); if (!q.get('hasta')) q.set('hasta', iso(new Date())); return q }, { replace: true }) }}
              className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs"
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-medium text-sub">Hasta</span>
            <input
              type="date" value={rango.hasta}
              onChange={(e) => { setParams((prev) => { const q = new URLSearchParams(prev); q.set('preset', 'custom'); q.set('hasta', e.target.value); if (!q.get('desde')) q.set('desde', e.target.value); return q }, { replace: true }) }}
              className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs"
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-medium text-sub">Local</span>
            <select value={fLocal} onChange={(e) => setFiltro('local', e.target.value)} className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs">
              <option value="">Todos</option>
              {datos.locales.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-medium text-sub">Ver por</span>
            <select value={gran} onChange={(e) => setFiltro('gran', e.target.value)} className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs">
              <option value="dia">Día</option>
              <option value="semana">Semana</option>
              <option value="mes">Mes</option>
            </select>
          </label>

          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {chips.map((c) => (
                <button key={c.clave} onClick={() => setFiltro(c.clave, '')} className="inline-flex h-7 items-center gap-1 rounded-full border border-brand-600/40 bg-brand-600/15 px-2.5 text-[11px] font-medium text-ink transition hover:bg-brand-600/25">
                  {c.texto} <X size={11} aria-hidden />
                </button>
              ))}
            </div>
          )}
          {(chips.length > 0 || preset !== '30d') && (
            <button onClick={limpiar} className={btnChico}>Limpiar todo</button>
          )}
          <span className="ml-auto self-center text-[11px] text-sub/70">
            {nf(datos.act.items)} ítems · clic en cualquier gráfico para filtrar
          </span>
        </div>
      </header>

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sub"><Loader2 size={18} className="animate-spin" aria-hidden /> Cargando datos...</div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* KPIs con comparación */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Kpi icono={<Boxes size={16} className="text-violet-500" />} label="Ítems" valor={nf(datos.act.items)} actual={datos.act.items} previo={datos.prev?.items} />
            <Kpi icono={<TrendingUp size={16} className="text-emerald-500" />} label="Unidades" valor={nf(datos.act.unidades)} actual={datos.act.unidades} previo={datos.prev?.unidades} />
            <Kpi icono={<Boxes size={16} className="text-sky-500" />} label="Lotes" valor={String(datos.act.lotes)} actual={datos.act.lotes} previo={datos.prev?.lotes} />
            <Kpi icono={<Building2 size={16} className="text-amber-500" />} label="Locales" valor={String(datos.act.locales)} actual={datos.act.locales} previo={datos.prev?.locales} />
            <Kpi icono={<CheckCircle2 size={16} className="text-green-500" />} label="Cumplido" valor={`${datos.act.cumplido}%`} actual={datos.act.cumplido} previo={datos.prev?.cumplido} puntos />
            <Kpi icono={<Timer size={16} className="text-orange-500" />} label="T. prom." valor={`${datos.act.tiempo} hs`} actual={datos.act.tiempo} previo={datos.prev?.tiempo} invertido />
          </div>

          {/* Pendientes por antigüedad */}
          <div className={tarjeta}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <Clock size={15} className="text-amber-500" aria-hidden /> Pendientes por antigüedad
              </h3>
              <span className="text-xs text-sub/70">{nf(datos.pendientes)} sin marcar como hechos · el local de origen es el que tiene que resolverlos.</span>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {datos.conteoBuckets.map((b) => (
                <div key={b.id} className="rounded-xl border border-line bg-surface2/60 p-3">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-sub/70">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: b.color }} /> {b.label}
                  </div>
                  <div className="font-display text-2xl font-bold" style={{ color: b.color }}>{nf(b.cantidad)}</div>
                </div>
              ))}
            </div>
            {datos.aging.length > 0 && (
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={datos.aging.slice(0, 10)} margin={{ left: -12, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                    <XAxis dataKey="local" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip {...TOOLTIP} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {datos.conteoBuckets.map((b) => (
                      <Bar key={b.id} dataKey={b.id} name={b.label} stackId="a" fill={b.color} cursor="pointer" onClick={clicBarra('origen')} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
                <div className="overflow-hidden rounded-xl border border-line">
                  <div className="max-h-[260px] overflow-y-auto">
                    <table className="w-full text-[13px]">
                      <thead className="sticky top-0 bg-surface2 text-left text-[11px] uppercase tracking-wider text-sub">
                        <tr>
                          <th className="px-3 py-2">Local</th>
                          <th className="px-3 py-2 text-right">Pendientes</th>
                          <th className="px-3 py-2 text-right">+7 días</th>
                          <th className="px-3 py-2 text-right">Más viejo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line/50">
                        {datos.aging.map((r) => (
                          <tr key={r.local} className="cursor-pointer hover:bg-line/20" onClick={() => alternar('origen', r.local)}>
                            <td className="px-3 py-2 font-medium text-ink">{r.local}</td>
                            <td className="px-3 py-2 text-right text-sub">{r.total}</td>
                            <td className={'px-3 py-2 text-right font-semibold ' + (r.b4 > 0 ? 'text-red-400' : 'text-sub')}>{r.b4}</td>
                            <td className="px-3 py-2 text-right text-sub">{r.masViejoDias} d</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
            {datos.faltantesLocal.length > 0 && (
              <div className="mt-4 rounded-xl border border-line bg-surface2/40 p-3">
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink">
                  <AlertTriangle size={13} className="text-red-400" aria-hidden /> Faltantes por local
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {datos.faltantesLocal.map((r) => (
                    <button key={r.local} onClick={() => alternar('origen', r.local)} className="rounded-lg border border-line bg-surface px-2.5 py-1 text-[11px] text-sub transition hover:text-ink">
                      {r.local} <span className="font-semibold text-red-400">{r.faltante}</span> <span className="text-sub/60">({r.porcentaje}%)</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Evolución */}
          <div className={tarjeta}>
            <h3 className="mb-3 text-sm font-semibold text-ink">
              Evolución por {gran === 'dia' ? 'día' : gran === 'semana' ? 'semana' : 'mes'}
              <span className="ml-2 text-xs font-normal text-sub/70">unidades y % cumplido</span>
            </h3>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={datos.serie} margin={{ left: -12, right: -4 }}>
                <defs>
                  <linearGradient id="gradUnidades" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34d399" stopOpacity={0.55} />
                    <stop offset="100%" stopColor="#34d399" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="izq" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="der" orientation="right" domain={[0, 100]} unit="%" tick={{ fontSize: 10 }} />
                <Tooltip {...TOOLTIP} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area yAxisId="izq" type="monotone" dataKey="unidades" name="Unidades" stroke="#34d399" strokeWidth={2} fill="url(#gradUnidades)" />
                <Line yAxisId="der" type="monotone" dataKey="cumplido" name="% cumplido" stroke="#fbbf24" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Por destino y origen */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className={tarjeta}>
              <h3 className="mb-3 text-sm font-semibold text-ink">Unidades recibidas por local <span className="text-xs font-normal text-sub/70">(destino)</span></h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={datos.porDestino} margin={{ left: -12, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip {...TOOLTIP} formatter={(v) => [nf(Number(v)), 'Unidades']} />
                  <Bar dataKey="valor" radius={[4, 4, 0, 0]} cursor="pointer" onClick={clicBarra('destino')}>
                    {datos.porDestino.map((d) => (
                      <Cell key={d.name} fill={fDestino && fDestino !== d.name ? 'rgba(139,92,246,0.25)' : '#8b5cf6'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className={tarjeta}>
              <h3 className="mb-3 text-sm font-semibold text-ink">Unidades enviadas por local <span className="text-xs font-normal text-sub/70">(origen)</span></h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={datos.porOrigen} margin={{ left: -12, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip {...TOOLTIP} formatter={(v) => [nf(Number(v)), 'Unidades']} />
                  <Bar dataKey="valor" radius={[4, 4, 0, 0]} cursor="pointer" onClick={clicBarra('origen')}>
                    {datos.porOrigen.map((d) => (
                      <Cell key={d.name} fill={fOrigen && fOrigen !== d.name ? 'rgba(34,211,238,0.25)' : '#22d3ee'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Motivo y estado */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className={tarjeta}>
              <h3 className="mb-3 text-sm font-semibold text-ink">Unidades por motivo</h3>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={datos.porMotivo} dataKey="valor" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                    cursor="pointer" onClick={clicBarra('motivo')}
                    label={(e) => ((e as { percent: number }).percent > 0.05 ? (e as { name: string }).name : '')}
                  >
                    {datos.porMotivo.map((d, i) => (
                      <Cell key={d.name} fill={fMotivo && fMotivo !== d.name ? 'rgba(148,163,184,0.25)' : PALETA[i % PALETA.length]} />
                    ))}
                  </Pie>
                  <Tooltip {...TOOLTIP} formatter={(v) => [nf(Number(v)), 'Unidades']} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className={tarjeta}>
              <h3 className="mb-3 text-sm font-semibold text-ink">Unidades por estado</h3>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={datos.porEstado} dataKey="valor" nameKey="name" cx="50%" cy="50%" outerRadius={80} cursor="pointer" onClick={clicBarra('estado')}>
                    {datos.porEstado.map((d, i) => (
                      <Cell key={d.name} fill={fEstado && fEstado !== d.name ? 'rgba(148,163,184,0.25)' : PALETA[(i + 4) % PALETA.length]} />
                    ))}
                  </Pie>
                  <Tooltip {...TOOLTIP} formatter={(v) => [nf(Number(v)), 'Unidades']} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Tiempos */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className={tarjeta}>
              <h3 className="mb-1 text-sm font-semibold text-ink">Tiempo promedio de transferencia por local</h3>
              <p className="mb-3 text-xs text-sub/70">Desde que se crea el ítem hasta que el local lo marca hecho · {datos.act.tiempo} hs en promedio.</p>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={datos.tiempoLocal} margin={{ left: -12, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                  <XAxis dataKey="local" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 10 }} unit=" hs" />
                  <Tooltip {...TOOLTIP} formatter={(v) => [`${Number(v)} hs`, 'Promedio']} />
                  <Bar dataKey="promedioHs" radius={[4, 4, 0, 0]} cursor="pointer" onClick={clicBarra('origen')}>
                    {datos.tiempoLocal.map((d) => (
                      <Cell key={d.local} fill={fOrigen && fOrigen !== d.local ? 'rgba(251,146,60,0.25)' : '#fb923c'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-hidden rounded-2xl border border-line bg-surface">
              <div className="border-b border-line px-4 py-3"><h3 className="text-sm font-semibold text-ink">Detalle de tiempos por local</h3></div>
              <div className="max-h-[420px] overflow-y-auto">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 bg-surface2 text-left text-[11px] uppercase tracking-wider text-sub">
                    <tr><th className="px-4 py-2">Local</th><th className="px-4 py-2 text-right">Prom. hs</th><th className="px-4 py-2 text-right">Prom. días</th><th className="px-4 py-2 text-right">Ítems</th></tr>
                  </thead>
                  <tbody className="divide-y divide-line/50">
                    {datos.tiempoLocal.map((r) => (
                      <tr key={r.local} className="cursor-pointer hover:bg-line/20" onClick={() => alternar('origen', r.local)}>
                        <td className="px-4 py-2 font-medium text-ink">{r.local}</td>
                        <td className="px-4 py-2 text-right text-orange-500">{r.promedioHs}</td>
                        <td className="px-4 py-2 text-right text-sub">{r.promedioDias}</td>
                        <td className="px-4 py-2 text-right text-sub">{r.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Resumen por local */}
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            <div className="border-b border-line px-4 py-3"><h3 className="text-sm font-semibold text-ink">Resumen por local</h3></div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-surface2 text-left text-[11px] uppercase tracking-wider text-sub">
                  <tr><th className="px-4 py-2">Local</th><th className="px-4 py-2 text-right">Enviado</th><th className="px-4 py-2 text-right">Recibido</th><th className="px-4 py-2 text-right">Total</th></tr>
                </thead>
                <tbody className="divide-y divide-line/50">
                  {datos.tabla.map((r) => (
                    <tr key={r.local} className="cursor-pointer hover:bg-line/20" onClick={() => alternar('local', r.local)}>
                      <td className="px-4 py-2 font-medium text-ink">{r.local}</td>
                      <td className="px-4 py-2 text-right text-sky-500">{nf(r.enviado)}</td>
                      <td className="px-4 py-2 text-right text-violet-500">{nf(r.recibido)}</td>
                      <td className="px-4 py-2 text-right font-semibold text-ink">{nf(r.enviado + r.recibido)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}

/** KPI con la variación contra el período anterior. */
function Kpi({ icono, label, valor, actual, previo, puntos, invertido }: {
  icono: React.ReactNode
  label: string
  valor: string
  actual: number
  previo?: number
  /** la diferencia se muestra en puntos porcentuales */
  puntos?: boolean
  /** menos es mejor (tiempos) */
  invertido?: boolean
}) {
  const hayPrevio = previo != null && (previo !== 0 || actual !== 0)
  const dif = hayPrevio ? actual - (previo as number) : 0
  const pct = hayPrevio && previo ? Math.round((dif / Math.abs(previo as number)) * 1000) / 10 : null
  const mejora = invertido ? dif < 0 : dif > 0
  const color = dif === 0 ? 'text-sub' : mejora ? 'text-emerald-400' : 'text-red-400'
  const Icono = dif === 0 ? Minus : (dif > 0 ? TrendingUp : TrendingDown)

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2">{icono}<span className="text-[11px] uppercase tracking-wider text-sub/70">{label}</span></div>
      <div className="font-display text-2xl font-bold text-ink">{valor}</div>
      {hayPrevio ? (
        <div className={'mt-0.5 flex items-center gap-1 text-[11px] font-medium ' + color} title="Comparado con el período anterior del mismo largo">
          <Icono size={12} aria-hidden />
          {puntos ? `${dif > 0 ? '+' : ''}${Math.round(dif * 10) / 10} pts` : pct != null ? `${pct > 0 ? '+' : ''}${pct}%` : `${dif > 0 ? '+' : ''}${dif}`}
          <span className="text-sub/60">vs. período anterior</span>
        </div>
      ) : (
        <div className="mt-0.5 text-[11px] text-sub/50">sin período anterior</div>
      )}
    </div>
  )
}
