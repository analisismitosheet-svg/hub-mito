import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, TrendingUp, User } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

interface Empleado { id: string; legajo: string | null; nombre: string }
interface ItemSep {
  lote_id: string
  hecho_por: string | null
  hecho_at: string | null
  estado: string
  cantidad: number
}

interface FilaEmpleado {
  empleadoId: string
  nombre: string
  legajo: string | null
  items: number
  unidades: number
  lotes: number
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

export default function EstadisticasRendimiento() {
  const { can } = useAuth()
  const [empleados, setEmpleados] = useState<Empleado[]>([])
  const [items, setItems] = useState<ItemSep[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')

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
      const [empData, itemsData] = await Promise.all([
        traerTodo<Empleado>((from, to) => sb.from('empleados').select('id,legajo,nombre').order('nombre').range(from, to)),
        traerTodo<ItemSep>((from, to) => sb.from('mayorista_items').select('lote_id,hecho_por,hecho_at,estado,cantidad').order('hecho_at', { ascending: true }).range(from, to)),
      ])
      setEmpleados(empData)
      setItems(itemsData)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de red')
    }
    setCargando(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  const filas = useMemo<FilaEmpleado[]>(() => {
    // Solo items hechos con empleado asignado
    const hechos = items.filter((i) => i.estado === 'hecho' && i.hecho_por && i.hecho_at)
    // Filtrar por rango de fechas (hecho_at)
    let hechosFiltrados = hechos
    if (desde) hechosFiltrados = hechosFiltrados.filter((i) => (i.hecho_at ?? '') >= desde)
    if (hasta) hechosFiltrados = hechosFiltrados.filter((i) => (i.hecho_at ?? '') <= hasta + 'T23:59:59')

    // Mapa por empleado: items y unidades
    const porEmpleado = new Map<string, FilaEmpleado>()
    // Lapsos por (empleado, lote): primer y último hecho_at
    const lapsos = new Map<string, { min: number; max: number }>()

    for (const i of hechosFiltrados) {
      const empId = i.hecho_por!
      let f = porEmpleado.get(empId)
      if (!f) {
        const emp = empleados.find((e) => e.id === empId)
        f = { empleadoId: empId, nombre: emp?.nombre ?? 'Desconocido', legajo: emp?.legajo ?? null, items: 0, unidades: 0, lotes: 0, segundos: 0 }
        porEmpleado.set(empId, f)
      }
      f.items += 1
      f.unidades += i.cantidad || 1

      const t = new Date(i.hecho_at!).getTime()
      const key = `${empId}|${i.lote_id}`
      const lapso = lapsos.get(key)
      if (lapso) { if (t < lapso.min) lapso.min = t; if (t > lapso.max) lapso.max = t }
      else lapsos.set(key, { min: t, max: t })
    }

    for (const [key, lapso] of lapsos) {
      const empId = key.split('|')[0]
      const f = porEmpleado.get(empId)
      if (f) {
        f.lotes += 1
        f.segundos += Math.max(0, (lapso.max - lapso.min) / 1000)
      }
    }

    return Array.from(porEmpleado.values()).sort((a, b) => b.unidades - a.unidades)
  }, [items, empleados, desde, hasta])

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
                  <th className="px-3 py-2 whitespace-nowrap">Empleado</th>
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
                  return (
                    <tr key={f.empleadoId} className="transition hover:bg-line/20">
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2 font-medium text-ink"><User size={13} className="text-sub" aria-hidden /> {f.nombre} {f.legajo ? <span className="text-[10px] text-sub/70">#{f.legajo}</span> : null}</span>
                      </td>
                      <td className="px-3 py-2 text-center text-sub">{f.items}</td>
                      <td className="px-3 py-2 text-center font-semibold text-ink">{f.unidades}</td>
                      <td className="px-3 py-2 text-center text-sub">{f.lotes}</td>
                      <td className="px-3 py-2 text-center text-sub whitespace-nowrap">{fmtDuracion(f.segundos)}</td>
                      <td className="px-3 py-2 text-center text-sub whitespace-nowrap">{unidHora ? unidHora.toFixed(1) : '—'}</td>
                    </tr>
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