import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Loader2, Search, SearchX, Plus, Pencil, Trash2, X, Megaphone } from 'lucide-react'
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

export default function Novedades() {
  const { can } = useAuth()
  const puedeCrear = can('rrhh.novedades.create')
  const puedeEditar = can('rrhh.novedades.edit')
  const puedeBorrar = can('rrhh.novedades.delete')

  const [todos, setTodos] = useState<Novedad[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [fMotivo, setFMotivo] = useState('')
  const [fTipo, setFTipo] = useState('')
  const [modal, setModal] = useState<'new' | 'edit' | null>(null)
  const [sel, setSel] = useState<Novedad | null>(null)
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    setCargando(true); setError(null)
    const { data, error: err } = await supabase.from('novedades').select('*').order('created_at', { ascending: false })
    if (err) { setError(err.message); setCargando(false); return }
    setTodos((data as Novedad[] | null) ?? [])
    setCargando(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  const term = q.trim().toUpperCase()
  const lista = useMemo(() => {
    let r = todos
    if (fMotivo) r = r.filter((n) => n.motivo === fMotivo)
    if (fTipo) r = r.filter((n) => n.tipo === fTipo)
    if (term) r = r.filter((n) =>
      (n.nombre_completo || '').toUpperCase().includes(term) ||
      (n.numero || '').toUpperCase().includes(term) ||
      (n.local || '').toUpperCase().includes(term) ||
      (n.novedad || '').toUpperCase().includes(term)
    )
    return r
  }, [todos, fMotivo, fTipo, term])

  async function eliminar(n: Novedad) {
    if (!supabase) return
    const { error: err } = await supabase.from('novedades').delete().eq('id', n.id)
    if (err) { return }
    setSel(null); await cargar()
  }

  return (
    <Layout>
      <BackButton />
      <header className="mb-3 mt-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink"><Megaphone size={20} className="text-violet-500" aria-hidden /> Novedades <span className="text-sm font-normal text-sub">({todos.length})</span></h1>
        <p className="text-xs text-sub/70">Novedades de empleados (ausencias, tardanzas, vacaciones, etc.)</p>
      </header>

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sub/70" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, N°, local..." className={inputCls + ' pl-8 text-xs'} />
        </div>
        <select value={fMotivo} onChange={(e) => setFMotivo(e.target.value)} className={selectCls + ' w-auto text-xs'}>
          <option value="">Motivo (todos)</option>
          {MOTIVOS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={fTipo} onChange={(e) => setFTipo(e.target.value)} className={selectCls + ' w-auto text-xs'}>
          <option value="">Tipo (todos)</option>
          {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {puedeCrear && (
          <button onClick={() => setModal('new')} className="btn-press inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-700"><Plus size={13} aria-hidden /> Nueva Novedad</button>
        )}
      </div>

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sub"><Loader2 size={18} className="animate-spin" aria-hidden /> Cargando...</div>
      ) : lista.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-6 text-center">
          <SearchX size={32} className="mx-auto mb-2 text-sub/40" aria-hidden />
          <p className="text-sm text-sub">{term ? 'No se encontraron novedades.' : 'Todavia no hay novedades cargadas.'}</p>
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
                        {puedeEditar && <button onClick={() => { setSel(n); setModal('edit') }} className="rounded border border-line p-1 text-sub transition hover:text-ink" title="Editar"><Pencil size={12} aria-hidden /></button>}
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

      {modal && (
        <NovedadModal novedad={modal === 'edit' ? sel : null} onClose={() => { setModal(null); setSel(null) }} onSaved={async () => { setModal(null); setSel(null); await cargar() }} />
      )}

      <ConfirmDialog open={!!confirm} message={confirm?.message ?? ''} onCancel={() => setConfirm(null)} onConfirm={() => { confirm?.onConfirm(); setConfirm(null) }} />
    </Layout>
  )
}

function NovedadModal({ novedad, onClose, onSaved }: { novedad: Novedad | null; onClose: () => void; onSaved: () => void }) {
  const [anio, setAnio] = useState(novedad?.anio || '')
  const [mes, setMes] = useState(novedad?.mes_liquidacion || '')
  const [numero, setNumero] = useState(novedad?.numero || '')
  const [nombre, setNombre] = useState(novedad?.nombre_completo || '')
  const [tipo, setTipo] = useState(novedad?.tipo || '')
  const [fecha, setFecha] = useState(novedad?.fecha || '')
  const [desde, setDesde] = useState(novedad?.desde || '')
  const [hasta, setHasta] = useState(novedad?.hasta || '')
  const [local, setLocal] = useState(novedad?.local || '')
  const [motivo, setMotivo] = useState(novedad?.motivo || '')
  const [novedadTxt, setNovedadTxt] = useState(novedad?.novedad || '')
  const [minutos, setMinutos] = useState(novedad?.minutos || '')
  const [control, setControl] = useState(novedad?.control || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    const result = novedad
      ? await supabase.from('novedades').update(payload).eq('id', novedad.id)
      : await supabase.from('novedades').insert(payload)
    setBusy(false)
    if (result.error) { setError(result.error.message); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="flex w-[94vw] max-w-2xl flex-col rounded-2xl border border-line bg-surface shadow-2xl" style={{ maxHeight: '92vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink"><Megaphone size={18} className="text-violet-500" aria-hidden /> {novedad ? 'Editar Novedad' : 'Nueva Novedad'}</h2>
          <button onClick={onClose} className="rounded-lg border border-line p-1.5 text-sub transition hover:bg-line hover:text-ink" aria-label="Cerrar"><X size={16} aria-hidden /></button>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className="flex-1 overflow-y-auto px-5 py-4">
          {error && <p role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-2 text-xs text-brand-400">{error}</p>}
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
        </form>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button onClick={onClose} disabled={busy} className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2 text-sm font-medium text-ink hover:bg-line">Cancelar</button>
          <button onClick={(e) => void handleSubmit(e)} disabled={busy} className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}{novedad ? 'Guardar cambios' : 'Crear Novedad'}
          </button>
        </div>
      </div>
    </div>
  )
}