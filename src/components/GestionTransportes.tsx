import { useEffect, useState, type FormEvent } from 'react'
import { Loader2, Plus, Pencil, Trash2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import ConfirmDialog from '@/components/ConfirmDialog'

interface Transporte { id: string; nombre: string; estado: string | null }

const inputCls = 'w-full rounded-xl border border-line bg-surface2 px-3 py-1.5 text-[13px] text-ink outline-none transition duration-250 placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'

/** Modal para crear, editar y borrar transportes. Se usa desde Facturación Fábrica. */
export default function GestionTransportes({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [lista, setLista] = useState<Transporte[]>([])
  const [cargando, setCargando] = useState(true)
  const [editando, setEditando] = useState<Transporte | null>(null)
  const [nombre, setNombre] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)

  async function cargar() {
    if (!supabase) { setCargando(false); return }
    const { data } = await supabase.from('transportes').select('id,nombre,estado').order('nombre', { ascending: true })
    setLista((data as Transporte[] | null) ?? [])
    setCargando(false)
  }

  useEffect(() => { void cargar() }, [])

  function empezarNuevo() { setEditando(null); setNombre('') }
  function empezarEditar(t: Transporte) { setEditando(t); setNombre(t.nombre) }

  async function guardar(e: FormEvent) {
    e.preventDefault()
    if (!supabase || !nombre.trim()) { setError('El nombre es obligatorio.'); return }
    setBusy(true); setError(null)
    const val = nombre.trim().toUpperCase()
    if (editando) {
      const { error } = await supabase.from('transportes').update({ nombre: val }).eq('id', editando.id)
      if (error) { setError(error.message); setBusy(false); return }
    } else {
      const { error } = await supabase.from('transportes').insert({ nombre: val, estado: 'ACTIVO' })
      if (error) { setError(error.message); setBusy(false); return }
    }
    setBusy(false)
    setEditando(null); setNombre('')
    await cargar()
    onSaved()
  }

  async function borrar(t: Transporte) {
    if (!supabase) return
    const { error } = await supabase.from('transportes').delete().eq('id', t.id)
    if (error) { setError(error.message); return }
    await cargar()
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="flex w-[92vw] max-w-md flex-col rounded-2xl border border-line bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">Gestionar Transportes</h2>
          <button onClick={onClose} className="rounded-lg border border-line p-1.5 text-sub transition hover:bg-line hover:text-ink" aria-label="Cerrar"><X size={16} aria-hidden /></button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-5">
          {error && <p role="alert" className="mb-3 rounded-xl border border-brand-600/30 bg-brand-600/10 p-2 text-xs text-brand-400">{error}</p>}

          {/* Formulario crear/editar */}
          <form onSubmit={(e) => void guardar(e)} className="mb-4 rounded-xl border border-line bg-surface2 p-3">
            <div className="flex items-end gap-2">
              <label className="block flex-1">
                <span className="mb-1 block text-xs font-medium text-sub">{editando ? 'Editar transporte' : 'Nuevo transporte'}</span>
                <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del transporte..." className={inputCls} autoFocus />
              </label>
              <button type="submit" disabled={busy} className="btn-press inline-flex items-center gap-1 rounded-xl bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : editando ? <Pencil size={14} aria-hidden /> : <Plus size={14} aria-hidden />}
                {editando ? 'Guardar' : 'Agregar'}
              </button>
              {editando && (
                <button type="button" onClick={empezarNuevo} className="btn-press rounded-xl border border-line bg-surface2 px-3 py-2 text-sm font-medium text-ink hover:bg-line">Cancelar</button>
              )}
            </div>
          </form>

          {/* Lista */}
          {cargando ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sub"><Loader2 size={16} className="animate-spin" aria-hidden /> Cargando...</div>
          ) : lista.length === 0 ? (
            <p className="py-6 text-center text-sm text-sub">Sin transportes cargados.</p>
          ) : (
            <ul className="space-y-1">
              {lista.map((t) => (
                <li key={t.id} className="flex items-center gap-2 rounded-lg border border-line/60 bg-surface px-3 py-1.5">
                  <span className="flex-1 text-sm text-ink">{t.nombre} {t.estado === 'INACTIVO' && <span className="ml-1 rounded-full bg-red-500/15 px-1.5 py-px text-[9px] font-medium text-red-400">INACTIVO</span>}</span>
                  <button onClick={() => empezarEditar(t)} className="rounded border border-line p-1 text-sub transition hover:text-ink" title="Editar"><Pencil size={13} aria-hidden /></button>
                  <button onClick={() => setConfirm({ message: `¿Borrar el transporte "${t.nombre}"?`, onConfirm: () => void borrar(t) })} className="rounded border border-line p-1 text-sub transition hover:text-red-400" title="Borrar"><Trash2 size={13} aria-hidden /></button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end border-t border-line px-5 py-3">
          <button onClick={onClose} className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2 text-sm font-medium text-ink hover:bg-line">Cerrar</button>
        </div>
      </div>
      <ConfirmDialog open={!!confirm} message={confirm?.message ?? ''} onCancel={() => setConfirm(null)} onConfirm={() => { confirm?.onConfirm(); setConfirm(null) }} />
    </div>
  )
}