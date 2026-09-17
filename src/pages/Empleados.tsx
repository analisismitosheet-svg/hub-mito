import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2, Plus, Trash2, Pencil, Search, SearchX, X, Upload, MapPin } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { supabase } from '@/lib/supabase'
import { usePermisosArea } from '@/hooks/usePermisosArea'
import { AutocompleteCampo } from '@/components/MultiselectFiltro'
import MultiselectFiltro from '@/components/MultiselectFiltro'

/** Convierte una fecha de Excel (serie o texto) a ISO yyyy-mm-dd. */
function fechaExcelAISO(v: unknown): string | null {
  if (v == null || v === '') return null
  if (typeof v === 'number' && v > 0) {
    const ms = Math.round((v - 25569) * 86400 * 1000)
    const d = new Date(ms)
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
    return null
  }
  const s = String(v).trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) {
    let y = +m[3]
    if (y < 100) y += 2000
    return `${y}-${String(+m[2]).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`
  }
  return null
}

interface Empleado {
  id: string
  legajo: string | null
  nombre: string
  activo: boolean | null
  lugar: string | null
  area_sector: string | null
  horas: number | null
  convenio: string | null
  categoria: string | null
  puesto: string | null
  comision: string | null
  reingreso: string | null
  fecha_ingreso: string | null
  antiguedad_2025: number | null
  dias_vacaciones_2025: number | null
  cuil: string | null
  dni: string | null
  fecha_nacimiento: string | null
  sexo: string | null
  telefono: string | null
  domicilio: string | null
  email: string | null
  codigo_os: string | null
  prepaga: string | null
  tipo_contrato: string | null
  contacto_emergencia: string | null
  parentesco: string | null
  telefono_emergencia: string | null
  estado_legajo: string | null
}

const ESTADO_LEGAJO_OPCIONES = ['NOMINA ACTIVA', 'PLANES ACTIVOS', 'BAJAS MITO', 'BAJAS PLANES']
const ESTADO_POR_DEFECTO = 'NOMINA ACTIVA'

/** Estado del legajo; los empleados sin estado cargado cuentan como nomina activa. */
function estadoEfectivo(e: { estado_legajo: string | null }): string {
  const s = (e.estado_legajo || '').toUpperCase().trim()
  return ESTADO_LEGAJO_OPCIONES.includes(s) ? s : ESTADO_POR_DEFECTO
}
function estiloEstadoLegajo(s: string | null): string {
  switch ((s || '').toUpperCase()) {
    case 'NOMINA ACTIVA': return 'bg-emerald-500/15 text-emerald-400'
    case 'PLANES ACTIVOS': return 'bg-sky-500/15 text-sky-400'
    case 'BAJAS MITO': return 'bg-red-500/15 text-red-400'
    case 'BAJAS PLANES': return 'bg-rose-500/15 text-rose-400'
    default: return 'bg-line text-sub'
  }
}

const CAMPOS =
  'id,legajo,nombre,activo,lugar,area_sector,horas,convenio,categoria,puesto,comision,reingreso,fecha_ingreso,antiguedad_2025,dias_vacaciones_2025,cuil,dni,fecha_nacimiento,sexo,telefono,domicilio,email,codigo_os,prepaga,tipo_contrato,contacto_emergencia,parentesco,telefono_emergencia,estado_legajo'

const inputCls = 'w-full rounded-xl border border-line bg-surface2 px-3 py-1.5 text-[13px] text-ink outline-none transition duration-250 placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'
const selectCls = inputCls + ' appearance-none'
const tdBase = 'px-2 py-[3px] whitespace-nowrap'
const tdBaseWrap = 'px-2 py-[3px]'

/** Meses completos desde una fecha ISO (yyyy-mm-dd) hasta hoy. */
function mesesDesde(fechaIso: string | null): number {
  if (!fechaIso) return 0
  const d = new Date(fechaIso + 'T00:00:00')
  if (isNaN(d.getTime())) return 0
  const hoy = new Date()
  let meses = (hoy.getFullYear() - d.getFullYear()) * 12 + (hoy.getMonth() - d.getMonth())
  if (hoy.getDate() < d.getDate()) meses--
  return Math.max(0, meses)
}

/** Años completos desde una fecha ISO hasta hoy. */
function aniosDesde(fechaIso: string | null): number {
  return Math.floor(mesesDesde(fechaIso) / 12)
}

/** Texto de antigüedad: "X años" si supera el año, "X meses" si no llega. */
function textoAntiguedad(fechaIso: string | null): string {
  const m = mesesDesde(fechaIso)
  if (m <= 0) return ''
  const a = aniosDesde(fechaIso)
  if (a >= 1) return `${a} año${a > 1 ? 's' : ''}`
  return `${m} mes${m > 1 ? 'es' : ''}`
}

/** Días de vacaciones: 1-4 años=14, 5-9=21, 10+=28; menos de 1 año = proporcional por meses. */
function vacacionesSegunAntiguedad(fechaIso: string | null): number {
  const m = mesesDesde(fechaIso)
  const a = aniosDesde(fechaIso)
  if (a >= 10) return 28
  if (a >= 5) return 21
  if (a >= 1) return 14
  return Math.round((14 * m) / 12)
}

const SLUG_ESTADO: Record<string, string> = {
  'nomina-activa': 'NOMINA ACTIVA',
  'planes-activos': 'PLANES ACTIVOS',
  'bajas-mito': 'BAJAS MITO',
  'bajas-planes': 'BAJAS PLANES',
}
const ESTADO_SLUG: Record<string, string> = {
  'NOMINA ACTIVA': 'nomina-activa',
  'PLANES ACTIVOS': 'planes-activos',
  'BAJAS MITO': 'bajas-mito',
  'BAJAS PLANES': 'bajas-planes',
}

