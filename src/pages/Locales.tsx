import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { supabase } from '@/lib/supabase'

interface Local {
  codigo: string
  nombre: string | null
}

export default function Locales() {
  const [locales, setLocales] = useState<Local[]>([])
  const [codigo, setCodigo] = useState('')
  const [nombre, setNombre] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    const { data } = await supabase.from('locales').select('codigo,nombre').order('codigo')
    setLocales((data as Local[]) ?? [])
    setCargando(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  async function agregar(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    const cod = codigo.trim().toUpperCase()
    if (!cod) return
    setBusy(true); setError(null)
    const { error } = await supabase.from('locales').insert({ codigo: cod, nombre: nombre.trim() || null })
    setBusy(false)
    if (error) { setError(error.message); return }
    setCodigo(''); setNombre(''); await cargar()
  }

  async function borrar(cod: string) {
    if (!supabase) return
    const { error } = await supabase.from('locales').delete().eq('codigo', cod)
    if (error) { setError(error.message); return }
    await cargar()
  }

  return (
    <Layout>
      <BackButton />
      <header className="mb-5 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Locales</h1>
        <p className="mt-1 text-sm text-sub">ABM de locales/sucursales del sistema.</p>
      </header>

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      <form onSubmit={agregar} className="mb-4 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-surface p-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-sub">Código (como en el Excel)</span>
          <input value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} placeholder="VCPD" className="w-28 rounded-lg border border-line bg-surface2 px-2 py-1.5 text-sm uppercase text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40" required />
        </label>
        <label className="block flex-1">
          <span className="mb-1 block text-xs font-medium text-sub">Nombre (opcional)</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Sucursal Centro" className="w-full rounded-lg border border-line bg-surface2 px-2 py-1.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40" />
        </label>
        <button type="submit" disabled={busy} className="btn-press inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          <Plus size={15} aria-hidden /> Agregar
        </button>
      </form>

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sub">
          <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando…
        </div>
      ) : locales.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-sub">Todavía no hay locales. Agregá el primero arriba.</p>
      ) : (
        <div className="flex flex-wrap gap-2 rounded-2xl border border-line bg-surface p-4">
          {locales.map((l) => (
            <span key={l.codigo} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface2 py-1 pl-3 pr-1.5 text-sm text-ink">
              <span className="font-medium">{l.codigo}</span>
              {l.nombre && <span className="text-xs text-sub">· {l.nombre}</span>}
              <button onClick={() => setConfirm({ message: `¿Borrar el local ${l.codigo}? Los usuarios que lo tengan quedarán sin local asignado.`, onConfirm: () => void borrar(l.codigo) })} aria-label={`Borrar ${l.codigo}`} className="rounded-full p-0.5 text-sub hover:bg-brand-600/20 hover:text-brand-400">
                <Trash2 size={13} aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
      <ConfirmDialog open={!!confirm} message={confirm?.message ?? ''} onCancel={() => setConfirm(null)} onConfirm={() => { confirm?.onConfirm(); setConfirm(null) }} />
    </Layout>
  )
}
