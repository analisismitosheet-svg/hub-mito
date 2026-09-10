import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader2, Pencil, Trash2, Megaphone, Check, Upload } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

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
  // Si es numero de serie de Excel (dias desde 1899-12-30)
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

export default function CargaNovedades() {
  const { can } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const puedeEditar = can('rrhh.novedades.edit')
  const puedeBorrar = can('rrhh.novedades.delete')

  const [todos, setTodos] = useState<Novedad[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)
  const [importando, setImportando] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Formulario
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

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    setCargando(true); setError(null)
    const { data, error: err } = await supabase.from('novedades').select('*').order('created_at', { ascending: false }).limit(200)
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
      editar(n)
      setSearchParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todos, searchParams])

  function reset() {
    setEditId(null); setAnio(''); setMes(''); setNumero(''); setNombre(''); setTipo(''); setFecha('')
    setDesde(''); setHasta(''); setLocal(''); setMotivo(''); setNovedadTxt(''); setMinutos(''); setControl('')
  }

  function editar(n: Novedad) {
    setEditId(n.id); setAnio(n.anio || ''); setMes(n.mes_liquidacion || ''); setNumero(n.numero || ''); setNombre(n.nombre_completo || '')
    setTipo(n.tipo || ''); setFecha(n.fecha || ''); setDesde(n.desde || ''); setHasta(n.hasta || '')
    setLocal(n.local || ''); setMotivo(n.motivo || ''); setNovedadTxt(n.novedad || ''); setMinutos(n.minutos || ''); setControl(n.control || '')
    window.scrollTo({ top: 0, behavior: 'smooth' })
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
    reset(); await cargar()
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

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink"><Megaphone size={20} className="text-violet-500" aria-hidden /> Carga Novedades</h1>
            <p className="text-xs text-sub/70">Cargar o editar novedades de empleados</p>
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importarExcel(f); e.target.value = '' }} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importando}
            className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {importando ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Upload size={15} aria-hidden />} Importar Excel
          </button>
        </div>
      </header>

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}
      {importMsg && <p className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">{importMsg}</p>}

      {/* Formulario */}
      <form onSubmit={(e) => void handleSubmit(e)} className="mb-6 rounded-2xl border border-line bg-surface p-4 shadow-soft">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink"><Megaphone size={15} className="text-violet-500" aria-hidden /> {editId ? 'Editar novedad' : 'Nueva novedad'}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="block"><span className="mb-0.5 block text-[11px] font-medium text-sub">Año</span><input value={anio} onChange={(e) => setAnio(e.target.value)} placeholder="2025" className={inputCls} /></label>
          <label className="block sm:col-span-2"><span className="mb-0.5 block text-[11px] font-medium text-sub">Mes liquidación</span><input value={mes} onChange={(e) => setMes(e.target.value)} placeholder="ENERO (26/12 AL 25/01)" className={inputCls} /></label>
          <label className="block"><span className="mb-0.5 block text-[11px] font-medium text-sub">N°</span><input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="935" className={inputCls} /></label>
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
        <div className="mt-3 flex items-center gap-2">
          <button type="submit" disabled={busy} className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Check size={15} aria-hidden />}{editId ? 'Guardar cambios' : 'Cargar novedad'}
          </button>
          {editId && <button type="button" onClick={reset} className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2 text-sm font-medium text-ink hover:bg-line">Cancelar edición</button>}
        </div>
      </form>

      {/* Lista reciente */}
      <h2 className="mb-2 text-sm font-semibold text-ink">Últimas novedades cargadas</h2>
      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sub"><Loader2 size={16} className="animate-spin" aria-hidden /> Cargando...</div>
      ) : todos.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-6 text-center text-sm text-sub">Todavía no hay novedades cargadas.</p>
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
                {todos.map((n) => (
                  <tr key={n.id} className="transition hover:bg-line/20">
                    <td className="px-2 py-1.5 text-sub">{n.anio || '-'}</td>
                    <td className="px-2 py-1.5 text-sub">{n.mes_liquidacion || '-'}</td>
                    <td className="px-2 py-1.5 text-sub">{n.numero || '-'}</td>
                    <td className="px-2 py-1.5 font-medium text-ink">{n.nombre_completo || '-'}</td>
                    <td className="px-2 py-1.5 text-sub">{n.tipo || '-'}</td>
                    <td className="px-2 py-1.5 text-center text-sub">{fmtFecha(n.fecha)}</td>
                    <td className="px-2 py-1.5 text-center text-sub">{fmtFecha(n.desde)}</td>
                    <td className="px-2 py-1.5 text-center text-sub">{fmtFecha(n.hasta)}</td>
                    <td className="px-2 py-1.5 text-sub">{n.local || '-'}</td>
                    <td className="px-2 py-1.5"><span className="inline-block whitespace-nowrap rounded-full border border-violet-500/30 bg-violet-500/15 px-1.5 py-px text-[10px] font-medium text-violet-400">{n.motivo || '-'}</span></td>
                    <td className="px-2 py-1.5"><span className="block max-w-[200px] truncate text-sub" title={n.novedad || ''}>{n.novedad || '-'}</span></td>
                    <td className="px-2 py-1.5 text-center text-sub">{n.minutos || '-'}</td>
                    <td className="px-2 py-1.5 text-sub">{n.control || '-'}</td>
                    <td className="px-2 py-1.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {puedeEditar && <button onClick={() => editar(n)} className="rounded border border-line p-1 text-sub transition hover:text-ink" title="Editar"><Pencil size={12} aria-hidden /></button>}
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