import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Loader2 } from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, LabelList } from 'recharts'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import FiltroPeriodo, { diasEntre, etiquetaPeriodo, hoyIso, periodoDe, sumarDias, type Periodo } from '@/components/FiltroPeriodo'
import { supabase as sb } from '@/lib/supabase'

/* ------------------------------------------------------------------ */
/*  Administradores > Tracking > Km recorridos                          */
/*                                                                      */
/*  Km por vehículo y día (RPC tracking_km, sql/tracking_km.sql: misma  */
/*  cuenta que kmDelDia en TrackingTransporte) por semana, mes o rango, */
/*  comparado con el período anterior del mismo largo.                  */
/* ------------------------------------------------------------------ */

// La pantalla solo se abre logueado: Supabase siempre está configurado acá
const supabase = sb!

interface Vehiculo { id: string; nombre: string; color: string; usuario_transporte_nombre: string | null; usuario_transporte_id: string | null }
interface FilaKm { vehiculo_id: string; dia: string; km: number; minutos_mov: number; primera: string; ultima: string }
interface FilaBulto { chofer_id: string; dia: string; bultos: number | string }
/** Parada de 10 min o más lejos de todo local o depósito (sql/tracking_paradas_fuera.sql) */
interface FilaParada {
  vehiculo_id: string; dia: string; desde: string; hasta: string; minutos: number | string
  lat: number; lng: number; cerca_de: string | null; cerca_m: number | string | null
}

const TOOLTIP = {
  contentStyle: {
    background: 'var(--surface)',
    border: '1px solid var(--line)',
    borderRadius: 12,
    fontSize: 12,
    color: 'var(--ink)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
  },
}

const nf = (n: number, dec = 0) => n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
const fmtKm = (n: number) => `${nf(n, n < 10 ? 1 : 0)} km`
const fmtBultosKm = (bultos: number, km: number) =>
  km > 0 ? (bultos / km).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
