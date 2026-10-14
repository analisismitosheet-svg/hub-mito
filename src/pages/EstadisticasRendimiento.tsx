import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, TrendingUp, User, Timer, Hourglass, Download, Activity } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import EstadisticaVtd from '@/components/EstadisticaVtd'
import FiltroPeriodo, { hoyIso, periodoDe, type Periodo } from '@/components/FiltroPeriodo'
import PausasPiso, { type PausaFila } from '@/components/PausasPiso'
import { nombreMotivoPausa } from '@/components/MotivoPausa'
import { supabase } from '@/lib/supabase'
import { FILTRO_EMPLEADOS_ACTIVOS } from '@/lib/empleadosActivos'
import { usePermisosArea } from '@/hooks/usePermisosArea'

interface Empleado { id: string; legajo: string | null; nombre: string }
/** Tiempo real medido con Iniciar/Pausar/Finalizar en Mi repo (vista vw_tiempos_piso) */
interface TiempoPiso {
  empleado_id: string | null
  fecha: string
  sesiones: number
  repos: number
  unidades: number
  segundos: number
  pendientes_fin: number
}

interface FilaPiso {
  empleadoId: string
  nombre: string
  legajo: string | null
  repos: number
  unidades: number
  segundos: number
  faltaron: number
}

/** Tiempo sin trabajar entre una tarea terminada y la siguiente del mismo legajo
 *  (RPC estadistica_tiempos_muertos, sql/armado_tiempos_muertos.sql). */
interface TiempoMuerto {
  usuario_id: string
  legajo: string | null
  nombre: string | null
  cortes: number
  muerto: number
  promedio: number
  maximo: number
}

