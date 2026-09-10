import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Loader2, Plus, Trash2, Pencil, Search, SearchX, X, Upload } from 'lucide-react'
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
}

const CAMPOS =
  'id,legajo,nombre,activo,lugar,area_sector,horas,convenio,categoria,puesto,comision,reingreso,fecha_ingreso,antiguedad_2025,dias_vacaciones_2025,cuil,dni,fecha_nacimiento,sexo,telefono,domicilio,email,codigo_os,prepaga,tipo_contrato,contacto_emergencia,parentesco,telefono_emergencia'

const inputCls = 'w-full rounded-xl border border-line bg-surface2 px-3 py-1.5 text-[13px] text-ink outline-none transition duration-250 placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'
const selectCls = inputCls + ' appearance-none'
const tdBase = 'px-2 py-[3px] whitespace-nowrap'
const tdBaseWrap = 'px-2 py-[3px]'

export default function Empleados() {
  const { crear: puedeCrear, editar: puedeEditar, borrar: puedeBorrar } = usePermisosArea('rrhh.empleados')
  const [empleados, setEmpleados] = useState<Empleado[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [filtros, setFiltros] = useState<Record<string, string[]>>({})
  const [modal, setModal] = useState<'new' | 'edit' | null>(null)
  const [sel, setSel] = useState<Empleado | null>(null)
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)
  const [importando, setImportando] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    const { data, error } = await supabase.from('empleados').select(CAMPOS).order('nombre')
    if (error) setError(error.message)
    setEmpleados((data as Empleado[]) ?? [])
    setCargando(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  // Columnas filtrables y sus valores únicos (como los filtros de Excel)
  const columnasFiltro = useMemo(() => {
    const defs: { clave: string; label: string; valores: string[] }[] = [
      { clave: 'legajo', label: 'Legajo', valores: [] },
      { clave: 'lugar', label: 'Lugar', valores: [] },
      { clave: 'area_sector', label: 'Área / Sector', valores: [] },
      { clave: 'categoria', label: 'Categoría', valores: [] },
      { clave: 'puesto', label: 'Puesto', valores: [] },
    ]
    for (const d of defs) {
      d.valores = Array.from(
        new Set(empleados.map((e) => String((e as unknown as Record<string, unknown>)[d.clave] ?? '')).filter((v) => v !== '')),
      ).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))
    }
    return defs
  }, [empleados])

  const filtrados = useMemo(() => {
    const t = busqueda.trim().toUpperCase()
    return empleados.filter((e) => {
      for (const [clave, valores] of Object.entries(filtros)) {
        if (!valores || valores.length === 0) continue
        const actual = String((e as unknown as Record<string, unknown>)[clave] ?? '')
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
  }, [empleados, busqueda, filtros])

  const hayFiltros = Object.values(filtros).some((v) => v.length > 0) || !!busqueda

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
        <h1 className="font-display text-2xl font-semibold text-ink">Empleados</h1>
        <p className="mt-1 text-sm text-sub">Nómina de empleados: alta, edición y baja.</p>
      </header>

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-surface p-3">
        <label className="relative block flex-1 min-w-[200px]">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub" aria-hidden />
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre, legajo, DNI o área..." className={inputCls + ' pl-9'} />
        </label>
        {hayFiltros && (
          <button onClick={() => { setBusqueda(''); setFiltros({}) }} className="btn-press rounded-lg border border-line bg-surface2 px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-line">Limpiar filtros</button>
        )}
        {puedeCrear && (
          <button onClick={() => { setSel(null); setModal('new') }} className="btn-press ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
            <Plus size={15} aria-hidden /> Nuevo empleado
          </button>
        )}
        {puedeCrear && (
          <button onClick={() => fileRef.current?.click()} disabled={importando} className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-3 py-2 text-sm font-medium text-ink hover:bg-line disabled:opacity-50">
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
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full table-auto text-[12px]">
            <thead className="bg-surface2/60 text-left text-[11px] uppercase tracking-wide text-sub">
              <tr>
                <th className={tdBase + ' py-2'}>Legajo</th>
                <th className={tdBase + ' py-2'}>Nombre</th>
                <th className={tdBase + ' py-2'}>Lugar</th>
                <th className={tdBase + ' py-2'}>Área / Sector</th>
                <th className={tdBase + ' py-2'}>Categoría</th>
                <th className={tdBase + ' py-2'}>Puesto</th>
                <th className={tdBase + ' py-2 text-center'}>Horas</th>
                <th className={tdBase + ' py-2'}>Teléfono</th>
                <th className={tdBase + ' py-2 text-right'}>Acciones</th>
              </tr>
              <tr className="bg-surface/60">
                <th className={tdBase + ' py-1 align-top'}><FiltroCol d={columnasFiltro[0]!} filtros={filtros.legajo ?? []} onChange={(v) => setFiltros((prev) => ({ ...prev, legajo: v }))} /></th>
                <th className={tdBase + ' py-1 align-top'} />
                <th className={tdBase + ' py-1 align-top'}><FiltroCol d={columnasFiltro[1]!} filtros={filtros.lugar ?? []} onChange={(v) => setFiltros((prev) => ({ ...prev, lugar: v }))} /></th>
                <th className={tdBase + ' py-1 align-top'}><FiltroCol d={columnasFiltro[2]!} filtros={filtros.area_sector ?? []} onChange={(v) => setFiltros((prev) => ({ ...prev, area_sector: v }))} /></th>
                <th className={tdBase + ' py-1 align-top'}><FiltroCol d={columnasFiltro[3]!} filtros={filtros.categoria ?? []} onChange={(v) => setFiltros((prev) => ({ ...prev, categoria: v }))} /></th>
                <th className={tdBase + ' py-1 align-top'}><FiltroCol d={columnasFiltro[4]!} filtros={filtros.puesto ?? []} onChange={(v) => setFiltros((prev) => ({ ...prev, puesto: v }))} /></th>
                <th className={tdBase + ' py-1 align-top'} />
                <th className={tdBase + ' py-1 align-top'} />
                <th className={tdBase + ' py-1 align-top'} />
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filtrados.map((e) => (
                <tr key={e.id} className="hover:bg-line/20">
                  <td className={tdBase + ' text-sub'}>{e.legajo ?? '-'}</td>
                  <td className={tdBaseWrap + ' font-medium text-ink'}>{e.nombre}</td>
                  <td className={tdBase}>{e.lugar ?? '-'}</td>
                  <td className={tdBaseWrap}>{e.area_sector ?? '-'}</td>
                  <td className={tdBaseWrap}>{e.categoria ?? '-'}</td>
                  <td className={tdBaseWrap}>{e.puesto ?? '-'}</td>
                  <td className={tdBase + ' text-center'}>{e.horas ?? '-'}</td>
                  <td className={tdBaseWrap}>{e.telefono ?? '-'}</td>
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
          opciones={opcionesEmpleado}
          onClose={() => { setModal(null); setSel(null) }}
          onSaved={async () => { setModal(null); setSel(null); await cargar() }}
        />
      )}

      <ConfirmDialog open={!!confirm} message={confirm?.message ?? ''} onCancel={() => setConfirm(null)} onConfirm={() => { confirm?.onConfirm(); setConfirm(null) }} />
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
    }
    const res = registro
      ? await supabase.from('empleados').update(payload).eq('id', registro.id)
      : await supabase.from('empleados').insert(payload)
    setBusy(false)
    if (res.error) { setError(res.error.message); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div className="my-4 w-[94vw] max-w-[900px] rounded-2xl border border-line bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-lg font-semibold text-ink">{registro ? 'Editar empleado' : 'Nuevo empleado'}</h2>
          <button onClick={onClose} className="rounded-lg border border-line p-1.5 text-sub transition hover:bg-line hover:text-ink"><X size={16} aria-hidden /></button>
        </div>
        {error && <p role="alert" className="mx-5 mt-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}
        <form onSubmit={(e) => void guardar(e)} className="p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            <Campo label="N° Legajo"><input value={f.legajo} onChange={(e) => set('legajo', e.target.value)} className={inputCls} /></Campo>
            <Campo label="Apellido y Nombre *" span2><input value={f.nombre} onChange={(e) => set('nombre', e.target.value)} className={inputCls} /></Campo>
            <Campo label="Lugar"><AutocompleteCampo label="Lugar" opciones={(opciones.lugar ?? []).map((v) => ({ id: v, label: v }))} valor={f.lugar} onChange={(v) => set('lugar', v)} placeholder="Buscar lugar..." /></Campo>
            <AutocompleteCampo label="Área / Sector" opciones={(opciones.area_sector ?? []).map((v) => ({ id: v, label: v }))} valor={f.area_sector} onChange={(v) => set('area_sector', v)} />
            <Campo label="Horas"><input value={f.horas} onChange={(e) => set('horas', e.target.value)} className={inputCls} /></Campo>
            <AutocompleteCampo label="Convenio" opciones={(opciones.convenio ?? []).map((v) => ({ id: v, label: v }))} valor={f.convenio} onChange={(v) => set('convenio', v)} />
            <AutocompleteCampo label="Categoría" opciones={(opciones.categoria ?? []).map((v) => ({ id: v, label: v }))} valor={f.categoria} onChange={(v) => set('categoria', v)} />
            <AutocompleteCampo label="Puesto" opciones={(opciones.puesto ?? []).map((v) => ({ id: v, label: v }))} valor={f.puesto} onChange={(v) => set('puesto', v)} />
            <Campo label="Comisión"><input value={f.comision} onChange={(e) => set('comision', e.target.value)} className={inputCls} /></Campo>
            <Campo label="Reingreso"><input value={f.reingreso} onChange={(e) => set('reingreso', e.target.value)} className={inputCls} /></Campo>
            <Campo label="Fecha de ingreso"><input type="date" value={f.fecha_ingreso} onChange={(e) => set('fecha_ingreso', e.target.value)} className={inputCls} /></Campo>
            <Campo label="Antigüedad 2025"><input value={f.antiguedad_2025} onChange={(e) => set('antiguedad_2025', e.target.value)} className={inputCls} /></Campo>
            <Campo label="Días vacaciones 2025"><input value={f.dias_vacaciones_2025} onChange={(e) => set('dias_vacaciones_2025', e.target.value)} className={inputCls} /></Campo>
            <Campo label="CUIL"><input value={f.cuil} onChange={(e) => set('cuil', e.target.value)} className={inputCls} /></Campo>
            <Campo label="DNI"><input value={f.dni} onChange={(e) => set('dni', e.target.value)} className={inputCls} /></Campo>
            <Campo label="Fecha de nacimiento"><input type="date" value={f.fecha_nacimiento} onChange={(e) => set('fecha_nacimiento', e.target.value)} className={inputCls} /></Campo>
            <Campo label="Sexo"><select value={f.sexo} onChange={(e) => set('sexo', e.target.value)} className={selectCls}><option value="">--</option><option value="F">F</option><option value="M">M</option></select></Campo>
            <Campo label="Teléfono"><input value={f.telefono} onChange={(e) => set('telefono', e.target.value)} className={inputCls} /></Campo>
            <Campo label="Email"><input value={f.email} onChange={(e) => set('email', e.target.value)} className={inputCls} /></Campo>
            <Campo label="Domicilio" span3><input value={f.domicilio} onChange={(e) => set('domicilio', e.target.value)} className={inputCls} /></Campo>
            <Campo label="Código OS"><input value={f.codigo_os} onChange={(e) => set('codigo_os', e.target.value)} className={inputCls} /></Campo>
            <Campo label="Prepaga"><input value={f.prepaga} onChange={(e) => set('prepaga', e.target.value)} className={inputCls} list="prepaga-list" /><datalist id="prepaga-list">{(opciones.prepaga ?? []).map((v) => <option key={v} value={v} />)}</datalist></Campo>
            <Campo label="Tipo de contrato"><input value={f.tipo_contrato} onChange={(e) => set('tipo_contrato', e.target.value)} className={inputCls} list="contrato-list" /><datalist id="contrato-list">{(opciones.tipo_contrato ?? []).map((v) => <option key={v} value={v} />)}</datalist></Campo>
            <Campo label="Contacto emergencia" span2><input value={f.contacto_emergencia} onChange={(e) => set('contacto_emergencia', e.target.value)} className={inputCls} /></Campo>
            <Campo label="Parentesco"><input value={f.parentesco} onChange={(e) => set('parentesco', e.target.value)} className={inputCls} /></Campo>
            <Campo label="Teléfono emergencia"><input value={f.telefono_emergencia} onChange={(e) => set('telefono_emergencia', e.target.value)} className={inputCls} /></Campo>
          </div>
          <div className="mt-5 flex justify-end gap-2">
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
    <label className={'block ' + (span3 ? 'sm:col-span-2 md:col-span-3' : span2 ? 'sm:col-span-2' : '')}>
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