const fmtFecha = (s: string) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}` }
const fmtHora = (iso: string) =>
  new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Cordoba', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
/** "GENERAL PAZ · 441 m" */
const fmtCerca = (nombre: string | null, metros: number) =>
  !nombre || !metros ? '—' : `${nombre} · ${metros < 1000 ? `${nf(metros)} m` : `${nf(metros / 1000, 1)} km`}`
const fmtCorta = (s: string) => { const [, m, d] = s.split('-'); return `${d}/${m}` }
const DIA_SEM = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const diaSemana = (s: string) => { const [y, m, d] = s.split('-').map(Number); return DIA_SEM[new Date(y, m - 1, d).getDay()] }
function hm(min: number) {
  if (min < 60) return `${Math.round(min)} min`
  return `${Math.floor(min / 60)} h ${Math.round(min % 60)} min`
}
/** Lunes de la semana de esa fecha (para agrupar rangos largos). */
function lunes(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  const f = new Date(y, m - 1, d)
  return sumarDias(s, -((f.getDay() + 6) % 7))
}

export default function TrackingKm() {
  const navigate = useNavigate()
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDe('semana', hoyIso()))
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([])
  const [filas, setFilas] = useState<FilaKm[]>([])
  const [anterior, setAnterior] = useState<FilaKm[]>([])
  const [bultos, setBultos] = useState<FilaBulto[]>([])
  const [bultosAnt, setBultosAnt] = useState<FilaBulto[]>([])
  const [paradas, setParadas] = useState<FilaParada[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const leerBultos = useCallback(async (desde: string, hasta: string): Promise<FilaBulto[]> => {
    try {
      const { data } = await supabase.auth.getSession()
      const r = await fetch(`/api/tracking?vista=bultos&desde=${desde}&hasta=${hasta}`, {
        headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}` },
      })
      if (!r.ok) return []
      const body = await r.json().catch(() => ({}))
      return (body.filas ?? []) as FilaBulto[]
    } catch {
      return []
    }
  }, [])

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    const largo = diasEntre(periodo.desde, periodo.hasta)
    const antHasta = sumarDias(periodo.desde, -1)
    const antDesde = sumarDias(antHasta, -(largo - 1))
    const [v, k, a, bcur, bant, pa] = await Promise.all([
      supabase.from('tracking_vehiculos').select('id,nombre,color,usuario_transporte_nombre,usuario_transporte_id').order('nombre'),
      supabase.rpc('tracking_km', { p_desde: periodo.desde, p_hasta: periodo.hasta }),
      supabase.rpc('tracking_km', { p_desde: antDesde, p_hasta: antHasta }),
      leerBultos(periodo.desde, periodo.hasta),
      leerBultos(antDesde, antHasta),
      supabase.rpc('tracking_paradas_fuera', { p_desde: periodo.desde, p_hasta: periodo.hasta, p_min_min: 10 }),
    ])
    if (k.error) setError(k.error.message)
    setVehiculos((v.data ?? []) as Vehiculo[])
    const num = (x: FilaKm) => ({ ...x, km: Number(x.km), minutos_mov: Number(x.minutos_mov) })
    setFilas(((k.data ?? []) as FilaKm[]).map(num))
    setAnterior(((a.data ?? []) as FilaKm[]).map(num))
    setBultos(bcur)
    setBultosAnt(bant)
    setParadas(((pa.data ?? []) as FilaParada[]).slice().sort((x, y) => y.desde.localeCompare(x.desde)))
    setCargando(false)
  }, [periodo, leerBultos])

  useEffect(() => { void cargar() }, [cargar])

  const nombre = useCallback((id: string) => vehiculos.find((v) => v.id === id)?.nombre ?? '?', [vehiculos])
  const conKm = useMemo(() => vehiculos.filter((v) => filas.some((f) => f.vehiculo_id === v.id && f.km > 0)), [vehiculos, filas])

  // Bultos por vehículo (del chofer vinculado, por día)
  const bultosDe = useMemo(() => {
    const m = new Map<string, { bultos: number; bultosAnt: number; dias: number }>()
    for (const v of vehiculos) {
      const cur = bultos.filter((f) => f.chofer_id === v.usuario_transporte_id)
      const ant = bultosAnt.filter((f) => f.chofer_id === v.usuario_transporte_id)
      m.set(v.id, {
        bultos: cur.reduce((s, f) => s + Number(f.bultos), 0),
        bultosAnt: ant.reduce((s, f) => s + Number(f.bultos), 0),
        dias: cur.filter((f) => Number(f.bultos) > 0).length,
      })
    }
    return m
  }, [vehiculos, bultos, bultosAnt])

  // Totales
  const tot = useMemo(() => {
    const km = filas.reduce((s, f) => s + f.km, 0)
    const kmAnt = anterior.reduce((s, f) => s + f.km, 0)
    const mov = filas.reduce((s, f) => s + f.minutos_mov, 0)
    const diasVeh = filas.filter((f) => f.km >= 1).length // días-vehículo con recorrido real
    const porVeh = new Map<string, number>()
    for (const f of filas) porVeh.set(f.vehiculo_id, (porVeh.get(f.vehiculo_id) ?? 0) + f.km)
    const top = [...porVeh].sort((a, b) => b[1] - a[1])[0]
    const bultosTot = [...bultosDe.values()].reduce((s, b) => s + b.bultos, 0)
    const bultosAntTot = [...bultosDe.values()].reduce((s, b) => s + b.bultosAnt, 0)
    return { km, kmAnt, mov, diasVeh, top, bultos: bultosTot, bultosAnt: bultosAntTot }
  }, [filas, anterior, bultosDe])

  // Por vehículo
  const porVehiculo = useMemo(() => vehiculos.map((v) => {
    const fs = filas.filter((f) => f.vehiculo_id === v.id)
    const km = fs.reduce((s, f) => s + f.km, 0)
    const kmAnt = anterior.filter((f) => f.vehiculo_id === v.id).reduce((s, f) => s + f.km, 0)
    const dias = fs.filter((f) => f.km >= 1)
    const max = [...fs].sort((a, b) => b.km - a.km)[0]
    const b = bultosDe.get(v.id) ?? { bultos: 0, bultosAnt: 0, dias: 0 }
    return { v, km, kmAnt, dias: dias.length, prom: dias.length ? km / dias.length : 0, max, mov: fs.reduce((s, f) => s + f.minutos_mov, 0), bultos: b.bultos, bultosAnt: b.bultosAnt, bultosDias: b.dias }
  }).filter((x) => x.km > 0 || x.kmAnt > 0 || x.bultos > 0 || x.bultosAnt > 0).sort((a, b) => b.km - a.km), [vehiculos, filas, anterior, bultosDe])

  // Gráfico: por día, o por semana si el rango es largo
  const porSemana = diasEntre(periodo.desde, periodo.hasta) > 62
  const grafico = useMemo(() => {
    const claves: string[] = []
    if (porSemana) {
      for (let d = lunes(periodo.desde); d <= periodo.hasta; d = sumarDias(d, 7)) claves.push(d)
    } else {
      for (let d = periodo.desde; d <= periodo.hasta; d = sumarDias(d, 1)) claves.push(d)
    }
    return claves.map((c) => {
      const fila: Record<string, string | number> = { clave: c, etiqueta: porSemana ? `sem ${fmtCorta(c)}` : `${diaSemana(c)} ${fmtCorta(c)}` }
      for (const v of conKm) {
        const km = filas
          .filter((f) => f.vehiculo_id === v.id && (porSemana ? lunes(f.dia) === c : f.dia === c))
          .reduce((s, f) => s + f.km, 0)
        fila[v.id] = Math.round(km * 10) / 10
      }
      return fila
    })
  }, [periodo, porSemana, conKm, filas])

  // Tabla por día (solo días con algún km)
  const dias = useMemo(() => [...new Set(filas.filter((f) => f.km > 0).map((f) => f.dia))].sort().reverse(), [filas])
  const kmDe = (veh: string, dia: string) => filas.find((f) => f.vehiculo_id === veh && f.dia === dia)?.km ?? 0
  const bultosPorDia = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of bultos) m.set(f.dia, (m.get(f.dia) ?? 0) + Number(f.bultos))
    return m
  }, [bultos])

  async function exportar() {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porVehiculo.map((x) => ({
      Vehículo: x.v.nombre, Chofer: x.v.usuario_transporte_nombre ?? '', Km: Number(x.km.toFixed(1)),
      Bultos: x.bultos, 'Bultos/km': x.km > 0 ? Number((x.bultos / x.km).toFixed(2)) : '', 'Bultos/día': x.bultosDias ? Number((x.bultos / x.bultosDias).toFixed(1)) : '',
      'Días con recorrido': x.dias, 'Km por día': Number(x.prom.toFixed(1)),
      'Día con más km': x.max ? fmtFecha(x.max.dia) : '', 'Km ese día': x.max ? Number(x.max.km.toFixed(1)) : '',
      'Tiempo andando': hm(x.mov), 'Km período anterior': Number(x.kmAnt.toFixed(1)),
    }))), 'Por vehículo')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([...filas].sort((a, b) => a.dia.localeCompare(b.dia) || nombre(a.vehiculo_id).localeCompare(nombre(b.vehiculo_id))).map((f) => ({
      Fecha: fmtFecha(f.dia), Vehículo: nombre(f.vehiculo_id), Km: Number(f.km.toFixed(1)), 'Tiempo andando': hm(f.minutos_mov),
      'Primera ubicación': new Date(f.primera).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
      'Última ubicación': new Date(f.ultima).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
    }))), 'Por día')
    XLSX.writeFile(wb, `km_transporte_${periodo.desde}_a_${periodo.hasta}.xlsx`)
  }

  const variacion = (act: number, ant: number) => {
    if (ant <= 0) return null
    const p = ((act - ant) / ant) * 100
    return { p, texto: `${p >= 0 ? '▲' : '▼'} ${nf(Math.abs(p))}%` }
  }
  const varTot = variacion(tot.km, tot.kmAnt)

  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Km recorridos</h1>
          <p className="text-sm text-sub">Kilómetros de cada vehículo según el GPS (Traccar), bultos movidos y relación bultos/km, por día, semana o mes.</p>
        </div>
        <button onClick={() => void exportar()} disabled={!filas.length}
          className="btn-press inline-flex h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-ink disabled:opacity-50">
          <Download size={16} /> Excel
        </button>
      </header>

      <div className="sticky top-16 z-[5] mb-4">
        <FiltroPeriodo valor={periodo} onChange={setPeriodo} />
      </div>

      {error && <div className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">{error}</div>}

      {cargando ? (
        <div className="flex items-center gap-2 p-6 text-sm text-sub"><Loader2 size={16} className="animate-spin" /> Calculando km…</div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-6">
            <Kpi label="Km totales" valor={fmtKm(tot.km)} color="#0d9488"
              sub={varTot ? <span className={varTot.p >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}>{varTot.texto} vs período anterior ({fmtKm(tot.kmAnt)})</span> : etiquetaPeriodo(periodo)} />
            <Kpi label="Km por día" valor={tot.diasVeh ? fmtKm(tot.km / tot.diasVeh) : '—'} color="#2563eb" sub="promedio por vehículo en los días que anduvo" />
            <Kpi label="Bultos movidos" valor={nf(tot.bultos)} color="#38bdf8"
              sub={variacion(tot.bultos, tot.bultosAnt) ? <span className="text-green-600 dark:text-green-400">{variacion(tot.bultos, tot.bultosAnt)!.texto} vs período anterior ({nf(tot.bultosAnt)})</span> : `bultos en ${etiquetaPeriodo(periodo)}`} />
            <Kpi label="Bultos / km" valor={fmtBultosKm(tot.bultos, tot.km)} color="#0d9488" sub={`${nf(tot.bultos)} bultos en ${fmtKm(tot.km)}`} />
            <Kpi label="Tiempo andando" valor={hm(tot.mov)} color="#7c3aed" sub={tot.mov ? `${nf(tot.km / (tot.mov / 60))} km/h de promedio` : 'en movimiento'} />
            <Kpi label="El que más anduvo" valor={tot.top ? nombre(tot.top[0]) : '—'} color="#ea580c" sub={tot.top ? fmtKm(tot.top[1]) : 'sin recorridos'} chico />
          </div>

          {!filas.some((f) => f.km > 0) ? (
            <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-sub">Sin recorridos en {etiquetaPeriodo(periodo)}.</p>
          ) : (
            <>
              <section className="mb-4 rounded-2xl border border-line bg-surface p-4">
                <h2 className="mb-2 font-semibold text-ink">Km por {porSemana ? 'semana' : 'día'}</h2>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={grafico} margin={{ left: -12, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                    <XAxis dataKey="etiqueta" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip {...TOOLTIP} formatter={(v, n) => [fmtKm(Number(v)), nombre(String(n))]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} formatter={(id) => nombre(String(id))} />
                    {conKm.map((v) => (
                      <Bar key={v.id} dataKey={v.id} fill={v.color} radius={[4, 4, 0, 0]} maxBarSize={28} cursor={porSemana ? undefined : 'pointer'}
                        onClick={(d) => { const c = (d as { payload?: { clave?: string } }).payload?.clave; if (!porSemana && c) navigate(`/administradores/tracking?fecha=${c}`) }}>
                        <LabelList dataKey={v.id} content={EtiquetaKm} />
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
                {!porSemana && <p className="text-[11px] text-sub">Tocá una barra para ver ese día en el mapa.</p>}
              </section>

              <section className="mb-4 overflow-x-auto rounded-2xl border border-line bg-surface p-4">
                <h2 className="mb-2 font-semibold text-ink">Por vehículo</h2>
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-sub">
                      <th className="py-2">Vehículo</th>
                      <th className="py-2 text-right">Km</th>
                      <th className="py-2 text-right">📦 Bultos</th>
                      <th className="py-2 text-right">⚡ Bultos/km</th>
                      <th className="py-2 text-right">Bultos/día</th>
                      <th className="py-2 text-right">Días</th>
                      <th className="py-2 text-right">Km/día</th>
                      <th className="py-2 text-right">Día con más km</th>
                      <th className="py-2 text-right">Andando</th>
                      <th className="py-2 text-right">vs anterior</th>
                    </tr>
                  </thead>
                  <tbody>
                    {porVehiculo.map((x) => {
                      const va = variacion(x.km, x.kmAnt)
                      return (
                        <tr key={x.v.id} className="border-b border-line/60 last:border-0">
                          <td className="py-2">
                            <div className="flex items-center gap-2 font-semibold text-ink">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ background: x.v.color }} />{x.v.nombre}
                            </div>
                            {x.v.usuario_transporte_nombre && <div className="ml-4 text-[11px] text-sub">{x.v.usuario_transporte_nombre}</div>}
                          </td>
                          <td className="py-2 text-right font-semibold text-ink">{fmtKm(x.km)}</td>
                          <td className="py-2 text-right text-ink">{x.bultos || '—'}</td>
                          <td className="py-2 text-right font-semibold text-teal-500">{fmtBultosKm(x.bultos, x.km)}</td>
                          <td className="py-2 text-right text-ink">{x.bultosDias ? nf(x.bultos / x.bultosDias, 1) : '—'}</td>
                          <td className="py-2 text-right text-ink">{x.dias}</td>
                          <td className="py-2 text-right text-ink">{x.dias ? fmtKm(x.prom) : '—'}</td>
                          <td className="py-2 text-right text-sub">{x.max && x.max.km > 0 ? `${fmtCorta(x.max.dia)} · ${fmtKm(x.max.km)}` : '—'}</td>
                          <td className="py-2 text-right text-sub">{hm(x.mov)}</td>
                          <td className={`py-2 text-right text-xs ${va ? (va.p >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500') : 'text-sub'}`}>{va?.texto ?? '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </section>

              <section className="overflow-x-auto rounded-2xl border border-line bg-surface p-4">
                <h2 className="mb-2 font-semibold text-ink">Por día</h2>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-sub">
                      <th className="py-2">Fecha</th>
                      {conKm.map((v) => <th key={v.id} className="py-2 text-right" style={{ color: v.color }}>{v.nombre}</th>)}
                      <th className="py-2 text-right">Total</th>
                      <th className="py-2 text-right">📦 Bultos</th>
                      <th className="py-2 text-right">⚡ Bultos/km</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dias.map((d) => {
                      const kmTot = conKm.reduce((s, v) => s + kmDe(v.id, d), 0)
                      const bultosDia = bultosPorDia.get(d) ?? 0
                      return (
                        <tr key={d} onClick={() => navigate(`/administradores/tracking?fecha=${d}`)}
                          className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-surface2" title="Ver ese día en el mapa">
                          <td className="py-2 text-ink">{diaSemana(d)} {fmtFecha(d)}</td>
                          {conKm.map((v) => <td key={v.id} className="py-2 text-right text-ink">{kmDe(v.id, d) > 0 ? fmtKm(kmDe(v.id, d)) : '—'}</td>)}
                          <td className="py-2 text-right font-semibold text-ink">{fmtKm(kmTot)}</td>
                          <td className="py-2 text-right text-ink">{bultosDia || '—'}</td>
                          <td className="py-2 text-right font-semibold text-teal-500">{fmtBultosKm(bultosDia, kmTot)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </section>

              <section className="overflow-x-auto rounded-2xl border border-line bg-surface p-4">
                <h2 className="mb-1 font-semibold text-ink">Paradas fuera de locales y depósito</h2>
                <p className="mb-2 text-xs text-sub">
                  Donde el vehículo se quedó quieto 10 minutos o más lejos de todo local, del depósito y de la fábrica.
                </p>
                {!paradas.length ? (
                  <p className="py-4 text-center text-sm text-sub">Ninguna parada fuera de locales en este período.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs text-sub">
                        <th className="py-2">Vehículo</th>
                        <th className="py-2">Fecha</th>
                        <th className="py-2 text-right">Desde</th>
                        <th className="py-2 text-right">Hasta</th>
                        <th className="py-2 text-right">Cuánto</th>
                        <th className="py-2">Más cerca de</th>
                        <th className="py-2 text-right">Mapa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paradas.map((p) => {
                        const v = vehiculos.find((x) => x.id === p.vehiculo_id)
                        return (
                          <tr key={`${p.vehiculo_id}|${p.desde}`}
                            onClick={() => navigate(`/administradores/tracking?fecha=${p.dia}`)}
                            className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-surface2" title="Ver ese día en el mapa">
                            <td className="py-2 font-medium" style={{ color: v?.color }}>{v?.nombre ?? '?'}</td>
                            <td className="py-2 text-ink">{diaSemana(p.dia)} {fmtFecha(p.dia)}</td>
                            <td className="py-2 text-right text-sub">{fmtHora(p.desde)}</td>
                            <td className="py-2 text-right text-sub">{fmtHora(p.hasta)}</td>
                            <td className="py-2 text-right font-semibold text-orange-500">{hm(Number(p.minutos))}</td>
                            <td className="py-2 text-ink">{fmtCerca(p.cerca_de, Number(p.cerca_m))}</td>
                            <td className="py-2 text-right">
                              <a
                                href={`https://maps.google.com/?q=${p.lat},${p.lng}`}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs font-medium text-teal-500 hover:underline"
                              >
                                Ver punto
                              </a>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )}
          <p className="mt-3 text-[11px] text-sub">
            Cuenta la distancia entre las ubicaciones de Traccar (solo las precisas, sin saltos imposibles ni el temblequeo del GPS quieto).
            En curvas da apenas menos que el odómetro; los tramos sin señal no se cuentan.
          </p>
        </>
      )}
    </Layout>
  )
}

/** Km dentro de la columna, arriba de todo; si la columna es muy finita o muy baja, justo encima. */
function EtiquetaKm(props: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: unknown }) {
  const v = Number(props.value)
  if (!v) return null
  const x = Number(props.x ?? 0), y = Number(props.y ?? 0), w = Number(props.width ?? 0), h = Number(props.height ?? 0)
  const texto = nf(v, v < 10 ? 1 : 0)
  const adentro = w >= texto.length * 7 + 4 && h >= 20
  return (
    <text x={x + w / 2} y={adentro ? y + 14 : y - 4} textAnchor="middle"
      fill={adentro ? '#fff' : 'var(--ink)'} fontSize={11} fontWeight={700}>
      {texto}
    </text>
  )
}

function Kpi({ label, valor, sub, color, chico }: { label: string; valor: string; sub: React.ReactNode; color: string; chico?: boolean }) {
  return (
    <div className="rounded-xl border bg-surface p-2.5" style={{ borderColor: `${color}55` }}>
      <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color }}>{label}</div>
      <div className={`${chico ? 'text-base' : 'text-2xl'} truncate font-bold text-ink`}>{valor}</div>
      <div className="text-[11px] text-sub">{sub}</div>
    </div>
  )
}