function fmtDuracion(seg: number): string {
  if (seg <= 0) return '—'
  const h = Math.floor(seg / 3600)
  const m = Math.floor((seg % 3600) / 60)
  const s = Math.floor(seg % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export default function EstadisticasRendimiento() {
  const { ver: puedeVer } = usePermisosArea('mayorista.estadisticas')
  const [empleados, setEmpleados] = useState<Empleado[]>([])
  const [tiempos, setTiempos] = useState<TiempoPiso[]>([])
  const [muertos, setMuertos] = useState<TiempoMuerto[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Fallas propias de cada fuente (antes se ocultaban y parecía "no hay datos")
  const [avisoTiempos, setAvisoTiempos] = useState<string | null>(null)
  const [avisoMuertos, setAvisoMuertos] = useState<string | null>(null)
  // Un solo filtro de fechas para toda la pantalla (repos, tiempo real, tiempo muerto y pausas)
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDe('dia', hoyIso()))
  const { desde, hasta } = periodo
  // Filas de pausas que expone PausasPiso, para incluirlas en el Excel de la pantalla
  const [pausas, setPausas] = useState<PausaFila[]>([])

  const cargar = useCallback(async (desdeF: string, hastaF: string) => {
    if (!supabase) { setCargando(false); return }
    const sb = supabase
    setCargando(true); setError(null); setAvisoTiempos(null); setAvisoMuertos(null)
    try {
      const desdeQ = desdeF
      const hastaQ = hastaF

      const [empData, tiemposData, muertosData] = await Promise.all([
        sb.from('empleados_basico').select('id,legajo,nombre').or(FILTRO_EMPLEADOS_ACTIVOS).order('nombre'),
        sb.from('vw_tiempos_piso').select('empleado_id,fecha,sesiones,repos,unidades,segundos,pendientes_fin').gte('fecha', desdeQ).lte('fecha', hastaQ),
        sb.rpc('estadistica_tiempos_muertos', { p_desde: desdeQ, p_hasta: hastaQ }),
      ])
      setEmpleados((empData.data as Empleado[] | null) ?? [])
      // Si la vista todavía no existe (sql/piso_tiempos.sql sin aplicar) la sección no se muestra,
      // pero se avisa por qué en vez de dejar la pantalla como "sin datos".
      setTiempos(tiemposData.error ? [] : ((tiemposData.data as TiempoPiso[] | null) ?? []))
      // Igual con el tiempo muerto: si el RPC no está aplicado, se avisa.
      setMuertos(muertosData.error ? [] : ((muertosData.data as TiempoMuerto[] | null) ?? []))
      setAvisoTiempos(tiemposData.error ? (tiemposData.error.message || 'No se pudo leer el tiempo real en piso.') : null)
      setAvisoMuertos(muertosData.error ? (muertosData.error.message || 'No se pudo leer el tiempo muerto entre tareas.') : null)
      if (empData.error) setError(empData.error.message)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de red')
    }
    setCargando(false)
  }, [])

  useEffect(() => { void cargar(desde, hasta) }, [cargar, desde, hasta])

  const filasPiso = useMemo<FilaPiso[]>(() => {
    const porId = new Map(empleados.map((e) => [e.id, e]))
    const mapa = new Map<string, FilaPiso>()
    for (const t of tiempos) {
      if (!t.empleado_id) continue
      const emp = porId.get(t.empleado_id)
      let f = mapa.get(t.empleado_id)
      if (!f) {
        f = { empleadoId: t.empleado_id, nombre: emp?.nombre ?? 'Sin nombre', legajo: emp?.legajo ?? null, repos: 0, unidades: 0, segundos: 0, faltaron: 0 }
        mapa.set(t.empleado_id, f)
      }
      f.repos += t.repos
      f.unidades += t.unidades
      f.segundos += t.segundos
      f.faltaron += t.pendientes_fin
    }
    return Array.from(mapa.values()).sort((a, b) => b.unidades - a.unidades)
  }, [tiempos, empleados])

  const sinDatos = filasPiso.length === 0 && muertos.length === 0 && pausas.length === 0

  /** Baja un Excel con las tres tablas de la pantalla (una hoja por bloque). */
  async function exportar() {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasPiso.map((f) => ({
      Legajo: f.legajo ?? '', Empleado: f.nombre, Repos: f.repos, Unidades: f.unidades,
      'Tiempo real': fmtDuracion(f.segundos),
      'Unid/h': f.segundos > 0 ? Number((f.unidades / (f.segundos / 3600)).toFixed(1)) : '',
      Faltaron: f.faltaron,
    }))), 'Tiempo real')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([...muertos].sort((a, b) => b.muerto - a.muerto).map((m) => ({
      Legajo: m.legajo ?? '', Empleado: m.nombre ?? '', Cortes: m.cortes,
      'Tiempo muerto': fmtDuracion(m.muerto), Promedio: fmtDuracion(m.promedio), 'Maximo': fmtDuracion(m.maximo),
    }))), 'Tiempo muerto')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pausas.map((p) => ({
      Legajo: p.legajo ?? '', Empleado: p.nombre ?? '', Motivo: nombreMotivoPausa(p.motivo),
      Pausas: p.pausas, 'En pausa': p.abiertas, Tiempo: fmtDuracion(p.segundos),
    }))), 'Pausas')
    XLSX.writeFile(wb, `eficiencia_mayorista_${desde}_a_${hasta}.xlsx`)
  }

  if (!puedeVer) {
    return (
      <Layout>
        <BackButton />
        <p className="rounded-xl border border-line bg-surface p-6 text-sm text-sub">No tenés permiso para ver estadísticas.</p>
      </Layout>
    )
  }

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink"><TrendingUp size={20} className="text-brand-600" aria-hidden /> Eficiencia mayorista</h1>
          <p className="text-xs text-sub/70">Repos por día y por semana, y tiempo real en piso por empleado.</p>
        </div>
        <button
          type="button"
          onClick={() => void exportar()}
          disabled={sinDatos}
          className="btn-press inline-flex h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink transition hover:bg-surface2 disabled:opacity-50"
          title="Bajar un Excel con las tablas de la pantalla"
        >
          <Download size={16} aria-hidden /> Excel
        </button>
      </header>

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      {/* Filtro de fechas único: maneja todas las secciones de abajo */}
      <div className="sticky top-2 z-20 mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-2 shadow-soft">
        <FiltroPeriodo valor={periodo} onChange={setPeriodo} />
        {cargando && (
          <span role="status" className="inline-flex items-center gap-1.5 text-[11px] font-medium text-sub">
            <Loader2 size={12} className="animate-spin" aria-hidden /> Actualizando…
          </span>
        )}
      </div>

      {/* Repos (motivo VTD): el día o el período elegido, por repo y por local */}
      <EstadisticaVtd desde={desde} hasta={hasta} onVerDia={(f) => setPeriodo(periodoDe('dia', f))} />

      {/* Piso: tiempo real, tiempo muerto y pausas, con el mismo período */}
      <div className="mb-3 mt-4 border-t border-line pt-4">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
          <Activity size={17} className="text-emerald-500" aria-hidden /> Piso
        </h2>
        <p className="text-xs text-sub/70">Tiempo real, tiempo muerto y pausas del mismo período.</p>
      </div>


      {!cargando && avisoTiempos && (
        <p role="status" className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-500">
          No se pudo leer el tiempo real en piso: {avisoTiempos}
        </p>
      )}

      {!cargando && filasPiso.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-1 flex items-center gap-2 font-display text-lg font-semibold text-ink">
            <Timer size={17} className="text-emerald-500" aria-hidden /> Tiempo real en piso
          </h2>
          <p className="mb-2 text-xs text-sub/70">Medido con Iniciar / Pausar / Finalizar en Mi repo. Las pausas no cuentan.</p>
          <div className="w-full overflow-x-auto rounded-2xl border border-line">
            <table className="w-full table-auto border-collapse text-sm leading-tight">
              <thead>
                <tr className="table-head text-left text-[11px] font-semibold uppercase tracking-wider">
                  <th className="px-3 py-2 whitespace-nowrap">N° Empleado</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">Repos</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">Unidades</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">Tiempo real</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">Unid/h</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">Faltaron</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50 bg-surface">
                {filasPiso.map((f) => (
                  <tr key={f.empleadoId}>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2 font-medium text-ink">
                        <User size={13} className="text-sub" aria-hidden /> {f.legajo ? `#${f.legajo}` : f.nombre}{' '}
                        {f.legajo ? <span className="text-[10px] font-normal text-sub/70">{f.nombre}</span> : null}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center text-sub">{f.repos}</td>
                    <td className="px-3 py-2 text-center font-semibold text-ink">{f.unidades}</td>
                    <td className="px-3 py-2 text-center text-ink whitespace-nowrap">{fmtDuracion(f.segundos)}</td>
                    <td className="px-3 py-2 text-center text-sub whitespace-nowrap">{f.segundos > 0 ? (f.unidades / (f.segundos / 3600)).toFixed(1) : '—'}</td>
                    <td className={'px-3 py-2 text-center whitespace-nowrap ' + (f.faltaron > 0 ? 'text-amber-500' : 'text-sub')}>{f.faltaron || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Tiempo muerto entre tareas (fin de una → inicio de la siguiente), con las mismas fechas */}
      {!cargando && avisoMuertos && (
        <p role="status" className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-500">
          No se pudo leer el tiempo muerto entre tareas: {avisoMuertos}
        </p>
      )}
      {!cargando && muertos.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-1 flex items-center gap-2 font-display text-lg font-semibold text-ink">
            <Hourglass size={17} className="text-amber-500" aria-hidden /> Tiempo muerto entre tareas
          </h2>
          <p className="mb-2 text-xs text-sub/70">
            Desde que se finaliza una tarea (armado o repo) hasta que se inicia la siguiente, el mismo día.
            Un “corte” es cada vez que terminó una y tardó en arrancar la próxima.
          </p>
          <div className="w-full overflow-x-auto rounded-2xl border border-line">
            <table className="w-full table-auto border-collapse text-sm leading-tight">
              <thead>
                <tr className="table-head text-left text-[11px] font-semibold uppercase tracking-wider">
                  <th className="px-3 py-2 whitespace-nowrap">N° Empleado</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">Cortes</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">Tiempo muerto</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">Promedio</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">Máximo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50 bg-surface">
                {[...muertos].sort((a, b) => b.muerto - a.muerto).map((m) => (
                  <tr key={m.usuario_id}>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2 font-medium text-ink">
                        <User size={13} className="text-sub" aria-hidden /> {m.legajo ? `#${m.legajo}` : (m.nombre ?? '—')}{' '}
                        {m.legajo ? <span className="text-[10px] font-normal text-sub/70">{m.nombre}</span> : null}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center text-sub">{m.cortes}</td>
                    <td className="px-3 py-2 text-center font-semibold text-amber-500 whitespace-nowrap">{fmtDuracion(m.muerto)}</td>
                    <td className="px-3 py-2 text-center text-sub whitespace-nowrap">{fmtDuracion(m.promedio)}</td>
                    <td className="px-3 py-2 text-center text-sub whitespace-nowrap">{fmtDuracion(m.maximo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Pausas con motivo (repo y armado), con las mismas fechas que el tiempo real y el tiempo muerto */}
      <PausasPiso desde={desde} hasta={hasta} onDatos={setPausas} />

      {cargando && filasPiso.length === 0 && (
        <div className="flex items-center justify-center gap-2 py-10 text-sub"><Loader2 size={18} className="animate-spin" aria-hidden /> Cargando...</div>
      )}
    </Layout>
  )
}