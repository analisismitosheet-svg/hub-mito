import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, TrendingUp, User, ChevronRight } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

interface Empleado { id: string; legajo: string | null; nombre: string }
interface ItemSep {
  lote_id: string
  local: string
  hecho_por: string | null
  hecho_at: string | null
  estado: string
  cantidad: number
}

interface Responsable { lote_id: string; local: string; empleado_id: string | null }

interface FilaEmpleado {
  empleadoId: string
  nombre: string
  legajo: string | null
  items: number
  unidades: number
  lotes: number
  segundos: number
  dias: FilaDia[]
}

interface FilaDia {
  fecha: string
  items: number
  unidades: number
  segundos: number
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

function fmtHora(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  } catch {
    return iso
  }
}

function fmtFecha(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

export default function EstadisticasRendimiento() {
  const { can } = useAuth()
  const [empleados, setEmpleados] = useState<Empleado[]>([])
  const [responsables, setResponsables] = useState<Responsable[]>([])
  const [items, setItems] = useState<ItemSep[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    const sb = supabase
    setCargando(true); setError(null)
    try {
      const PAGE = 1000
      async function traerTodo<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
        const acc: T[] = []
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await build(from, from + PAGE - 1)
          if (error) { setError(error.message); break }
          const d = (data as T[] | null) ?? []
          acc.push(...d)
          if (d.length < PAGE) break
        }
        return acc
      }
      const [empData, respData, itemsData] = await Promise.all([
        traerTodo<Empleado>((from, to) => sb.from('empleados').select('id,legajo,nombre').order('nombre').range(from, to)),
        traerTodo<Responsable>((from, to) => sb.from('mayorista_responsables').select('lote_id,local,empleado_id').range(from, to)),
        traerTodo<ItemSep>((from, to) => sb.from('mayorista_items').select('lote_id,local,hecho_por,hecho_at,estado,cantidad').eq('estado', 'hecho').range(from, to)),
      ])
      setEmpleados(empData)
      setResponsables(respData)
      setItems(itemsData)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de red')
    }
    setCargando(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  const filas = useMemo<FilaEmpleado[]>(() => {
    // Solo items hechos con timestamp
    const hechos = items.filter((i) => i.estado === 'hecho' && i.hecho_at)
    // Filtrar por rango de fechas (hecho_at)
    let hechosFiltrados = hechos
    if (desde) hechosFiltrados = hechosFiltrados.filter((i) => (i.hecho_at ?? '') >= desde)
    if (hasta) hechosFiltrados = hechosFiltrados.filter((i) => (i.hecho_at ?? '') <= hasta + 'T23:59:59')

    // Empleado responsable de cada (lote, local): el que separa esa localidad
    const respMap = new Map<string, string>()
    for (const r of responsables) {
      if (r.empleado_id) respMap.set(`${r.lote_id}|${r.local}`, r.empleado_id)
    }

    // Mapa por empleado: items y unidades
    const porEmpleado = new Map<string, FilaEmpleado>()
    // Lapsos por (empleado, día): primer y último hecho_at (tiempo real de trabajo)
    const lapsosDia = new Map<string, { min: number; max: number }>()
    // Lotes únicos por empleado
    const lotesPorEmp = new Map<string, Set<string>>()
    // Detalle por día por empleado
    const diasPorEmp = new Map<string, Map<string, FilaDia>>()

    // Clave de agrupación: legajo (N° de empleado); si no tiene legajo, usa el nombre/id
    const claveEmp = (id: string): { key: string; nombre: string; legajo: string | null } => {
      const emp = empleados.find((e) => e.id === id)
      if (emp) return { key: emp.legajo ?? emp.nombre, nombre: emp.nombre, legajo: emp.legajo }
      return { key: id, nombre: 'Sin asignar', legajo: null }
    }

    for (const i of hechosFiltrados) {
      // Empleado que separa el local de este item
      const empId = respMap.get(`${i.lote_id}|${i.local}`) ?? i.hecho_por
      if (!empId) continue
      const { key, nombre, legajo } = claveEmp(empId)
      let f = porEmpleado.get(key)
      if (!f) {
        f = { empleadoId: empId, nombre, legajo, items: 0, unidades: 0, lotes: 0, segundos: 0, dias: [] }
        porEmpleado.set(key, f)
      }
      f.items += 1
      f.unidades += i.cantidad || 1

      const lotes = lotesPorEmp.get(key)
      if (lotes) lotes.add(i.lote_id)
      else lotesPorEmp.set(key, new Set([i.lote_id]))

      const t = new Date(i.hecho_at!).getTime()
      const dia = (i.hecho_at ?? '').slice(0, 10)
      const keyDia = `${key}|${dia}`
      const lapso = lapsosDia.get(keyDia)
      if (lapso) { if (t < lapso.min) lapso.min = t; if (t > lapso.max) lapso.max = t }
      else lapsosDia.set(keyDia, { min: t, max: t })

      // Detalle por día
      let diasEmp = diasPorEmp.get(key)
      if (!diasEmp) { diasEmp = new Map(); diasPorEmp.set(key, diasEmp) }
      const d = diasEmp.get(dia)
      if (d) { d.items += 1; d.unidades += i.cantidad || 1 }
      else diasEmp.set(dia, { fecha: dia, items: 1, unidades: i.cantidad || 1, segundos: 0 })
    }

    for (const [key, lapso] of lapsosDia) {
      const empId = key.split('|')[0]
      const f = porEmpleado.get(empId)
      if (f) {
        f.segundos += Math.max(0, (lapso.max - lapso.min) / 1000)
      }
      const dia = key.split('|')[1]
      const diasEmp = diasPorEmp.get(empId)
      if (diasEmp) {
        const d = diasEmp.get(dia)
        if (d) d.segundos = Math.max(0, (lapso.max - lapso.min) / 1000)
      }
    }

    for (const [empId, set] of lotesPorEmp) {
      const f = porEmpleado.get(empId)
      if (f) f.lotes = set.size
    }

    for (const [key, diasEmp] of diasPorEmp) {
      const f = porEmpleado.get(key)
      if (f) {
        f.dias = Array.from(diasEmp.values()).sort((a, b) => b.fecha.localeCompare(a.fecha))
      }
    }

    return Array.from(porEmpleado.values()).sort((a, b) => b.unidades - a.unidades)
  }, [items, empleados, responsables, desde, hasta])

  const totalItems = filas.reduce((s, f) => s + f.items, 0)
  const totalUnidades = filas.reduce((s, f) => s + f.unidades, 0)
  const totalSegundos = filas.reduce((s, f) => s + f.segundos, 0)

  const PuedeVer = () => can('mayorista.estadisticas.view')

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
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink"><TrendingUp size={20} className="text-brand-600" aria-hidden /> Estadísticas / Rendimientos</h1>
        <p className="text-xs text-sub/70">Rendimiento por empleado: items separados, unidades y tiempo.</p>
      </header>

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={inputCls + ' w-auto text-xs'} title="Desde" />
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={inputCls + ' w-auto text-xs'} title="Hasta" />
        {(desde || hasta) && (
          <button onClick={() => { setDesde(''); setHasta('') }} className="btn-press rounded-lg border border-line bg-surface2 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-line">Limpiar fechas</button>
        )}
        <span className="text-[11px] text-sub/70">{totalItems} items · {totalUnidades} unidades separadas</span>
      </div>

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sub"><Loader2 size={18} className="animate-spin" aria-hidden /> Cargando...</div>
      ) : filas.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-6 text-center">
          <TrendingUp size={32} className="mx-auto mb-2 text-sub/40" aria-hidden />
          <p className="text-sm text-sub">Todavía no hay separaciones registradas.</p>
        </div>
      ) : (
        <div className="w-full overflow-hidden rounded-2xl border border-line">
          <div className="w-full overflow-x-auto">
            <table className="w-full table-auto border-collapse text-sm leading-tight">
              <thead>
                <tr className="border-b border-line bg-zinc-800 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                  <th className="px-3 py-2 whitespace-nowrap">N° Empleado</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">Items</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">Unidades</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">Lotes</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">Tiempo</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">Unid/h</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50 bg-surface">
                {filas.map((f) => {
                  const unidHora = f.segundos > 0 ? (f.unidades / (f.segundos / 3600)) : 0
                  const clave = f.legajo ?? f.empleadoId
                  const esAbierto = abierto === clave
                  return (
                    <Fragment key={clave}>
                      <tr className={'cursor-pointer transition hover:bg-line/20' + (esAbierto ? ' bg-line/20' : '')} onClick={() => setAbierto(esAbierto ? null : clave)}>
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-2 font-medium text-ink">
                            <ChevronRight size={14} aria-hidden className={'shrink-0 text-sub transition-transform ' + (esAbierto ? 'rotate-90' : '')} />
                            <User size={13} className="text-sub" aria-hidden /> {f.legajo ? `#${f.legajo}` : f.nombre} {f.legajo ? <span className="text-[10px] font-normal text-sub/70">{f.nombre}</span> : null}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center text-sub">{f.items}</td>
                        <td className="px-3 py-2 text-center font-semibold text-ink">{f.unidades}</td>
                        <td className="px-3 py-2 text-center text-sub">{f.lotes}</td>
                        <td className="px-3 py-2 text-center text-sub whitespace-nowrap">{fmtDuracion(f.segundos)}</td>
                        <td className="px-3 py-2 text-center text-sub whitespace-nowrap">{unidHora ? unidHora.toFixed(1) : '—'}</td>
                      </tr>
                      {esAbierto && (
                        <tr>
                          <td colSpan={6} className="bg-surface2/60 px-4 py-2">
                            <div className="rounded-xl border border-line bg-surface">
                              <table className="w-full table-auto border-collapse text-xs leading-tight">
                                <thead>
                                  <tr className="border-b border-line text-left text-[10px] font-semibold uppercase tracking-wider text-sub/70">
                                    <th className="px-3 py-1.5">Fecha</th>
                                    <th className="px-3 py-1.5 text-center">Items</th>
                                    <th className="px-3 py-1.5 text-center">Unidades</th>
                                    <th className="px-3 py-1.5 text-center">Tiempo</th>
                                    <th className="px-3 py-1.5 text-center">Unid/h</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-line/50">
                                  {f.dias.map((d) => {
                                    const uh = d.segundos > 0 ? (d.unidades / (d.segundos / 3600)) : 0
                                    return (
                                      <tr key={d.fecha}>
                                        <td className="px-3 py-1.5 font-medium text-ink">{fmtFecha(d.fecha)}</td>
                                        <td className="px-3 py-1.5 text-center text-sub">{d.items}</td>
                                        <td className="px-3 py-1.5 text-center text-ink">{d.unidades}</td>
                                        <td className="px-3 py-1.5 text-center text-sub whitespace-nowrap">{fmtDuracion(d.segundos)}</td>
                                        <td className="px-3 py-1.5 text-center text-sub whitespace-nowrap">{uh ? uh.toFixed(1) : '—'}</td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-zinc-800/60 font-semibold text-ink">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-center">{totalItems}</td>
                  <td className="px-3 py-2 text-center">{totalUnidades}</td>
                  <td className="px-3 py-2 text-center">{filas.reduce((s, f) => s + f.lotes, 0)}</td>
                  <td className="px-3 py-2 text-center whitespace-nowrap">{fmtDuracion(totalSegundos)}</td>
                  <td className="px-3 py-2 text-center whitespace-nowrap">{totalSegundos > 0 ? (totalUnidades / (totalSegundos / 3600)).toFixed(1) : '—'}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="border-t border-line px-3 py-2 text-[11px] text-sub">
            <span>Última separación registrada: {fmtHora(items.filter((i) => i.hecho_at).map((i) => i.hecho_at).sort().pop() ?? null)}</span>
          </div>
        </div>
      )}
    </Layout>
  )
}