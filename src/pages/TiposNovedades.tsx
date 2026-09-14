import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Loader2, Plus, Trash2, Pencil, Check, X, Tag } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { supabase } from '@/lib/supabase'
import { usePermisosArea } from '@/hooks/usePermisosArea'
import { cargarTipos, invalidarTipos, type TipoNovedad } from '@/lib/tipos'

const inputCls = 'w-full rounded-xl border border-line bg-surface2 px-3 py-1.5 text-[13px] text-ink outline-none transition duration-250 placeholder:text-sub/70 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40'

export default function TiposNovedades() {
  const { crear: puedeCrear, editar: puedeEditar, borrar: puedeBorrar } = usePermisosArea('rrhh.novedades')
  const [tipos, setTipos] = useState<TipoNovedad[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editNombre, setEditNombre] = useState('')
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const data = await cargarTipos()
    setTipos(data)
    setCargando(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  async function crear(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    const nombre = nuevoNombre.trim().toUpperCase()
    if (!nombre) { setError('Poné un nombre de tipo.'); return }
    setBusy(true); setError(null)
    const { error } = await supabase.from('novedades_tipos').insert({ nombre })
    setBusy(false)
    if (error) { setError(error.message); return }
    setNuevoNombre('')
    invalidarTipos()
    await cargar()
  }

  async function guardarEdicion() {
    if (!supabase || !editId) return
    const nombre = editNombre.trim().toUpperCase()
    if (!nombre) { setError('El nombre no puede quedar vacío.'); return }
    setBusy(true); setError(null)
    const { error } = await supabase.from('novedades_tipos').update({ nombre }).eq('id', editId)
    setBusy(false)
    if (error) { setError(error.message); return }
    setEditId(null)
    invalidarTipos()
    await cargar()
  }

  async function borrar(t: TipoNovedad) {
    if (!supabase) return
    const { error } = await supabase.from('novedades_tipos').delete().eq('id', t.id)
    if (error) { setError(error.message); return }
    invalidarTipos()
    await cargar()
  }

  return (
    <Layout>
      <BackButton />
      <header className="mb-5 mt-2">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink"><Tag size={20} className="text-brand-600" aria-hidden /> Tipos de Novedad</h1>
        <p className="mt-1 text-sm text-sub">Crear, editar o borrar tipos de novedad.</p>
      </header>

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      {puedeCrear && (
        <form onSubmit={crear} className="mb-4 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-surface p-3">
          <label className="block flex-1 min-w-[180px]">
            <span className="mb-1 block text-xs font-medium text-sub">Nuevo tipo</span>
            <input value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} placeholder="Ej: MITO, PPP..." className={inputCls} />
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
      ) : tipos.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-sub">Todavía no hay tipos.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="divide-y divide-line/70">
            {tipos.map((t) =>
              editId === t.id ? (
                <div key={t.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                  <input value={editNombre} onChange={(e) => setEditNombre(e.target.value)} className={inputCls + ' max-w-[220px]'} placeholder="Nombre" />
                  <button onClick={guardarEdicion} disabled={busy} aria-label="Guardar" className="btn-press rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-1.5 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"><Check size={14} aria-hidden /></button>
                  <button onClick={() => setEditId(null)} aria-label="Cancelar" className="btn-press rounded-lg border border-line p-1.5 text-sub hover:text-ink"><X size={14} aria-hidden /></button>
                </div>
              ) : (
                <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex-1 font-medium text-ink">{t.nombre}</span>
                  {puedeEditar && <button onClick={() => { setEditId(t.id); setEditNombre(t.nombre) }} aria-label={`Editar ${t.nombre}`} className="btn-press rounded-lg border border-line p-1.5 text-sub hover:text-ink"><Pencil size={13} aria-hidden /></button>}
                  {puedeBorrar && <button onClick={() => setConfirm({ message: `¿Borrar el tipo "${t.nombre}"?`, onConfirm: () => void borrar(t) })} aria-label={`Borrar ${t.nombre}`} className="btn-press rounded-lg border border-brand-600/30 bg-brand-600/10 p-1.5 text-brand-400 hover:bg-brand-600/20"><Trash2 size={13} aria-hidden /></button>}
                </div>
              ),
            )}
          </div>
        </div>
      )}

      <ConfirmDialog open={!!confirm} message={confirm?.message ?? ''} onCancel={() => setConfirm(null)} onConfirm={() => { confirm?.onConfirm(); setConfirm(null) }} />
    </Layout>
  )
}