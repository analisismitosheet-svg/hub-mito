import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Loader2, Plus, Trash2, SlidersHorizontal, Check, X, ChevronRight, MapPin } from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
import ConfirmDialog from '@/components/ConfirmDialog'
import { supabase } from '@/lib/supabase'
import {
  AREAS,
  APPS,
  cargarOverridesAreas,
  invalidarOverridesAreas,
  cargarAccionesArea,
  invalidarAccionesArea,
  ACCIONES_AREA,
  ACCIONES_AREA_LABEL,
  moduloDePermiso,
  type AccionArea,
} from '@/config/areas'

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
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)
  const [ubicacion, setUbicacion] = useState<Record<string, string[]>>({})
  const [acciones, setAcciones] = useState<Record<string, string[]>>({})
  const [cargandoUbi, setCargandoUbi] = useState(false)

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    const [rl, p] = await Promise.all([
      supabase.from('roles').select('codigo,nombre,es_admin,protegido').order('orden'),
      supabase.from('permisos').select('clave,modulo,accion,label,orden').order('orden'),
    ])
    setRoles((rl.data as Rol[]) ?? [])
    setPermisos((p.data as Permiso[]) ?? [])
    setCargando(false)
    // Cargar ubicación de menús y acciones por área
    setCargandoUbi(true)
    try {
      const [mapa, mapaAcciones] = await Promise.all([cargarOverridesAreas(), cargarAccionesArea()])
      setUbicacion(mapa)
      setAcciones(mapaAcciones)
    } finally {
      setCargandoUbi(false)
    }
  }, [])

  async function guardarUbicacion(appId: string, areaId: string, marcado: boolean) {
    if (!supabase) return
    const nuevo = { ...ubicacion }
    const arr = nuevo[appId] ?? []
    if (marcado) {
      if (!arr.includes(areaId)) nuevo[appId] = [...arr, areaId]
    } else {
      nuevo[appId] = arr.filter((a) => a !== areaId)
    }
    setUbicacion(nuevo)
    invalidarOverridesAreas()
    if (marcado) {
      await supabase.from('app_areas').insert({ app_id: appId, area_id: areaId })
    } else {
      await supabase.from('app_areas').delete().eq('app_id', appId).eq('area_id', areaId)
    }
  }

  // Guarda una acción permitida para (app, área). accionActiva: estado previo de esa acción.
  async function guardarAccion(appId: string, areaId: string, accion: AccionArea, activa: boolean) {
    if (!supabase) return
    const clave = `${appId}|${areaId}`
    const nuevo = { ...acciones }
    const arr = nuevo[clave] ?? []
    if (activa) {
      nuevo[clave] = arr.filter((a) => a !== accion)
    } else {
      if (!arr.includes(accion)) nuevo[clave] = [...arr, accion]
    }
    setAcciones(nuevo)
    invalidarAccionesArea()
    if (activa) {
      await supabase.from('app_area_acciones').delete().eq('app_id', appId).eq('area_id', areaId).eq('accion', accion)
    } else {
      await supabase.from('app_area_acciones').insert({ app_id: appId, area_id: areaId, accion })
    }
  }

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
                  <button onClick={() => setConfirm({ message: `¿Borrar el rol "${r.nombre}"? Los usuarios que lo tengan pasarán a "Usuario".`, onConfirm: () => void borrar(r) })} aria-label={`Borrar rol ${r.nombre}`} className="btn-press rounded-lg border border-brand-600/30 bg-brand-600/10 p-1.5 text-brand-400 hover:bg-brand-600/20">
                    <Trash2 size={13} aria-hidden />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ubicación de menús por área */}
      <section className="mt-8 rounded-2xl border border-line bg-surface p-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink"><MapPin size={15} className="text-brand-500" aria-hidden /> Ubicación de menús</h2>
        <p className="mb-3 text-xs text-sub">Tildá en qué áreas debe aparecer cada submenú y qué acciones se pueden hacer en cada una (ver, crear, editar, edición única, borrar). Sin tilde, se usa la ubicación y los permisos por rol por defecto.</p>
        {cargandoUbi ? (
          <div className="flex items-center gap-2 py-6 text-sub"><Loader2 size={16} className="animate-spin" aria-hidden /> Cargando...</div>
        ) : (
          <div className="space-y-2">
            {APPS.map((app) => {
              const areasMarcadas = ubicacion[app.id] ?? []
              const porDefecto = [app.areaId, ...(app.areaIds ?? [])]
              const modulo = moduloDePermiso(app.permiso)
              return (
                <details key={app.id} className="rounded-xl border border-line bg-surface2/60">
                  <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium text-ink">
                    <span className="flex-1 truncate">{app.title}</span>
                    <span className="text-[11px] text-sub/70">{areasMarcadas.length > 0 ? `${areasMarcadas.length} área(s)` : 'por defecto'}</span>
                    <ChevronRight size={13} aria-hidden className="text-sub" />
                  </summary>
                  <div className="grid grid-cols-1 gap-1 border-t border-line px-3 py-2 md:grid-cols-2">
                    {AREAS.map((area) => {
                      const marcado = areasMarcadas.includes(area.id)
                      const esDefecto = porDefecto.includes(area.id)
                      const accionesDeEsta = acciones[`${app.id}|${area.id}`] ?? []
                      return (
                        <div key={area.id} className="rounded-lg border border-line/60 bg-surface/40 px-2 py-1.5">
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink">
                            <input
                              type="checkbox"
                              checked={marcado}
                              onChange={(e) => void guardarUbicacion(app.id, area.id, e.target.checked)}
                              className="h-3.5 w-3.5 rounded border-line bg-surface2 accent-brand-600"
                            />
                            <span className="truncate font-medium">{area.name}</span>
                            {esDefecto && !marcado && <span className="text-[10px] text-sub/60">def</span>}
                          </label>
                          {marcado && modulo && (
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 border-t border-line/50 pl-5 pt-1">
                              {ACCIONES_AREA.map((acc) => {
                                const activa = accionesDeEsta.includes(acc)
                                return (
                                  <label key={acc} className="flex cursor-pointer items-center gap-1 text-[11px] text-sub">
                                    <input
                                      type="checkbox"
                                      checked={activa}
                                      onChange={(e) => void guardarAccion(app.id, area.id, acc, e.target.checked)}
                                      className="h-3 w-3 rounded border-line bg-surface2 accent-brand-600"
                                    />
                                    {ACCIONES_AREA_LABEL[acc]}
                                  </label>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </details>
              )
            })}
          </div>
        )}
      </section>

      {rolGestion && (
        <RolPermisosModal
          rol={rolGestion}
          permisos={permisos}
          onClose={() => setRolGestion(null)}
          onSaved={async () => { setRolGestion(null); await cargar() }}
        />
      )}
      <ConfirmDialog open={!!confirm} message={confirm?.message ?? ''} onCancel={() => setConfirm(null)} onConfirm={() => { confirm?.onConfirm(); setConfirm(null) }} />
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
  const [abierto, setAbierto] = useState<Set<string>>(new Set(AREAS.map((a) => a.id)))

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

  const areasPermisos = useMemo(() => {
    // Mapa exhaustive: clave -> areaId (o lista de areaIds si el permiso
    // pertenece a más de un grupo, ej. Facturación Fábrica: Mayorista y Polo 52)
    const permToArea: Record<string, string | string[]> = {
      'area_administracion.view': 'administracion',
      'area_tesoreria.view': 'tesoreria',
      'area_rrhh.view': 'rrhh',
      'area_mayorista.view': 'mayorista',
      'area_marketing.view': 'marketing',
      'area_compras.view': 'compras',
      'area_sistemas.view': 'sistemas',
      'area_locales.view': 'locales',
      'area_diseno.view': 'diseno',
      'area_deposito.view': 'deposito',
      'area_polo52.view': 'polo52',
      'area_arquitectura.view': 'arquitectura',
      'area_recepcion.view': 'recepcion',
      'area_mantenimiento.view': 'mantenimiento',
      'cuentas_amigos.view': 'tesoreria',
      'cuentas_amigos.create': 'tesoreria',
      'cuentas_amigos.edit': 'tesoreria',
      'cuentas_amigos.delete': 'tesoreria',
      'manuales.view': 'locales',
      'manuales.create': 'locales',
      'manuales.edit': 'locales',
      'manuales.delete': 'locales',
      'documentos.view': 'locales',
      'documentos.create': 'locales',
      'documentos.edit': 'locales',
      'documentos.delete': 'locales',
      'transferencias.view': 'compras',
      'transferencias.import': 'compras',
      'transferencias.ver_todo': 'compras',
      'mayorista.view': 'mayorista',
      'mayorista.import': 'mayorista',
      'mayorista.mark': 'mayorista',
      'mayorista.clientes.view': 'mayorista',
      'mayorista.clientes.create': 'mayorista',
      'mayorista.clientes.edit': 'mayorista',
      'mayorista.clientes.delete': 'mayorista',
      'mayorista.facturacion.view': ['mayorista', 'polo52'],
      'mayorista.facturacion.create': ['mayorista', 'polo52'],
      'mayorista.facturacion.edit': ['mayorista', 'polo52'],
      'mayorista.facturacion.delete': ['mayorista', 'polo52'],
      'mayorista.guias.view': 'mayorista',
      'mayorista.guias.create': 'mayorista',
      'mayorista.guias.edit': 'mayorista',
      'mayorista.guias.delete': 'mayorista',
      'mayorista.notas_credito.view': 'mayorista',
      'mayorista.notas_credito.create': 'mayorista',
      'mayorista.notas_credito.edit': 'mayorista',
      'mayorista.notas_credito.delete': 'mayorista',
      'mayorista.estadisticas.view': 'mayorista',
      'rrhh.novedades.view': 'rrhh',
      'rrhh.novedades.create': 'rrhh',
      'rrhh.novedades.edit': 'rrhh',
      'rrhh.novedades.delete': 'rrhh',
      'rrhh.empleados.view': 'rrhh',
      'rrhh.empleados.create': 'rrhh',
      'rrhh.empleados.edit': 'rrhh',
      'rrhh.empleados.delete': 'rrhh',
      'deposito.view': 'deposito',
      'deposito.import': 'deposito',
      'deposito.mark': 'deposito',
      'opiniones.view': 'locales',
      'opiniones.borrar': 'locales',
      'encuestas.gestionar': 'marketing',
      'banner.editar': 'marketing',
      'qr.regenerar': 'locales',
      'sectores.gestionar': 'locales',
    }

    const porArea = new Map<string, { area: typeof AREAS[number]; permisos: Permiso[] }>()
    const clavesVistas = new Map<string, Set<string>>()
    for (const area of AREAS) {
      porArea.set(area.id, { area, permisos: [] })
      clavesVistas.set(area.id, new Set())
    }

    for (const p of permisos) {
      if (!p || !p.clave) continue
      const targets = permToArea[p.clave]
      const destinos: string[] = Array.isArray(targets) ? targets : targets ? [targets] : []
      if (destinos.length === 0) {
        // Fallback: intentar deducir del módulo
        const fallback = permisos.find((x) => x.clave === p.clave)
        const mod = fallback?.modulo?.replace('area_', '') ?? '_otros'
        if (!porArea.has(mod)) { porArea.set(mod, { area: { id: mod, name: mod, icon: SlidersHorizontal, accent: 'text-gray-500', color: '#64748b' }, permisos: [] }); clavesVistas.set(mod, new Set()) }
        if (!clavesVistas.get(mod)!.has(p.clave)) { clavesVistas.get(mod)!.add(p.clave); porArea.get(mod)!.permisos.push(p) }
        continue
      }
      for (const areaId of destinos) {
        const bucket = porArea.get(areaId)
        if (!bucket) continue
        const vistos = clavesVistas.get(areaId)!
        // Evita duplicados: la misma clave no puede aparecer dos veces en el mismo área
        if (!vistos.has(p.clave)) { vistos.add(p.clave); bucket.permisos.push(p) }
      }
    }

    return Array.from(porArea.values())
      .filter((b) => b.permisos.length > 0)
      .sort((a, b) => a.area.name.localeCompare(b.area.name, 'es'))
  }, [permisos])

  function toggle(clave: string) { setSel((s) => { const n = new Set(s); if (n.has(clave)) n.delete(clave); else n.add(clave); return n }) }

  function toggleArea(claves: string[]) {
    setSel((s) => {
      const n = new Set(s)
      const allChecked = claves.every((c) => n.has(c))
      for (const c of claves) { allChecked ? n.delete(c) : n.add(c) }
      return n
    })
  }

  function toggleAbierto(areaId: string) {
    setAbierto((s) => { const n = new Set(s); if (n.has(areaId)) n.delete(areaId); else n.add(areaId); return n })
  }

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
            <div className="space-y-2">
              {areasPermisos.map(({ area, permisos: areaPerms }) => {
                const checked = areaPerms.filter((p) => sel.has(p.clave)).length
                const total = areaPerms.length
                const isOpen = abierto.has(area.id)
                const Icon = area.icon
                return (
                  <div key={area.id} className="overflow-hidden rounded-xl border border-line">
                    <div className="flex items-center gap-2 bg-surface2 px-3 py-2">
                      <button onClick={() => toggleAbierto(area.id)} className="flex flex-1 items-center gap-2 text-left">
                        <ChevronRight size={14} className={`shrink-0 text-sub transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                        <Icon size={15} style={{ color: area.color }} aria-hidden />
                        <span className="flex-1 text-sm font-semibold text-ink">{area.name}</span>
                        <span className="text-[11px] tabular-nums text-sub">{checked}/{total}</span>
                      </button>
                      <button onClick={() => toggleArea(areaPerms.map((p) => p.clave))} className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${checked === total && total > 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-line text-sub hover:text-ink'}`} title="Seleccionar/deseleccionar área">
                        {checked === total && total > 0 ? '✓' : '☐'}
                      </button>
                    </div>
                    {isOpen && (
                      <div className="divide-y divide-line/70 border-t border-line">
                        {areaPerms.map((p) => (
                          <label key={p.clave} className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 hover:bg-surface2">
                            <span className="text-sm text-ink">{p.label}</span>
                            <input type="checkbox" checked={sel.has(p.clave)} onChange={() => toggle(p.clave)} className="h-4 w-4 accent-brand-600" />
                          </label>
                        ))}
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
