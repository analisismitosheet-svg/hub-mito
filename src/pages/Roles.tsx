import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Loader2, Plus, Trash2, SlidersHorizontal, Check, X } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'

interface Rol {
  codigo: string
  nombre: string
  es_admin: boolean
  protegido: boolean
}
interface Permiso {
  clave: string
  modulo: string
  accion: string
  label: string
  orden: number
}

export default function Roles() {
  const [roles, setRoles] = useState<Rol[]>([])
  const [permisos, setPermisos] = useState<Permiso[]>([])
  const [nombre, setNombre] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [rolGestion, setRolGestion] = useState<Rol | null>(null)

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    const [rl, p] = await Promise.all([
      supabase.from('roles').select('codigo,nombre,es_admin,protegido').order('orden'),
      supabase.from('permisos').select('clave,modulo,accion,label,orden').order('orden'),
    ])
    setRoles((rl.data as Rol[]) ?? [])
    setPermisos((p.data as Permiso[]) ?? [])
    setCargando(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  function codigoDe(n: string) {
    return n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  }

  async function agregar(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    const cod = codigoDe(nombre)
    if (!cod) { setError('Poné un nombre válido.'); return }
    setBusy(true); setError(null)
    const { error } = await supabase.from('roles').insert({ codigo: cod, nombre: nombre.trim() })
    setBusy(false)
    if (error) { setError(error.message); return }
    setNombre(''); await cargar()
  }

  async function borrar(r: Rol) {
    if (!supabase) return
    if (!window.confirm(`¿Borrar el rol "${r.nombre}"? Los usuarios que lo tengan pasarán a "Usuario".`)) return
    const { error } = await supabase.from('roles').delete().eq('codigo', r.codigo)
    if (error) { setError(error.message); return }
    await cargar()
  }

  return (
    <Layout>
      <BackButton />
      <header className="mb-5 mt-2">
        <h1 className="font-display text-2xl font-semibold text-ink">Roles y permisos</h1>
        <p className="mt-1 text-sm text-sub">Crear roles y configurar sus permisos.</p>
      </header>

      {error && <p role="alert" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">{error}</p>}

      <form onSubmit={agregar} className="mb-4 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-surface p-4">
        <label className="block flex-1">
          <span className="mb-1 block text-xs font-medium text-sub">Nuevo rol</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Supervisor, Depósito, Cajero…" className="w-full rounded-lg border border-line bg-surface2 px-2 py-1.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40" />
        </label>
        <button type="submit" disabled={busy} className="btn-press inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          <Plus size={15} aria-hidden /> Crear rol
        </button>
      </form>

      {cargando ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sub">
          <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando…
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="divide-y divide-line/70">
            {roles.map((r) => (
              <div key={r.codigo} className="flex items-center gap-3 px-4 py-2.5">
                <span className="flex-1 font-medium text-ink">
                  {r.nombre}
                  {r.es_admin && <span className="ml-2 rounded-full bg-brand-600/15 px-2 py-0.5 text-[11px] font-medium text-brand-400">acceso total</span>}
                </span>
                {!r.es_admin && (
                  <button onClick={() => setRolGestion(r)} className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-2.5 py-1 text-xs font-medium text-ink hover:bg-line">
                    <SlidersHorizontal size={13} aria-hidden /> Permisos
                  </button>
                )}
                {!r.protegido && (
                  <button onClick={() => borrar(r)} aria-label={`Borrar rol ${r.nombre}`} className="btn-press rounded-lg border border-brand-600/30 bg-brand-600/10 p-1.5 text-brand-400 hover:bg-brand-600/20">
                    <Trash2 size={13} aria-hidden />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {rolGestion && (
        <RolPermisosModal
          rol={rolGestion}
          permisos={permisos}
          onClose={() => setRolGestion(null)}
          onSaved={async () => { setRolGestion(null); await cargar() }}
        />
      )}
    </Layout>
  )
}

function RolPermisosModal({
  rol, permisos, onClose, onSaved,
}: {
  rol: Rol; permisos: Permiso[]; onClose: () => void; onSaved: () => void
}) {
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let activo = true
    ;(async () => {
      if (!supabase) return
      const { data } = await supabase.from('rol_permisos').select('permiso_clave').eq('rol', rol.codigo)
      if (!activo) return
      setSel(new Set(((data as { permiso_clave: string }[]) ?? []).map((r) => r.permiso_clave)))
      setCargando(false)
    })()
    return () => { activo = false }
  }, [rol.codigo])

  const grupos = useMemo(() => {
    const m = new Map<string, Permiso[]>()
    for (const p of permisos) { const arr = m.get(p.modulo) ?? []; arr.push(p); m.set(p.modulo, arr) }
    return Array.from(m.entries())
  }, [permisos])

  function toggle(clave: string) { setSel((s) => { const n = new Set(s); if (n.has(clave)) n.delete(clave); else n.add(clave); return n }) }
  function setTodos(v: boolean) { setSel(v ? new Set(permisos.map((p) => p.clave)) : new Set()) }

  async function guardar() {
    if (!supabase) return
    setGuardando(true); setError(null)
    const { error: e1 } = await supabase.from('rol_permisos').delete().eq('rol', rol.codigo)
    if (e1) { setError(e1.message); setGuardando(false); return }
    const filas = Array.from(sel).map((permiso_clave) => ({ rol: rol.codigo, permiso_clave }))
    if (filas.length) { const { error: e2 } = await supabase.from('rol_permisos').insert(filas); if (e2) { setError(e2.message); setGuardando(false); return } }
    setGuardando(false); onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-soft-lg sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="font-display font-semibold text-ink">Permisos del rol</h2>
            <p className="truncate text-xs text-sub">{rol.nombre}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-sub hover:bg-line hover:text-ink"><X size={18} aria-hidden /></button>
        </div>
        <div className="flex items-center gap-2 border-b border-line px-4 py-2">
          <button onClick={() => setTodos(true)} className="btn-press rounded-lg border border-line bg-surface2 px-2.5 py-1 text-xs text-ink hover:bg-line">Seleccionar todo</button>
          <button onClick={() => setTodos(false)} className="btn-press rounded-lg border border-line bg-surface2 px-2.5 py-1 text-xs text-ink hover:bg-line">Deseleccionar todo</button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {cargando ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sub"><Loader2 size={18} className="animate-spin" aria-hidden /> Cargando…</div>
          ) : (
            <div className="space-y-4">
              {grupos.map(([modulo, items]) => (
                <div key={modulo}>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-sub">{modulo.replace('area_', 'Área: ')}</p>
                  <div className="divide-y divide-line/70 overflow-hidden rounded-xl border border-line">
                    {items.map((p) => (
                      <label key={p.clave} className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 hover:bg-surface2">
                        <span className="text-sm text-ink">{p.label}</span>
                        <input type="checkbox" checked={sel.has(p.clave)} onChange={() => toggle(p.clave)} className="h-4 w-4 accent-brand-600" />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {error && <p className="px-4 pb-2 text-sm text-brand-400">{error}</p>}
        <div className="flex gap-2 border-t border-line px-4 py-3">
          <button onClick={guardar} disabled={guardando || cargando} className="btn-press inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {guardando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Check size={16} aria-hidden />}
            {guardando ? 'Guardando…' : 'Guardar permisos'}
          </button>
          <button onClick={onClose} className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2.5 text-sm font-medium text-ink hover:bg-line">Cancelar</button>
        </div>
      </div>
    </div>
  )
}
