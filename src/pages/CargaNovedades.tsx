import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader2, Pencil, Trash2, Megaphone, Check, Upload, Plus, X, Search } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { supabase } from '@/lib/supabase'
import { usePermisosArea } from '@/hooks/usePermisosArea'
import { SelectBuscar, AutocompleteCampo } from '@/components/MultiselectFiltro'
import { nombresMotivos, colorFilaMotivo } from '@/lib/motivos'
import { nombresTipos, invalidarTipos, cargarTipos } from '@/lib/tipos'

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
const selectCls = inputCls + ' appearance-none'

const LOCALES = ['FABRICA', 'BUSTOS', 'HIPER', 'NVO CENTRO', 'DINO', 'POLO 52', 'GRAL PAZ', 'RIVERA', 'ESPINOSA', 'RUTA 9', 'NMO', 'CF RIVERA', '9 DE JULIO', 'MUÑOZ', 'WALMART', 'VCP', 'CF BUSTOS', 'CF OLMOS', 'CF RUTA 9', 'RIO 4']

/** Meses de liquidación (el período va del 26 del mes anterior al 25 del mes). */
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']

/** Nombre del mes a partir del texto de liquidación ("ENERO (26/12 AL 25/01)" -> "ENERO"). */
function mesNombre(mes: string | null): string {
  const n = (mes ?? '').split(/[ (]/)[0].trim().toUpperCase()
  return MESES.includes(n) ? n : ''
}

/** Arma el texto de liquidación para un mes: "MES (26/mm AL 25/mm)". */
function textoMes(mes: string): string {
  const idx = MESES.indexOf(mes.toUpperCase())
  if (idx < 0) return mes
  // El período arranca el 26 del mes anterior
  const dd = String(idx === 0 ? 12 : idx).padStart(2, '0')
  const hh = String(idx + 1).padStart(2, '0')
  return `${mes.toUpperCase()} (26/${dd} AL 25/${hh})`
}

function fmtFecha(iso: string | null): string {
  if (!iso) return '-'
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

/** Días entre dos fechas ISO (inclusive). Devuelve null si falta alguna. */
function diasDesdeHasta(desde: string | null, hasta: string | null): number | null {
  if (!desde || !hasta) return null
  const a = new Date(desde + 'T00:00:00')
  const b = new Date(hasta + 'T00:00:00')
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null
  const dias = Math.round((b.getTime() - a.getTime()) / 86400000) + 1
  return dias > 0 ? dias : null
}

/** Motivos que cuentan días (vacaciones, carpeta médica, ausente, licencia, suspensión). */
const MOTIVOS_CON_DIAS = new Set(['VACACIONES', 'CARPETA MEDICA', 'AUSENTE', 'LICENCIA', 'SUSPENSION'])
function esMotivoConDias(motivo: string | null): boolean {
  if (!motivo) return false
  const n = motivo.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  return MOTIVOS_CON_DIAS.has(n)
}

/** Convierte un valor de celda Excel (numero de serie o dd/mm/yyyy) a fecha ISO (YYYY-MM-DD). */
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
    const mm = String(+m[2]).padStart(2, '0')
    const dd = String(+m[1]).padStart(2, '0')
    return `${y}-${mm}-${dd}`
  }
  return null
}

/** Color de fondo por motivo (formato del archivo Novedades rrhh). */
function colorFila(motivo: string | null): { bg: string; fg: string } | null {
  return colorFilaMotivo(motivo)
}