export default function Empleados() {
  const navigate = useNavigate()
  const { estado: slug = '' } = useParams<{ estado?: string }>()
  const estado = SLUG_ESTADO[slug] ?? ''
  const { crear: puedeCrear, editar: puedeEditar, borrar: puedeBorrar } = usePermisosArea('rrhh.empleados')
  const [empleados, setEmpleados] = useState<Empleado[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [filtros, setFiltros] = useState<Record<string, string[]>>({})
  const [sortKey, setSortKey] = useState<string>('nombre')
  const [sortAsc, setSortAsc] = useState(true)
  const [modal, setModal] = useState<'new' | 'edit' | null>(null)
  const [sel, setSel] = useState<Empleado | null>(null)
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)
  const [importando, setImportando] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const fabRef = useRef<HTMLButtonElement>(null)
  const [fabPos, setFabPos] = useState<{ x: number; y: number } | null>(null)
  const fabDrag = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null)

  function fabDown(e: ReactMouseEvent) {
    e.preventDefault()
    const rect = fabRef.current?.getBoundingClientRect()
    const ox = fabPos?.x ?? (rect ? rect.left : window.innerWidth - 190)
    const oy = fabPos?.y ?? (rect ? rect.top : window.innerHeight - 70)
    fabDrag.current = { sx: e.clientX, sy: e.clientY, ox, oy, moved: false }
    const onMove = (ev: MouseEvent) => {
      const d = fabDrag.current
      if (!d) return
      if (Math.abs(ev.clientX - d.sx) + Math.abs(ev.clientY - d.sy) > 4) d.moved = true
      setFabPos({
        x: Math.max(0, Math.min(window.innerWidth - 190, d.ox + (ev.clientX - d.sx))),
        y: Math.max(0, Math.min(window.innerHeight - 56, d.oy + (ev.clientY - d.sy))),
      })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    const { data, error } = await supabase.from('empleados').select(CAMPOS).order('nombre')
    if (error) setError(error.message)
    setEmpleados((data as Empleado[]) ?? [])
    setCargando(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  // Si entrás a Empleados sin categoría, vas directo a Nómina Activa con el submenú lateral
  useEffect(() => {
    if (!estado) navigate('/rrhh/empleados/nomina-activa', { replace: true })
  }, [estado, navigate])

  // Columnas filtrables y sus valores únicos (como los filtros de Excel)
  const columnasFiltro = useMemo(() => {
    const defs: { clave: string; label: string; valores: string[] }[] = [
      { clave: 'legajo', label: 'Legajo', valores: [] },
      { clave: 'sexo', label: 'Sexo', valores: [] },
      { clave: 'lugar', label: 'Lugar', valores: [] },
      { clave: 'area_sector', label: 'Área / Sector', valores: [] },
      { clave: 'categoria', label: 'Categoría', valores: [] },
      { clave: 'puesto', label: 'Puesto', valores: [] },
      { clave: 'convenio', label: 'Convenio', valores: [] },
      { clave: 'prepaga', label: 'Prepaga', valores: [] },
      { clave: 'tipo_contrato', label: 'Contrato', valores: [] },
      { clave: 'codigo_os', label: 'Código OS', valores: [] },
      { clave: 'estado_legajo', label: 'Estado', valores: [] },
    ]
    for (const d of defs) {
      if (d.clave === 'estado_legajo') {
        d.valores = [...ESTADO_LEGAJO_OPCIONES]
        continue
      }
      d.valores = Array.from(
        new Set(empleados.map((e) => String((e as unknown as Record<string, unknown>)[d.clave] ?? '')).filter((v) => v !== '')),
      ).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))
    }
    return defs
  }, [empleados])

  const filtroDef = (clave: string) => columnasFiltro.find((d) => d.clave === clave)!

  const filtrados = useMemo(() => {
    const t = busqueda.trim().toUpperCase()
    const out = empleados.filter((e) => {
      if (estado && estadoEfectivo(e) !== estado) return false
      for (const [clave, valores] of Object.entries(filtros)) {
        if (!valores || valores.length === 0) continue
        const actual = clave === 'estado_legajo'
          ? estadoEfectivo(e)
          : String((e as unknown as Record<string, unknown>)[clave] ?? '')
        if (!valores.includes(actual)) return false
      }
      if (!t) return true
      return (
        e.nombre.toUpperCase().includes(t) ||
        (e.legajo ?? '').includes(t) ||
        (e.dni ?? '').includes(t) ||
        (e.area_sector ?? '').toUpperCase().includes(t)
      )
    })
    out.sort((a, b) => {
      const val = (e: Empleado) =>
        sortKey === 'estado_legajo' ? estadoEfectivo(e)
        : sortKey === 'antiguedad_2025' ? mesesDesde(e.fecha_ingreso)
        : sortKey === 'dias_vacaciones_2025' ? vacacionesSegunAntiguedad(e.fecha_ingreso)
        : (e as unknown as Record<string, unknown>)[sortKey]
      const av = val(a)
      const bv = val(b)
      const sa = String(av ?? '').trim()
      const sb = String(bv ?? '').trim()
      if (sortKey === 'legajo' || sortKey === 'horas' || sortKey === 'antiguedad_2025' || sortKey === 'dias_vacaciones_2025') {
        const na = Number(sa.replace(',', '.'))
        const nb = Number(sb.replace(',', '.'))
        if (!isNaN(na) && !isNaN(nb)) return sortAsc ? na - nb : nb - na
      }
      const cmp = sa.localeCompare(sb, 'es', { numeric: true })
      return sortAsc ? cmp : -cmp
    })
    return out
  }, [empleados, busqueda, filtros, sortKey, sortAsc, estado])

  const hayFiltros = Object.values(filtros).some((v) => v.length > 0) || !!busqueda

  function toggleSort(clave: string) {
    if (sortKey === clave) setSortAsc((a) => !a)
    else { setSortKey(clave); setSortAsc(true) }
  }
  const sortArrow = (clave: string) => sortKey === clave ? (sortAsc ? ' ↑' : ' ↓') : ''

  // Valores únicos por campo (para el autocomplete del modal)
  const opcionesEmpleado = useMemo(() => {
    const campos = ['lugar', 'area_sector', 'convenio', 'categoria', 'puesto', 'prepaga', 'tipo_contrato'] as const
    const out: Record<string, string[]> = {}
    for (const c of campos) {
      out[c] = Array.from(
        new Set(empleados.map((e) => String((e as unknown as Record<string, unknown>)[c] ?? '')).filter((v) => v !== '')),
      ).sort((a, b) => a.localeCompare(b, 'es'))
    }
    return out
  }, [empleados])

  async function borrar(id: string) {
    if (!supabase) return
    const { error } = await supabase.from('empleados').delete().eq('id', id)
    if (error) { setError(error.message); return }
    await cargar()
  }

  /** Importa el Excel de nómina: detecta columnas por encabezado y hace upsert por legajo. */
  async function importarNomina(file: File) {
    if (!supabase) return
    setImportando(true); setImportMsg(null); setError(null)
    try {
      const XLSX = await import('xlsx')
      const data = new Uint8Array(await file.arrayBuffer())
      const wb = XLSX.read(data, { type: 'array', raw: false })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
      if (json.length === 0) { setError('El archivo está vacío.'); return }

      const headers = Object.keys(json[0])
      const normal = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
      const col = (name: string): string | null => {
        const target = normal(name)
        return headers.find((h) => normal(h).includes(target)) ?? null
      }
      const cLegajo = col('legajo')
      const cNombre = col('apellido y nombre')
      if (!cLegajo || !cNombre) { setError('No se detectaron las columnas "N LEGAJO" y "APELLIDO Y NOMBRE".'); return }

      const val = (row: Record<string, unknown>, name: string): string => {
        const k = col(name)
        return k ? String(row[k] ?? '').trim() : ''
      }
      const num = (row: Record<string, unknown>, name: string): number | null => {
        const s = val(row, name)
        if (!s) return null
        const n = Number(s.replace(',', '.'))
        return isNaN(n) ? null : n
      }

      const BATCH = 200
      let procesados = 0
      let creados = 0
      let actualizados = 0
      for (let i = 0; i < json.length; i += BATCH) {
        const filas = json.slice(i, i + BATCH).map((row) => {
          const payload: Record<string, unknown> = {
            legajo: val(row, 'legajo') || null,
            nombre: val(row, 'apellido y nombre') || null,
            lugar: val(row, 'lugar') || null,
            area_sector: val(row, 'area/sector') || null,
            horas: num(row, 'horas'),
            convenio: val(row, 'convenio') || null,
            categoria: val(row, 'categoria') || null,
            puesto: val(row, 'puesto') || null,
            comision: val(row, 'comision') || null,
            reingreso: val(row, 'reingreso') || null,
            fecha_ingreso: fechaExcelAISO(row[col('fecha de ingreso') ?? ''] ?? null),
            antiguedad_2025: num(row, 'antiguedad 2025'),
            dias_vacaciones_2025: num(row, 'dias de vacac 2025'),
            cuil: val(row, 'cuil') || null,
            dni: val(row, 'dni') || null,
            fecha_nacimiento: fechaExcelAISO(row[col('fecha de nac') ?? ''] ?? null),
            sexo: val(row, 'sexo') || null,
            telefono: val(row, 'telefonos de contacto') || null,
            domicilio: val(row, 'domicilio') || null,
            email: val(row, 'email') || null,
            codigo_os: val(row, 'codigo os') || null,
            prepaga: val(row, 'prepaga') || null,
            tipo_contrato: val(row, 'tipo de contrato') || null,
            contacto_emergencia: val(row, 'contacto emergencia') || null,
            parentesco: val(row, 'parentesco') || null,
            telefono_emergencia: val(row, 'telefonico') || null,
          }
          // Solo se toca el estado si el Excel trae la columna: asi no se pisan
          // los legajos que ya fueron movidos a planes o bajas desde la app.
          if (col('estado')) payload.estado_legajo = val(row, 'estado').toUpperCase() || null
          if (!payload.nombre) return null
          return payload
        }).filter((p): p is Record<string, unknown> => !!p)

        if (filas.length === 0) continue
        procesados += filas.length
        const { error: err, data: res } = await supabase
          .from('empleados')
          .upsert(filas, { onConflict: 'legajo' })
          .select('id,legajo')
        if (err) { setError(err.message); setImportando(false); return }
        // Conteo aproximado por legajo repetido vs nuevo
        for (const r of (res as { legajo: string | null }[] | null) ?? []) {
          if (r.legajo) actualizados++
          else creados++
        }
      }
      setImportMsg(`Se importaron ${procesados} empleados (${creados} nuevos, ${actualizados} actualizados por legajo).`)
      await cargar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al importar el archivo.')
    } finally {
      setImportando(false)
    }
  }

  return (
    <Layout>
      <BackButton />
      <header className="mb-5 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Empleados {estado && <span className="text-lg font-normal text-sub">· {estado}</span>}</h1>
        <p className="mt-1 text-sm text-sub">{estado ? `${estado}: alta, edición y baja.` : 'Seleccioná una categoría.'}</p>
      </header>

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      <div className="flex flex-col gap-4 lg:flex-row">
        <aside className="shrink-0 lg:w-56">
          <div className="flex flex-row gap-1 overflow-x-auto rounded-2xl border border-line bg-surface p-2 lg:flex-col">
            {ESTADO_LEGAJO_OPCIONES.map((s) => {
              const count = empleados.filter((e) => estadoEfectivo(e) === s).length
              return (
                <button
                  key={s}
                  onClick={() => navigate(`/rrhh/empleados/${ESTADO_SLUG[s]}`)}
                  className={'whitespace-nowrap rounded-lg px-3 py-2 text-left text-xs font-medium transition ' + (estado === s ? 'bg-violet-600 text-white' : 'text-sub hover:bg-line hover:text-ink')}
                >
                  {s} <span className={'ml-1 ' + (estado === s ? 'text-white/70' : 'text-sub/60')}>({count})</span>
                </button>
              )
            })}
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-surface p-3">
            <label className="relative block flex-1 min-w-[200px]">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" aria-hidden />
              <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre, legajo, DNI o área..." className={inputCls + ' pl-9'} />
            </label>
            {hayFiltros && (
              <button onClick={() => { setBusqueda(''); setFiltros({}) }} className="btn-press rounded-lg border border-line bg-surface2 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-line">Limpiar filtros</button>
            )}
            {puedeCrear && (
              <button onClick={() => fileRef.current?.click()} disabled={importando} className="btn-press ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-3 py-2 text-sm font-medium text-ink hover:bg-line disabled:opacity-50">
                <Upload size={15} aria-hidden /> {importando ? 'Importando…' : 'Importar nómina'}
              </button>
            )}
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importarNomina(f); e.target.value = '' }} />
          </div>
          {importMsg && <p className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">{importMsg}</p>}

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sub">
          <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando…
        </div>
      ) : filtrados.length === 0 ? (
        <p className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-surface p-6 text-sm text-sub">
          <SearchX size={16} aria-hidden /> No hay empleados que coincidan.
        </p>
      ) : (
<div className="scroll-always-x overflow-auto rounded-2xl border border-line bg-surface" style={{ maxHeight: 'calc(100vh - 230px)' }}>
        <table className="w-full min-w-max table-auto text-[12px]">
            <thead className="sticky top-0 z-10 bg-surface2/95 text-left text-[11px] uppercase tracking-wide text-sub backdrop-blur">
              <tr>
                <th className={tdBase + ' py-2'}><button type="button" onClick={() => toggleSort('legajo')} className="font-semibold uppercase text-sub hover:text-ink">Legajo{sortArrow('legajo')}</button></th>
                <th className={tdBase + ' py-2'}><button type="button" onClick={() => toggleSort('nombre')} className="font-semibold uppercase text-sub hover:text-ink">Nombre{sortArrow('nombre')}</button></th>
                <th className={tdBase + ' py-2'}><button type="button" onClick={() => toggleSort('dni')} className="font-semibold uppercase text-sub hover:text-ink">DNI{sortArrow('dni')}</button></th>
                <th className={tdBase + ' py-2'}><button type="button" onClick={() => toggleSort('cuil')} className="font-semibold uppercase text-sub hover:text-ink">CUIL{sortArrow('cuil')}</button></th>
                <th className={tdBase + ' py-2'}><button type="button" onClick={() => toggleSort('fecha_nacimiento')} className="font-semibold uppercase text-sub hover:text-ink">Nacimiento{sortArrow('fecha_nacimiento')}</button></th>
                <th className={tdBase + ' py-2'}><button type="button" onClick={() => toggleSort('sexo')} className="font-semibold uppercase text-sub hover:text-ink">Sexo{sortArrow('sexo')}</button></th>
                <th className={tdBase + ' py-2'}><button type="button" onClick={() => toggleSort('lugar')} className="font-semibold uppercase text-sub hover:text-ink">Lugar{sortArrow('lugar')}</button></th>
                <th className={tdBase + ' py-2'}><button type="button" onClick={() => toggleSort('area_sector')} className="font-semibold uppercase text-sub hover:text-ink">Área / Sector{sortArrow('area_sector')}</button></th>
                <th className={tdBase + ' py-2'}><button type="button" onClick={() => toggleSort('categoria')} className="font-semibold uppercase text-sub hover:text-ink">Categoría{sortArrow('categoria')}</button></th>
                <th className={tdBase + ' py-2'}><button type="button" onClick={() => toggleSort('puesto')} className="font-semibold uppercase text-sub hover:text-ink">Puesto{sortArrow('puesto')}</button></th>
                <th className={tdBase + ' py-2 text-center'}><button type="button" onClick={() => toggleSort('horas')} className="font-semibold uppercase text-sub hover:text-ink">Horas{sortArrow('horas')}</button></th>
                <th className={tdBase + ' py-2'}><button type="button" onClick={() => toggleSort('convenio')} className="font-semibold uppercase text-sub hover:text-ink">Convenio{sortArrow('convenio')}</button></th>
                <th className={tdBase + ' py-2'}><button type="button" onClick={() => toggleSort('comision')} className="font-semibold uppercase text-sub hover:text-ink">Comisión{sortArrow('comision')}</button></th>
                <th className={tdBase + ' py-2'}><button type="button" onClick={() => toggleSort('reingreso')} className="font-semibold uppercase text-sub hover:text-ink">Reingreso{sortArrow('reingreso')}</button></th>
                <th className={tdBase + ' py-2'}><button type="button" onClick={() => toggleSort('fecha_ingreso')} className="font-semibold uppercase text-sub hover:text-ink">Ingreso{sortArrow('fecha_ingreso')}</button></th>
                <th className={tdBase + ' py-2 text-center'}><button type="button" onClick={() => toggleSort('antiguedad_2025')} className="font-semibold uppercase text-sub hover:text-ink">Antigüedad{sortArrow('antiguedad_2025')}</button></th>
                <th className={tdBase + ' py-2 text-center'}><button type="button" onClick={() => toggleSort('dias_vacaciones_2025')} className="font-semibold uppercase text-sub hover:text-ink">Vacaciones{sortArrow('dias_vacaciones_2025')}</button></th>
                <th className={tdBase + ' py-2'}><button type="button" onClick={() => toggleSort('prepaga')} className="font-semibold uppercase text-sub hover:text-ink">Prepaga{sortArrow('prepaga')}</button></th>
                <th className={tdBase + ' py-2'}><button type="button" onClick={() => toggleSort('tipo_contrato')} className="font-semibold uppercase text-sub hover:text-ink">Contrato{sortArrow('tipo_contrato')}</button></th>
                <th className={tdBase + ' py-2'}><button type="button" onClick={() => toggleSort('codigo_os')} className="font-semibold uppercase text-sub hover:text-ink">Código OS{sortArrow('codigo_os')}</button></th>
                <th className={tdBase + ' py-2'}><button type="button" onClick={() => toggleSort('telefono')} className="font-semibold uppercase text-sub hover:text-ink">Teléfono{sortArrow('telefono')}</button></th>
                <th className={tdBase + ' py-2'}><button type="button" onClick={() => toggleSort('domicilio')} className="font-semibold uppercase text-sub hover:text-ink">Domicilio{sortArrow('domicilio')}</button></th>
                <th className={tdBase + ' py-2'}><button type="button" onClick={() => toggleSort('email')} className="font-semibold uppercase text-sub hover:text-ink">Email{sortArrow('email')}</button></th>
                <th className={tdBase + ' py-2'}><button type="button" onClick={() => toggleSort('contacto_emergencia')} className="font-semibold uppercase text-sub hover:text-ink">Contacto Emerg.{sortArrow('contacto_emergencia')}</button></th>
                <th className={tdBase + ' py-2'}><button type="button" onClick={() => toggleSort('parentesco')} className="font-semibold uppercase text-sub hover:text-ink">Parentesco{sortArrow('parentesco')}</button></th>
                <th className={tdBase + ' py-2'}><button type="button" onClick={() => toggleSort('telefono_emergencia')} className="font-semibold uppercase text-sub hover:text-ink">Tel Emerg.{sortArrow('telefono_emergencia')}</button></th>
                <th className={tdBase + ' py-2'}><button type="button" onClick={() => toggleSort('estado_legajo')} className="font-semibold uppercase text-sub hover:text-ink">Estado{sortArrow('estado_legajo')}</button></th>
                <th className={tdBase + ' py-2 text-right'}>Acciones</th>
              </tr>
              <tr className="bg-surface/60">
                <th className={tdBase + ' py-1 align-top'}><FiltroCol d={filtroDef('legajo')} filtros={filtros.legajo ?? []} onChange={(v) => setFiltros((prev) => ({ ...prev, legajo: v }))} /></th>
                <th className={tdBase + ' py-1 align-top'} />
                <th className={tdBase + ' py-1 align-top'} />
                <th className={tdBase + ' py-1 align-top'} />
                <th className={tdBase + ' py-1 align-top'} />
                <th className={tdBase + ' py-1 align-top'}><FiltroCol d={filtroDef('sexo')} filtros={filtros.sexo ?? []} onChange={(v) => setFiltros((prev) => ({ ...prev, sexo: v }))} /></th>
                <th className={tdBase + ' py-1 align-top'}><FiltroCol d={filtroDef('lugar')} filtros={filtros.lugar ?? []} onChange={(v) => setFiltros((prev) => ({ ...prev, lugar: v }))} /></th>
                <th className={tdBase + ' py-1 align-top'}><FiltroCol d={filtroDef('area_sector')} filtros={filtros.area_sector ?? []} onChange={(v) => setFiltros((prev) => ({ ...prev, area_sector: v }))} /></th>
                <th className={tdBase + ' py-1 align-top'}><FiltroCol d={filtroDef('categoria')} filtros={filtros.categoria ?? []} onChange={(v) => setFiltros((prev) => ({ ...prev, categoria: v }))} /></th>
                <th className={tdBase + ' py-1 align-top'}><FiltroCol d={filtroDef('puesto')} filtros={filtros.puesto ?? []} onChange={(v) => setFiltros((prev) => ({ ...prev, puesto: v }))} /></th>
                <th className={tdBase + ' py-1 align-top'} />
                <th className={tdBase + ' py-1 align-top'}><FiltroCol d={filtroDef('convenio')} filtros={filtros.convenio ?? []} onChange={(v) => setFiltros((prev) => ({ ...prev, convenio: v }))} /></th>
                <th className={tdBase + ' py-1 align-top'} />
                <th className={tdBase + ' py-1 align-top'} />
                <th className={tdBase + ' py-1 align-top'} />
                <th className={tdBase + ' py-1 align-top'} />
                <th className={tdBase + ' py-1 align-top'} />
                <th className={tdBase + ' py-1 align-top'}><FiltroCol d={filtroDef('prepaga')} filtros={filtros.prepaga ?? []} onChange={(v) => setFiltros((prev) => ({ ...prev, prepaga: v }))} /></th>
                <th className={tdBase + ' py-1 align-top'}><FiltroCol d={filtroDef('tipo_contrato')} filtros={filtros.tipo_contrato ?? []} onChange={(v) => setFiltros((prev) => ({ ...prev, tipo_contrato: v }))} /></th>
                <th className={tdBase + ' py-1 align-top'}><FiltroCol d={filtroDef('codigo_os')} filtros={filtros.codigo_os ?? []} onChange={(v) => setFiltros((prev) => ({ ...prev, codigo_os: v }))} /></th>
                <th className={tdBase + ' py-1 align-top'} />
                <th className={tdBase + ' py-1 align-top'} />
                <th className={tdBase + ' py-1 align-top'} />
                <th className={tdBase + ' py-1 align-top'} />
                <th className={tdBase + ' py-1 align-top'} />
                <th className={tdBase + ' py-1 align-top'} />
                <th className={tdBase + ' py-1 align-top'}><FiltroCol d={filtroDef('estado_legajo')} filtros={filtros.estado_legajo ?? []} onChange={(v) => setFiltros((prev) => ({ ...prev, estado_legajo: v }))} /></th>
                <th className={tdBase + ' py-1 align-top'} />
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filtrados.map((e) => (
                <tr key={e.id} className="hover:bg-line/20">
                  <td className={tdBase + ' text-sub'}>{e.legajo ?? '-'}</td>
                  <td className={tdBaseWrap + ' font-medium text-ink'}>{puedeEditar ? <button type="button" onClick={() => { setSel(e); setModal('edit') }} className="cursor-pointer text-left text-ink transition hover:text-brand-500" title="Editar empleado">{e.nombre}</button> : e.nombre}</td>
                  <td className={tdBase}>{e.dni ?? '-'}</td>
                  <td className={tdBase}>{e.cuil ?? '-'}</td>
                  <td className={tdBase}>{e.fecha_nacimiento ?? '-'}</td>
                  <td className={tdBase}>{e.sexo ?? '-'}</td>
                  <td className={tdBase}>{e.lugar ?? '-'}</td>
                  <td className={tdBaseWrap}>{e.area_sector ?? '-'}</td>
                  <td className={tdBaseWrap}>{e.categoria ?? '-'}</td>
                  <td className={tdBaseWrap}>{e.puesto ?? '-'}</td>
                  <td className={tdBase + ' text-center'}>{e.horas ?? '-'}</td>
                  <td className={tdBase}>{e.convenio ?? '-'}</td>
                  <td className={tdBase}>{e.comision ?? '-'}</td>
                  <td className={tdBase}>{e.reingreso ?? '-'}</td>
                  <td className={tdBase}>{e.fecha_ingreso ?? '-'}</td>
                  <td className={tdBase + ' text-center'}>{textoAntiguedad(e.fecha_ingreso) || '-'}</td>
                  <td className={tdBase + ' text-center'}>{vacacionesSegunAntiguedad(e.fecha_ingreso) || '-'}</td>
                  <td className={tdBase}>{e.prepaga ?? '-'}</td>
                  <td className={tdBase}>{e.tipo_contrato ?? '-'}</td>
                  <td className={tdBase}>{e.codigo_os ?? '-'}</td>
                  <td className={tdBaseWrap}>{e.telefono ?? '-'}</td>
                  <td className={tdBaseWrap}>{e.domicilio ?? '-'}</td>
                  <td className={tdBaseWrap}>{e.email ?? '-'}</td>
                  <td className={tdBaseWrap}>{e.contacto_emergencia ?? '-'}</td>
                  <td className={tdBase}>{e.parentesco ?? '-'}</td>
                  <td className={tdBaseWrap}>{e.telefono_emergencia ?? '-'}</td>
                  <td className={tdBaseWrap}><span className={'inline-block whitespace-nowrap rounded-full border px-2 py-px text-[10px] font-medium ' + estiloEstadoLegajo(estadoEfectivo(e))}>{estadoEfectivo(e)}</span></td>
                  <td className={tdBase + ' text-right'}>
                    <div className="flex items-center justify-end gap-1">
                      {puedeEditar && <button onClick={() => { setSel(e); setModal('edit') }} className="rounded border border-line p-1 text-sub transition hover:text-ink" title="Editar"><Pencil size={11} aria-hidden /></button>}
                      {puedeBorrar && <button onClick={() => setConfirm({ message: `¿Borrar al empleado "${e.nombre}"?`, onConfirm: () => void borrar(e.id) })} className="rounded border border-line p-1 text-sub transition hover:text-ink" title="Eliminar"><Trash2 size={11} aria-hidden /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
          </div>
        </div>

      {modal && (
        <EmpleadoModal
          registro={modal === 'edit' ? sel : null}
          opciones={opcionesEmpleado}
          onClose={() => { setModal(null); setSel(null) }}
          onSaved={async () => { setModal(null); setSel(null); await cargar() }}
        />
      )}

      <ConfirmDialog open={!!confirm} message={confirm?.message ?? ''} onCancel={() => setConfirm(null)} onConfirm={() => { confirm?.onConfirm(); setConfirm(null) }} />

      {puedeCrear && !modal && (
        <button
          ref={fabRef}
          onMouseDown={fabDown}
          onClick={() => { if (fabDrag.current?.moved) { fabDrag.current.moved = false; return } setSel(null); setModal('new') }}
          style={{
            position: 'fixed',
            left: fabPos ? fabPos.x : undefined,
            top: fabPos ? fabPos.y : undefined,
            bottom: fabPos ? undefined : '1.5rem',
            right: fabPos ? undefined : '1.5rem',
            zIndex: 50,
            touchAction: 'none',
          }}
          title="Nuevo empleado (arrastra para mover)"
          aria-label="Nuevo empleado"
          className="btn-press inline-flex cursor-grab select-none items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-brand-600/30 hover:bg-brand-700 active:cursor-grabbing"
        >
          <Plus size={15} aria-hidden /> Nuevo empleado
        </button>
      )}
    </Layout>
  )
}

function EmpleadoModal({ registro, opciones, onClose, onSaved }: {
  registro: Empleado | null
  opciones: Record<string, string[]>
  onClose: () => void
  onSaved: () => void
}) {
  const [f, setF] = useState<Record<string, string>>(() => {
    const s = (v: unknown) => (v == null ? '' : String(v))
    return {
      legajo: s(registro?.legajo), nombre: s(registro?.nombre), lugar: s(registro?.lugar),
      area_sector: s(registro?.area_sector), horas: s(registro?.horas), convenio: s(registro?.convenio),
      categoria: s(registro?.categoria), puesto: s(registro?.puesto), comision: s(registro?.comision),
      reingreso: s(registro?.reingreso), fecha_ingreso: s(registro?.fecha_ingreso),
      antiguedad_2025: s(registro?.antiguedad_2025), dias_vacaciones_2025: s(registro?.dias_vacaciones_2025),
      cuil: s(registro?.cuil), dni: s(registro?.dni), fecha_nacimiento: s(registro?.fecha_nacimiento),
      sexo: s(registro?.sexo), telefono: s(registro?.telefono), domicilio: s(registro?.domicilio),
      email: s(registro?.email), codigo_os: s(registro?.codigo_os), prepaga: s(registro?.prepaga),
      tipo_contrato: s(registro?.tipo_contrato), contacto_emergencia: s(registro?.contacto_emergencia),
      parentesco: s(registro?.parentesco), telefono_emergencia: s(registro?.telefono_emergencia),
      estado_legajo: s(registro?.estado_legajo),
    }
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: string, v: string) => setF((prev) => ({ ...prev, [k]: v }))

  async function guardar(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (!f.nombre.trim()) { setError('El nombre no puede quedar vacío.'); return }
    setBusy(true); setError(null)
    const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))
    const payload: Record<string, unknown> = {
      legajo: f.legajo.trim() || null,
      nombre: f.nombre.trim(),
      lugar: f.lugar || null,
      area_sector: f.area_sector.trim() || null,
      horas: num(f.horas),
      convenio: f.convenio.trim() || null,
      categoria: f.categoria.trim() || null,
      puesto: f.puesto.trim() || null,
      comision: f.comision.trim() || null,
      reingreso: f.reingreso.trim() || null,
      fecha_ingreso: f.fecha_ingreso || null,
      antiguedad_2025: num(f.antiguedad_2025),
      dias_vacaciones_2025: num(f.dias_vacaciones_2025),
      cuil: f.cuil.trim() || null,
      dni: f.dni.trim() || null,
      fecha_nacimiento: f.fecha_nacimiento || null,
      sexo: f.sexo || null,
      telefono: f.telefono.trim() || null,
      domicilio: f.domicilio.trim() || null,
      email: f.email.trim() || null,
      codigo_os: f.codigo_os.trim() || null,
      prepaga: f.prepaga.trim() || null,
      tipo_contrato: f.tipo_contrato.trim() || null,
      contacto_emergencia: f.contacto_emergencia.trim() || null,
      parentesco: f.parentesco.trim() || null,
      telefono_emergencia: f.telefono_emergencia.trim() || null,
      estado_legajo: f.estado_legajo.trim() || null,
    }
    // Evita crear/editar con un legajo que ya usa otro empleado
    const legajoTrim = f.legajo.trim()
    if (legajoTrim) {
      const { data: dup, error: errDup } = await supabase.from('empleados').select('id').eq('legajo', legajoTrim).limit(10)
      if (errDup) { setBusy(false); setError(errDup.message); return }
      const duplicado = ((dup as { id: string }[] | null) ?? []).find((d) => d.id !== registro?.id)
      if (duplicado) {
        setBusy(false)
        setError(`El legajo ${legajoTrim} ya está asignado a otro empleado.`)
        return
      }
    }
    const res = registro
      ? await supabase.from('empleados').update(payload).eq('id', registro.id)
      : await supabase.from('empleados').insert(payload)
    setBusy(false)
    if (res.error) { setError(res.error.message); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/60" onClick={onClose}>
      <div className="flex h-full flex-col bg-surface" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-lg font-semibold text-ink">{registro ? 'Editar empleado' : 'Nuevo empleado'}</h2>
          <button onClick={onClose} className="rounded-lg border border-line p-1.5 text-sub transition hover:bg-line hover:text-ink"><X size={16} aria-hidden /></button>
        </div>
        {error && <p role="alert" className="mx-5 mt-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}
        <form onSubmit={(e) => void guardar(e)} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <Campo label="N° Legajo"><input value={f.legajo} onChange={(e) => set('legajo', e.target.value)} className={inputCls} /></Campo>
            <Campo label="Apellido y Nombre *" span2><input value={f.nombre} onChange={(e) => set('nombre', e.target.value)} className={inputCls} /></Campo>
            <AutocompleteCampo label="Lugar" opciones={(opciones.lugar ?? []).map((v) => ({ id: v, label: v }))} valor={f.lugar} onChange={(v) => set('lugar', v)} placeholder="Buscar lugar..." />
            <AutocompleteCampo label="Área / Sector" opciones={(opciones.area_sector ?? []).map((v) => ({ id: v, label: v }))} valor={f.area_sector} onChange={(v) => set('area_sector', v)} />
            <Campo label="Horas"><input value={f.horas} onChange={(e) => set('horas', e.target.value)} className={inputCls} /></Campo>
            <AutocompleteCampo label="Convenio" opciones={(opciones.convenio ?? []).map((v) => ({ id: v, label: v }))} valor={f.convenio} onChange={(v) => set('convenio', v)} />
            <AutocompleteCampo label="Categoría" opciones={(opciones.categoria ?? []).map((v) => ({ id: v, label: v }))} valor={f.categoria} onChange={(v) => set('categoria', v)} />
            <AutocompleteCampo label="Puesto" opciones={(opciones.puesto ?? []).map((v) => ({ id: v, label: v }))} valor={f.puesto} onChange={(v) => set('puesto', v)} />
            <Campo label="Comisión"><input value={f.comision} onChange={(e) => set('comision', e.target.value)} className={inputCls} /></Campo>
            <Campo label="Reingreso"><input value={f.reingreso} onChange={(e) => set('reingreso', e.target.value)} className={inputCls} /></Campo>
            <Campo label="Fecha de ingreso"><input type="date" value={f.fecha_ingreso} onChange={(e) => set('fecha_ingreso', e.target.value)} className={inputCls} /></Campo>
            <Campo label="Antigüedad"><span className={inputCls + ' flex items-center text-sub'}>{textoAntiguedad(f.fecha_ingreso) || '-'}</span></Campo>
            <Campo label="Vacaciones"><span className={inputCls + ' flex items-center text-sub'}>{vacacionesSegunAntiguedad(f.fecha_ingreso) ? `${vacacionesSegunAntiguedad(f.fecha_ingreso)} días` : '-'}</span></Campo>
            <Campo label="CUIL"><input value={f.cuil} onChange={(e) => set('cuil', e.target.value)} className={inputCls} /></Campo>
            <Campo label="DNI"><input value={f.dni} onChange={(e) => set('dni', e.target.value)} className={inputCls} /></Campo>
            <Campo label="Fecha de nacimiento"><input type="date" value={f.fecha_nacimiento} onChange={(e) => set('fecha_nacimiento', e.target.value)} className={inputCls} /></Campo>
            <Campo label="Sexo"><select value={f.sexo} onChange={(e) => set('sexo', e.target.value)} className={selectCls}><option value="">--</option><option value="F">F</option><option value="M">M</option></select></Campo>
            <Campo label="Teléfono"><input value={f.telefono} onChange={(e) => set('telefono', e.target.value)} className={inputCls} /></Campo>
            <Campo label="Email"><input value={f.email} onChange={(e) => set('email', e.target.value)} className={inputCls} /></Campo>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-5 sm:col-span-2 lg:col-span-3 xl:col-span-4">
              <Campo label="Domicilio">
                <input value={f.domicilio} onChange={(e) => set('domicilio', e.target.value)} placeholder="Calle, número, localidad..." className={inputCls} />
              </Campo>
              <div className="sm:col-span-4">
                <span className="mb-1 block text-xs font-medium text-sub">Ubicación</span>
                <div className="overflow-hidden rounded-xl border border-line">
                  <iframe
                    title={`Mapa de ${f.domicilio.trim() || 'Argentina'}`}
                    src={`https://maps.google.com/maps?q=${encodeURIComponent(f.domicilio.trim() || 'Argentina')}&t=m&z=15&ie=UTF8&iwloc=&markers=color:red%7C${encodeURIComponent(f.domicilio.trim() || 'Argentina')}&output=embed`}
                    className="h-64 w-full border-0"
                    loading="lazy"
                    allowFullScreen
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(f.domicilio.trim() || 'Argentina')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 border-t border-line bg-surface2 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-line hover:text-red-700"
                  >
                    <MapPin size={13} aria-hidden /> Abrir en Google Maps
                  </a>
                </div>
              </div>
            </div>
            <Campo label="Código OS"><input value={f.codigo_os} onChange={(e) => set('codigo_os', e.target.value)} className={inputCls} /></Campo>
            <Campo label="Prepaga"><input value={f.prepaga} onChange={(e) => set('prepaga', e.target.value)} className={inputCls} list="prepaga-list" /><datalist id="prepaga-list">{(opciones.prepaga ?? []).map((v) => <option key={v} value={v} />)}</datalist></Campo>
            <Campo label="Tipo de contrato"><input value={f.tipo_contrato} onChange={(e) => set('tipo_contrato', e.target.value)} className={inputCls} list="contrato-list" /><datalist id="contrato-list">{(opciones.tipo_contrato ?? []).map((v) => <option key={v} value={v} />)}</datalist></Campo>
            <Campo label="Contacto emergencia" span2><input value={f.contacto_emergencia} onChange={(e) => set('contacto_emergencia', e.target.value)} className={inputCls} /></Campo>
            <Campo label="Parentesco"><input value={f.parentesco} onChange={(e) => set('parentesco', e.target.value)} className={inputCls} /></Campo>
            <Campo label="Teléfono emergencia"><input value={f.telefono_emergencia} onChange={(e) => set('telefono_emergencia', e.target.value)} className={inputCls} /></Campo>
            <Campo label="Estado legajo"><select value={f.estado_legajo} onChange={(e) => set('estado_legajo', e.target.value)} className={selectCls}><option value="">--</option>{ESTADO_LEGAJO_OPCIONES.map((o) => <option key={o} value={o}>{o}</option>)}</select></Campo>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button type="button" onClick={onClose} className="btn-press rounded-lg border border-line bg-surface2 px-4 py-2 text-sm font-medium text-ink hover:bg-line">Cancelar</button>
            <button type="submit" disabled={busy} className="btn-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {busy ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Campo({ label, children, span2, span3 }: { label: string; children: React.ReactNode; span2?: boolean; span3?: boolean }) {
  return (
    <label className={'block ' + (span3 ? 'sm:col-span-2 lg:col-span-3 xl:col-span-4' : span2 ? 'sm:col-span-2' : '')}>
      <span className="mb-1 block text-xs font-medium text-sub">{label}</span>
      {children}
    </label>
  )
}

function FiltroCol({ d, filtros, onChange }: { d: { clave: string; label: string; valores: string[] }; filtros: string[]; onChange: (v: string[]) => void }) {
  return (
    <MultiselectFiltro
      label={d.label}
      compacto
      opciones={d.valores.map((v) => ({ id: v, label: v }))}
      seleccionadas={new Set(filtros)}
      onChange={(s) => onChange(Array.from(s))}
    />
  )
}