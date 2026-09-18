import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Loader2, Plus, Trash2, Pencil, Search, SearchX, X, Upload, MapPin,
  Users, ClipboardList, UserMinus, UserX,
} from 'lucide-react'
import Layout from '@/components/Layout'
import AppCard from '@/components/AppCard'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { supabase } from '@/lib/supabase'
import { usePermisosArea } from '@/hooks/usePermisosArea'
import { AutocompleteCampo } from '@/components/MultiselectFiltro'
import MultiselectFiltro from '@/components/MultiselectFiltro'
import { COLUMNAS, columnasDeEstado, camposDeEstado } from '@/config/columnasEmpleados'
import { leerListado, claveBaja, soloDigitos } from '@/lib/importarListado'

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
  fecha_egreso: string | null
  motivo_baja: string | null
  plan: string | null
  obra_social: string | null
  fin_plan: string | null
  entrega_remeras: string | null
}

const ESTADO_LEGAJO_OPCIONES = ['NOMINA ACTIVA', 'PLANES ACTIVOS', 'BAJAS MITO', 'BAJAS PLANES']
const ESTADOS_ACTIVOS = ['NOMINA ACTIVA', 'PLANES ACTIVOS']
const ESTADO_POR_DEFECTO = 'NOMINA ACTIVA'

/** Estado del legajo; los empleados sin estado cargado cuentan como nómina activa. */
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
  'id,legajo,nombre,activo,lugar,area_sector,horas,convenio,categoria,puesto,comision,reingreso,fecha_ingreso,antiguedad_2025,dias_vacaciones_2025,cuil,dni,fecha_nacimiento,sexo,telefono,domicilio,email,codigo_os,prepaga,tipo_contrato,contacto_emergencia,parentesco,telefono_emergencia,estado_legajo,fecha_egreso,motivo_baja,plan,obra_social,fin_plan,entrega_remeras'

const inputCls = 'w-full rounded-xl border border-line bg-surface2 px-3 py-1.5 text-[13px] text-ink outline-none transition duration-250 placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'
const selectCls = inputCls + ' appearance-none'
const tdBase = 'px-2 py-[3px] whitespace-nowrap'
const tdBaseWrap = 'px-2 py-[3px]'

/** Las 4 categorías se muestran como tarjetas, igual que las apps de un área. */
const CATEGORIAS = [
  { estado: 'NOMINA ACTIVA', slug: 'nomina-activa', titulo: 'Nómina Activa', detalle: 'Legajos activos de Mito.', icono: Users, color: '#10b981' },
  { estado: 'PLANES ACTIVOS', slug: 'planes-activos', titulo: 'Planes Activos', detalle: 'Legajos de planes vigentes.', icono: ClipboardList, color: '#0ea5e9' },
  { estado: 'BAJAS MITO', slug: 'bajas-mito', titulo: 'Bajas Mito', detalle: 'Legajos dados de baja en Mito.', icono: UserMinus, color: '#ef4444' },
  { estado: 'BAJAS PLANES', slug: 'bajas-planes', titulo: 'Bajas Planes', detalle: 'Legajos de planes dados de baja.', icono: UserX, color: '#f43f5e' },
]

/** Nómina activa incluye a los legajos sin estado cargado. */
const FILTRO_NOMINA = 'estado_legajo.eq."NOMINA ACTIVA",estado_legajo.is.null'

const SLUG_ESTADO: Record<string, string> = Object.fromEntries(CATEGORIAS.map((c) => [c.slug, c.estado]))

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

/** yyyy-mm-dd -> dd/mm/yyyy */
function fechaLinda(v: unknown): string {
  const s = String(v ?? '')
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s
}

/** Trae todas las páginas de una consulta (PostgREST devuelve 1000 por vez). */
async function traerTodo<T>(pagina: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<{ filas: T[]; error: string | null }> {
  const filas: T[] = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await pagina(desde, desde + 999)
    if (error) return { filas, error: error.message }
    const lote = (data as T[]) ?? []
    filas.push(...lote)
    if (lote.length < 1000) break
  }
  return { filas, error: null }
}

