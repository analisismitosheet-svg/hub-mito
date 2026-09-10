import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader2, Pencil, Trash2, Megaphone, Check, Upload, Plus, X, Search } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { supabase } from '@/lib/supabase'
import { usePermisosArea } from '@/hooks/usePermisosArea'

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

const MOTIVOS = ['INGRESO', 'AUSENTE', 'TARDANZA', 'APERCIBIM', 'EMBARGO', 'CARPETA MÉDICA', 'CAMBIO COMISIÓN', 'RESTAR', 'SUSPENSION', 'CAMBIO LOCAL', 'CAMBIO', 'VACACIONES', 'BAJA', 'LICENCIA', 'OTROS', 'RECUPERAR', 'SIN NOVEDADES']
const TIPOS = ['MITO', 'PPP', 'MAS26', 'PFOMENTAR']
const LOCALES = ['FABRICA', 'BUSTOS', 'HIPER', 'NVO CENTRO', 'DINO', 'POLO 52', 'GRAL PAZ', 'RIVERA', 'ESPINOSA', 'RUTA 9', 'NMO', 'CF RIVERA', '9 DE JULIO', 'MUÑOZ', 'WALMART', 'VCP', 'CF BUSTOS', 'CF OLMOS', 'CF RUTA 9', 'RIO 4']

