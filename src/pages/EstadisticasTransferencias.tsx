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

/**
 * Todo el tablero se calcula en la base con la función
 * `estadisticas_transferencias`: vuelve un JSON de pocos KB en vez de las
 * ~15.000 filas crudas que antes había que bajar de a 1.000 por vez.
 */
interface Kpis { items: number; unidades: number; lotes: number; locales: number; cumplido: number; tiempo: number }
interface Par { name: string; valor: number }
interface Respuesta {
  kpis: Kpis
  kpisPrev: Kpis | null
  porDestino: Par[]
  porOrigen: Par[]
  porMotivo: Par[]
  porEstado: Par[]
  serie: { name: string; unidades: number; cumplido: number }[]
  tiempos: { local: string; promedioHs: number; promedioDias: number; n: number }[]
  buckets: { b1: number; b2: number; b3: number; b4: number; total: number }
  aging: { local: string; b1: number; b2: number; b3: number; b4: number; total: number; masViejoDias: number }[]
  faltantes: { local: string; faltante: number; total: number; porcentaje: number }[]
  tabla: { local: string; enviado: number; recibido: number }[]
  locales: string[]
}

const PALETA = ['#8b5cf6', '#22d3ee', '#f472b6', '#34d399', '#fbbf24', '#60a5fa', '#f87171', '#a3e635', '#e879f9', '#fb923c', '#c084fc', '#94a3b8']
const NOMBRES_ESTADO: Record<string, string> = { pendiente: 'Pendiente', hecho: 'Hecho', faltante: 'Faltante', senado: 'Señado' }
const etiquetaEstado = (e: string) => NOMBRES_ESTADO[e] ?? e
const REFRESCO_MS = 45000

const BUCKETS = [
  { id: 'b1' as const, label: 'Menos de 24 h', color: '#34d399' },
  { id: 'b2' as const, label: '24 a 48 h', color: '#fbbf24' },
  { id: 'b3' as const, label: '2 a 7 días', color: '#fb923c' },
  { id: 'b4' as const, label: 'Más de 7 días', color: '#f87171' },
]

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

const iso = (d: Date) => d.toISOString().slice(0, 10)
const sumarDias = (fechaIso: string, dias: number) => {
  const d = new Date(fechaIso + 'T00:00:00')
  d.setDate(d.getDate() + dias)
  return iso(d)
}
const nf = (n: number) => Math.round(n).toLocaleString('es-AR')

type Preset = 'hoy' | '7d' | '30d' | 'mes' | 'mesPasado' | 'todo' | 'custom'
const PRESETS: { id: Preset; label: string }[] = [
  { id: 'hoy', label: 'Hoy' },
  { id: '7d', label: '7 días' },
  { id: '30d', label: '30 días' },
  { id: 'mes', label: 'Este mes' },
  { id: 'mesPasado', label: 'Mes pasado' },
  { id: 'todo', label: 'Todo' },
]

function resolverRango(preset: Preset, desde: string, hasta: string): { desde: string; hasta: string } {
  const hoy = iso(new Date())
  switch (preset) {
    case 'hoy': return { desde: hoy, hasta: hoy }
    case '7d': return { desde: sumarDias(hoy, -6), hasta: hoy }
    case '30d': return { desde: sumarDias(hoy, -29), hasta: hoy }
    case 'mes': return { desde: hoy.slice(0, 8) + '01', hasta: hoy }
    case 'mesPasado': {
      const d = new Date(hoy + 'T00:00:00')
      return { desde: iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), hasta: iso(new Date(d.getFullYear(), d.getMonth(), 0)) }
    }
    case 'todo': return { desde: '', hasta: '' }
    default: return { desde, hasta }
  }
}

type Gran = 'dia' | 'semana' | 'mes'

