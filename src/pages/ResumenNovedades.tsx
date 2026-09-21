import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, SearchX, Megaphone, List, LayoutDashboard, Clock, Users, BadgeAlert, CalendarDays, Pencil, Trash2, Download } from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, Cell, LabelList, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { supabase } from '@/lib/supabase'
import { FILTRO_EMPLEADOS_ACTIVOS } from '@/lib/empleadosActivos'
import { usePermisosArea } from '@/hooks/usePermisosArea'
import MultiselectFiltro, { SelectBuscar, AutocompleteCampo } from '@/components/MultiselectFiltro'
import { nombresMotivos, colorFilaMotivo } from '@/lib/motivos'
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

const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']
const MESES_CORTOS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC']

const PALETA = ['#8b5cf6', '#22d3ee', '#f472b6', '#34d399', '#fbbf24', '#60a5fa', '#f87171', '#a3e635', '#e879f9', '#2dd4bf', '#fb923c', '#c084fc', '#94a3b8']

/** Motivos que se miden en DÍAS (licencias, vacaciones, bajas...) vs en cantidad. */
const MOTIVOS_DIAS = new Set(['VACACIONES', 'LICENCIA', 'CARPETA MÉDICA', 'CARPETA MEDICA', 'BAJA', 'AUSENTE', 'SUSPENSION', 'ACCIDENTE', 'ENFERMEDAD'])
function esMotivoDias(motivo: string | null): boolean {
  return !!motivo && MOTIVOS_DIAS.has(String(motivo).trim().toUpperCase())
}
function diasEntre(desde: string | null, hasta: string | null): number {
  if (!desde || !hasta) return 1
  const a = new Date(desde + 'T00:00:00').getTime()
  const b = new Date(hasta + 'T00:00:00').getTime()
  if (isNaN(a) || isNaN(b) || b < a) return 1
  return Math.round((b - a) / 86400000) + 1
}

function mesNombre(mes: string | null): string {
  return (mes ?? '').split(/[ (]/)[0].trim().toUpperCase()
}
function mesIndex(mes: string | null): number {
  return MESES.indexOf(mesNombre(mes))
}
function toNum(v: string | null | undefined): number {
  const n = Number(((v ?? '').replace(/[^0-9.,-]/g, '') || '0').replace(',', '.'))
  return isNaN(n) ? 0 : n
}
function fmtMin(tot: number): string {
  if (tot <= 0) return '0'
  const h = Math.floor(tot / 60)
  const m = Math.round(tot % 60)
  return h ? `${h}h ${m}m` : `${m}m`
}

async function cargarTodas(query: any): Promise<{ data: Novedad[]; error: any }> {
  const CHUNK = 1000
  const acc: Novedad[] = []
  let error: any = null
  for (let i = 0; i < 20000; i += CHUNK) {
    const { data, error: e } = await query.order('created_at', { ascending: false }).range(i, i + CHUNK - 1)
    if (e) { error = e; break }
    acc.push(...(data as Novedad[]))
    if ((data?.length ?? 0) < CHUNK) break
  }
  return { data: acc, error }
}

const cardCls = 'rounded-2xl border border-line bg-surface p-3'

function TooltipDark({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-line bg-zinc-900 px-3 py-2 text-xs shadow-xl">
      {label ? <p className="mb-1 font-semibold text-ink">{label}</p> : null}
      {payload.map((p: any, i: number) => (
        <p key={i} className="flex items-center gap-2 text-sub">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: p.color || p.payload?.fill }} />
          {p.name}: <span className="font-medium text-ink">{formatter ? formatter(p.value) : p.value}</span>
        </p>
      ))}
    </div>
  )
}

