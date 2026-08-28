import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Loader2, Plus, Trash2, SlidersHorizontal, Check, X, ChevronRight } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import { supabase } from '@/lib/supabase'

interface Rol {
  codigo: string
  nombre: string
  es_admin: boolean
  protegido: boolean
}

export default function Roles() {
  const [roles, setRoles] = useState<Rol[]>([])
  const [nombre, setNombre] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [rolGestion, setRolGestion] = useState<Rol | null>(null)

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    const { data: rl } = await supabase.from('roles').select('codigo,nombre,es_admin,protegido').order('orden')
    setRoles((rl as Rol[]) ?? [])
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

interface AreaNode {
  id: number
  key: string
  name: string
  scope: string
  asignado: boolean
  actions: { key: string; label: string; has: boolean }[]
}

interface TreeNode {
  id: number
  key: string
  name: string
  has_scope: boolean
  areas: AreaNode[]
}

const SCOPE_OPCIONES = ['all', 'own', 'locales_asignados', 'polo52', 'none']

function RolPermisosModal({
  rol, onClose, onSaved,
}: {
  rol: Rol; onClose: () => void; onSaved: () => void
}) {
  const [tree, setTree] = useState<TreeNode[] | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [scopes, setScopes] = useState<Record<string, { scope: string; moduleId: number; submodId: number }>>({})
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
      const t = Array.isArray(data) ? (data as TreeNode[]) : null
      if (rpcErr || !t) {
        setError(rpcErr ? 'No se pudo leer el árbol (¿aplicaste los RPC actualizados?).' : null)
        setCargando(false)
        return
      }
      setTree(t)
      if (activo) {
        const s = new Set<string>()
        const sc: Record<string, { scope: string; moduleId: number; submodId: number }> = {}
        t.forEach((app) => {
          setAbierto((prev) => new Set(prev).add(`app_${app.id}`))
          for (const area of app.areas) {
            for (const a of area.actions) if (a.has) s.add(`${area.key}.${app.key}.${a.key}`)
            if (app.has_scope && area.scope && area.scope !== 'none') sc[`${area.id}:${app.id}`] = { scope: area.scope, moduleId: area.id, submodId: app.id }
          }
        })
        setSel(s); setScopes(sc)
        setCargando(false)
      }
    })()
    return () => { activo = false }
  }, [rol.codigo])

  function toggle(clave: string) {
    setSel((s) => { const n = new Set(s); n.has(clave) ? n.delete(clave) : n.add(clave); return n })
  }

  function toggleArea(app: TreeNode, area: AreaNode) {
    const claves = area.actions.map((a) => `${area.key}.${app.key}.${a.key}`)
    setSel((s) => {
      const n = new Set(s)
      const all = claves.every((c) => n.has(c))
      for (const c of claves) all ? n.delete(c) : n.add(c)
      return n
    })
  }

  function toggleSubmodulo(app: TreeNode) {
    const claves = app.areas.flatMap((area) => area.actions.map((a) => `${area.key}.${app.key}.${a.key}`))
    const n = new Set(sel)
    const all = claves.length > 0 && claves.every((c) => n.has(c))
    for (const c of claves) all ? n.delete(c) : n.add(c)
    setSel(n)
  }

  function toggleAbierto(key: string) {
    setAbierto((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  function setScope(moduleId: number, submodId: number, value: string) {
    const key = `${moduleId}:${submodId}`
    setScopes((p) => {
      const n = { ...p }
      if (value === 'none') delete n[key]
      else n[key] = { scope: value, moduleId, submodId }
      return n
    })
  }

  async function guardar() {
    if (!supabase) return
    setGuardando(true); setError(null)

    // construir payload para el RPC centralizado
    const permisosArr = Array.from(sel)
    const scopesObj: Record<string, string> = {}
    for (const key of Object.keys(scopes)) {
      scopesObj[key] = scopes[key].scope
    }

    const { error } = await supabase.rpc('guardar_permisos', {
      _rol: rol.codigo,
      _permisos: permisosArr,
      _scopes: scopesObj,
    })
    if (error) { setError(error.message); setGuardando(false); return }

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
            <p className="py-8 text-center text-sm text-sub">No hay datos. Revisá que hayas aplicado <code className="text-brand-400">rbac_area_submodule.sql</code> y los RPC actualizados.</p>
          ) : (
            <div className="space-y-2">
              {tree.map((app) => {
                const isOpen = abierto.has(`app_${app.id}`)
                const permisosApp = app.areas.flatMap((area) => area.actions.map((a) => `${area.key}.${app.key}.${a.key}`))
                const checkedApp = permisosApp.filter((c) => sel.has(c)).length
                const allApp = permisosApp.length > 0 && permisosApp.every((c) => sel.has(c))
                return (
                  <div key={app.id} className="overflow-hidden rounded-xl border border-line">
                    <div className="flex items-center gap-2 bg-surface2 px-3 py-2">
                      <button onClick={() => toggleAbierto(`app_${app.id}`)} className="flex flex-1 items-center gap-2 text-left">
                        <ChevronRight size={14} className={`shrink-0 text-sub transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                        <span className="flex-1 text-sm font-semibold text-ink">{app.name}</span>
                        <span className="text-[11px] tabular-nums text-sub">{checkedApp}/{permisosApp.length}</span>
                      </button>
                      {app.areas.length > 1 && (
                        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 pl-1 text-xs text-sub" title="Todas las áreas de esta app">
                          <input type="checkbox" checked={allApp} onChange={() => toggleSubmodulo(app)} className="h-3.5 w-3.5 accent-brand-600" />
                          Todas
                        </label>
                      )}
                    </div>
                    {isOpen && (
                      <div className="border-t border-line">
                        {app.areas.map((area, ai) => {
                          const claves = area.actions.map((a) => `${area.key}.${app.key}.${a.key}`)
                          const allOn = claves.every((c) => sel.has(c))
                          const someOn = claves.some((c) => sel.has(c))
                          const scopeVal = scopes[`${area.id}:${app.id}`]?.scope ?? 'none'
                          return (
                            <div key={`${ai}-${area.key}`} className="border-b border-line/60 px-3 py-2 last:border-b-0">
                              <div className="flex items-center justify-between gap-2">
                                <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-ink">
                                  <input type="checkbox" checked={allOn} onChange={() => toggleArea(app, area)} className="h-4 w-4 accent-brand-600" />
                                  <span className={`flex-1 ${someOn && !allOn ? 'text-amber-400' : ''}`}>{area.name}</span>
                                  <span className="shrink-0 text-[10px] font-medium text-sub" title="Aparece en el menú de esta área">
                                    {area.asignado ? 'en menú' : 'sin asignar'}
                                  </span>
                                </label>
                                {app.has_scope && (
                                  <select value={scopeVal} onChange={(e) => setScope(area.id, app.id, e.target.value)} className="rounded-lg border border-line bg-surface2 px-2 py-1 text-[11px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40">
                                    {SCOPE_OPCIONES.map((o) => <option key={o} value={o}>{o === 'none' ? 'Sin alcance' : o}</option>)}
                                  </select>
                                )}
                              </div>
                              {!allOn && (
                                <div className="mt-1.5 flex flex-wrap gap-1.5 pl-6">
                                  {area.actions.map((a) => {
                                    const clave = `${area.key}.${app.key}.${a.key}`
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