/** Nombre corto del mes de liquidación (primera palabra, ej. "ENERO (26/12...)" -> "ENERO"). */
function mesCorto(mes: string | null): string {
  return (mes ?? '').split(/[ (]/)[0] || ''
}

const MESES_LIQUIDACION = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']

/** Ejecuta una query paginándola (Supabase limita a 1000 filas por request). */
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

export default function CargaNovedades() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { editar: puedeEditar, borrar: puedeBorrar } = usePermisosArea('rrhh.novedades')

  const [todos, setTodos] = useState<Novedad[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
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

  // Modal de carga (a pantalla completa)
  const [modalAbierto, setModalAbierto] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [anio, setAnio] = useState('')
  const [mes, setMes] = useState('')
  const [numero, setNumero] = useState('')
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState('')
  const [fecha, setFecha] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [local, setLocal] = useState('')
  const [motivo, setMotivo] = useState('')
  const [novedadTxt, setNovedadTxt] = useState('')
  const [minutos, setMinutos] = useState('')
  const [control, setControl] = useState('')
  const [busy, setBusy] = useState(false)

  // Filtros
  const [q, setQ] = useState('')
  const [fAnio, setFAnio] = useState(() => {
    const hoy = new Date()
    return String(hoy.getFullYear() + (hoy.getDate() >= 26 ? 1 : 0))
  })
  const [fMes, setFMes] = useState(() => {
    const hoy = new Date()
    const idx = hoy.getDate() >= 26 ? hoy.getMonth() + 1 : hoy.getMonth()
    return MESES_LIQUIDACION[idx % 12]
  })
  const [fMotivo, setFMotivo] = useState('')
  const [fLocal, setFLocal] = useState('')
  const [fTipo, setFTipo] = useState('')
  const [motivos, setMotivos] = useState<string[]>([])
  const [tipos, setTipos] = useState<string[]>([])
  const [abiertoTipos, setAbiertoTipos] = useState(false)
  const [empleadosLegajo, setEmpleadosLegajo] = useState<{ legajo: string; nombre: string }[]>([])

  // Orden de la tabla
  const [orden, setOrden] = useState<{ clave: string; dir: 1 | -1 } | null>({ clave: 'nombre_completo', dir: 1 })
  const toggleOrden = (clave: string) =>
    setOrden((o) =>
      o?.clave === clave
        ? { clave, dir: o.dir === 1 ? -1 : 1 }
        : { clave, dir: 1 },
    )

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    setCargando(true); setError(null)
    // Filtros aplicados en el servidor (la tabla tiene ~11k filas; sin esto solo llegan las primeras 1000)
    let query = supabase.from('novedades').select('*')
    if (fAnio) query = query.eq('anio', fAnio)
    if (fMes) query = query.like('mes_liquidacion', fMes + '%')
    if (fMotivo) query = query.eq('motivo', fMotivo)
    if (fLocal) query = query.eq('local', fLocal)
    if (fTipo) query = query.eq('tipo', fTipo)
    const t = q.trim().toUpperCase()
    if (t) query = query.or(`nombre_completo.ilike.%${t}%,numero.ilike.%${t}%`)
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
  }, [fAnio, fMes, fMotivo, fLocal, fTipo, q])

  useEffect(() => { void cargar() }, [cargar])

  // Empleados (legajo + nombre) para armar una fila por legajo en el mes en curso
  useEffect(() => {
    if (!supabase) return
    void supabase.from('empleados').select('legajo,nombre').not('legajo', 'is', null).then(({ data }) => {
      const rows = ((data as { legajo: string | null; nombre: string | null }[] | null) ?? [])
        .filter((e) => e.legajo && e.nombre)
        .map((e) => ({ legajo: String(e.legajo), nombre: String(e.nombre) }))
      setEmpleadosLegajo(rows)
    })
  }, [])

  // Precargar novedad a editar desde ?editar=<id> (navegado desde Resumen)
  useEffect(() => {
    const id = searchParams.get('editar')
    if (!id) return
    const n = todos.find((x) => x.id === id)
    if (n) {
      abrirModal(n)
      setSearchParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todos, searchParams])

  function reset() {
    setEditId(null); setAnio(''); setMes(''); setNumero(''); setNombre(''); setTipo(''); setFecha('')
    setDesde(''); setHasta(''); setLocal(''); setMotivo(''); setNovedadTxt(''); setMinutos(''); setControl('')
  }

  function abrirModal(n: Novedad | null = null) {
    if (n) {
      setEditId(n.id); setAnio(n.anio || ''); setMes(n.mes_liquidacion || ''); setNumero(n.numero || ''); setNombre(n.nombre_completo || '')
      setTipo(n.tipo || ''); setFecha(n.fecha || ''); setDesde(n.desde || ''); setHasta(n.hasta || '')
      setLocal(n.local || ''); setMotivo(n.motivo || ''); setNovedadTxt(n.novedad || ''); setMinutos(n.minutos || ''); setControl(n.control || '')
    } else {
      reset()
      // Nueva novedad: precarga el mes/año del filtro para que coincida con la fila vacía
      setAnio(fAnio)
      setMes(fMes ? textoMes(fMes) : '')
    }
    setModalAbierto(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (!nombre.trim()) { setError('El nombre es obligatorio.'); return }
    setBusy(true); setError(null)
    const payload = {
      anio: anio.trim() || null, mes_liquidacion: mes.trim() || null, numero: numero.trim() || null,
      nombre_completo: nombre.trim() || null, tipo: tipo || null, fecha: fecha || null,
      desde: desde || null, hasta: hasta || null, local: local || null, motivo: motivo || null,
      novedad: novedadTxt.trim() || null, minutos: motivo === 'TARDANZA' ? minutos.trim() || null : null, control: control.trim() || null,
    }
    const result = editId
      ? await supabase.from('novedades').update(payload).eq('id', editId)
      : await supabase.from('novedades').insert(payload)
    setBusy(false)
    if (result.error) { setError(result.error.message); return }
    setModalAbierto(false); reset(); await cargar()
  }

  async function eliminar(n: Novedad) {
    if (!supabase) return
    const { error: err } = await supabase.from('novedades').delete().eq('id', n.id)
    if (!err) await cargar()
  }

  /** Detecta la columna en el Excel por nombre normalizado (el formato del archivo "Novedades rrhh"). */
  function detectarCol(headers: string[]): Record<string, string> {
    const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')
    const m: Record<string, string> = {}
    const defs: Record<string, string[]> = {
      anio: ['año', 'anio', 'ano', 'añ'],
      mes_liquidacion: ['mesliquidacion', 'mes', 'mesliqui', 'periodo'],
      numero: ['n°', 'numero', 'nro', 'n'],
      nombre_completo: ['nombrecompleto', 'nombre', 'apellido', 'nombres'],
      tipo: ['tipo'],
      fecha: ['fecha'],
      desde: ['desde'],
      hasta: ['hasta'],
      local: ['local'],
      motivo: ['motivo'],
      novedad: ['novedad'],
      minutos: ['minutos', 'min'],
      control: ['controlcertificado', 'control', 'certificado', 'notificacion'],
    }
    for (const h of headers) {
      const n = norm(h)
      for (const [key, keywords] of Object.entries(defs)) {
        if (m[key]) continue
        if (keywords.some((k) => n.includes(k)) || (key === 'numero' && n === 'n')) {
          m[key] = h
          break
        }
      }
    }
    return m
  }

  async function importarExcel(file: File) {
    if (!supabase) return
    setImportando(true); setImportMsg(null); setError(null)
    try {
      const XLSX = await import('xlsx')
      const data = new Uint8Array(await file.arrayBuffer())
      const wb = XLSX.read(data, { type: 'array', raw: false })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
      if (json.length === 0) { setError('El archivo está vacío.'); setImportando(false); return }

      const headers = Object.keys(json[0])
      const map = detectarCol(headers)
      if (!map.nombre_completo) { setError('No se detectó la columna "NOMBRE COMPLETO". Asegurate de usar el formato del archivo Novedades rrhh.'); setImportando(false); return }

      const val = (row: Record<string, unknown>, key: string): string => {
        const col = map[key]
        if (!col) return ''
        return String(row[col] ?? '').trim()
      }

      const batch: Record<string, unknown>[] = []
      for (const row of json) {
        const nombre = val(row, 'nombre_completo')
        if (!nombre) continue
        const fechaRaw = row[map.fecha]
        const desdeRaw = row[map.desde]
        const hastaRaw = row[map.hasta]
        batch.push({
          anio: val(row, 'anio') || null,
          mes_liquidacion: val(row, 'mes_liquidacion') || null,
          numero: val(row, 'numero') || null,
          nombre_completo: nombre,
          tipo: val(row, 'tipo') || null,
          fecha: map.fecha ? fechaExcelAISO(fechaRaw) : null,
          desde: map.desde ? fechaExcelAISO(desdeRaw) : null,
          hasta: map.hasta ? fechaExcelAISO(hastaRaw) : null,
          local: val(row, 'local') || null,
          motivo: val(row, 'motivo') || null,
          novedad: val(row, 'novedad') || null,
          minutos: val(row, 'minutos') || null,
          control: val(row, 'control') || null,
        })
      }
      if (batch.length === 0) { setError('No se encontraron filas con nombre.'); setImportando(false); return }

      const BATCH = 200
      let insertados = 0
      for (let i = 0; i < batch.length; i += BATCH) {
        const { error: err } = await supabase.from('novedades').insert(batch.slice(i, i + BATCH))
        if (err) { setError(err.message); setImportando(false); return }
        insertados += Math.min(BATCH, batch.length - i)
      }
      setImportMsg(`${insertados} novedades importadas.`)
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al leer el archivo')
    }
    setImportando(false)
  }

  // Años disponibles en los datos
  const aniosDisponibles = useMemo(() => {
    const set = new Set<string>()
    for (const n of todos) { const a = (n.anio || '').trim(); if (a) set.add(a) }
    return Array.from(set).sort((a, b) => b.localeCompare(a))
  }, [todos])

  // Mes de liquidacion en curso (periodo del 26 al 25): las filas por legajo
  // se arman solo cuando el filtro coincide con ese mes.
  const mesEnCurso = useMemo(() => {
    const hoy = new Date()
    const anio = String(hoy.getFullYear() + (hoy.getDate() >= 26 ? 1 : 0))
    const idx = (hoy.getDate() >= 26 ? hoy.getMonth() + 1 : hoy.getMonth()) % 12
    return { anio, mes: MESES_LIQUIDACION[idx] }
  }, [])
  const esMesEnCurso = fAnio === mesEnCurso.anio && fMes === mesEnCurso.mes

  const lista = useMemo(() => {
    let r = todos
    if (fAnio) r = r.filter((n) => (n.anio || '').trim() === fAnio)
    if (fMes) r = r.filter((n) => mesCorto(n.mes_liquidacion) === fMes)
    if (fMotivo) r = r.filter((n) => (n.motivo || '') === fMotivo)
    if (fLocal) r = r.filter((n) => (n.local || '') === fLocal)
    if (fTipo) r = r.filter((n) => (n.tipo || '') === fTipo)
    const t = q.trim().toUpperCase()
    if (t) r = r.filter((n) => (n.nombre_completo || '').toUpperCase().includes(t) || (n.numero || '').toUpperCase().includes(t))
    // En el mes en curso: una fila por legajo aunque no tenga novedad cargada
    if (esMesEnCurso) {
      const conNovedad = new Set(
        todos
          .filter((n) => mesCorto(n.mes_liquidacion) === fMes && (n.anio || '').trim() === fAnio)
          .map((n) => String(n.numero || '').trim()),
      )
      const vacias = empleadosLegajo
        .filter((e) => !conNovedad.has(String(e.legajo).trim()))
        .map((e): Novedad => ({
          id: `vac-${e.legajo}`,
          anio: fAnio,
          mes_liquidacion: fMes,
          numero: String(e.legajo),
          nombre_completo: e.nombre,
          tipo: null, fecha: null, desde: null, hasta: null, local: null,
          motivo: null, novedad: null, minutos: null, control: null,
          created_at: '',
        }))
      r = [...r, ...vacias]
    }
    if (orden) {
      r = [...r].sort((a, b) => {
        const av = (a as unknown as Record<string, unknown>)[orden.clave]
        const bv = (b as unknown as Record<string, unknown>)[orden.clave]
        let c = 0
        if (orden.clave === 'dias') {
          const da = esMotivoConDias(a.motivo) ? diasDesdeHasta(a.desde, a.hasta) ?? -1 : -1
          const db = esMotivoConDias(b.motivo) ? diasDesdeHasta(b.desde, b.hasta) ?? -1 : -1
          c = da - db
        } else if (orden.clave === 'numero') {
          c = (Number(av) || 0) - (Number(bv) || 0)
        } else if (orden.clave === 'anio') {
          c = ((av ?? '') as string).localeCompare((bv ?? '') as string, undefined, { numeric: true })
        } else if (orden.clave === 'mes_liquidacion') {
          c = (MESES.indexOf(mesCorto(av as string | null)) || 0) - (MESES.indexOf(mesCorto(bv as string | null)) || 0)
        } else {
          c = String(av ?? '').localeCompare(String(bv ?? ''), 'es', { sensitivity: 'base' })
        }
        return c === 0 ? 0 : c * orden.dir
      })
    }
    return r
  }, [todos, fAnio, fMes, fMotivo, fLocal, fTipo, q, orden, esMesEnCurso, empleadosLegajo])

  // Autocompletar empleado (por nombre o N° de legajo) en el modal de novedad
  const opcionesEmp = useMemo(
    () => empleadosLegajo.map((e) => ({ id: `${e.legajo} - ${e.nombre}`, label: `${e.legajo} - ${e.nombre}` })),
    [empleadosLegajo],
  )
  const elegirEmp = (v: string) => {
    const emp = empleadosLegajo.find((e) => `${e.legajo} - ${e.nombre}` === v)
    if (emp) { setNumero(emp.legajo); setNombre(emp.nombre) }
  }

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink"><Megaphone size={20} className="text-violet-500" aria-hidden /> Carga Novedades</h1>
            <p className="text-xs text-sub/70">Cargar o editar novedades de empleados</p>
          </div>
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importarExcel(f); e.target.value = '' }} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={importando}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-surface2 px-3 py-2 text-sm font-medium text-ink hover:bg-line disabled:opacity-50"
            >
              {importando ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Upload size={15} aria-hidden />} Importar
            </button>
          </div>
        </div>
      </header>

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}
      {importMsg && <p className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">{importMsg}</p>}

      {/* Filtros */}
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sub/70" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="N° o nombre..." className={inputCls + ' h-7 pl-7 pr-2 text-xs'} />
        </div>
        <select value={fAnio} onChange={(e) => setFAnio(e.target.value)} className={selectCls + ' h-7 w-full px-2 py-0 text-xs'}>
          <option value="">Año</option>
          {aniosDisponibles.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={fMes} onChange={(e) => setFMes(e.target.value)} className={selectCls + ' h-7 w-full px-2 py-0 text-xs'}>
          <option value="">Mes</option>
          {MESES_LIQUIDACION.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <SelectBuscar label="Motivo" opciones={motivos.map((m) => ({ id: m, label: m }))} valor={fMotivo} onChange={setFMotivo} className="h-7 w-full" />
        <SelectBuscar label="Local" opciones={LOCALES.map((l) => ({ id: l, label: l }))} valor={fLocal} onChange={setFLocal} className="h-7 w-full" />
        <SelectBuscar label="Tipo" opciones={tipos.map((t) => ({ id: t, label: t }))} valor={fTipo} onChange={setFTipo} className="h-7 w-full" />
        <span className="flex items-center text-[11px] text-sub/70">{lista.length}/{todos.length}</span>
      </div>

      {/* Lista */}
      <h2 className="mb-2 text-sm font-semibold text-ink">Novedades cargadas</h2>
      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sub"><Loader2 size={16} className="animate-spin" aria-hidden /> Cargando...</div>
      ) : lista.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-6 text-center text-sm text-sub">No se encontraron novedades con esos filtros.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line">
          <div className="overflow-x-auto">
            <table className="w-full table-auto border-collapse text-sm leading-tight">
              <thead>
                <tr className="bg-zinc-800 text-left text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                  {([['anio', 'Año'], ['mes_liquidacion', 'Mes'], ['numero', 'N°'], ['nombre_completo', 'Nombre'], ['tipo', 'Tipo'], ['fecha', 'Fecha'], ['desde', 'Desde'], ['hasta', 'Hasta'], ['dias', 'Días'], ['local', 'Local'], ['motivo', 'Motivo'], ['novedad', 'Novedad'], ['minutos', 'Min'], ['control', 'Control']] as const).map(([clave, label]) => (
                    <th key={clave} className="px-2 py-2 whitespace-nowrap">
                      <button onClick={() => toggleOrden(clave)} className={'inline-flex items-center gap-1 uppercase tracking-wider transition hover:text-white ' + (orden?.clave === clave ? 'text-white' : '')} title={`Ordenar por ${label}`}>
                        {label}
                        <span className="text-[9px] leading-none">
                          {orden?.clave === clave ? (orden.dir === 1 ? '▲' : '▼') : '▽'}
                        </span>
                      </button>
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right whitespace-nowrap">Acc</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50 bg-surface">
                {lista.map((n) => {
                  const col = colorFila(n.motivo)
                  const esVacia = String(n.id).startsWith('vac-')
                  return (
                    <tr key={n.id} style={col ? { backgroundColor: col.bg, color: col.fg } : undefined} className={'transition ' + (esVacia ? 'opacity-50' : 'hover:brightness-110' + (col ? '' : ' hover:bg-line/20'))}>
                      <td className="px-2 py-1.5 text-sub">{n.anio || '-'}</td>
                      <td className="px-2 py-1.5 text-sub">{n.mes_liquidacion || '-'}</td>
                      <td className="px-2 py-1.5 text-sub">{n.numero || '-'}</td>
                      <td className="px-2 py-1.5 font-medium">{n.nombre_completo || '-'}</td>
                      <td className="px-2 py-1.5 text-sub">{n.tipo || '-'}</td>
                      <td className="px-2 py-1.5 text-center">{fmtFecha(n.fecha)}</td>
                      <td className="px-2 py-1.5 text-center">{fmtFecha(n.desde)}</td>
                      <td className="px-2 py-1.5 text-center">{fmtFecha(n.hasta)}</td>
                      <td className="px-2 py-1.5 text-center">{esMotivoConDias(n.motivo) ? diasDesdeHasta(n.desde, n.hasta) ?? '-' : '-'}</td>
                      <td className="px-2 py-1.5">{n.local || '-'}</td>
                      <td className="px-2 py-1.5"><span className="inline-block whitespace-nowrap rounded-full border px-1.5 py-px text-[10px] font-medium" style={col ? { borderColor: col.fg + '66', backgroundColor: col.fg + '22', color: col.fg } : { borderColor: 'rgba(167,139,250,0.3)', backgroundColor: 'rgba(167,139,250,0.15)', color: '#a78bfa' }}>{n.motivo || '-'}</span></td>
                      <td className="px-2 py-1.5"><span className="block max-w-[200px] truncate" title={n.novedad || ''}>{n.novedad || '-'}</span></td>
                      <td className="px-2 py-1.5 text-center">{n.minutos || '-'}</td>
                      <td className="px-2 py-1.5">{n.control || '-'}</td>
                      <td className="px-2 py-1.5 text-right">
                        {esVacia ? <span className="text-[10px] text-sub/50">Sin novedad</span> : (
                          <div className="flex items-center justify-end gap-1">
                            {puedeEditar && <button onClick={() => abrirModal(n)} className="rounded border border-line p-1 transition hover:text-ink" title="Editar"><Pencil size={12} aria-hidden /></button>}
                            {puedeBorrar && <button onClick={() => setConfirm({ message: `¿Eliminar la novedad de "${n.nombre_completo || '-'}"?`, onConfirm: () => void eliminar(n) })} className="rounded border border-line p-1 transition hover:text-red-400" title="Eliminar"><Trash2 size={12} aria-hidden /></button>}
                          </div>
                        )}
                      </td>
                    </tr>
                  )})}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de carga a pantalla completa */}
      {modalAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-2 sm:p-4" onClick={() => !busy && setModalAbierto(false)}>
          <div className="flex h-[94vh] w-[95vw] max-w-[1400px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-ink"><Megaphone size={18} className="text-violet-500" aria-hidden /> {editId ? 'Editar Novedad' : 'Nueva Novedad'}</h2>
              <button onClick={() => setModalAbierto(false)} className="rounded-lg border border-line p-1.5 text-sub transition hover:bg-line hover:text-ink" aria-label="Cerrar"><X size={16} aria-hidden /></button>
            </div>
            <form onSubmit={(e) => void handleSubmit(e)} className="flex-1 overflow-y-auto px-5 py-4">
              {error && <p role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-2 text-xs text-brand-400">{error}</p>}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="block"><span className="mb-0.5 block text-[11px] font-medium text-sub">Año</span><input value={anio} onChange={(e) => setAnio(e.target.value)} placeholder="2025" className={inputCls} /></label>
                <label className="block sm:col-span-2"><span className="mb-0.5 block text-[11px] font-medium text-sub">Mes liquidación</span>
                  <div className="flex gap-1">
                    <select
                      value={mesNombre(mes)}
                      onChange={(e) => setMes(e.target.value ? textoMes(e.target.value) : '')}
                      className={selectCls + ' flex-1'}
                    >
                      <option value="">--</option>
                      {MESES.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    {mes && <span className="shrink-0 self-center text-[11px] text-sub/70" title={mes}>{mes}</span>}
                  </div>
                </label>
                <AutocompleteCampo label="N° legajo" opciones={opcionesEmp} valor={numero} onChange={(v) => { setNumero(v); elegirEmp(v) }} placeholder="935" className="block" />
                <AutocompleteCampo label="Nombre completo *" opciones={opcionesEmp} valor={nombre} onChange={(v) => { setNombre(v); elegirEmp(v) }} placeholder="APELLIDO NOMBRE" className="block sm:col-span-2" />
                <label className="block"><span className="mb-0.5 block text-[11px] font-medium text-sub">Tipo</span>
                  <div className="flex gap-1">
                    <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={selectCls + ' flex-1'}><option value="">--</option>{tipos.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                    <button type="button" onClick={() => setAbiertoTipos((o) => !o)} className="btn-press inline-flex shrink-0 items-center justify-center rounded-lg border border-brand-600/40 bg-brand-600/10 px-2 text-base font-semibold text-brand-400 hover:bg-brand-600/20" title="Gestionar tipos"><Plus size={15} aria-hidden /></button>
                  </div>
                </label>
                <label className="block"><span className="mb-0.5 block text-[11px] font-medium text-sub">Fecha</span><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} /></label>
                <label className="block"><span className="mb-0.5 block text-[11px] font-medium text-sub">Desde</span><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={inputCls} /></label>
                <label className="block"><span className="mb-0.5 block text-[11px] font-medium text-sub">Hasta</span><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={inputCls} /></label>
                <label className="block"><span className="mb-0.5 block text-[11px] font-medium text-sub">Local</span><select value={local} onChange={(e) => setLocal(e.target.value)} className={selectCls}><option value="">--</option>{LOCALES.map((l) => <option key={l} value={l}>{l}</option>)}</select></label>
                <label className="block"><span className="mb-0.5 block text-[11px] font-medium text-sub">Motivo</span><select value={motivo} onChange={(e) => setMotivo(e.target.value)} className={selectCls}><option value="">--</option>{motivos.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
                <label className="block sm:col-span-3"><span className="mb-0.5 block text-[11px] font-medium text-sub">Novedad</span><input value={novedadTxt} onChange={(e) => setNovedadTxt(e.target.value)} placeholder="Detalle..." className={inputCls} /></label>
                <label className="block"><span className="mb-0.5 block text-[11px] font-medium text-sub">Minutos (solo TARDANZA)</span><input value={minutos} onChange={(e) => setMinutos(e.target.value)} disabled={motivo !== 'TARDANZA'} placeholder="30" className={inputCls + (motivo !== 'TARDANZA' ? ' cursor-not-allowed opacity-50' : '')} /></label>
                <label className="block sm:col-span-4"><span className="mb-0.5 block text-[11px] font-medium text-sub">Control certificado / notificación</span><input value={control} onChange={(e) => setControl(e.target.value)} placeholder="OK / NO ENVIA CERTIFICADO" className={inputCls} /></label>
              </div>
            </form>
            <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
              <button onClick={() => setModalAbierto(false)} disabled={busy} className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2 text-sm font-medium text-ink hover:bg-line">Cancelar</button>
              <button onClick={(e) => void handleSubmit(e)} disabled={busy} className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Check size={15} aria-hidden />}{editId ? 'Guardar cambios' : 'Cargar novedad'}
              </button>
            </div>
          </div>
        </div>
      )}

      {abiertoTipos && (
        <TarjetaTipos
          onClose={() => setAbiertoTipos(false)}
          onSaved={async () => { const t = await nombresTipos(); setTipos(t) }}
        />
      )}

      <ConfirmDialog open={!!confirm} message={confirm?.message ?? ''} onCancel={() => setConfirm(null)} onConfirm={() => { confirm?.onConfirm(); setConfirm(null) }} />

      {!modalAbierto && (
        <button
          ref={fabRef}
          onMouseDown={fabDown}
          onClick={() => { if (fabDrag.current?.moved) { fabDrag.current.moved = false; return } abrirModal(null) }}
          style={{
            position: 'fixed',
            left: fabPos ? fabPos.x : undefined,
            top: fabPos ? fabPos.y : undefined,
            bottom: fabPos ? undefined : '1.5rem',
            right: fabPos ? undefined : '1.5rem',
            zIndex: 50,
            touchAction: 'none',
          }}
          title="Nueva Novedad (arrastra para mover)"
          aria-label="Nueva Novedad"
          className="btn-press inline-flex cursor-grab select-none items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet-600/30 hover:bg-violet-700 active:cursor-grabbing"
        >
          <Plus size={15} aria-hidden /> Nueva Novedad
        </button>
      )}
    </Layout>
)
}