export default function Empleados() {
  const navigate = useNavigate()
  const { estado: slug = '' } = useParams<{ estado?: string }>()
  const estado = SLUG_ESTADO[slug] ?? ''
  const { crear: puedeCrear, editar: puedeEditar, borrar: puedeBorrar } = usePermisosArea('rrhh.empleados')
  const [empleados, setEmpleados] = useState<Empleado[]>([])
  const [conteos, setConteos] = useState<Record<string, number>>({})
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

  const columnas = useMemo(() => columnasDeEstado(estado || ESTADO_POR_DEFECTO), [estado])

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

  /** Portada: cuántos legajos hay en cada categoría. */
  const cargarConteos = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    setCargando(true)
    const out: Record<string, number> = {}
    for (const c of CATEGORIAS) {
      const q = supabase.from('empleados').select('id', { count: 'exact', head: true })
      const { count, error } = c.estado === ESTADO_POR_DEFECTO
        ? await q.or(FILTRO_NOMINA)
        : await q.eq('estado_legajo', c.estado)
      if (error) { setError(error.message); break }
      out[c.estado] = count ?? 0
    }
    setConteos(out)
    setCargando(false)
  }, [])

  /** Lista de una categoría (el histórico de bajas pasa de 1000 filas). */
  const cargar = useCallback(async () => {
    const sb = supabase
    if (!sb || !estado) { setCargando(false); return }
    setCargando(true)
    setError(null)
    const { filas, error: err } = await traerTodo<Empleado>((desde, hasta) => {
      const q = sb.from('empleados').select(CAMPOS).order('nombre').range(desde, hasta)
      return estado === ESTADO_POR_DEFECTO
        ? q.or(FILTRO_NOMINA)
        : q.eq('estado_legajo', estado)
    })
    if (err) setError(err)
    setEmpleados(filas)
    setCargando(false)
  }, [estado])

  useEffect(() => {
    setBusqueda('')
    setFiltros({})
    if (estado) void cargar()
    else void cargarConteos()
  }, [estado, cargar, cargarConteos])

  /** Valor crudo de una columna (para filtrar y ordenar). */
  const valor = useCallback((e: Empleado, clave: string): unknown => {
    if (clave === 'antiguedad') return mesesDesde(e.fecha_ingreso)
    if (clave === 'vacaciones') return vacacionesSegunAntiguedad(e.fecha_ingreso)
    if (clave === 'estado_legajo') return estadoEfectivo(e)
    return (e as unknown as Record<string, unknown>)[clave]
  }, [])

  /** Texto que se muestra en la celda. */
  const texto = useCallback((e: Empleado, clave: string): string => {
    if (clave === 'antiguedad') return textoAntiguedad(e.fecha_ingreso) || '-'
    if (clave === 'vacaciones') {
      const d = vacacionesSegunAntiguedad(e.fecha_ingreso)
      return d ? `${d} días` : '-'
    }
    const v = valor(e, clave)
    if (v == null || String(v).trim() === '') return '-'
    if (COLUMNAS[clave]?.tipo === 'fecha') return fechaLinda(v)
    return String(v)
  }, [valor])

  // Columnas con filtro tipo Excel, con los valores que existen en esta categoría
  const columnasFiltro = useMemo(() => {
    return columnas
      .filter((c) => COLUMNAS[c]?.filtrable)
      .map((clave) => ({
        clave,
        label: COLUMNAS[clave].label,
        valores: Array.from(new Set(empleados.map((e) => String(valor(e, clave) ?? '')).filter((v) => v !== '')))
          .sort((a, b) => a.localeCompare(b, 'es', { numeric: true })),
      }))
  }, [columnas, empleados, valor])

  const filtroDe = (clave: string) => columnasFiltro.find((d) => d.clave === clave)

  const filtrados = useMemo(() => {
    const t = busqueda.trim().toUpperCase()
    const out = empleados.filter((e) => {
      for (const [clave, valores] of Object.entries(filtros)) {
        if (!valores || valores.length === 0) continue
        if (!valores.includes(String(valor(e, clave) ?? ''))) return false
      }
      if (!t) return true
      return (
        e.nombre.toUpperCase().includes(t) ||
        (e.legajo ?? '').includes(t) ||
        (e.dni ?? '').includes(t) ||
        (e.cuil ?? '').includes(t) ||
        (e.area_sector ?? '').toUpperCase().includes(t)
      )
    })
    const numericas = new Set(['legajo', 'horas', 'antiguedad', 'vacaciones', 'dni'])
    out.sort((a, b) => {
      const av = valor(a, sortKey)
      const bv = valor(b, sortKey)
      const sa = String(av ?? '').trim()
      const sb = String(bv ?? '').trim()
      if (numericas.has(sortKey)) {
        const na = Number(sa.replace(',', '.'))
        const nb = Number(sb.replace(',', '.'))
        if (!isNaN(na) && !isNaN(nb)) return sortAsc ? na - nb : nb - na
      }
      const cmp = sa.localeCompare(sb, 'es', { numeric: true })
      return sortAsc ? cmp : -cmp
    })
    return out
  }, [empleados, busqueda, filtros, sortKey, sortAsc, valor])

  const hayFiltros = Object.values(filtros).some((v) => v.length > 0) || !!busqueda

  function toggleSort(clave: string) {
    if (sortKey === clave) setSortAsc((a) => !a)
    else { setSortKey(clave); setSortAsc(true) }
  }
  const sortArrow = (clave: string) => (sortKey === clave ? (sortAsc ? ' ↑' : ' ↓') : '')

  // Valores únicos por campo (para el autocomplete del modal)
  const opcionesEmpleado = useMemo(() => {
    const campos = ['lugar', 'area_sector', 'convenio', 'categoria', 'puesto', 'prepaga', 'tipo_contrato', 'plan', 'obra_social'] as const
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

  /** Guarda de a lotes: las filas con id se actualizan, las demás se insertan. */
  async function guardarLotes(filas: Record<string, unknown>[]): Promise<string | null> {
    if (!supabase || filas.length === 0) return null
    const conId = filas.filter((f) => f.id)
    const sinId = filas.filter((f) => !f.id)
    for (let i = 0; i < conId.length; i += 300) {
      const { error } = await supabase.from('empleados').upsert(conId.slice(i, i + 300))
      if (error) return error.message
    }
    for (let i = 0; i < sinId.length; i += 300) {
      const { error } = await supabase.from('empleados').insert(sinId.slice(i, i + 300))
      if (error) return error.message
    }
    return null
  }

  /**
   * Importa el Excel del listado. Reconoce una hoja por categoría; si el archivo
   * trae una sola hoja, se carga con el mapeo de la categoría abierta.
   */
  async function importarArchivo(file: File) {
    const sb = supabase
    if (!sb) return
    setImportando(true); setImportMsg(null); setError(null)
    try {
      const { porEstado, avisos } = await leerListado(file, estado || ESTADO_POR_DEFECTO)
      if (Object.keys(porEstado).length === 0) {
        setError('No se reconoció ninguna hoja del archivo.')
        return
      }

      // Activos: para actualizar por legajo y para no importar la baja de alguien que hoy trabaja
      const { filas: activos, error: errAct } = await traerTodo<{ id: string; legajo: string | null; cuil: string | null; estado_legajo: string | null }>(
        (desde, hasta) => sb.from('empleados').select('id,legajo,cuil,estado_legajo').in('estado_legajo', ESTADOS_ACTIVOS).range(desde, hasta),
      )
      if (errAct) { setError(errAct); return }
      const cuilActivos = new Set(activos.map((a) => soloDigitos(a.cuil)).filter(Boolean))
      // El legajo se busca dentro de la misma categoría: nómina y planes numeran por separado
      const idPorLegajo = new Map(
        activos.filter((a) => a.legajo).map((a) => [`${a.estado_legajo}|${a.legajo}`, a.id]),
      )

      const resumen: string[] = []
      for (const [est, filas] of Object.entries(porEstado)) {
        if (ESTADOS_ACTIVOS.includes(est)) {
          const conId = filas.map((f) => {
            const id = f.legajo ? idPorLegajo.get(`${est}|${f.legajo}`) : undefined
            return id ? { ...f, id } : f
          })
          const nuevos = conId.filter((f) => !f.id).length
          const err = await guardarLotes(conId)
          if (err) { setError(err); return }
          resumen.push(`${est}: ${filas.length} (${nuevos} nuevos)`)
        } else {
          const { filas: previas, error: errPrev } = await traerTodo<{ cuil: string | null; nombre: string; fecha_ingreso: string | null; fecha_egreso: string | null }>(
            (desde, hasta) => sb.from('empleados').select('cuil,nombre,fecha_ingreso,fecha_egreso').eq('estado_legajo', est).range(desde, hasta),
          )
          if (errPrev) { setError(errPrev); return }
          const yaEstan = new Set(previas.map(claveBaja))
          let salteadas = 0
          const nuevas = filas.filter((f) => {
            const c = soloDigitos(f.cuil)
            if (c && cuilActivos.has(c)) { salteadas++; return false }
            const k = claveBaja(f)
            if (yaEstan.has(k)) { salteadas++; return false }
            yaEstan.add(k)
            return true
          })
          const err = await guardarLotes(nuevas)
          if (err) { setError(err); return }
          resumen.push(`${est}: ${nuevas.length} nuevas, ${salteadas} salteadas`)
        }
      }
      setImportMsg([`Listo. ${resumen.join(' · ')}`, ...avisos].join(' — '))
      if (estado) await cargar()
      else await cargarConteos()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al importar el archivo.')
    } finally {
      setImportando(false)
    }
  }

  const entradaArchivo = (
    <input
      ref={fileRef}
      type="file"
      accept=".xlsx,.xls"
      className="hidden"
      onChange={(e) => { const f = e.target.files?.[0]; if (f) void importarArchivo(f); e.target.value = '' }}
    />
  )

  // ── Portada: cada estado del legajo es una tarjeta a la que se entra ──────
  if (!estado) {
    return (
      <Layout>
        <BackButton />
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="rounded-xl border p-3" style={{ color: '#7c3aed', backgroundColor: '#7c3aed24', borderColor: '#7c3aed40' }}>
            <Users size={24} aria-hidden />
          </div>
          <h1 className="font-display text-2xl font-bold text-ink">Empleados</h1>
          {puedeCrear && (
            <button onClick={() => fileRef.current?.click()} disabled={importando} className="btn-press ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-3 py-2 text-sm font-medium text-ink hover:bg-line disabled:opacity-50">
              <Upload size={15} aria-hidden /> {importando ? 'Importando…' : 'Importar listado'}
            </button>
          )}
          {entradaArchivo}
        </div>

        {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}
        {importMsg && <p className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">{importMsg}</p>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIAS.map((c, i) => {
            const n = conteos[c.estado] ?? 0
            return (
              <AppCard
                key={c.slug}
                index={i}
                areaId="rrhh"
                app={{
                  id: c.slug,
                  areaId: 'rrhh',
                  title: c.titulo,
                  description: cargando ? 'Cargando…' : `${n} legajo${n === 1 ? '' : 's'} · ${c.detalle}`,
                  icon: c.icono,
                  kind: 'internal',
                  target: `/rrhh/empleados/${c.slug}`,
                  color: c.color,
                }}
              />
            )
          })}
        </div>
      </Layout>
    )
  }

  // ── Categoría abierta: tabla con las columnas de esa hoja ────────────────
  return (
    <Layout>
      <BackButton />
      <header className="mb-4 mt-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">
            Empleados <span className="text-lg font-normal text-sub">· {estado}</span>
          </h1>
          <p className="mt-1 text-sm text-sub">{filtrados.length} de {empleados.length} legajos · alta, edición y baja.</p>
        </div>
        <button onClick={() => navigate('/rrhh/empleados')} className="btn-press rounded-lg border border-line bg-surface2 px-2.5 py-1.5 text-xs font-medium text-sub transition hover:text-ink">
          Cambiar categoría
        </button>
      </header>

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-surface p-3">
        <label className="relative block min-w-[200px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" aria-hidden />
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre, legajo, DNI, CUIL o área..." className={inputCls + ' pl-9'} />
        </label>
        {hayFiltros && (
          <button onClick={() => { setBusqueda(''); setFiltros({}) }} className="btn-press rounded-lg border border-line bg-surface2 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-line">Limpiar filtros</button>
        )}
        {puedeCrear && (
          <button onClick={() => fileRef.current?.click()} disabled={importando} className="btn-press ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-3 py-2 text-sm font-medium text-ink hover:bg-line disabled:opacity-50">
            <Upload size={15} aria-hidden /> {importando ? 'Importando…' : 'Importar listado'}
          </button>
        )}
        {entradaArchivo}
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
                {columnas.map((clave) => (
                  <th key={clave} className={tdBase + ' py-2'}>
                    <button type="button" onClick={() => toggleSort(clave)} className="font-semibold uppercase text-sub hover:text-ink">
                      {COLUMNAS[clave].label}{sortArrow(clave)}
                    </button>
                  </th>
                ))}
                <th className={tdBase + ' py-2 text-right'}>Acciones</th>
              </tr>
              <tr className="bg-surface/60">
                {columnas.map((clave) => {
                  const d = filtroDe(clave)
                  return (
                    <th key={clave} className={tdBase + ' py-1 align-top'}>
                      {d && (
                        <FiltroCol
                          d={d}
                          filtros={filtros[clave] ?? []}
                          onChange={(v) => setFiltros((prev) => ({ ...prev, [clave]: v }))}
                        />
                      )}
                    </th>
                  )
                })}
                <th className={tdBase + ' py-1 align-top'} />
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filtrados.map((e) => (
                <tr key={e.id} className="hover:bg-line/20">
                  {columnas.map((clave) => {
                    const cls = (COLUMNAS[clave].wrap ? tdBaseWrap : tdBase)
                    if (clave === 'nombre') {
                      return (
                        <td key={clave} className={tdBaseWrap + ' font-medium text-ink'}>
                          {puedeEditar ? (
                            <button type="button" onClick={() => { setSel(e); setModal('edit') }} className="cursor-pointer text-left text-ink transition hover:text-brand-500" title="Editar empleado">
                              {e.nombre}
                            </button>
                          ) : e.nombre}
                        </td>
                      )
                    }
                    if (clave === 'estado_legajo') {
                      return (
                        <td key={clave} className={tdBaseWrap}>
                          <span className={'inline-block whitespace-nowrap rounded-full border px-2 py-px text-[10px] font-medium ' + estiloEstadoLegajo(estadoEfectivo(e))}>
                            {estadoEfectivo(e)}
                          </span>
                        </td>
                      )
                    }
                    return <td key={clave} className={cls + (clave === 'legajo' ? ' text-sub' : '')}>{texto(e, clave)}</td>
                  })}
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

      {modal && (
        <EmpleadoModal
          registro={modal === 'edit' ? sel : null}
          estadoActual={estado}
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

function EmpleadoModal({ registro, estadoActual, opciones, onClose, onSaved }: {
  registro: Empleado | null
  estadoActual: string
  opciones: Record<string, string[]>
  onClose: () => void
  onSaved: () => void
}) {
  const [f, setF] = useState<Record<string, string>>(() => {
    const s = (v: unknown) => (v == null ? '' : String(v))
    const base: Record<string, string> = { estado_legajo: s(registro?.estado_legajo) || estadoActual }
    for (const clave of Object.keys(COLUMNAS)) base[clave] = s((registro as unknown as Record<string, unknown>)?.[clave])
    base.nombre = s(registro?.nombre)
    return base
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: string, v: string) => setF((prev) => ({ ...prev, [k]: v }))

  // Los campos siguen al estado elegido: si lo pasás a una baja, quedan los de la hoja de bajas
  const estadoElegido = ESTADO_LEGAJO_OPCIONES.includes(f.estado_legajo) ? f.estado_legajo : estadoActual
  const campos = camposDeEstado(estadoElegido)
  const esBaja = estadoElegido.startsWith('BAJAS')

  async function guardar(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (!f.nombre.trim()) { setError('El nombre no puede quedar vacío.'); return }
    setBusy(true); setError(null)
    const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))
    const payload: Record<string, unknown> = { estado_legajo: estadoElegido }
    for (const clave of campos) {
      const def = COLUMNAS[clave]
      const v = (f[clave] ?? '').trim()
      if (def?.tipo === 'numero') payload[clave] = num(v)
      else payload[clave] = v || null
    }
    payload.nombre = f.nombre.trim()

    // Entre los legajos activos el número no se puede repetir
    const legajoTrim = (f.legajo ?? '').trim()
    if (legajoTrim && ESTADOS_ACTIVOS.includes(estadoElegido)) {
      const { data: dup, error: errDup } = await supabase
        .from('empleados').select('id').eq('legajo', legajoTrim).in('estado_legajo', ESTADOS_ACTIVOS).limit(10)
      if (errDup) { setBusy(false); setError(errDup.message); return }
      const duplicado = ((dup as { id: string }[] | null) ?? []).find((d) => d.id !== registro?.id)
      if (duplicado) {
        setBusy(false)
        setError(`El legajo ${legajoTrim} ya está asignado a otro legajo activo.`)
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

  function control(clave: string) {
    const def = COLUMNAS[clave]
    if (!def) return null
    if (clave === 'sexo') {
      return (
        <Campo key={clave} label={def.label}>
          <select value={f.sexo} onChange={(e) => set('sexo', e.target.value)} className={selectCls}>
            <option value="">--</option><option value="F">F</option><option value="M">M</option>
          </select>
        </Campo>
      )
    }
    if (def.campo === 'fecha') {
      return (
        <Campo key={clave} label={def.label}>
          <input type="date" value={f[clave] ?? ''} onChange={(e) => set(clave, e.target.value)} className={inputCls} />
        </Campo>
      )
    }
    if (def.campo === 'autocomplete') {
      return (
        <AutocompleteCampo
          key={clave}
          label={def.label}
          opciones={(opciones[clave] ?? []).map((v) => ({ id: v, label: v }))}
          valor={f[clave] ?? ''}
          onChange={(v) => set(clave, v)}
        />
      )
    }
    return (
      <Campo key={clave} label={def.label} span2={clave === 'nombre' || clave === 'contacto_emergencia' || clave === 'motivo_baja'}>
        <input value={f[clave] ?? ''} onChange={(e) => set(clave, e.target.value)} className={inputCls} />
      </Campo>
    )
  }

  const domicilio = (f.domicilio ?? '').trim()

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/60" onClick={onClose}>
      <div className="flex h-full flex-col bg-surface" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-lg font-semibold text-ink">
            {registro ? 'Editar empleado' : 'Nuevo empleado'}
            <span className="ml-2 text-sm font-normal text-sub">· {estadoElegido}</span>
          </h2>
          <button onClick={onClose} className="rounded-lg border border-line p-1.5 text-sub transition hover:bg-line hover:text-ink"><X size={16} aria-hidden /></button>
        </div>
        {error && <p role="alert" className="mx-5 mt-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}
        <form onSubmit={(e) => void guardar(e)} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="mb-3 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface2/60 p-3">
              <Campo label="Estado del legajo">
                <select value={f.estado_legajo} onChange={(e) => set('estado_legajo', e.target.value)} className={selectCls}>
                  {ESTADO_LEGAJO_OPCIONES.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </Campo>
              <p className="flex-1 text-xs leading-relaxed text-sub/80">
                {esBaja
                  ? 'Al pasarlo a una baja se piden los datos de la hoja de bajas (egreso y motivo). El resto de la ficha se conserva, solo deja de mostrarse.'
                  : 'La ficha muestra los campos de esta categoría. Si lo pasás a una baja, cambian por los de la hoja de bajas.'}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {campos.filter((c) => c !== 'domicilio').map((c) => control(c))}

              {estadoElegido === 'NOMINA ACTIVA' && (
                <>
                  <Campo label="Antigüedad"><span className={inputCls + ' flex items-center text-sub'}>{textoAntiguedad(f.fecha_ingreso) || '-'}</span></Campo>
                  <Campo label="Vacaciones"><span className={inputCls + ' flex items-center text-sub'}>{vacacionesSegunAntiguedad(f.fecha_ingreso) ? `${vacacionesSegunAntiguedad(f.fecha_ingreso)} días` : '-'}</span></Campo>
                </>
              )}

              {campos.includes('domicilio') && (
                <div className="grid grid-cols-1 gap-3 sm:col-span-2 sm:grid-cols-5 lg:col-span-3 xl:col-span-4">
                  <Campo label="Domicilio">
                    <input value={f.domicilio ?? ''} onChange={(e) => set('domicilio', e.target.value)} placeholder="Calle, número, localidad..." className={inputCls} />
                  </Campo>
                  <div className="sm:col-span-4">
                    <span className="mb-1 block text-xs font-medium text-sub">Ubicación</span>
                    <div className="overflow-hidden rounded-xl border border-line">
                      <iframe
                        title={`Mapa de ${domicilio || 'Argentina'}`}
                        src={`https://maps.google.com/maps?q=${encodeURIComponent(domicilio || 'Argentina')}&t=m&z=15&ie=UTF8&iwloc=&markers=color:red%7C${encodeURIComponent(domicilio || 'Argentina')}&output=embed`}
                        className="h-64 w-full border-0"
                        loading="lazy"
                        allowFullScreen
                        referrerPolicy="no-referrer-when-downgrade"
                      />
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(domicilio || 'Argentina')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-1.5 border-t border-line bg-surface2 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-line hover:text-red-700"
                      >
                        <MapPin size={13} aria-hidden /> Abrir en Google Maps
                      </a>
                    </div>
                  </div>
                </div>
              )}
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
