import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Loader2, Plus, Trash2, Pencil, Check, X } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { supabase } from '@/lib/supabase'

interface Empleado {
  id: string
  legajo: string | null
  nombre: string
}

export default function Empleados() {
  const [empleados, setEmpleados] = useState<Empleado[]>([])
  const [legajo, setLegajo] = useState('')
  const [nombre, setNombre] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editLegajo, setEditLegajo] = useState('')
  const [editNombre, setEditNombre] = useState('')
  const [cargando, setCargando] = useState(true)
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    const { data } = await supabase.from('empleados').select('id,legajo,nombre').order('nombre')
    setEmpleados((data as Empleado[]) ?? [])
    setCargando(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  function empezarEdicion(e: Empleado) {
    setEditId(e.id)
    setEditLegajo(e.legajo ?? '')
    setEditNombre(e.nombre)
    setError(null)
  }
  function cancelarEdicion() {
    setEditId(null)
    setEditLegajo('')
    setEditNombre('')
  }
  async function guardarEdicion() {
    if (!supabase || !editId) return
    if (!editNombre.trim()) { setError('El nombre no puede quedar vacío.'); return }
    setBusy(true); setError(null)
    const { error } = await supabase.from('empleados').update({ legajo: editLegajo.trim() || null, nombre: editNombre.trim() }).eq('id', editId)
    setBusy(false)
    if (error) { setError(error.message); return }
    cancelarEdicion(); await cargar()
  }

  async function agregar(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (!nombre.trim()) { setError('Poné el nombre completo.'); return }
    setBusy(true); setError(null)
    const { error } = await supabase.from('empleados').insert({ legajo: legajo.trim() || null, nombre: nombre.trim() })
    setBusy(false)
    if (error) { setError(error.message); return }
    setLegajo(''); setNombre(''); await cargar()
  }

  async function borrar(id: string) {
    if (!supabase) return
    const { error } = await supabase.from('empleados').delete().eq('id', id)
    if (error) { setError(error.message); return }
    await cargar()
  }

  return (
    <Layout>
      <BackButton />
      <header className="mb-5 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Empleados</h1>
        <p className="mt-1 text-sm text-sub">Alta, edición y baja de empleados.</p>
      </header>

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      <form onSubmit={agregar} className="mb-4 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-surface p-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-sub">N° legajo</span>
          <input value={legajo} onChange={(e) => setLegajo(e.target.value)} placeholder="1234" className="w-24 rounded-lg border border-line bg-surface2 px-2 py-1.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40" />
        </label>
        <label className="block flex-1">
          <span className="mb-1 block text-xs font-medium text-sub">Nombre completo</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Juan Pérez" className="w-full rounded-lg border border-line bg-surface2 px-2 py-1.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40" />
        </label>
        <button type="submit" disabled={busy} className="btn-press inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          <Plus size={15} aria-hidden /> Agregar
        </button>
      </form>

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sub">
          <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando…
        </div>
      ) : empleados.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-sub">Todavía no hay empleados. Agregá el primero arriba.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="divide-y divide-line/70">
            {empleados.map((e) =>
              editId === e.id ? (
                <div key={e.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                  <input value={editLegajo} onChange={(ev) => setEditLegajo(ev.target.value)} placeholder="Legajo" className="w-24 rounded-lg border border-line bg-surface2 px-2 py-1.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40" />
                  <input value={editNombre} onChange={(ev) => setEditNombre(ev.target.value)} placeholder="Nombre completo" className="min-w-0 flex-1 rounded-lg border border-line bg-surface2 px-2 py-1.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40" onKeyDown={(ev) => { if (ev.key === 'Enter') guardarEdicion(); if (ev.key === 'Escape') cancelarEdicion() }} />
                  <button onClick={guardarEdicion} disabled={busy} aria-label="Guardar" className="btn-press rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-1.5 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"><Check size={14} aria-hidden /></button>
                  <button onClick={cancelarEdicion} aria-label="Cancelar" className="btn-press rounded-lg border border-line p-1.5 text-sub hover:text-ink"><X size={14} aria-hidden /></button>
                </div>
              ) : (
                <div key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                  {e.legajo && <span className="rounded-full bg-line px-2 py-0.5 text-[11px] font-semibold text-sub">#{e.legajo}</span>}
                  <span className="flex-1 font-medium text-ink">{e.nombre}</span>
                  <button onClick={() => empezarEdicion(e)} aria-label={`Editar ${e.nombre}`} className="btn-press rounded-lg border border-line p-1.5 text-sub hover:text-ink"><Pencil size={13} aria-hidden /></button>
                  <button onClick={() => setConfirm({ message: `¿Borrar al empleado "${e.nombre}"?`, onConfirm: () => void borrar(e.id) })} aria-label={`Borrar ${e.nombre}`} className="btn-press rounded-lg border border-brand-600/30 bg-brand-600/10 p-1.5 text-brand-400 hover:bg-brand-600/20"><Trash2 size={13} aria-hidden /></button>
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
