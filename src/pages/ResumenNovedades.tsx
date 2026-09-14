import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Search, SearchX, Pencil, Trash2, Megaphone, BarChart3 } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { supabase } from '@/lib/supabase'
import { usePermisosArea } from '@/hooks/usePermisosArea'
import { SelectBuscar } from '@/components/MultiselectFiltro'
import { nombresMotivos } from '@/lib/motivos'
import { nombresTipos } from '@/lib/tipos'

interface Novedad {
  id: string
  anio: string | null
  mes_liquidacion: string | null
  numero: string | null
  nombre_completo: string | null
  tipo: string | null
  fecha: string | null
  desde: string | null
  hasta: string | null
  local: string | null
  motivo: string | null
  novedad: string | null
  minutos: string | null
  control: string | null
  created_at: string
}

const inputCls = 'w-full rounded-xl border border-line bg-surface2 px-3 py-1.5 text-[13px] text-ink outline-none transition duration-250 placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'

/** Meses en orden (el mes de liquidación va del 26 del mes anterior al 25 del mes). */
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']

/** Nombre del mes de liquidación ("ENERO (26/12 AL 25/01)" -> "ENERO"). */
function mesNombre(mes: string | null): string {
  return (mes ?? '').split(/[ (]/)[0].trim().toUpperCase()
}
function mesIndex(mes: string | null): number {
  return MESES.indexOf(mesNombre(mes))
}
function fmtFecha(iso: string | null): string {
  if (!iso) return '-'
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

export default function ResumenNovedades() {
  const navigate = useNavigate()
  const { editar: puedeEditar, borrar: puedeBorrar } = usePermisosArea('rrhh.novedades')

  const [todos, setTodos] = useState<Novedad[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [fAnio, setFAnio] = useState('')
  const [fMesDesde, setFMesDesde] = useState('')
  const [fMesHasta, setFMesHasta] = useState('')
  const [fMotivo, setFMotivo] = useState('')
  const [fLocal, setFLocal] = useState('')
  const [fTipo, setFTipo] = useState('')
  const [motivos, setMotivos] = useState<string[]>([])
  const [tipos, setTipos] = useState<string[]>([])
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    setCargando(true); setError(null)
    // Filtros aplicados en el servidor (la tabla tiene ~11k filas; sin esto solo llegan las primeras 1000)
    let query = supabase.from('novedades').select('*')
    if (fAnio) query = query.eq('anio', fAnio)
    if (fMesDesde || fMesHasta) {
      const desde = fMesDesde ? MESES.indexOf(fMesDesde) : 0
      const hasta = fMesHasta ? MESES.indexOf(fMesHasta) : MESES.length - 1
      const seleccion = MESES.slice(desde, hasta + 1)
      if (seleccion.length) query = query.or(seleccion.map((m) => `mes_liquidacion.like.${m}%`).join(','))
    }
    if (fMotivo) query = query.eq('motivo', fMotivo)
    if (fLocal) query = query.eq('local', fLocal)
    if (fTipo) query = query.eq('tipo', fTipo)
    const t = q.trim().toUpperCase()
    if (t) query = query.or(`nombre_completo.ilike.%${t}%,numero.ilike.%${t}%,local.ilike.%${t}%,novedad.ilike.%${t}%`)
    const [nov, mts, tps] = await Promise.all([
      query.order('created_at', { ascending: false }).limit(2000),
      nombresMotivos(),
      nombresTipos(),
    ])
    const err = nov.error
    if (err) { setError(err.message); setCargando(false); return }
    setTodos((nov.data as Novedad[] | null) ?? [])
    setMotivos(mts)
    setTipos(tps)
    setCargando(false)
  }, [fAnio, fMesDesde, fMesHasta, fMotivo, fLocal, fTipo, q])

  useEffect(() => { void cargar() }, [cargar])

  // Opciones dinámicas
  const anios = useMemo(
    () => Array.from(new Set(todos.map((n) => n.anio).filter((a): a is string => !!a))).sort((a, b) => b.localeCompare(a, 'es', { numeric: true })),
    [todos],
  )
  const locales = useMemo(
    () => Array.from(new Set(todos.map((n) => n.local).filter((l): l is string => !!l))).sort((a, b) => a.localeCompare(b, 'es')),
    [todos],
  )

  const term = q.trim().toUpperCase()
  const lista = useMemo(() => {
    let r = todos
    if (fAnio) r = r.filter((n) => (n.anio ?? '') === fAnio)
    if (fMesDesde) {
      const desde = MESES.indexOf(fMesDesde)
      r = r.filter((n) => { const i = mesIndex(n.mes_liquidacion); return i >= 0 && i >= desde })
    }
    if (fMesHasta) {
      const hasta = MESES.indexOf(fMesHasta)
      r = r.filter((n) => { const i = mesIndex(n.mes_liquidacion); return i >= 0 && i <= hasta })
    }
    if (fMotivo) r = r.filter((n) => (n.motivo ?? '') === fMotivo)
    if (fLocal) r = r.filter((n) => (n.local ?? '') === fLocal)
    if (fTipo) r = r.filter((n) => (n.tipo ?? '') === fTipo)
    if (term) r = r.filter((n) =>
      (n.nombre_completo || '').toUpperCase().includes(term) ||
      (n.numero || '').toUpperCase().includes(term) ||
      (n.local || '').toUpperCase().includes(term) ||
      (n.novedad || '').toUpperCase().includes(term)
    )
    return r
  }, [todos, fAnio, fMesDesde, fMesHasta, fMotivo, fLocal, fTipo, term])

  // Estadísticas por motivo (sobre el resultado filtrado)
  const porMotivo = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of lista) {
      const k = (n.motivo ?? 'SIN MOTIVO').trim() || 'SIN MOTIVO'
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [lista])

  const hayFiltros = !!(q || fAnio || fMesDesde || fMesHasta || fMotivo || fLocal || fTipo)
  function limpiar() {
    setQ(''); setFAnio(''); setFMesDesde(''); setFMesHasta(''); setFMotivo(''); setFLocal(''); setFTipo('')
  }

  async function eliminar(n: Novedad) {
    if (!supabase) return
    const { error: err } = await supabase.from('novedades').delete().eq('id', n.id)
    if (err) { return }
    await cargar()
  }

  return (
    <Layout wide>
      <BackButton />
      <header className="mb-3 mt-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink"><Megaphone size={20} className="text-violet-500" aria-hidden /> Resumen Novedades <span className="text-sm font-normal text-sub">({lista.length}{hayFiltros ? ` de ${todos.length}` : ''})</span></h1>
        <p className="text-xs text-sub/70">Estadísticas de novedades por empleado (los meses van del 26 al 25).</p>
      </header>

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      {/* Filtros */}
      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-surface p-3">
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-sub">Año</span>
          <SelectBuscar label="Año" opciones={anios.map((a) => ({ id: a, label: a }))} valor={fAnio} onChange={setFAnio} className="w-28" />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-sub">Mes desde</span>
          <SelectBuscar label="Mes" opciones={MESES.map((m) => ({ id: m, label: m }))} valor={fMesDesde} onChange={setFMesDesde} className="w-40" />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-sub">Mes hasta</span>
          <SelectBuscar label="Mes" opciones={MESES.map((m) => ({ id: m, label: m }))} valor={fMesHasta} onChange={setFMesHasta} className="w-40" />
        </label>
        <label className="block flex-1 min-w-[180px]">
          <span className="mb-0.5 block text-[11px] font-medium text-sub">Legajo o nombre</span>
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub/70" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por legajo, nombre, novedad..." className={inputCls + ' pl-8 text-xs'} />
          </div>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-sub">Motivo</span>
          <SelectBuscar label="Motivo" opciones={motivos.map((m) => ({ id: m, label: m }))} valor={fMotivo} onChange={setFMotivo} className="w-44" />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-sub">Local</span>
          <SelectBuscar label="Local" opciones={locales.map((l) => ({ id: l, label: l }))} valor={fLocal} onChange={setFLocal} className="w-40" />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[11px] font-medium text-sub">Tipo</span>
          <SelectBuscar label="Tipo" opciones={tipos.map((t) => ({ id: t, label: t }))} valor={fTipo} onChange={setFTipo} className="w-36" />
        </label>
        {hayFiltros && (
          <button onClick={limpiar} className="btn-press rounded-lg border border-line bg-surface2 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-line">Limpiar filtros</button>
        )}
      </div>

      {/* Estadísticas por motivo */}
      {!cargando && porMotivo.length > 0 && (
        <div className="mb-3 rounded-2xl border border-line bg-surface p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-sub"><BarChart3 size={13} aria-hidden /> Totales por motivo ({lista.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {porMotivo.map(([motivo, cant]) => (
              <button
                key={motivo}
                onClick={() => setFMotivo(fMotivo === motivo ? '' : motivo)}
                className={'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ' + (fMotivo === motivo ? 'border-brand-500/50 bg-brand-600/15 text-brand-400' : 'border-line bg-surface2 text-ink hover:bg-line')}
              >
                {motivo}
                <span className="rounded-full bg-line px-1.5 text-[10px] tabular-nums">{cant}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sub"><Loader2 size={18} className="animate-spin" aria-hidden /> Cargando...</div>
      ) : lista.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-6 text-center">
          <SearchX size={32} className="mx-auto mb-2 text-sub/40" aria-hidden />
          <p className="text-sm text-sub">{hayFiltros ? 'No se encontraron novedades con esos filtros.' : 'Todavia no hay novedades cargadas.'}</p>
        </div>
      ) : (
        <div className="w-full overflow-hidden rounded-2xl border border-line">
          <div className="w-full overflow-x-auto">
            <table className="w-full table-auto border-collapse text-sm leading-tight">
              <thead>
                <tr className="bg-zinc-800 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                  <th className="px-2 py-2 whitespace-nowrap">Mes</th>
                  <th className="px-2 py-2 whitespace-nowrap">N°</th>
                  <th className="px-2 py-2 whitespace-nowrap">Nombre</th>
                  <th className="px-2 py-2 whitespace-nowrap">Tipo</th>
                  <th className="px-2 py-2 text-center whitespace-nowrap">Fecha</th>
                  <th className="px-2 py-2 whitespace-nowrap">Desde</th>
                  <th className="px-2 py-2 whitespace-nowrap">Hasta</th>
                  <th className="px-2 py-2 whitespace-nowrap">Local</th>
                  <th className="px-2 py-2 whitespace-nowrap">Motivo</th>
                  <th className="px-2 py-2 whitespace-nowrap">Novedad</th>
                  <th className="px-2 py-2 text-center whitespace-nowrap">Min</th>
                  <th className="px-2 py-2 whitespace-nowrap">Control</th>
                  <th className="px-2 py-2 text-right whitespace-nowrap">Acc</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50 bg-surface">
                {lista.map((n) => (
                  <tr key={n.id} className="transition hover:bg-line/20">
                    <td className="px-2 py-1.5 text-sub">{n.mes_liquidacion || '-'}</td>
                    <td className="px-2 py-1.5 text-sub">{n.numero || '-'}</td>
                    <td className="px-2 py-1.5 font-medium text-ink">{n.nombre_completo || '-'}</td>
                    <td className="px-2 py-1.5 text-sub">{n.tipo || '-'}</td>
                    <td className="px-2 py-1.5 text-center text-sub">{fmtFecha(n.fecha)}</td>
                    <td className="px-2 py-1.5 text-sub">{fmtFecha(n.desde)}</td>
                    <td className="px-2 py-1.5 text-sub">{fmtFecha(n.hasta)}</td>
                    <td className="px-2 py-1.5 text-sub">{n.local || '-'}</td>
                    <td className="px-2 py-1.5"><span className="inline-block whitespace-nowrap rounded-full border border-violet-500/30 bg-violet-500/15 px-1.5 py-px text-[10px] font-medium text-violet-400">{n.motivo || '-'}</span></td>
                    <td className="px-2 py-1.5"><span className="block max-w-[220px] truncate text-sub" title={n.novedad || ''}>{n.novedad || '-'}</span></td>
                    <td className="px-2 py-1.5 text-center text-sub">{n.minutos || '-'}</td>
                    <td className="px-2 py-1.5 text-sub">{n.control || '-'}</td>
                    <td className="px-2 py-1.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {puedeEditar && <button onClick={() => navigate(`/rrhh/novedades/carga?editar=${n.id}`)} className="rounded border border-line p-1 text-sub transition hover:text-ink" title="Editar"><Pencil size={12} aria-hidden /></button>}
                        {puedeBorrar && <button onClick={() => setConfirm({ message: `¿Eliminar la novedad de "${n.nombre_completo || '-'}"?`, onConfirm: () => void eliminar(n) })} className="rounded border border-line p-1 text-sub transition hover:text-red-400" title="Eliminar"><Trash2 size={12} aria-hidden /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmDialog open={!!confirm} message={confirm?.message ?? ''} onCancel={() => setConfirm(null)} onConfirm={() => { confirm?.onConfirm(); setConfirm(null) }} />
    </Layout>
  )
}