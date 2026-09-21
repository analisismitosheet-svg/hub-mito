import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, TrendingUp, Boxes, Building2, CheckCircle2, Timer } from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, Legend,
} from 'recharts'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'

interface ItemTf { id: string; lote_id: string; origen: string; destino: string; articulo: string | null; cantidad: number; estado: string; created_at?: string; hecho_at?: string | null }
interface LoteTf { id: string; nombre: string; motivo: string | null; fecha: string; created_at: string }

const PALETA = ['#8b5cf6', '#22d3ee', '#f472b6', '#34d399', '#fbbf24', '#60a5fa', '#f87171', '#a3e635', '#e879f9', '#fb923c', '#c084fc', '#94a3b8']
const NOMBRES_ESTADO: Record<string, string> = { pendiente: 'Pendiente', hecho: 'Hecho', faltante: 'Faltante', senado: 'Señado' }

function horasEntre(a: string, b: string): number | null {
  const t1 = new Date(a).getTime()
  const t2 = new Date(b).getTime()
  if (isNaN(t1) || isNaN(t2)) return null
  const ms = t2 - t1
  return ms > 0 ? ms / 3600000 : null
}

export default function EstadisticasTransferencias() {
  const [items, setItems] = useState<ItemTf[]>([])
  const [lotes, setLotes] = useState<LoteTf[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [filtroLocal, setFiltroLocal] = useState('')

  const cargar = useCallback(async () => {
    const sb = supabase
    if (!sb) { setCargando(false); return }
    setCargando(true); setError(null)
    // Solo los últimos lotes y un tope de ítems, para no pasarse del timeout
    const { data: lts, error: e1 } = await sb.from('transfer_lotes')
      .select('id,nombre,motivo,fecha,created_at').order('created_at', { ascending: false }).limit(60)
    if (e1) { setError(e1.message); setCargando(false); return }
    const lotesList = (lts as LoteTf[]) ?? []
    const ids = lotesList.map((l) => l.id)
    let its: ItemTf[] = []
    if (ids.length > 0) {
      const { data, error: e2 } = await sb.from('transfer_items')
        .select('id,lote_id,origen,destino,articulo,cantidad,estado,created_at,hecho_at')
        .in('lote_id', ids).order('created_at', { ascending: false }).limit(3000)
      if (e2) { setError(e2.message); setCargando(false); return }
      its = (data as ItemTf[]) ?? []
    }
    setLotes(lotesList); setItems(its); setCargando(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  const datos = useMemo(() => {
    let visibles = items
    if (fechaDesde) visibles = visibles.filter((i) => (i.created_at || '').slice(0, 10) >= fechaDesde)
    if (fechaHasta) visibles = visibles.filter((i) => (i.created_at || '').slice(0, 10) <= fechaHasta)
    if (filtroLocal) visibles = visibles.filter((i) => i.origen === filtroLocal || i.destino === filtroLocal)
    const motivoPorLote = new Map(lotes.map((l) => [l.id, l.motivo || 'SIN MOTIVO']))
    const uni = (i: ItemTf) => Number(i.cantidad) || 1

    // Por destino y origen
    const porDestino = new Map<string, number>()
    const porOrigen = new Map<string, number>()
    const porMotivo = new Map<string, number>()
    const porEstado = new Map<string, number>()
    const porMes = new Map<string, number>()
    for (const i of visibles) {
      const q = uni(i)
      porDestino.set(i.destino, (porDestino.get(i.destino) ?? 0) + q)
      porOrigen.set(i.origen, (porOrigen.get(i.origen) ?? 0) + q)
      const m = motivoPorLote.get(i.lote_id) || 'SIN MOTIVO'
      porMotivo.set(m, (porMotivo.get(m) ?? 0) + q)
      const es = NOMBRES_ESTADO[i.estado] || i.estado
      porEstado.set(es, (porEstado.get(es) ?? 0) + q)
      const f = i.created_at || ''
      porMes.set(f.slice(0, 7), (porMes.get(f.slice(0, 7)) ?? 0) + q)
    }

    const top = (mapa: Map<string, number>, n: number) =>
      Array.from(mapa.entries()).map(([name, valor]) => ({ name, valor })).sort((a, b) => b.valor - a.valor).slice(0, n)

    const totalUnidades = visibles.reduce((s, i) => s + uni(i), 0)
    const hechos = visibles.filter((i) => i.estado === 'hecho' || i.estado === 'senado').length

    // Tiempo de transferencia: desde que se crea el ítem hasta que el local lo marca hecho
    const tiempos = new Map<string, { sum: number; n: number }>()
    for (const i of visibles) {
      if (i.estado !== 'hecho' && i.estado !== 'senado') continue
      if (!i.hecho_at || !i.created_at) continue
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
    const promGral = tiempoLocal.length
      ? Math.round((tiempoLocal.reduce((s, t) => s + t.promedioHs, 0) / tiempoLocal.length) * 10) / 10
      : 0

    return {
      totalItems: visibles.length,
      totalUnidades,
      totalLotes: new Set(visibles.map((i) => i.lote_id)).size,
      totalDestinos: porDestino.size,
      cumplido: visibles.length ? Math.round((hechos / visibles.length) * 100) : 0,
      porDestino: top(porDestino, 12),
      porOrigen: top(porOrigen, 12),
      porMotivo: top(porMotivo, 8),
      porEstado: Array.from(porEstado.entries()).map(([name, valor]) => ({ name, valor })),
      porMes: Array.from(porMes.entries()).sort().map(([name, valor]) => ({ name, valor })),
      tiempoLocal,
      promGral,
      tabla: Array.from(new Set([...porDestino.keys(), ...porOrigen.keys()]))
        .map((local) => ({ local, enviado: porOrigen.get(local) ?? 0, recibido: porDestino.get(local) ?? 0 }))
        .sort((a, b) => (b.enviado + b.recibido) - (a.enviado + a.recibido)),
    }
  }, [items, lotes, fechaDesde, fechaHasta, filtroLocal])

  const kpi = 'rounded-2xl border border-line bg-surface p-4'
  const kpiVal = 'font-display text-2xl font-bold text-ink'
  const kpiLbl = 'text-[11px] uppercase tracking-wider text-sub/70'

  return (
    <Layout wide>
      <BackButton />
      <header className="mb-3 mt-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink"><TrendingUp size={22} className="text-lime-500" aria-hidden /> Estadísticas Transferencias</h1>
        <p className="text-xs text-sub/70">Reposiciones / transferencias por local · últimos lotes ({items.length.toLocaleString('es-AR')} ítems cargados).</p>
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-surface p-3">
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-medium text-sub">Desde</span>
            <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs" />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-medium text-sub">Hasta</span>
            <input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs" />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-medium text-sub">Local</span>
            <select value={filtroLocal} onChange={(e) => setFiltroLocal(e.target.value)} className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs">
              <option value="">Todos</option>
              {Array.from(new Set(items.flatMap((i) => [i.origen, i.destino]))).sort((a, b) => a.localeCompare(b, 'es')).map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          {(fechaDesde || fechaHasta || filtroLocal) && (
            <button onClick={() => { setFechaDesde(''); setFechaHasta(''); setFiltroLocal('') }} className="btn-press h-8 rounded-lg border border-line bg-surface2 px-2.5 text-xs font-medium text-ink hover:bg-line">Limpiar</button>
          )}
          <span className="ml-auto self-center text-[11px] text-sub/70">{datos.totalItems.toLocaleString('es-AR')} ítems en el filtro</span>
        </div>
      </header>

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sub"><Loader2 size={18} className="animate-spin" aria-hidden /> Cargando datos...</div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <div className={kpi}><div className="flex items-center gap-2"><Boxes size={16} className="text-violet-500" /><span className={kpiLbl}>Ítems</span></div><div className={kpiVal}>{datos.totalItems.toLocaleString('es-AR')}</div></div>
            <div className={kpi}><div className="flex items-center gap-2"><TrendingUp size={16} className="text-emerald-500" /><span className={kpiLbl}>Unidades</span></div><div className={kpiVal}>{datos.totalUnidades.toLocaleString('es-AR')}</div></div>
            <div className={kpi}><div className="flex items-center gap-2"><Timer size={16} className="text-sky-500" /><span className={kpiLbl}>Lotes</span></div><div className={kpiVal}>{datos.totalLotes}</div></div>
            <div className={kpi}><div className="flex items-center gap-2"><Building2 size={16} className="text-amber-500" /><span className={kpiLbl}>Locales</span></div><div className={kpiVal}>{datos.totalDestinos}</div></div>
            <div className={kpi}><div className="flex items-center gap-2"><CheckCircle2 size={16} className="text-green-500" /><span className={kpiLbl}>Cumplido</span></div><div className={kpiVal}>{datos.cumplido}%</div></div>
            <div className={kpi}><div className="flex items-center gap-2"><Timer size={16} className="text-orange-500" /><span className={kpiLbl}>T. prom.</span></div><div className={kpiVal}>{datos.promGral} hs</div></div>
          </div>

          {/* Por destino y origen */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-line bg-surface p-4">
              <h3 className="mb-3 text-sm font-semibold text-ink">Unidades por local (recibido / destino)</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={datos.porDestino} margin={{ left: -12, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => [Number(v).toLocaleString('es-AR'), 'Unidades']} />
                  <Bar dataKey="valor" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4">
              <h3 className="mb-3 text-sm font-semibold text-ink">Unidades por local (enviado / origen)</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={datos.porOrigen} margin={{ left: -12, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => [Number(v).toLocaleString('es-AR'), 'Unidades']} />
                  <Bar dataKey="valor" fill="#22d3ee" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Por motivo y estado */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-line bg-surface p-4">
              <h3 className="mb-3 text-sm font-semibold text-ink">Unidades por motivo</h3>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={datos.porMotivo} dataKey="valor" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(e) => (e as { name: string; percent: number }).percent > 0.05 ? `${(e as { name: string }).name}` : ''}>
                    {datos.porMotivo.map((_, i) => <Cell key={i} fill={PALETA[i % PALETA.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => [Number(v).toLocaleString('es-AR'), 'Unidades']} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4">
              <h3 className="mb-3 text-sm font-semibold text-ink">Unidades por estado</h3>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={datos.porEstado} dataKey="valor" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
                    {datos.porEstado.map((_, i) => <Cell key={i} fill={PALETA[(i + 4) % PALETA.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => [Number(v).toLocaleString('es-AR'), 'Unidades']} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Evolución mensual */}
          <div className="rounded-2xl border border-line bg-surface p-4">
            <h3 className="mb-3 text-sm font-semibold text-ink">Evolución de unidades por mes</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={datos.porMes} margin={{ left: -12, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => [Number(v).toLocaleString('es-AR'), 'Unidades']} />
                <Bar dataKey="valor" fill="#34d399" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Tiempo promedio por local */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-line bg-surface p-4">
              <h3 className="mb-1 text-sm font-semibold text-ink">Tiempo promedio de transferencia por local</h3>
              <p className="mb-3 text-xs text-sub/70">Desde que se crea el ítem hasta que el local lo marca hecho · {datos.promGral} hs en promedio general.</p>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={datos.tiempoLocal} margin={{ left: -12, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                  <XAxis dataKey="local" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 10 }} unit=" hs" />
                  <Tooltip formatter={(v) => [`${Number(v)} hs`, 'Promedio']} />
                  <Bar dataKey="promedioHs" fill="#fb923c" radius={[4, 4, 0, 0]} />
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
                      <tr key={r.local} className="hover:bg-line/20">
                        <td className="px-4 py-2 font-medium text-ink">{r.local}</td>
                        <td className="px-4 py-2 text-right text-orange-600">{r.promedioHs}</td>
                        <td className="px-4 py-2 text-right text-sub">{r.promedioDias}</td>
                        <td className="px-4 py-2 text-right text-sub">{r.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Tabla por local */}
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            <div className="border-b border-line px-4 py-3"><h3 className="text-sm font-semibold text-ink">Resumen por local</h3></div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-surface2 text-left text-[11px] uppercase tracking-wider text-sub">
                  <tr><th className="px-4 py-2">Local</th><th className="px-4 py-2 text-right">Enviado</th><th className="px-4 py-2 text-right">Recibido</th><th className="px-4 py-2 text-right">Total</th></tr>
                </thead>
                <tbody className="divide-y divide-line/50">
                  {datos.tabla.map((r) => (
                    <tr key={r.local} className="hover:bg-line/20">
                      <td className="px-4 py-2 font-medium text-ink">{r.local}</td>
                      <td className="px-4 py-2 text-right text-sky-600">{r.enviado.toLocaleString('es-AR')}</td>
                      <td className="px-4 py-2 text-right text-violet-600">{r.recibido.toLocaleString('es-AR')}</td>
                      <td className="px-4 py-2 text-right font-semibold text-ink">{(r.enviado + r.recibido).toLocaleString('es-AR')}</td>
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