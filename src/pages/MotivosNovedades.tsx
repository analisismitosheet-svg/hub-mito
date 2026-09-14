import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Loader2, Plus, Trash2, Pencil, Check, X, Palette } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { supabase } from '@/lib/supabase'
import { usePermisosArea } from '@/hooks/usePermisosArea'
import { cargarMotivos, invalidarMotivos, type Motivo } from '@/lib/motivos'

const inputCls = 'w-full rounded-xl border border-line bg-surface2 px-3 py-1.5 text-[13px] text-ink outline-none transition duration-250 placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'

const COLORES_SUGERIDOS = [
  '#00BFFF', '#FF4500', '#FFD700', '#4B0082', '#FF00FF', '#FFA07A',
  '#008000', '#6495ED', '#FF0000', '#32CD32', '#DDA0DD', '#7FFFD4',
  '#00008B', '#FFDAB9', '#6A5ACD', '#FF8C00', '#FFFFFF', '#808080',
]

export default function MotivosNovedades() {
  const { crear: puedeCrear, editar: puedeEditar, borrar: puedeBorrar } = usePermisosArea('rrhh.novedades')
  const [motivos, setMotivos] = useState<Motivo[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editNombre, setEditNombre] = useState('')
  const [editColor, setEditColor] = useState('#6A5ACD')
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoColor, setNuevoColor] = useState('#6A5ACD')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const data = await cargarMotivos()
    setMotivos(data)
    setCargando(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  async function crear(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    const nombre = nuevoNombre.trim().toUpperCase()
    if (!nombre) { setError('Poné un nombre de motivo.'); return }
    setBusy(true); setError(null)
    const { error } = await supabase.from('novedades_motivos').insert({ nombre, color: nuevoColor })
    setBusy(false)
    if (error) { setError(error.message); return }
    setNuevoNombre(''); setNuevoColor('#6A5ACD')
    invalidarMotivos()
    await cargar()
  }

  async function guardarEdicion() {
    if (!supabase || !editId) return
    const nombre = editNombre.trim().toUpperCase()
    if (!nombre) { setError('El nombre no puede quedar vacío.'); return }
    setBusy(true); setError(null)
    const { error } = await supabase.from('novedades_motivos').update({ nombre, color: editColor }).eq('id', editId)
    setBusy(false)
    if (error) { setError(error.message); return }
    setEditId(null)
    invalidarMotivos()
    await cargar()
  }

  async function borrar(m: Motivo) {
    if (!supabase) return
    const { error } = await supabase.from('novedades_motivos').delete().eq('id', m.id)
    if (error) { setError(error.message); return }
    invalidarMotivos()
    await cargar()
  }

  return (
    <Layout>
      <BackButton />
      <header className="mb-5 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Motivos</h1>
        <p className="mt-1 text-sm text-sub">Crear, editar o borrar motivos de novedades y elegir su color.</p>
      </header>

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      {puedeCrear && (
        <form onSubmit={crear} className="mb-4 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-surface p-3">
          <label className="block flex-1 min-w-[180px]">
            <span className="mb-1 block text-xs font-medium text-sub">Nuevo motivo</span>
            <input value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} placeholder="Ej: VACACIONES, AUSENTE..." className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-sub">Color</span>
            <div className="flex items-center gap-2">
              <input type="color" value={nuevoColor} onChange={(e) => setNuevoColor(e.target.value)} className="h-8 w-12 cursor-pointer rounded border border-line bg-surface2" title="Elegir color" />
              <div className="h-6 w-6 rounded-full border border-line" style={{ backgroundColor: nuevoColor }} />
            </div>
          </label>
          <button type="submit" disabled={busy} className="btn-press inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            <Plus size={15} aria-hidden /> Agregar
          </button>
        </form>
      )}

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sub">
          <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando…
        </div>
      ) : motivos.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-sub">Todavía no hay motivos.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="divide-y divide-line/70">
            {motivos.map((m) =>
              editId === m.id ? (
                <div key={m.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                  <input value={editNombre} onChange={(e) => setEditNombre(e.target.value)} className={inputCls + ' max-w-[220px]'} placeholder="Nombre" />
                  <div className="flex items-center gap-2">
                    <input type="color" value={editColor} onChange={(e) => setEditColor(e.target.value)} className="h-8 w-12 cursor-pointer rounded border border-line bg-surface2" title="Elegir color" />
                    <div className="h-6 w-6 rounded-full border border-line" style={{ backgroundColor: editColor }} />
                  </div>
                  <button onClick={guardarEdicion} disabled={busy} aria-label="Guardar" className="btn-press rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-1.5 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"><Check size={14} aria-hidden /></button>
                  <button onClick={() => setEditId(null)} aria-label="Cancelar" className="btn-press rounded-lg border border-line p-1.5 text-sub hover:text-ink"><X size={14} aria-hidden /></button>
                </div>
              ) : (
                <div key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="h-5 w-5 shrink-0 rounded-full border border-line" style={{ backgroundColor: m.color }} title={m.color} />
                  <span className="flex-1 font-medium text-ink">{m.nombre}</span>
                  <span className="text-[11px] tabular-nums text-sub/70">{m.color}</span>
                  {puedeEditar && <button onClick={() => { setEditId(m.id); setEditNombre(m.nombre); setEditColor(m.color) }} aria-label={`Editar ${m.nombre}`} className="btn-press rounded-lg border border-line p-1.5 text-sub hover:text-ink"><Pencil size={13} aria-hidden /></button>}
                  {puedeBorrar && <button onClick={() => setConfirm({ message: `¿Borrar el motivo "${m.nombre}"?`, onConfirm: () => void borrar(m) })} aria-label={`Borrar ${m.nombre}`} className="btn-press rounded-lg border border-brand-600/30 bg-brand-600/10 p-1.5 text-brand-400 hover:bg-brand-600/20"><Trash2 size={13} aria-hidden /></button>}
                </div>
              ),
            )}
          </div>
        </div>
      )}

      {puedeEditar && (
        <div className="mt-4 rounded-2xl border border-line bg-surface p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-sub"><Palette size={13} aria-hidden /> Colores sugeridos</p>
          <div className="flex flex-wrap gap-1.5">
            {COLORES_SUGERIDOS.map((c) => (
              <button key={c} onClick={() => (editId ? setEditColor(c) : setNuevoColor(c))} className="h-7 w-7 rounded-full border border-line transition hover:scale-110" style={{ backgroundColor: c }} title={c} />
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog open={!!confirm} message={confirm?.message ?? ''} onCancel={() => setConfirm(null)} onConfirm={() => { confirm?.onConfirm(); setConfirm(null) }} />
    </Layout>
  )
}