export default function EstadisticasTransferencias() {
  const [params, setParams] = useSearchParams()
  const [datos, setDatos] = useState<Respuesta | null>(null)
  const [locales, setLocales] = useState<string[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [auto, setAuto] = useState(true)
  const [exportando, setExportando] = useState(false)
  const [actualizado, setActualizado] = useState<Date | null>(null)
  const [ahora, setAhora] = useState(Date.now())
  const firma = useRef<string>('')

  // ── Filtros (viven en la URL para poder compartir el link) ───────────────
  const preset = (params.get('preset') as Preset) || '30d'
  const gran = (params.get('gran') as Gran) || 'dia'
  const fLocal = params.get('local') ?? ''
  const fOrigen = params.get('origen') ?? ''
  const fDestino = params.get('destino') ?? ''
  const fMotivo = params.get('motivo') ?? ''
  const fEstado = params.get('estado') ?? ''
  const rango = useMemo(
    () => resolverRango(preset, params.get('desde') ?? '', params.get('hasta') ?? ''),
    [preset, params],
  )

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
    setParams((prev) => {
      const p = new URLSearchParams(prev)
      if ((p.get(clave) ?? '') === valor) p.delete(clave)
      else p.set(clave, valor)
      return p
    }, { replace: true })
  }, [setParams])

  const limpiar = () => setParams(new URLSearchParams(), { replace: true })
  const hayFiltros = !!(fLocal || fOrigen || fDestino || fMotivo || fEstado)

  // ── Carga: una sola llamada, todo agregado en la base ────────────────────
  const cargar = useCallback(async () => {
    const sb = supabase
    if (!sb) return
    setCargando(true)
    setError(null)
    const { data, error: err } = await sb.rpc('estadisticas_transferencias', {
      p_desde: rango.desde || null,
      p_hasta: rango.hasta || null,
      p_origen: fOrigen || null,
      p_destino: fDestino || null,
      p_motivo: fMotivo || null,
      p_estado: fEstado || null,
      p_local: fLocal || null,
      p_gran: gran,
    })
    if (err) { setError(err.message); setCargando(false); return }
    const r = data as Respuesta | null
    if (r) {
      setDatos(r)
      // La lista del desplegable se arma sin filtros, si no se iría achicando
      if (!hayFiltros) setLocales(r.locales ?? [])
      setActualizado(new Date())
    }
    setCargando(false)
  }, [rango.desde, rango.hasta, fOrigen, fDestino, fMotivo, fEstado, fLocal, gran, hayFiltros])

  useEffect(() => { void cargar() }, [cargar])

  /** Refresco automático: primero pregunta si algo cambió (consulta liviana). */
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
      if (firma.current && firma.current !== nueva) void cargar()
      firma.current = nueva
    }, REFRESCO_MS)
    return () => clearInterval(id)
  }, [auto, cargar])

  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 15000)
    return () => clearInterval(id)
  }, [])

  // ── Exportar a Excel (las filas crudas se piden solo al exportar) ────────
  async function exportar() {
    const sb = supabase
    if (!sb || !datos) return
    setExportando(true)
    try {
      let qLotes = sb.from('transfer_lotes').select('id,nombre,motivo,fecha').order('fecha', { ascending: false })
      if (rango.desde) qLotes = qLotes.gte('fecha', rango.desde)
      if (rango.hasta) qLotes = qLotes.lte('fecha', rango.hasta)
      const { data: lts, error: e1 } = await qLotes
      if (e1) { setError(e1.message); return }
      const lotes = (lts as { id: string; motivo: string | null; fecha: string }[]) ?? []
      const porLote = new Map(lotes.map((l) => [l.id, l]))

      const filas: Record<string, unknown>[] = []
      if (lotes.length) {
        const ids = lotes.map((l) => l.id)
        // Las páginas se piden de a 4 en paralelo, no una atrás de otra
        for (let base = 0; ; base += 4000) {
          const paginas = await Promise.all([0, 1, 2, 3].map((k) =>
            sb.from('transfer_items')
              .select('lote_id,origen,destino,articulo,cantidad,estado,created_at,hecho_at')
              .in('lote_id', ids).order('created_at', { ascending: false })
              .range(base + k * 1000, base + k * 1000 + 999),
          ))
          const lote = paginas.flatMap((p) => (p.data as Record<string, unknown>[] | null) ?? [])
          for (const i of lote) {
            const l = porLote.get(String(i.lote_id))
            if (fOrigen && i.origen !== fOrigen) continue
            if (fDestino && i.destino !== fDestino) continue
            if (fEstado && i.estado !== fEstado) continue
            if (fLocal && i.origen !== fLocal && i.destino !== fLocal) continue
            const motivo = (l?.motivo || 'SIN MOTIVO').trim() || 'SIN MOTIVO'
            if (fMotivo && motivo !== fMotivo) continue
            filas.push({
              Fecha: l?.fecha ?? '', Origen: i.origen, Destino: i.destino, Artículo: i.articulo ?? '',
              Cantidad: Number(i.cantidad) || 1, Estado: etiquetaEstado(String(i.estado)),
              Motivo: motivo, Creado: i.created_at ?? '', Hecho: i.hecho_at ?? '',
            })
          }
          if (paginas[3].data && (paginas[3].data as unknown[]).length < 1000) break
          if (paginas.every((p) => !p.data || (p.data as unknown[]).length === 0)) break
        }
      }

      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()
      const hoja = (nombre: string, datosHoja: Record<string, unknown>[]) => {
        if (!datosHoja.length) return
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(datosHoja), nombre.slice(0, 31))
      }
      hoja('Resumen', [{
        Desde: rango.desde || 'todo', Hasta: rango.hasta || 'todo',
        Ítems: datos.kpis.items, Unidades: datos.kpis.unidades, Lotes: datos.kpis.lotes,
        Locales: datos.kpis.locales, 'Cumplido %': datos.kpis.cumplido, 'Tiempo prom. hs': datos.kpis.tiempo,
        Pendientes: datos.buckets?.total ?? 0,
      }])
      hoja('Por local', datos.tabla.map((r) => ({ Local: r.local, Enviado: r.enviado, Recibido: r.recibido, Total: r.enviado + r.recibido })))
      hoja('Tiempos', datos.tiempos.map((r) => ({ Local: r.local, 'Prom. hs': r.promedioHs, 'Prom. días': r.promedioDias, Ítems: r.n })))
      hoja('Pendientes', datos.aging.map((r) => ({
        Local: r.local, Total: r.total, '<24h': r.b1, '24-48h': r.b2, '2-7d': r.b3, '+7d': r.b4, 'Más viejo (días)': r.masViejoDias,
      })))
      hoja('Ítems', filas)
      XLSX.writeFile(wb, `transferencias_${rango.desde || 'todo'}_${rango.hasta || 'hoy'}.xlsx`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo exportar.')
    } finally {
      setExportando(false)
    }
  }

  // ── UI ───────────────────────────────────────────────────────────────────
  const chips: { clave: string; texto: string }[] = [
    fLocal && { clave: 'local', texto: `Local: ${fLocal}` },
    fOrigen && { clave: 'origen', texto: `Origen: ${fOrigen}` },
    fDestino && { clave: 'destino', texto: `Destino: ${fDestino}` },
    fMotivo && { clave: 'motivo', texto: `Motivo: ${fMotivo}` },
    fEstado && { clave: 'estado', texto: `Estado: ${etiquetaEstado(fEstado)}` },
  ].filter(Boolean) as { clave: string; texto: string }[]

  const hace = actualizado ? Math.max(0, Math.round((ahora - actualizado.getTime()) / 60000)) : null
  const clic = (clave: string) => (d: unknown) => {
    const p = d as { name?: string; payload?: { name?: string; local?: string }; local?: string }
    const valor = p?.payload?.name ?? p?.name ?? p?.payload?.local ?? p?.local
    if (valor) alternar(clave, String(valor))
  }

  const tarjeta = 'rounded-2xl border border-line bg-surface p-4'
  const btnChico = 'btn-press h-8 rounded-lg border border-line bg-surface2 px-2.5 text-xs font-medium text-ink transition hover:bg-line disabled:opacity-50'
  const estadoConNombre = (datos?.porEstado ?? []).map((e) => ({ ...e, name: etiquetaEstado(e.name), crudo: e.name }))

  return (
    <Layout wide>
      <BackButton />
      <header className="mb-3 mt-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink">
            <TrendingUp size={22} className="text-lime-500" aria-hidden /> Estadísticas Transferencias
          </h1>
          <span className="flex items-center gap-1.5 text-xs text-sub/70">
            {rango.desde ? `${rango.desde} → ${rango.hasta}` : 'todo el historial'}
            {hace != null && ` · actualizado hace ${hace === 0 ? 'menos de 1 min' : `${hace} min`}`}
            {cargando && datos && <Loader2 size={12} className="animate-spin text-brand-400" aria-hidden />}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => setAuto((a) => !a)} title="Refresco automático cada 45 segundos" className={btnChico + (auto ? ' border-emerald-600/50 text-emerald-400' : '')}>
              {auto ? 'Auto ON' : 'Auto OFF'}
            </button>
            <button onClick={() => void cargar()} className={btnChico + ' inline-flex items-center gap-1'}>
              <RefreshCw size={13} className={cargando ? 'animate-spin' : ''} aria-hidden /> Actualizar
            </button>
            <button onClick={() => void exportar()} disabled={exportando || !datos} className={btnChico + ' inline-flex items-center gap-1'}>
              <Download size={13} aria-hidden /> {exportando ? 'Generando…' : 'Excel'}
            </button>
          </div>
        </div>

        {/* Filtros */}
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-surface p-3">
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => setParams((prev) => { const q = new URLSearchParams(prev); q.set('preset', p.id); q.delete('desde'); q.delete('hasta'); return q }, { replace: true })}
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
              onChange={(e) => setParams((prev) => { const q = new URLSearchParams(prev); q.set('preset', 'custom'); q.set('desde', e.target.value); if (!q.get('hasta')) q.set('hasta', iso(new Date())); return q }, { replace: true })}
              className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs"
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-medium text-sub">Hasta</span>
            <input
              type="date" value={rango.hasta}
              onChange={(e) => setParams((prev) => { const q = new URLSearchParams(prev); q.set('preset', 'custom'); q.set('hasta', e.target.value); if (!q.get('desde')) q.set('desde', e.target.value); return q }, { replace: true })}
              className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs"
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-medium text-sub">Local</span>
            <select value={fLocal} onChange={(e) => setFiltro('local', e.target.value)} className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs">
              <option value="">Todos</option>
              {locales.map((l) => <option key={l} value={l}>{l}</option>)}
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
          {(chips.length > 0 || preset !== '30d') && <button onClick={limpiar} className={btnChico}>Limpiar todo</button>}
          <span className="ml-auto self-center text-[11px] text-sub/70">
            {datos ? `${nf(datos.kpis.items)} ítems · clic en cualquier gráfico para filtrar` : ''}
          </span>
        </div>
      </header>

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      {!datos ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sub"><Loader2 size={18} className="animate-spin" aria-hidden /> Cargando datos...</div>
      ) : (
        <div className={'flex flex-col gap-4 transition-opacity ' + (cargando ? 'opacity-60' : '')}>
          {/* KPIs con comparación */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Kpi icono={<Boxes size={16} className="text-violet-500" />} label="Ítems" valor={nf(datos.kpis.items)} actual={datos.kpis.items} previo={datos.kpisPrev?.items} />
            <Kpi icono={<TrendingUp size={16} className="text-emerald-500" />} label="Unidades" valor={nf(datos.kpis.unidades)} actual={datos.kpis.unidades} previo={datos.kpisPrev?.unidades} />
            <Kpi icono={<Boxes size={16} className="text-sky-500" />} label="Lotes" valor={String(datos.kpis.lotes)} actual={datos.kpis.lotes} previo={datos.kpisPrev?.lotes} />
            <Kpi icono={<Building2 size={16} className="text-amber-500" />} label="Locales" valor={String(datos.kpis.locales)} actual={datos.kpis.locales} previo={datos.kpisPrev?.locales} />
            <Kpi icono={<CheckCircle2 size={16} className="text-green-500" />} label="Cumplido" valor={`${datos.kpis.cumplido}%`} actual={datos.kpis.cumplido} previo={datos.kpisPrev?.cumplido} puntos />
            <Kpi icono={<Timer size={16} className="text-orange-500" />} label="T. prom." valor={`${datos.kpis.tiempo} hs`} actual={datos.kpis.tiempo} previo={datos.kpisPrev?.tiempo} invertido />
          </div>

          {/* Pendientes por antigüedad */}
          <div className={tarjeta}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <Clock size={15} className="text-amber-500" aria-hidden /> Pendientes por antigüedad
              </h3>
              <span className="text-xs text-sub/70">{nf(datos.buckets?.total ?? 0)} sin marcar como hechos · el local de origen es el que tiene que resolverlos.</span>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {BUCKETS.map((b) => (
                <div key={b.id} className="rounded-xl border border-line bg-surface2/60 p-3">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-sub/70">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: b.color }} /> {b.label}
                  </div>
                  <div className="font-display text-2xl font-bold" style={{ color: b.color }}>{nf(datos.buckets?.[b.id] ?? 0)}</div>
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
                    {BUCKETS.map((b) => (
                      <Bar key={b.id} dataKey={b.id} name={b.label} stackId="a" fill={b.color} cursor="pointer" onClick={clic('origen')} />
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
            {datos.faltantes.length > 0 && (
              <div className="mt-4 rounded-xl border border-line bg-surface2/40 p-3">
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink">
                  <AlertTriangle size={13} className="text-red-400" aria-hidden /> Faltantes por local
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {datos.faltantes.map((r) => (
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
                  <Bar dataKey="valor" radius={[4, 4, 0, 0]} cursor="pointer" onClick={clic('destino')}>
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
                  <Bar dataKey="valor" radius={[4, 4, 0, 0]} cursor="pointer" onClick={clic('origen')}>
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
                    cursor="pointer" onClick={clic('motivo')}
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
                  <Pie
                    data={estadoConNombre} dataKey="valor" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                    cursor="pointer"
                    onClick={(d: unknown) => {
                      const p = d as { payload?: { crudo?: string }; crudo?: string }
                      const v = p?.payload?.crudo ?? p?.crudo
                      if (v) alternar('estado', String(v))
                    }}
                  >
                    {estadoConNombre.map((d, i) => (
                      <Cell key={d.crudo} fill={fEstado && fEstado !== d.crudo ? 'rgba(148,163,184,0.25)' : PALETA[(i + 4) % PALETA.length]} />
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
              <p className="mb-3 text-xs text-sub/70">Desde que se crea el ítem hasta que el local lo marca hecho · {datos.kpis.tiempo} hs en promedio.</p>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={datos.tiempos} margin={{ left: -12, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                  <XAxis dataKey="local" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 10 }} unit=" hs" />
                  <Tooltip {...TOOLTIP} formatter={(v) => [`${Number(v)} hs`, 'Promedio']} />
                  <Bar dataKey="promedioHs" radius={[4, 4, 0, 0]} cursor="pointer" onClick={clic('origen')}>
                    {datos.tiempos.map((d) => (
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
                    {datos.tiempos.map((r) => (
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
  const Icono = dif === 0 ? Minus : dif > 0 ? TrendingUp : TrendingDown

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