function fmtFecha(iso: string | null): string {
  if (!iso) return '-'
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
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
const COLOR_MOTIVO: Record<string, string> = {
  'INGRESO': '#00BFFF',
  'AUSENTE': '#FF4500',
  'TARDANZA': '#FFD700',
  'APERCIBIM': '#4B0082',
  'APERCIBIMIENTO': '#4B0082',
  'EMBARGO': '#FF00FF',
  'CARPETA MÉDICA': '#FFA07A',
  'CAMBIO COMISIÓN': '#008000',
  'RESTAR': '#6495ED',
  'SUSPENSION': '#FF0000',
  'CAMBIO LOCAL': '#32CD32',
  'CAMBIO': '#DDA0DD',
  'VACACIONES': '#7FFFD4',
  'BAJA': '#00008B',
  'LICENCIA': '#FFDAB9',
  'OTROS': '#6A5ACD',
  'RECUPERAR': '#FF8C00',
  'SIN NOVEDADES': '#FFFFFF',
}

/** Devuelve color de fondo (con alpha) y color de texto legible según el motivo. */
function colorFila(motivo: string | null): { bg: string; fg: string } | null {
  const c = COLOR_MOTIVO[(motivo ?? '').trim().toUpperCase()]
  if (!c) return null
  return { bg: c + '22', fg: c }
}

/** Nombre corto del mes de liquidación (primera palabra, ej. "ENERO (26/12...)" -> "ENERO"). */
function mesCorto(mes: string | null): string {
  return (mes ?? '').split(/[ (]/)[0] || ''
}

const MESES_LIQUIDACION = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']

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
  const [fAnio, setFAnio] = useState('')
  const [fMes, setFMes] = useState('')
  const [fMotivo, setFMotivo] = useState('')
  const [fLocal, setFLocal] = useState('')
  const [fTipo, setFTipo] = useState('')

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    setCargando(true); setError(null)
    const { data, error: err } = await supabase.from('novedades').select('*').order('created_at', { ascending: false }).limit(500)
    if (err) { setError(err.message); setCargando(false); return }
    setTodos((data as Novedad[] | null) ?? [])
    setCargando(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

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
      novedad: novedadTxt.trim() || null, minutos: minutos.trim() || null, control: control.trim() || null,
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

  const lista = useMemo(() => {
    let r = todos
    if (fAnio) r = r.filter((n) => (n.anio || '').trim() === fAnio)
    if (fMes) r = r.filter((n) => mesCorto(n.mes_liquidacion) === fMes)
    if (fMotivo) r = r.filter((n) => (n.motivo || '') === fMotivo)
    if (fLocal) r = r.filter((n) => (n.local || '') === fLocal)
    if (fTipo) r = r.filter((n) => (n.tipo || '') === fTipo)
    const t = q.trim().toUpperCase()
    if (t) r = r.filter((n) => (n.nombre_completo || '').toUpperCase().includes(t) || (n.numero || '').toUpperCase().includes(t))
    return r
  }, [todos, fAnio, fMes, fMotivo, fLocal, fTipo, q])

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
            <button
              onClick={() => abrirModal(null)}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700"
            >
              <Plus size={15} aria-hidden /> Nueva Novedad
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
        <select value={fMotivo} onChange={(e) => setFMotivo(e.target.value)} className={selectCls + ' h-7 w-full px-2 py-0 text-xs'}>
          <option value="">Motivo</option>
          {MOTIVOS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={fLocal} onChange={(e) => setFLocal(e.target.value)} className={selectCls + ' h-7 w-full px-2 py-0 text-xs'}>
          <option value="">Local</option>
          {LOCALES.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={fTipo} onChange={(e) => setFTipo(e.target.value)} className={selectCls + ' h-7 w-full px-2 py-0 text-xs'}>
          <option value="">Tipo</option>
          {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
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
                  <th className="px-2 py-2 whitespace-nowrap">Año</th>
                  <th className="px-2 py-2 whitespace-nowrap">Mes</th>
                  <th className="px-2 py-2 whitespace-nowrap">N°</th>
                  <th className="px-2 py-2 whitespace-nowrap">Nombre</th>
                  <th className="px-2 py-2 whitespace-nowrap">Tipo</th>
                  <th className="px-2 py-2 text-center whitespace-nowrap">Fecha</th>
                  <th className="px-2 py-2 text-center whitespace-nowrap">Desde</th>
                  <th className="px-2 py-2 text-center whitespace-nowrap">Hasta</th>
                  <th className="px-2 py-2 whitespace-nowrap">Local</th>
                  <th className="px-2 py-2 whitespace-nowrap">Motivo</th>
                  <th className="px-2 py-2 whitespace-nowrap">Novedad</th>
                  <th className="px-2 py-2 text-center whitespace-nowrap">Min</th>
                  <th className="px-2 py-2 whitespace-nowrap">Control</th>
                  <th className="px-2 py-2 text-right whitespace-nowrap">Acc</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50 bg-surface">
                {lista.map((n) => {
                  const col = colorFila(n.motivo)
                  return (
                    <tr key={n.id} style={col ? { backgroundColor: col.bg, color: col.fg } : undefined} className={'transition hover:brightness-110' + (col ? '' : ' hover:bg-line/20')}>
                      <td className="px-2 py-1.5 text-sub">{n.anio || '-'}</td>
                      <td className="px-2 py-1.5 text-sub">{n.mes_liquidacion || '-'}</td>
                      <td className="px-2 py-1.5 text-sub">{n.numero || '-'}</td>
                      <td className="px-2 py-1.5 font-medium">{n.nombre_completo || '-'}</td>
                      <td className="px-2 py-1.5 text-sub">{n.tipo || '-'}</td>
                      <td className="px-2 py-1.5 text-center">{fmtFecha(n.fecha)}</td>
                      <td className="px-2 py-1.5 text-center">{fmtFecha(n.desde)}</td>
                      <td className="px-2 py-1.5 text-center">{fmtFecha(n.hasta)}</td>
                      <td className="px-2 py-1.5">{n.local || '-'}</td>
                      <td className="px-2 py-1.5"><span className="inline-block whitespace-nowrap rounded-full border px-1.5 py-px text-[10px] font-medium" style={col ? { borderColor: col.fg + '66', backgroundColor: col.fg + '22', color: col.fg } : { borderColor: 'rgba(167,139,250,0.3)', backgroundColor: 'rgba(167,139,250,0.15)', color: '#a78bfa' }}>{n.motivo || '-'}</span></td>
                      <td className="px-2 py-1.5"><span className="block max-w-[200px] truncate" title={n.novedad || ''}>{n.novedad || '-'}</span></td>
                      <td className="px-2 py-1.5 text-center">{n.minutos || '-'}</td>
                      <td className="px-2 py-1.5">{n.control || '-'}</td>
                      <td className="px-2 py-1.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {puedeEditar && <button onClick={() => abrirModal(n)} className="rounded border border-line p-1 transition hover:text-ink" title="Editar"><Pencil size={12} aria-hidden /></button>}
                          {puedeBorrar && <button onClick={() => setConfirm({ message: `¿Eliminar la novedad de "${n.nombre_completo || '-'}"?`, onConfirm: () => void eliminar(n) })} className="rounded border border-line p-1 transition hover:text-red-400" title="Eliminar"><Trash2 size={12} aria-hidden /></button>}
                        </div>
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
          <div className="flex h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-ink"><Megaphone size={18} className="text-violet-500" aria-hidden /> {editId ? 'Editar Novedad' : 'Nueva Novedad'}</h2>
              <button onClick={() => setModalAbierto(false)} className="rounded-lg border border-line p-1.5 text-sub transition hover:bg-line hover:text-ink" aria-label="Cerrar"><X size={16} aria-hidden /></button>
            </div>
            <form onSubmit={(e) => void handleSubmit(e)} className="flex-1 overflow-y-auto px-5 py-4">
              {error && <p role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-2 text-xs text-brand-400">{error}</p>}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="block"><span className="mb-0.5 block text-[11px] font-medium text-sub">Año</span><input value={anio} onChange={(e) => setAnio(e.target.value)} placeholder="2025" className={inputCls} /></label>
                <label className="block sm:col-span-2"><span className="mb-0.5 block text-[11px] font-medium text-sub">Mes liquidación</span><input value={mes} onChange={(e) => setMes(e.target.value)} placeholder="ENERO (26/12 AL 25/01)" className={inputCls} /></label>
                <label className="block"><span className="mb-0.5 block text-[11px] font-medium text-sub">N° legajo</span><input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="935" className={inputCls} /></label>
                <label className="block sm:col-span-2"><span className="mb-0.5 block text-[11px] font-medium text-sub">Nombre completo *</span><input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="APELLIDO NOMBRE" className={inputCls} /></label>
                <label className="block"><span className="mb-0.5 block text-[11px] font-medium text-sub">Tipo</span><select value={tipo} onChange={(e) => setTipo(e.target.value)} className={selectCls}><option value="">--</option>{TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
                <label className="block"><span className="mb-0.5 block text-[11px] font-medium text-sub">Fecha</span><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} /></label>
                <label className="block"><span className="mb-0.5 block text-[11px] font-medium text-sub">Desde</span><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={inputCls} /></label>
                <label className="block"><span className="mb-0.5 block text-[11px] font-medium text-sub">Hasta</span><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={inputCls} /></label>
                <label className="block"><span className="mb-0.5 block text-[11px] font-medium text-sub">Local</span><select value={local} onChange={(e) => setLocal(e.target.value)} className={selectCls}><option value="">--</option>{LOCALES.map((l) => <option key={l} value={l}>{l}</option>)}</select></label>
                <label className="block"><span className="mb-0.5 block text-[11px] font-medium text-sub">Motivo</span><select value={motivo} onChange={(e) => setMotivo(e.target.value)} className={selectCls}><option value="">--</option>{MOTIVOS.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
                <label className="block sm:col-span-3"><span className="mb-0.5 block text-[11px] font-medium text-sub">Novedad</span><input value={novedadTxt} onChange={(e) => setNovedadTxt(e.target.value)} placeholder="Detalle..." className={inputCls} /></label>
                <label className="block"><span className="mb-0.5 block text-[11px] font-medium text-sub">Minutos</span><input value={minutos} onChange={(e) => setMinutos(e.target.value)} placeholder="30" className={inputCls} /></label>
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

      <ConfirmDialog open={!!confirm} message={confirm?.message ?? ''} onCancel={() => setConfirm(null)} onConfirm={() => { confirm?.onConfirm(); setConfirm(null) }} />
    </Layout>
  )
}