export default function ResumenNovedades() {
  const navigate = useNavigate()
  const { editar: puedeEditar, borrar: puedeBorrar } = usePermisosArea('rrhh.novedades')

  const [todos, setTodos] = useState<Novedad[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [vista, setVista] = useState<'dashboard' | 'tabla'>('dashboard')
  const [q, setQ] = useState('')
  const [fAnio, setFAnio] = useState('')
  const [fMesDesde, setFMesDesde] = useState('')
  const [fMesHasta, setFMesHasta] = useState('')
  const [fMotivo, setFMotivo] = useState('')
  const [fLocal, setFLocal] = useState('')
  const [fTipo, setFTipo] = useState('')
  const [sortKeys, setSortKeys] = useState<{ clave: string; dir: 1 | -1 }[]>([{ clave: 'nombre_completo', dir: 1 }])
  const [filtrosCol, setFiltrosCol] = useState<Record<string, string[]>>({})
  const [motivos, setMotivos] = useState<string[]>([])
  const [tipos, setTipos] = useState<string[]>([])
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)
  const [empleadosResumen, setEmpleadosResumen] = useState<{ legajo: string; nombre: string }[]>([])

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    setCargando(true); setError(null)
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
    const [tes, mts, tps] = await Promise.all([
      cargarTodas(query),
      nombresMotivos(),
      nombresTipos(),
    ])
    const err = tes.error
    if (err) { setError(err.message); setCargando(false); return }
    setTodos(tes.data)
    setMotivos(mts)
    setTipos(tps)
    setCargando(false)
  }, [fAnio, fMesDesde, fMesHasta, fMotivo, fLocal, fTipo, q])

  useEffect(() => { void cargar() }, [cargar])

  // Empleados (legajo + nombre) para autocompletar el filtro por legajo o nombre
  useEffect(() => {
    if (!supabase) return
    void supabase.from('empleados').select('legajo,nombre').not('legajo', 'is', null).or(FILTRO_EMPLEADOS_ACTIVOS).then(({ data }) => {
      const rows = ((data as { legajo: string | null; nombre: string | null }[] | null) ?? [])
        .filter((e) => e.legajo && e.nombre)
        .map((e) => ({ legajo: String(e.legajo), nombre: String(e.nombre) }))
      setEmpleadosResumen(rows)
    })
  }, [])

  const anios = useMemo(
    () => Array.from(new Set(todos.map((n) => n.anio).filter((a): a is string => !!a))).sort((a, b) => b.localeCompare(a, 'es', { numeric: true })),
    [todos],
  )
  const locales = useMemo(
    () => Array.from(new Set(todos.map((n) => n.local).filter((l): l is string => !!l))).sort((a, b) => a.localeCompare(b, 'es')),
    [todos],
  )

  const term = q.trim().toUpperCase()

  const opcionesResumen = useMemo(
    () => empleadosResumen.map((e) => ({ id: `${e.legajo} - ${e.nombre}`, label: `${e.legajo} - ${e.nombre}` })),
    [empleadosResumen],
  )
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
    if (term) {
      const m = term.match(/^(\d+)\s*-\s*.+$/)
      const esNumero = /^\d+$/.test(term)
      r = r.filter((n) => {
        const num = (n.numero || '').trim()
        const nom = (n.nombre_completo || '').toUpperCase()
        if (m) return num === m[1]
        if (esNumero) return num === term
        return nom.includes(term) || num.includes(term) || (n.local || '').toUpperCase().includes(term) || (n.novedad || '').toUpperCase().includes(term)
      })
    }
    return r
  }, [todos, fAnio, fMesDesde, fMesHasta, fMotivo, fLocal, fTipo, term])

  const colVal = useCallback((n: Novedad, clave: string): unknown => {
    if (clave === 'mes') return mesNombre(n.mes_liquidacion)
    return (n as unknown as Record<string, unknown>)[clave]
  }, [])

  const columnasRes = ['mes', 'numero', 'nombre_completo', 'tipo', 'fecha', 'local', 'motivo', 'novedad', 'minutos']
  const valoresCol = useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const clave of columnasRes) {
      out[clave] = Array.from(new Set(lista.map((n) => String(colVal(n, clave) ?? '')))).filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))
    }
    return out
  }, [lista, colVal])

  const listaTabla = useMemo(() => {
    let r = lista
    for (const [clave, vals] of Object.entries(filtrosCol)) {
      if (!vals || vals.length === 0) continue
      r = r.filter((n) => vals.includes(String(colVal(n, clave) ?? '')))
    }
    if (sortKeys.length) {
      r = [...r].sort((a, b) => {
        for (const k of sortKeys) {
          const av = colVal(a, k.clave)
          const bv = colVal(b, k.clave)
          let c = 0
          if (k.clave === 'numero' || k.clave === 'minutos') {
            c = (Number(String(av ?? '').replace(',', '.')) || 0) - (Number(String(bv ?? '').replace(',', '.')) || 0)
          } else {
            c = String(av ?? '').localeCompare(String(bv ?? ''), 'es', { numeric: true })
          }
          if (c !== 0) return c * k.dir
        }
        return 0
      })
    }
    return r
  }, [lista, filtrosCol, sortKeys, colVal])

  const toggleOrden = (clave: string) => setSortKeys((prev) => {
    if (prev[0]?.clave === clave) return prev.map((s, i) => (i === 0 ? { ...s, dir: s.dir === 1 ? -1 : 1 } : s))
    return [{ clave, dir: 1 }, ...prev.filter((s) => s.clave !== clave)]
  })
  const sortArrow = (clave: string) => {
    const i = sortKeys.findIndex((s) => s.clave === clave)
    if (i < 0) return '▽'
    const s = sortKeys[i]
    return s.dir === 1 ? `▲${i > 0 ? String(i + 1) : ''}` : `▼${i > 0 ? String(i + 1) : ''}`
  }

  // ---- KPIs ----
  const kpis = useMemo(() => {
    const empleados = new Set<string>()
    let minutos = 0
    let conFecha = 0
    for (const n of lista) {
      const clave = (n.numero || '') + '|' + (n.nombre_completo || '').trim()
      if (clave !== '|') empleados.add(clave)
      minutos += toNum(n.minutos)
      if (n.fecha) conFecha++
    }
    return {
      total: lista.length,
      empleados: empleados.size,
      minutos,
      conFecha,
    }
  }, [lista])

  // ---- Gráficos ----
  const porMes = useMemo(() => {
    const mapa = new Map<number, number>()
    for (const n of lista) {
      const i = mesIndex(n.mes_liquidacion)
      if (i >= 0) mapa.set(i, (mapa.get(i) ?? 0) + 1)
    }
    return MESES_CORTOS.map((m, i) => ({ mes: m, total: mapa.get(i) ?? 0, index: i })).filter((x) => x.total > 0)
  }, [lista])

  const porMotivo = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of lista) {
      const k = (n.motivo ?? 'SIN MOTIVO').trim() || 'SIN MOTIVO'
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return Array.from(m.entries())
      .map(([motivo, cant]) => ({ motivo, cant }))
      .sort((a, b) => b.cant - a.cant)
  }, [lista])

  const porLocal = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of lista) {
      const k = (n.local ?? 'SIN LOCAL').trim() || 'SIN LOCAL'
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return Array.from(m.entries())
      .map(([local, cant]) => ({ local, cant }))
      .sort((a, b) => b.cant - a.cant)
  }, [lista])

  // Top 10 por legajo+nombre, ajustando la métrica según el motivo filtrado:
  // - motivo de días (VACACIONES, LICENCIA, BAJA...) -> suma de días
  // - motivo de cantidad (TARDANZA, APERCIBIM...) o sin motivo -> cantidad de novedades
  const topEmpleados = useMemo(() => {
    const m = new Map<string, { lote: string; nombre: string; cant: number; dias: number }>()
    for (const n of lista) {
      const clave = (n.numero || '') + '|' + (n.nombre_completo || '').trim()
      if (clave === '|') continue
      const prev = m.get(clave) ?? { lote: n.numero || '', nombre: (n.nombre_completo || '').trim() || 'SIN NOMBRE', cant: 0, dias: 0 }
      prev.cant++
      if (fMotivo ? esMotivoDias(fMotivo) : false) prev.dias += diasEntre(n.desde, n.hasta)
      m.set(clave, prev)
    }
    const usarDias = !!fMotivo && esMotivoDias(fMotivo)
    return Array.from(m.values())
      .map((e) => ({ nombre: (e.lote ? e.lote + ' · ' : '') + e.nombre, valor: usarDias ? e.dias : e.cant }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 10)
  }, [lista, fMotivo])

  // Top 15 por días de ausencia (motivos de días, sin necesidad de filtro)
  const topDias = useMemo(() => {
    const m = new Map<string, { lote: string; nombre: string; dias: number }>()
    for (const n of lista) {
      if (!esMotivoDias(n.motivo)) continue
      const clave = (n.numero || '') + '|' + (n.nombre_completo || '').trim()
      if (clave === '|') continue
      const prev = m.get(clave) ?? { lote: n.numero || '', nombre: (n.nombre_completo || '').trim() || 'SIN NOMBRE', dias: 0 }
      prev.dias += diasEntre(n.desde, n.hasta)
      m.set(clave, prev)
    }
    return Array.from(m.values())
      .map((e) => ({ nombre: (e.lote ? e.lote + ' · ' : '') + e.nombre, dias: e.dias }))
      .sort((a, b) => b.dias - a.dias)
      .slice(0, 15)
  }, [lista])

  // Comparación mensual por motivo (top 6 + Otros), para ver evolución
  const porMesMotivo = useMemo(() => {
    const top = porMotivo.slice(0, 6).map((x) => x.motivo)
    const topSet = new Set(top)
    const filas = new Map<number, Record<string, number>>()
    for (const n of lista) {
      const i = mesIndex(n.mes_liquidacion)
      if (i < 0) continue
      const f = filas.get(i) ?? { index: i }
      const k = (n.motivo ?? 'SIN MOTIVO').trim() || 'SIN MOTIVO'
      const key = topSet.has(k) ? k : 'Otros'
      f[key] = (f[key] ?? 0) + 1
      filas.set(i, f)
    }
    return Array.from(filas.values())
      .sort((a, b) => a.index - b.index)
      .map((f) => {
        const { index: _i, ...rest } = f
        return { mes: MESES_CORTOS[_i], ...rest }
      })
  }, [lista, porMotivo])

  const hayFiltros = !!(q || fAnio || fMesDesde || fMesHasta || fMotivo || fLocal || fTipo)
  function limpiar() {
    setQ(''); setFAnio(''); setFMesDesde(''); setFMesHasta(''); setFMotivo(''); setFLocal(''); setFTipo('')
  }

  async function exportarExcel() {
    const XLSX = await import('xlsx')
    const filas = lista.map((n) => ({
      'Año': n.anio ?? '',
      'Mes': n.mes_liquidacion ?? '',
      'N°': n.numero ?? '',
      'Nombre': n.nombre_completo ?? '',
      'Tipo': n.tipo ?? '',
      'Fecha': n.fecha ?? '',
      'Desde': n.desde ?? '',
      'Hasta': n.hasta ?? '',
      'Días': esMotivoDias(n.motivo) ? diasEntre(n.desde, n.hasta) : '',
      'Local': n.local ?? '',
      'Motivo': n.motivo ?? '',
      'Novedad': n.novedad ?? '',
      'Minutos': n.minutos ?? '',
      'Control': n.control ?? '',
    }))
    const ws = XLSX.utils.json_to_sheet(filas)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Novedades')
    XLSX.writeFile(wb, `resumen_novedades_${fMesDesde || 'todas'}.xlsx`)
  }

  async function eliminar(n: Novedad) {
    if (!supabase) return
    const { error: err } = await supabase.from('novedades').delete().eq('id', n.id)
    if (err) { return }
    await cargar()
  }

  const kpiCards = [
    { icon: Megaphone, label: 'Novedades', value: String(kpis.total), color: 'text-violet-400' },
    { icon: Users, label: 'Empleados afectados', value: String(kpis.empleados), color: 'text-cyan-400' },
    { icon: Clock, label: 'Minutos totales', value: fmtMin(kpis.minutos), color: 'text-amber-400' },
    { icon: CalendarDays, label: 'Con fecha', value: String(kpis.conFecha), color: 'text-emerald-400' },
  ]

  return (
    <Layout wide>
      <BackButton />
      <header className="mb-3 mt-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink"><Megaphone size={20} className="text-violet-500" aria-hidden /> Resumen Novedades <span className="text-sm font-normal text-sub">({lista.length}{hayFiltros ? ` de ${todos.length}` : ''})</span></h1>
          <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1">
            <button onClick={() => setVista('dashboard')} className={'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition ' + (vista === 'dashboard' ? 'bg-brand-600/25 text-brand-400' : 'text-sub hover:text-ink')}><LayoutDashboard size={13} aria-hidden /> Gráficos</button>
            <button onClick={() => setVista('tabla')} className={'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition ' + (vista === 'tabla' ? 'bg-brand-600/25 text-brand-400' : 'text-sub hover:text-ink')}><List size={13} aria-hidden /> Detalle</button>
          </div>
          <button
            onClick={() => void exportarExcel()}
            className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            title="Exportar a Excel las novedades filtradas"
          >
            <Download size={15} aria-hidden /> Exportar
          </button>
        </div>
        <p className="text-xs text-sub/70">Estadísticas y comparativas de novedades (los meses van del 26 al 25).</p>
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
        <AutocompleteCampo label="Legajo o nombre" opciones={opcionesResumen} valor={q} onChange={setQ} placeholder="Buscar por legajo o nombre..." className="w-72" />
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

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sub"><Loader2 size={18} className="animate-spin" aria-hidden /> Cargando...</div>
      ) : lista.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-6 text-center">
          <SearchX size={32} className="mx-auto mb-2 text-sub/40" aria-hidden />
          <p className="text-sm text-sub">{hayFiltros ? 'No se encontraron novedades con esos filtros.' : 'Todavia no hay novedades cargadas.'}</p>
        </div>
      ) : vista === 'dashboard' ? (
        <div className="space-y-3">
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {kpiCards.map((k) => (
              <div key={k.label} className={cardCls}>
                <p className="flex items-center gap-1.5 text-[11px] font-medium text-sub"><k.icon size={13} className={k.color} aria-hidden /> {k.label}</p>
                <p className="mt-1 font-display text-2xl font-semibold text-ink tabular-nums">{k.value}</p>
              </div>
            ))}
          </div>

          {/* Fila 1: por mes + por tipo */}
          <div className="grid gap-3 lg:grid-cols-2">
            <div className={cardCls}>
              <p className="mb-2 text-xs font-semibold text-sub flex items-center gap-1.5"><CalendarDays size={13} className="text-violet-400" aria-hidden /> Novedades por mes</p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={porMes} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" vertical={false} />
                    <XAxis dataKey="mes" tick={{ fill: '#a1a1aa', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.12)' }} tickLine={false} />
                    <YAxis tick={{ fill: '#a1a1aa', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip content={<TooltipDark />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                    <Bar dataKey="total" name="Novedades" radius={[4, 4, 0, 0]} maxBarSize={42}>
                      {porMes.map((d, i) => <Cell key={d.mes} fill={PALETA[i % PALETA.length]} />)}
                      <LabelList dataKey="total" position="top" fill="#e4e4e7" fontSize={10} formatter={(v: unknown) => (typeof v === 'number' && v > 0 ? v : '')} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className={cardCls}>
              <p className="mb-2 text-xs font-semibold text-sub flex items-center gap-1.5"><Users size={13} className="text-cyan-400" aria-hidden /> Top 10 por empleado{fMotivo ? ` · ${fMotivo}` : ''} <button onClick={() => setFMotivo('')} title="Quitar motivo" className="rounded border border-line px-1 text-[10px] text-sub transition hover:text-ink">✕</button></p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topEmpleados} layout="vertical" margin={{ top: 0, right: 20, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" horizontal={false} />
                    <XAxis type="number" tick={{ fill: '#a1a1aa', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="nombre" width={140} tick={{ fill: '#a1a1aa', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<TooltipDark formatter={(v: number) => (fMotivo && esMotivoDias(fMotivo) ? `${v} días` : v)} />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                    <Bar dataKey="valor" name={fMotivo ? fMotivo : 'Novedades'} radius={[0, 4, 4, 0]} maxBarSize={14}>
                      {topEmpleados.map((d, i) => <Cell key={d.nombre} fill={PALETA[(i + 3) % PALETA.length]} />)}
                      <LabelList dataKey="valor" position="right" fill="#e4e4e7" fontSize={10} formatter={(v: unknown) => (typeof v === 'number' && v > 0 ? v : '')} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-1 text-[10px] text-sub/60">Hacé clic en un motivo en el gráfico "Top motivos" para ver el ranking de ese motivo.</p>
            </div>
          </div>

          {/* Fila 2: por motivo + por local */}
          <div className="grid gap-3 lg:grid-cols-2">
            <div className={cardCls}>
              <p className="mb-2 text-xs font-semibold text-sub flex items-center gap-1.5"><BadgeAlert size={13} className="text-amber-400" aria-hidden /> Top motivos <span className="font-normal text-[10px] text-sub/60">(clic para filtrar)</span></p>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={porMotivo.slice(0, 10)} layout="vertical" margin={{ top: 0, right: 10, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" horizontal={false} />
                    <XAxis type="number" tick={{ fill: '#a1a1aa', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="motivo" width={110} tick={{ fill: '#a1a1aa', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<TooltipDark />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                    <Bar dataKey="cant" name="Novedades" radius={[0, 4, 4, 0]} maxBarSize={18} onClick={(d: any) => { const motivo = d?.['motivo'] as string | undefined; if (motivo) setFMotivo((m) => (m === motivo ? '' : motivo)) }} cursor="pointer">
                      {porMotivo.slice(0, 10).map((d, i) => {
                        const col = colorFilaMotivo(d.motivo)?.fg
                        const sel = d.motivo === fMotivo
                        return <Cell key={d.motivo} fill={col || PALETA[(i + 5) % PALETA.length]} stroke={sel ? '#fbbf24' : undefined} strokeWidth={sel ? 2 : 0} />
                      })}
                      <LabelList dataKey="cant" position="right" fill="#e4e4e7" fontSize={10} formatter={(v: unknown) => (typeof v === 'number' && v > 0 ? v : '')} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-1 text-[10px] text-sub/60">Clic en una barra: TARDANZA → ranking por cantidad · VACACIONES/LICENCIA → ranking por días.</p>
            </div>

            <div className={cardCls}>
              <p className="mb-2 text-xs font-semibold text-sub flex items-center gap-1.5"><Megaphone size={13} className="text-emerald-400" aria-hidden /> Novedades por local</p>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={porLocal.slice(0, 12)} layout="vertical" margin={{ top: 0, right: 10, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" horizontal={false} />
                    <XAxis type="number" tick={{ fill: '#a1a1aa', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="local" width={100} tick={{ fill: '#a1a1aa', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<TooltipDark />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                    <Bar dataKey="cant" name="Novedades" radius={[0, 4, 4, 0]} maxBarSize={18}>
                      {porLocal.slice(0, 12).map((d, i) => <Cell key={d.local} fill={PALETA[(i + 1) % PALETA.length]} />)}
                      <LabelList dataKey="cant" position="right" fill="#e4e4e7" fontSize={10} formatter={(v: unknown) => (typeof v === 'number' && v > 0 ? v : '')} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Fila 3: comparativa mensual por motivo + top empleados */}
          <div className="grid gap-3 lg:grid-cols-2">
            <div className={cardCls}>
              <p className="mb-2 text-xs font-semibold text-sub flex items-center gap-1.5"><CalendarDays size={13} className="text-pink-400" aria-hidden /> Comparativa mensual por motivo</p>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={porMesMotivo} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" vertical={false} />
                    <XAxis dataKey="mes" tick={{ fill: '#a1a1aa', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.12)' }} tickLine={false} />
                    <YAxis tick={{ fill: '#a1a1aa', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip content={<TooltipDark />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                    <Legend iconType="circle" iconSize={8} formatter={(v: any) => <span style={{ color: '#a1a1aa', fontSize: 11 }}>{v}</span>} />
                    {Object.keys(porMesMotivo[0] ?? {}).filter((k) => k !== 'mes').map((k, i) => (
                      <Bar key={k} dataKey={k} name={k} stackId="a" fill={PALETA[i % PALETA.length]}>
                        <LabelList dataKey={k} position="inside" fill="#e4e4e7" fontSize={9} formatter={(v: unknown) => (typeof v === 'number' && v > 0 ? v : '')} />
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className={cardCls}>
              <p className="mb-2 text-xs font-semibold text-sub flex items-center gap-1.5"><Users size={13} className="text-indigo-400" aria-hidden /> Top 15 · días ausentes (VACACIONES, LICENCIA, BAJA...)</p>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topDias} layout="vertical" margin={{ top: 0, right: 10, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" horizontal={false} />
                    <XAxis type="number" tick={{ fill: '#a1a1aa', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="nombre" width={140} tick={{ fill: '#a1a1aa', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<TooltipDark formatter={(v: number) => `${v} días`} />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                    <Bar dataKey="dias" name="Días" radius={[0, 4, 4, 0]} maxBarSize={14}>
                      {topDias.map((d, i) => <Cell key={d.nombre} fill={PALETA[(i + 2) % PALETA.length]} />)}
                      <LabelList dataKey="dias" position="right" fill="#e4e4e7" fontSize={10} formatter={(v: unknown) => (typeof v === 'number' && v > 0 ? v : '')} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="w-full overflow-hidden rounded-2xl border border-line">
          <div className="w-full overflow-x-auto">
            <table className="w-full table-auto border-collapse text-sm leading-tight">
              <thead>
                <tr className="bg-zinc-800 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                  {([['mes', 'Mes'], ['numero', 'N°'], ['nombre_completo', 'Nombre'], ['tipo', 'Tipo'], ['fecha', 'Fecha'], ['local', 'Local'], ['motivo', 'Motivo'], ['novedad', 'Novedad'], ['minutos', 'Min']] as const).map(([clave, label]) => (
                    <th key={clave} className="px-2 py-2 whitespace-nowrap">
                      <button onClick={() => toggleOrden(clave)} className={'inline-flex items-center gap-1 uppercase tracking-wider transition hover:text-white ' + (sortKeys[0]?.clave === clave ? 'text-white' : '')} title={`Ordenar por ${label}`}>
                        {label}
                        <span className="text-[9px] leading-none">{sortArrow(clave)}</span>
                      </button>
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right whitespace-nowrap">Acc</th>
                </tr>
                <tr className="bg-zinc-800/40">
                  {columnasRes.map((clave, i) => {
                    const label = [['mes', 'Mes'], ['numero', 'N°'], ['nombre_completo', 'Nombre'], ['tipo', 'Tipo'], ['fecha', 'Fecha'], ['local', 'Local'], ['motivo', 'Motivo'], ['novedad', 'Novedad'], ['minutos', 'Min']][i][1]
                    return (
                      <th key={clave} className="px-1 py-1 align-top">
                        <MultiselectFiltro
                          compacto
                          label={label}
                          opciones={(valoresCol[clave] ?? []).map((v) => ({ id: v, label: v }))}
                          seleccionadas={new Set(filtrosCol[clave] ?? [])}
                          onChange={(s) => setFiltrosCol((prev) => ({ ...prev, [clave]: Array.from(s) }))}
                        />
                      </th>
                    )
                  })}
                  <th className="px-1 py-1 align-top" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50 bg-surface">
                {listaTabla.map((n) => (
                  <tr key={n.id} className="transition hover:bg-line/20">
                    <td className="px-2 py-1.5 text-sub">{n.mes_liquidacion || '-'}</td>
                    <td className="px-2 py-1.5 text-sub">{n.numero || '-'}</td>
                    <td className="px-2 py-1.5 font-medium text-ink">{n.nombre_completo || '-'}</td>
                    <td className="px-2 py-1.5 text-sub">{n.tipo || '-'}</td>
                    <td className="px-2 py-1.5 text-center text-sub">{n.fecha || '-'}</td>
                    <td className="px-2 py-1.5 text-sub">{n.local || '-'}</td>
                    <td className="px-2 py-1.5"><span className="inline-block whitespace-nowrap rounded-full border border-violet-500/30 bg-violet-500/15 px-1.5 py-px text-[10px] font-medium text-violet-400">{n.motivo || '-'}</span></td>
                    <td className="px-2 py-1.5"><span className="block max-w-[220px] truncate text-sub" title={n.novedad || ''}>{n.novedad || '-'}</span></td>
                    <td className="px-2 py-1.5 text-center text-sub">{n.minutos || '-'}</td>
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