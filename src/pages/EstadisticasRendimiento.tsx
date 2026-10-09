import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, TrendingUp, User, Timer, Hourglass } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import EstadisticaVtd from '@/components/EstadisticaVtd'
import PausasPiso from '@/components/PausasPiso'
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

const inputCls = 'w-full rounded-xl border border-line bg-surface2 px-3 py-1.5 text-[13px] text-ink outline-none transition duration-250 placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'

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
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')

  const cargar = useCallback(async (desdeF: string, hastaF: string) => {
    if (!supabase) { setCargando(false); return }
    const sb = supabase
    setCargando(true); setError(null)
    try {
      const hace90dias = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10)
      const desdeQ = desdeF || hace90dias
      const hastaQ = hastaF || new Date().toISOString().slice(0, 10)

      const [empData, tiemposData, muertosData] = await Promise.all([
        sb.from('empleados_basico').select('id,legajo,nombre').or(FILTRO_EMPLEADOS_ACTIVOS).order('nombre'),
        sb.from('vw_tiempos_piso').select('empleado_id,fecha,sesiones,repos,unidades,segundos,pendientes_fin').gte('fecha', desdeQ).lte('fecha', hastaQ),
        sb.rpc('estadistica_tiempos_muertos', { p_desde: desdeQ, p_hasta: hastaQ }),
      ])
      setEmpleados((empData.data as Empleado[] | null) ?? [])
      // Si la vista todavía no existe (sql/piso_tiempos.sql sin aplicar) simplemente no se muestra
      setTiempos(tiemposData.error ? [] : ((tiemposData.data as TiempoPiso[] | null) ?? []))
      // Igual con el tiempo muerto: si el RPC no está aplicado, la sección no aparece
      setMuertos(muertosData.error ? [] : ((muertosData.data as TiempoMuerto[] | null) ?? []))
      if (empData.error) setError(empData.error.message)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de red')
    }
    setCargando(false)
  }, [])

  useEffect(() => { void cargar(desde, hasta) }, [cargar, desde, hasta])

  const filasPiso = useMemo<FilaPiso[]>(() => {
    const mapa = new Map<string, FilaPiso>()
    for (const t of tiempos) {
      if (!t.empleado_id) continue
      const emp = empleados.find((e) => e.id === t.empleado_id)
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

  const PuedeVer = () => puedeVer

  if (!PuedeVer()) {
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
      <header className="mb-3 mt-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink"><TrendingUp size={20} className="text-brand-600" aria-hidden /> Eficiencia mayorista</h1>
        <p className="text-xs text-sub/70">Repos por día y por semana, y tiempo real en piso por empleado.</p>
      </header>

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      {/* Estadística de las repos (motivo VTD): por día, por semana y por local */}
      <EstadisticaVtd />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={inputCls + ' w-auto text-xs'} title="Desde" />
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={inputCls + ' w-auto text-xs'} title="Hasta" />
        {(desde || hasta) && (
          <button onClick={() => { setDesde(''); setHasta('') }} className="btn-press rounded-lg border border-line bg-surface2 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-line">Limpiar fechas</button>
        )}
        <span className="text-[11px] text-sub/70">Fechas para el tiempo real y las pausas</span>
      </div>

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

      {/* Pausas con motivo (repo y armado), con las mismas fechas */}
      <PausasPiso desde={desde} hasta={hasta} />

      {cargando && filasPiso.length === 0 && (
        <div className="flex items-center justify-center gap-2 py-10 text-sub"><Loader2 size={18} className="animate-spin" aria-hidden /> Cargando...</div>
      )}
    </Layout>
  )
}