/** Tarjeta ABM de tipos: crear, editar, borrar tipos de novedad. */
function TarjetaTipos({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const { crear: puedeCrear, editar: puedeEditar, borrar: puedeBorrar } = usePermisosArea('rrhh.novedades')
  const [tipos, setTipos] = useState<{ id: string; nombre: string }[]>([])
  const [nuevo, setNuevo] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editNombre, setEditNombre] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)

  const cargar = useCallback(async () => {
    const data = await cargarTipos()
    setTipos(data)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  async function crear(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    const nombre = nuevo.trim().toUpperCase()
    if (!nombre) { setErr('Poné un nombre de tipo.'); return }
    setBusy(true); setErr(null)
    const { error } = await supabase.from('novedades_tipos').insert({ nombre })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setNuevo('')
    invalidarTipos()
    await cargar(); await onSaved()
  }

  async function guardarEdicion() {
    if (!supabase || !editId) return
    const nombre = editNombre.trim().toUpperCase()
    if (!nombre) { setErr('El nombre no puede quedar vacío.'); return }
    setBusy(true); setErr(null)
    const { error } = await supabase.from('novedades_tipos').update({ nombre }).eq('id', editId)
    setBusy(false)
    if (error) { setErr(error.message); return }
    setEditId(null)
    invalidarTipos()
    await cargar(); await onSaved()
  }

  async function borrar(t: { id: string }) {
    if (!supabase) return
    const { error } = await supabase.from('novedades_tipos').delete().eq('id', t.id)
    if (error) { setErr(error.message); return }
    invalidarTipos()
    await cargar(); await onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 backdrop-blur-sm sm:p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-[95vw] max-w-[1000px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h3 className="font-semibold text-ink">Tipos de Novedad</h3>
          <button onClick={onClose} className="rounded-lg border border-line p-1.5 text-sub transition hover:bg-line hover:text-ink" aria-label="Cerrar"><X size={16} aria-hidden /></button>
        </div>
        {err && <p role="alert" className="mx-5 mt-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-2 text-xs text-brand-400">{err}</p>}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {puedeCrear && (
            <form onSubmit={crear} className="mb-3 flex gap-2">
              <input value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="Nuevo tipo..." className={inputCls} />
              <button type="submit" disabled={busy} className="btn-press shrink-0 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"><Plus size={14} aria-hidden /></button>
            </form>
          )}
          <div className="divide-y divide-line/60">
            {tipos.map((t) =>
              editId === t.id ? (
                <div key={t.id} className="flex items-center gap-2 py-2">
                  <input value={editNombre} onChange={(e) => setEditNombre(e.target.value)} className={inputCls} />
                  <button onClick={guardarEdicion} disabled={busy} className="btn-press rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-1.5 text-emerald-400 hover:bg-emerald-500/20"><Check size={13} aria-hidden /></button>
                  <button onClick={() => setEditId(null)} className="btn-press rounded-lg border border-line p-1.5 text-sub hover:text-ink"><X size={13} aria-hidden /></button>
                </div>
              ) : (
                <div key={t.id} className="flex items-center gap-2 py-2">
                  <span className="flex-1 text-sm text-ink">{t.nombre}</span>
                  {puedeEditar && <button onClick={() => { setEditId(t.id); setEditNombre(t.nombre) }} className="btn-press rounded-lg border border-line p-1.5 text-sub hover:text-ink"><Pencil size={12} aria-hidden /></button>}
                  {puedeBorrar && <button onClick={() => setConfirm({ message: `¿Borrar el tipo "${t.nombre}"?`, onConfirm: () => void borrar(t) })} className="btn-press rounded-lg border border-brand-600/30 bg-brand-600/10 p-1.5 text-brand-400 hover:bg-brand-600/20"><Trash2 size={12} aria-hidden /></button>}
                </div>
              ),
            )}
          </div>
        </div>
      </div>
      <ConfirmDialog open={!!confirm} message={confirm?.message ?? ''} onCancel={() => setConfirm(null)} onConfirm={() => { confirm?.onConfirm(); setConfirm(null) }} />
    </div>
  )
}