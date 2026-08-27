import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Loader2, Plus, Trash2, SlidersHorizontal, Check, X, ChevronRight } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'
import { AREAS } from '@/config/areas'

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
          onClose={() => setRolGestion(null)}
          onSaved={async () => { setRolGestion(null); await cargar() }}
        />
      )}
    </Layout>
  )
}

interface TreeNode {
  module: { key: string; name: string; icon: string | null }
  submodules: {
    id: number
    key: string
    name: string
    has_scope: boolean
    scope: string
    actions: { key: string; label: string; has: boolean }[]
  }[]
}

const SCOPE_OPCIONES = ['all', 'own', 'locales_asignados', 'polo52', 'none']

function RolPermisosModal({
  rol, onClose, onSaved,
}: {
  rol: Rol; onClose: () => void; onSaved: () => void
}) {
  const [tree, setTree] = useState<TreeNode[] | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [scopes, setScopes] = useState<Record<number, { scope: string; submodId: number }>>({})
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<Set<string>>(new Set())

  useEffect(() => {
    let activo = true
    ;(async () => {
      if (!supabase) return
      const { data, error: rpcErr } = await supabase.rpc('permisos_tree', { codigo: rol.codigo })
      if (!activo) return
      // el RPC devuelve un jsonb = arreglo de módulos
      const t = Array.isArray(data) ? (data as TreeNode[]) : null
      if (rpcErr || !t) {
        setError(rpcErr ? 'No se pudo leer el árbol (¿aplicaste rbac_dinamico_rpcs.sql?).' : null)
        setCargando(false)
        return
      }
      setTree(t)
      if (activo) {
        const s = new Set<string>()
        const sc: Record<number, { scope: string; submodId: number }> = {}
        for (const mod of t) {
          setAbierto((prev) => new Set(prev).add(mod.module.key))
          for (const sm of mod.submodules) {
            for (const a of sm.actions) if (a.has) s.add(`${mod.module.key}.${sm.key}.${a.key}`)
            if (sm.has_scope && sm.scope && sm.scope !== 'none') sc[sm.id] = { scope: sm.scope, submodId: sm.id }
          }
        }
        setSel(s); setScopes(sc)
        setCargando(false)
      }
    })()
    return () => { activo = false }
  }, [rol.codigo])

  function toggle(clave: string) {
    setSel((s) => { const n = new Set(s); n.has(clave) ? n.delete(clave) : n.add(clave); return n })
  }

  function toggleSubmodulo(modKey: string, sm: TreeNode['submodules'][number]) {
    const claves = sm.actions.map((a) => `${modKey}.${sm.key}.${a.key}`)
    setSel((s) => {
      const n = new Set(s)
      const all = claves.every((c) => n.has(c))
      for (const c of claves) all ? n.delete(c) : n.add(c)
      return n
    })
  }

  function toggleAbierto(key: string) {
    setAbierto((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  function setScope(smId: number, value: string) {
    setScopes((p) => {
      const n = { ...p }
      if (value === 'none') delete n[smId]
      else n[smId] = { scope: value, submodId: smId }
      return n
    })
  }

  async function guardar() {
    if (!supabase) return
    setGuardando(true); setError(null)

    // 1) permisos del rol (rol_permisos)
    const f = await supabase.from('rol_permisos').delete().eq('rol', rol.codigo)
    if (f.error) { setError(f.error.message); setGuardando(false); return }
    const filas = Array.from(sel).map((permiso_clave) => ({ rol: rol.codigo, permiso_clave }))
    if (filas.length) {
      const ins = await supabase.from('rol_permisos').insert(filas)
      if (ins.error) { setError(ins.error.message); setGuardando(false); return }
    }

    // 2) alcances (role_scope_settings)
    const limpiar = await supabase.from('role_scope_settings').delete().eq('role_codigo', rol.codigo)
    if (limpiar.error) { setError(limpiar.error.message); setGuardando(false); return }
    const scopeFilas = Object.entries(scopes).map(([, v]) => ({
      role_codigo: rol.codigo, submodule_id: v.submodId, scope_value: v.scope,
    }))
    if (scopeFilas.length) {
      const sIns = await supabase.from('role_scope_settings').insert(scopeFilas)
      if (sIns.error) { setError(sIns.error.message); setGuardando(false); return }
    }

    setGuardando(false); onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-soft-lg sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="font-display font-semibold text-ink">Permisos del rol</h2>
            <p className="truncate text-xs text-sub">{rol.nombre}{error ? ' · ' + error : ''}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-sub hover:bg-line hover:text-ink"><X size={18} aria-hidden /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {cargando ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sub"><Loader2 size={18} className="animate-spin" aria-hidden /> Cargando…</div>
          ) : !tree ? (
            <p className="py-8 text-center text-sm text-sub">No hay datos. Revisá que hayas aplicado <code className="text-brand-400">rbac_dinamico_schema.sql</code> y <code className="text-brand-400">rbac_dinamico_rpcs.sql</code>.</p>
          ) : (
            <div className="space-y-2">
              {tree.map((mod) => {
                const isOpen = abierto.has(mod.module.key)
                const permisosMod = mod.submodules.flatMap((sm) => sm.actions.map((a) => `${mod.module.key}.${sm.key}.${a.key}`))
                const checkedMod = permisosMod.filter((c) => sel.has(c)).length
                return (
                  <div key={mod.module.key} className="overflow-hidden rounded-xl border border-line">
                    <div className="flex items-center gap-2 bg-surface2 px-3 py-2">
                      <button onClick={() => toggleAbierto(mod.module.key)} className="flex flex-1 items-center gap-2 text-left">
                        <ChevronRight size={14} className={`shrink-0 text-sub transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                        <span className="flex-1 text-sm font-semibold text-ink">{mod.module.name}</span>
                        <span className="text-[11px] tabular-nums text-sub">{checkedMod}/{permisosMod.length}</span>
                      </button>
                    </div>
                    {isOpen && (
                      <div className="border-t border-line">
                        {mod.submodules.map((sm) => {
                          const claves = sm.actions.map((a) => `${mod.module.key}.${sm.key}.${a.key}`)
                          const allOn = claves.every((c) => sel.has(c))
                          const someOn = claves.some((c) => sel.has(c))
                          const scopeVal = scopes[sm.id]?.scope ?? 'none'
                          return (
                            <div key={sm.key} className="border-b border-line/60 px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
                                  <input type="checkbox" checked={allOn} onChange={() => toggleSubmodulo(mod.module.key, sm)} className="h-4 w-4 accent-brand-600" />
                                  <span className={someOn && !allOn ? 'text-amber-400' : ''}>{sm.name}</span>
                                </label>
                                {sm.has_scope && (
                                  <select value={scopeVal} onChange={(e) => setScope(sm.id, e.target.value)} className="rounded-lg border border-line bg-surface2 px-2 py-1 text-[11px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40">
                                    {SCOPE_OPCIONES.map((o) => <option key={o} value={o}>{o === 'none' ? 'Sin alcance' : o}</option>)}
                                  </select>
                                )}
                              </div>
                              {!allOn && (
                                <div className="mt-1.5 flex flex-wrap gap-1.5 pl-6">
                                  {sm.actions.map((a) => {
                                    const clave = `${mod.module.key}.${sm.key}.${a.key}`
                                    return (
                                      <button key={a.key} onClick={() => toggle(clave)} className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${sel.has(clave) ? 'border-brand-500/40 bg-brand-600/15 text-brand-300' : 'border-line bg-surface2 text-sub hover:text-ink'}`}>
                                        {a.label}
                                      </button>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
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
