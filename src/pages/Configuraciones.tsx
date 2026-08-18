import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  ShieldCheck,
  UserCheck,
  UserX,
  Ban,
  RotateCcw,
  SlidersHorizontal,
  Loader2,
  Check,
  X,
  Plus,
  Trash2,
  Store,
  KeyRound,
  Copy,
  UserRound,
  AlertTriangle,
  ListChecks,
  ChevronRight,
  Image as ImageIcon,
} from 'lucide-react'
import Layout from '@/components/Layout'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

interface UsuarioRow {
  id: string
  email: string
  nombre: string
  rol: string
  estado: 'pendiente' | 'aprobado' | 'rechazado' | 'desactivado'
  created_at: string
  motivo_rechazo: string | null
  local: string | null
}
interface Permiso {
  clave: string
  modulo: string
  accion: string
  label: string
  orden: number
}
interface Local {
  codigo: string
  nombre: string | null
}
interface Rol {
  codigo: string
  nombre: string
  es_admin: boolean
  protegido: boolean
}
interface Empleado {
  id: string
  legajo: string | null
  nombre: string
}

const ESTADO_STYLE: Record<string, string> = {
  aprobado: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  pendiente: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  rechazado: 'bg-brand-600/15 text-brand-400 border-brand-600/30',
  desactivado: 'bg-surface2 text-sub border-line2',
}

function fmtFecha(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short' }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

export default function Configuraciones() {
  const { perfil } = useAuth()
  const [usuarios, setUsuarios] = useState<UsuarioRow[]>([])
  const [permisos, setPermisos] = useState<Permiso[]>([])
  const [rolPermisos, setRolPermisos] = useState<Set<string>>(new Set())
  const [locales, setLocales] = useState<Local[]>([])
  const [roles, setRoles] = useState<Rol[]>([])
  const [empleados, setEmpleados] = useState<Empleado[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [gestion, setGestion] = useState<UsuarioRow | null>(null)
  const [pwUser, setPwUser] = useState<UsuarioRow | null>(null)
  const [rolGestion, setRolGestion] = useState<Rol | null>(null)

  const cargar = useCallback(async () => {
    if (!supabase) {
      setCargando(false)
      return
    }
    setCargando(true)
    setError(null)
    const [u, p, rp, lc, rl, em] = await Promise.all([
      supabase.from('usuarios').select('id,email,nombre,rol,estado,created_at,motivo_rechazo,local').order('nombre', { ascending: true }),
      supabase.from('permisos').select('clave,modulo,accion,label,orden').order('orden'),
      supabase.from('rol_permisos').select('rol,permiso_clave'),
      supabase.from('locales').select('codigo,nombre').order('codigo', { ascending: true }),
      supabase.from('roles').select('codigo,nombre,es_admin,protegido').order('orden', { ascending: true }),
      supabase.from('empleados').select('id,legajo,nombre').order('nombre', { ascending: true }),
    ])
    if (u.error) setError(u.error.message)
    setUsuarios((u.data as UsuarioRow[]) ?? [])
    setPermisos((p.data as Permiso[]) ?? [])
    setRolPermisos(
      new Set(((rp.data as { rol: string; permiso_clave: string }[]) ?? []).map((r) => `${r.rol}|${r.permiso_clave}`)),
    )
    setLocales((lc.data as Local[]) ?? [])
    setRoles((rl.data as Rol[]) ?? [])
    setEmpleados((em.data as Empleado[]) ?? [])
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const pendientes = useMemo(() => usuarios.filter((u) => u.estado === 'pendiente'), [usuarios])

  async function actualizar(id: string, patch: Partial<UsuarioRow>) {
    if (!supabase) return
    const payload: Record<string, unknown> = { ...patch }
    if (patch.estado && patch.estado !== 'pendiente') {
      payload.revisado_at = new Date().toISOString()
      payload.revisado_por = perfil?.id ?? null
    }
    const { error } = await supabase.from('usuarios').update(payload).eq('id', id)
    if (error) {
      setError(error.message)
      return
    }
    await cargar()
  }

  async function notificar(tipo: 'aprobado' | 'rechazado', u: UsuarioRow, motivo?: string) {
    if (!supabase) return
    try {
      await supabase.functions.invoke('notificar-acceso', {
        body: { tipo, nombre: u.nombre, email: u.email, motivo: motivo ?? '' },
      })
    } catch {
      /* email opcional */
    }
  }
  async function aprobar(u: UsuarioRow, rol: string) {
    await actualizar(u.id, { estado: 'aprobado', rol, motivo_rechazo: null })
    await notificar('aprobado', u)
  }
  async function rechazar(u: UsuarioRow) {
    const motivo = window.prompt('Motivo del rechazo (opcional):') ?? ''
    await actualizar(u.id, { estado: 'rechazado', motivo_rechazo: motivo.trim() || null })
    await notificar('rechazado', u, motivo.trim() || undefined)
  }

  if (cargando) {
    return (
      <Layout>
        <div className="flex items-center justify-center gap-2 py-20 text-sub">
          <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando configuración…
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-sub transition duration-250 hover:text-ink"
      >
        <ArrowLeft size={15} aria-hidden /> Menú
      </Link>

      <div className="mb-6 flex items-center gap-3">
        <div className="rounded-xl border border-brand-600/40 bg-brand-600/15 p-3 text-brand-500">
          <ShieldCheck size={26} aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Configuraciones</h1>
          <p className="text-sm text-sub">Usuarios, roles y permisos de la PWA.</p>
        </div>
      </div>

      {error && (
        <p role="alert" aria-live="polite" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
          {error}
        </p>
      )}

      {/* Solicitudes pendientes */}
      {pendientes.length > 0 && (
        <section className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="mb-3 flex items-center gap-2 font-display font-semibold text-amber-300">
            <AlertTriangle size={18} aria-hidden /> Solicitudes pendientes: {pendientes.length}
          </div>
          <div className="space-y-3">
            {pendientes.map((u) => (
              <SolicitudCard key={u.id} u={u} roles={roles} onAprobar={aprobar} onRechazar={rechazar} />
            ))}
          </div>
        </section>
      )}

      {/* Encuestas */}
      <Link
        to="/encuestas"
        className="mb-6 flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-soft transition duration-250 hover:border-line2"
      >
        <div className="rounded-xl border p-3" style={{ color: '#f59e0b', backgroundColor: '#f59e0b24', borderColor: '#f59e0b40' }}>
          <ListChecks size={22} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display font-semibold text-ink">Encuestas</div>
          <p className="text-sm text-sub">Configurar preguntas y tipos de respuesta (estrellas, Sí/No, texto…).</p>
        </div>
        <ChevronRight size={18} className="shrink-0 text-sub" aria-hidden />
      </Link>

      {/* Editor de banner */}
      <Link
        to="/banner"
        className="mb-6 flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-soft transition duration-250 hover:border-line2"
      >
        <div className="rounded-xl border p-3" style={{ color: '#0ea5e9', backgroundColor: '#0ea5e924', borderColor: '#0ea5e940' }}>
          <ImageIcon size={22} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display font-semibold text-ink">Banner del menú</div>
          <p className="text-sm text-sub">Crear y personalizar el banner: imágenes, colores, textos y botón.</p>
        </div>
        <ChevronRight size={18} className="shrink-0 text-sub" aria-hidden />
      </Link>

      {/* Roles y permisos */}
      <SeccionRoles roles={roles} onReload={cargar} onPermisos={setRolGestion} />

      {/* Catálogo de locales */}
      <SeccionLocales locales={locales} onReload={cargar} />

      {/* Empleados */}
      <SeccionEmpleados empleados={empleados} onReload={cargar} />

      {/* Listado de usuarios */}
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
        <div className="border-b border-line px-4 py-3 font-display font-semibold text-ink">
          Usuarios ({usuarios.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-surface2 text-left text-sub">
                <th className="px-3 py-2.5 font-medium">Nombre</th>
                <th className="hidden px-3 py-2.5 font-medium md:table-cell">Email</th>
                <th className="px-3 py-2.5 font-medium">Rol</th>
                <th className="px-3 py-2.5 font-medium">Local/Área</th>
                <th className="px-3 py-2.5 font-medium">Estado</th>
                <th className="hidden px-3 py-2.5 font-medium lg:table-cell">Alta</th>
                <th className="px-3 py-2.5 text-right font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => {
                const esYo = u.id === perfil?.id
                const rolAdmin = roles.find((r) => r.codigo === u.rol)?.es_admin ?? false
                return (
                  <tr key={u.id} className="border-t border-line align-middle">
                    <td className="px-3 py-2.5 font-medium text-ink">
                      {u.nombre}
                      <span className="block max-w-[160px] truncate text-xs font-normal text-sub md:hidden" title={u.email}>
                        {u.email}
                      </span>
                    </td>
                    <td className="hidden max-w-[220px] truncate px-3 py-2.5 text-sub md:table-cell" title={u.email}>
                      {u.email}
                    </td>
                    <td className="px-3 py-2.5">
                      <select
                        value={u.rol}
                        disabled={esYo}
                        onChange={(e) => actualizar(u.id, { rol: e.target.value })}
                        className="rounded-lg border border-line bg-surface2 px-2 py-1 text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-50"
                        aria-label={`Rol de ${u.nombre}`}
                      >
                        {roles.map((r) => (
                          <option key={r.codigo} value={r.codigo}>{r.nombre}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2.5">
                      <select
                        value={u.local ?? ''}
                        onChange={(e) => actualizar(u.id, { local: e.target.value || null })}
                        className="rounded-lg border border-line bg-surface2 px-2 py-1 text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                        aria-label={`Local/Área de ${u.nombre}`}
                      >
                        <option value="">—</option>
                        {locales.map((l) => (
                          <option key={l.codigo} value={l.codigo}>
                            {l.codigo}
                            {l.nombre ? ` · ${l.nombre}` : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${ESTADO_STYLE[u.estado] ?? ''}`}>
                        {u.estado}
                      </span>
                    </td>
                    <td className="hidden px-3 py-2.5 text-sub lg:table-cell">{fmtFecha(u.created_at)}</td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        {u.estado === 'aprobado' && !esYo && (
                          <button
                            onClick={() => actualizar(u.id, { estado: 'desactivado' })}
                            className="btn-press rounded-lg border border-line bg-surface2 p-1.5 text-sub hover:text-ink"
                            title="Desactivar"
                            aria-label={`Desactivar ${u.nombre}`}
                          >
                            <Ban size={15} aria-hidden />
                          </button>
                        )}
                        {(u.estado === 'desactivado' || u.estado === 'rechazado') && (
                          <button
                            onClick={() => actualizar(u.id, { estado: 'aprobado', motivo_rechazo: null })}
                            className="btn-press rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-1.5 text-emerald-400"
                            title="Reactivar"
                            aria-label={`Reactivar ${u.nombre}`}
                          >
                            <RotateCcw size={15} aria-hidden />
                          </button>
                        )}
                        <button
                          onClick={() => setPwUser(u)}
                          className="btn-press rounded-lg border border-line bg-surface2 p-1.5 text-ink hover:bg-line"
                          title="Cambiar contraseña"
                          aria-label={`Cambiar contraseña de ${u.nombre}`}
                        >
                          <KeyRound size={15} aria-hidden />
                        </button>
                        <button
                          onClick={() => setGestion(u)}
                          disabled={rolAdmin}
                          className="btn-press rounded-lg border border-line bg-surface2 p-1.5 text-ink hover:bg-line disabled:opacity-40"
                          title={rolAdmin ? 'Este rol tiene acceso total' : 'Permisos extra de este usuario'}
                          aria-label={`Permisos de ${u.nombre}`}
                        >
                          <SlidersHorizontal size={15} aria-hidden />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {gestion && (
        <PermisosModal
          usuario={gestion}
          permisos={permisos}
          rolPermisos={rolPermisos}
          onClose={() => setGestion(null)}
        />
      )}

      {pwUser && <PasswordModal usuario={pwUser} onClose={() => setPwUser(null)} />}

      {rolGestion && (
        <RolPermisosModal
          rol={rolGestion}
          permisos={permisos}
          onClose={() => setRolGestion(null)}
          onSaved={async () => {
            setRolGestion(null)
            await cargar()
          }}
        />
      )}
    </Layout>
  )
}

function SeccionEmpleados({ empleados, onReload }: { empleados: Empleado[]; onReload: () => Promise<void> }) {
  const [legajo, setLegajo] = useState('')
  const [nombre, setNombre] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function agregar(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (!nombre.trim()) {
      setError('Poné el nombre completo.')
      return
    }
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('empleados').insert({ legajo: legajo.trim() || null, nombre: nombre.trim() })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    setLegajo('')
    setNombre('')
    await onReload()
  }

  async function borrar(id: string, nom: string) {
    if (!supabase) return
    if (!window.confirm(`¿Borrar al empleado "${nom}"?`)) return
    const { error } = await supabase.from('empleados').delete().eq('id', id)
    if (error) {
      setError(error.message)
      return
    }
    await onReload()
  }

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3 font-display font-semibold text-ink">
        <UserRound size={18} aria-hidden /> Empleados ({empleados.length})
      </div>
      <form onSubmit={agregar} className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3">
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
      {error && <p className="px-4 py-2 text-sm text-brand-400">{error}</p>}
      {empleados.length === 0 ? (
        <p className="px-4 py-4 text-sm text-sub">Todavía no hay empleados. Agregá el primero arriba.</p>
      ) : (
        <div className="divide-y divide-line/70">
          {empleados.map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-4 py-2.5">
              {e.legajo && <span className="rounded-full bg-line px-2 py-0.5 text-[11px] font-semibold text-sub">#{e.legajo}</span>}
              <span className="flex-1 font-medium text-ink">{e.nombre}</span>
              <button onClick={() => borrar(e.id, e.nombre)} aria-label={`Borrar ${e.nombre}`} className="btn-press rounded-lg border border-brand-600/30 bg-brand-600/10 p-1.5 text-brand-400 hover:bg-brand-600/20">
                <Trash2 size={13} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SeccionRoles({
  roles,
  onReload,
  onPermisos,
}: {
  roles: Rol[]
  onReload: () => Promise<void>
  onPermisos: (r: Rol) => void
}) {
  const [nombre, setNombre] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function codigoDe(n: string) {
    return n
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
  }

  async function agregar(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    const cod = codigoDe(nombre)
    if (!cod) {
      setError('Poné un nombre válido.')
      return
    }
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('roles').insert({ codigo: cod, nombre: nombre.trim() })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    setNombre('')
    await onReload()
  }

  async function borrar(r: Rol) {
    if (!supabase) return
    if (!window.confirm(`¿Borrar el rol "${r.nombre}"? Los usuarios que lo tengan pasarán a "Usuario".`)) return
    const { error } = await supabase.from('roles').delete().eq('codigo', r.codigo)
    if (error) {
      setError(error.message)
      return
    }
    await onReload()
  }

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3 font-display font-semibold text-ink">
        <ShieldCheck size={18} aria-hidden /> Roles ({roles.length})
      </div>
      <form onSubmit={agregar} className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3">
        <label className="block flex-1">
          <span className="mb-1 block text-xs font-medium text-sub">Nuevo rol</span>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: Supervisor, Depósito, Cajero…"
            className="w-full rounded-lg border border-line bg-surface2 px-2 py-1.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          />
        </label>
        <button type="submit" disabled={busy} className="btn-press inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          <Plus size={15} aria-hidden /> Crear rol
        </button>
      </form>
      {error && <p className="px-4 py-2 text-sm text-brand-400">{error}</p>}
      <div className="divide-y divide-line/70">
        {roles.map((r) => (
          <div key={r.codigo} className="flex items-center gap-3 px-4 py-2.5">
            <span className="flex-1 font-medium text-ink">
              {r.nombre}
              {r.es_admin && <span className="ml-2 rounded-full bg-brand-600/15 px-2 py-0.5 text-[11px] font-medium text-brand-400">acceso total</span>}
            </span>
            {!r.es_admin && (
              <button
                onClick={() => onPermisos(r)}
                className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-2.5 py-1 text-xs font-medium text-ink hover:bg-line"
              >
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
  )
}

function RolPermisosModal({
  rol,
  permisos,
  onClose,
  onSaved,
}: {
  rol: Rol
  permisos: Permiso[]
  onClose: () => void
  onSaved: () => void
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
    return () => {
      activo = false
    }
  }, [rol.codigo])

  const grupos = useMemo(() => {
    const m = new Map<string, Permiso[]>()
    for (const p of permisos) {
      const arr = m.get(p.modulo) ?? []
      arr.push(p)
      m.set(p.modulo, arr)
    }
    return Array.from(m.entries())
  }, [permisos])

  function toggle(clave: string) {
    setSel((s) => {
      const n = new Set(s)
      if (n.has(clave)) n.delete(clave)
      else n.add(clave)
      return n
    })
  }
  function setTodos(v: boolean) {
    setSel(v ? new Set(permisos.map((p) => p.clave)) : new Set())
  }

  async function guardar() {
    if (!supabase) return
    setGuardando(true)
    setError(null)
    // Reemplaza el set de permisos del rol
    const { error: e1 } = await supabase.from('rol_permisos').delete().eq('rol', rol.codigo)
    if (e1) {
      setError(e1.message)
      setGuardando(false)
      return
    }
    const filas = Array.from(sel).map((permiso_clave) => ({ rol: rol.codigo, permiso_clave }))
    if (filas.length) {
      const { error: e2 } = await supabase.from('rol_permisos').insert(filas)
      if (e2) {
        setError(e2.message)
        setGuardando(false)
        return
      }
    }
    setGuardando(false)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-soft-lg sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="font-display font-semibold text-ink">Permisos del rol</h2>
            <p className="truncate text-xs text-sub">{rol.nombre}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-sub hover:bg-line hover:text-ink">
            <X size={18} aria-hidden />
          </button>
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

function PasswordModal({ usuario, onClose }: { usuario: UsuarioRow; onClose: () => void }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  function generar() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
    let s = ''
    for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)]
    setPw(s)
  }

  async function guardar() {
    if (!supabase) return
    if (pw.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.')
      return
    }
    setBusy(true)
    setError(null)
    const { data, error } = await supabase.functions.invoke('admin-set-password', {
      body: { userId: usuario.id, password: pw },
    })
    setBusy(false)
    const res = (data as { ok?: boolean; error?: string } | null) ?? null
    if (error || !res?.ok) {
      setError(error?.message ?? res?.error ?? 'No se pudo cambiar la contraseña.')
      return
    }
    setOk(true)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={() => !busy && onClose()}>
      <div className="w-full max-w-md rounded-t-2xl border border-line bg-surface shadow-soft-lg sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="font-display font-semibold text-ink">Cambiar contraseña</h2>
            <p className="truncate text-xs text-sub">{usuario.nombre} · {usuario.email}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-sub hover:bg-line hover:text-ink">
            <X size={18} aria-hidden />
          </button>
        </div>

        {ok ? (
          <div className="space-y-3 p-4">
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">
              <Check size={16} aria-hidden /> Contraseña actualizada.
            </div>
            <p className="text-sm text-sub">Pasale esta contraseña al usuario:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-ink">{pw}</code>
              <button
                onClick={() => navigator.clipboard?.writeText(pw)}
                className="btn-press rounded-lg border border-line bg-surface2 p-2 text-sub hover:text-ink"
                title="Copiar"
              >
                <Copy size={15} aria-hidden />
              </button>
            </div>
            <button onClick={onClose} className="btn-press w-full rounded-xl bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700">
              Listo
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-3 p-4">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-ink">Nueva contraseña</span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    autoComplete="off"
                    className="w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-ink outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40"
                  />
                  <button onClick={generar} className="btn-press shrink-0 rounded-lg border border-line bg-surface2 px-3 py-2 text-xs font-medium text-ink hover:bg-line">
                    Generar
                  </button>
                </div>
              </label>
              {error && <p className="text-sm text-brand-400">{error}</p>}
              <p className="text-xs text-sub">La contraseña se cambia al instante. El usuario podrá entrar con la nueva.</p>
            </div>
            <div className="flex gap-2 border-t border-line px-4 py-3">
              <button
                onClick={guardar}
                disabled={busy || pw.length < 6}
                className="btn-press inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <KeyRound size={16} aria-hidden />}
                {busy ? 'Cambiando…' : 'Cambiar contraseña'}
              </button>
              <button onClick={onClose} disabled={busy} className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2.5 text-sm font-medium text-ink hover:bg-line disabled:opacity-50">
                Cancelar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SeccionLocales({ locales, onReload }: { locales: Local[]; onReload: () => Promise<void> }) {
  const [codigo, setCodigo] = useState('')
  const [nombre, setNombre] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function agregar(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    const cod = codigo.trim().toUpperCase()
    if (!cod) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('locales').insert({ codigo: cod, nombre: nombre.trim() || null })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    setCodigo('')
    setNombre('')
    await onReload()
  }

  async function borrar(cod: string) {
    if (!supabase) return
    if (!window.confirm(`¿Borrar el local ${cod}? Los usuarios que lo tengan quedarán sin local asignado.`)) return
    const { error } = await supabase.from('locales').delete().eq('codigo', cod)
    if (error) {
      setError(error.message)
      return
    }
    await onReload()
  }

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3 font-display font-semibold text-ink">
        <Store size={18} aria-hidden /> Locales ({locales.length})
      </div>
      <form onSubmit={agregar} className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-sub">Código (como en el Excel)</span>
          <input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            placeholder="VCPD"
            className="w-28 rounded-lg border border-line bg-surface2 px-2 py-1.5 text-sm uppercase text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            required
          />
        </label>
        <label className="block flex-1">
          <span className="mb-1 block text-xs font-medium text-sub">Nombre (opcional)</span>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: Sucursal Centro"
            className="w-full rounded-lg border border-line bg-surface2 px-2 py-1.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="btn-press inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          <Plus size={15} aria-hidden /> Agregar
        </button>
      </form>
      {error && <p className="px-4 py-2 text-sm text-brand-400">{error}</p>}
      {locales.length === 0 ? (
        <p className="px-4 py-4 text-sm text-sub">Todavía no hay locales. Agregá el primero arriba.</p>
      ) : (
        <div className="flex flex-wrap gap-2 p-4">
          {locales.map((l) => (
            <span key={l.codigo} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface2 py-1 pl-3 pr-1.5 text-sm text-ink">
              <span className="font-medium">{l.codigo}</span>
              {l.nombre && <span className="text-xs text-sub">· {l.nombre}</span>}
              <button
                onClick={() => borrar(l.codigo)}
                aria-label={`Borrar ${l.codigo}`}
                className="rounded-full p-0.5 text-sub hover:bg-brand-600/20 hover:text-brand-400"
              >
                <Trash2 size={13} aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function SolicitudCard({
  u,
  roles,
  onAprobar,
  onRechazar,
}: {
  u: UsuarioRow
  roles: Rol[]
  onAprobar: (u: UsuarioRow, rol: string) => Promise<void>
  onRechazar: (u: UsuarioRow) => Promise<void>
}) {
  const [rol, setRol] = useState<string>('usuario')
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium text-ink">{u.nombre}</p>
        <p className="truncate text-sm text-sub">{u.email} · {fmtFecha(u.created_at)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={rol}
          onChange={(e) => setRol(e.target.value)}
          className="rounded-lg border border-line bg-surface2 px-2 py-1.5 text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          aria-label="Rol al aprobar"
        >
          {roles.map((r) => (
            <option key={r.codigo} value={r.codigo}>{r.nombre}</option>
          ))}
        </select>
        <button
          onClick={async () => {
            setBusy(true)
            await onRechazar(u)
            setBusy(false)
          }}
          disabled={busy}
          className="btn-press inline-flex items-center gap-1 rounded-lg border border-line bg-surface2 px-3 py-1.5 text-xs font-medium text-sub hover:text-ink disabled:opacity-50"
        >
          <UserX size={14} aria-hidden /> Rechazar
        </button>
        <button
          onClick={async () => {
            setBusy(true)
            await onAprobar(u, rol)
            setBusy(false)
          }}
          disabled={busy}
          className="btn-press inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          <UserCheck size={14} aria-hidden /> Aprobar
        </button>
      </div>
    </div>
  )
}

function PermisosModal({
  usuario,
  permisos,
  rolPermisos,
  onClose,
}: {
  usuario: UsuarioRow
  permisos: Permiso[]
  rolPermisos: Set<string>
  onClose: () => void
}) {
  // estado efectivo por permiso para este usuario
  const [estado, setEstado] = useState<Record<string, boolean>>({})
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const defaultDe = useCallback(
    (clave: string) => rolPermisos.has(`${usuario.rol}|${clave}`),
    [rolPermisos, usuario.rol],
  )

  useEffect(() => {
    let activo = true
    ;(async () => {
      if (!supabase) return
      setCargando(true)
      const { data } = await supabase
        .from('usuario_permisos')
        .select('permiso_clave,efecto')
        .eq('usuario_id', usuario.id)
      if (!activo) return
      const overrides = new Map(
        ((data as { permiso_clave: string; efecto: string }[]) ?? []).map((r) => [r.permiso_clave, r.efecto === 'grant']),
      )
      const eff: Record<string, boolean> = {}
      for (const p of permisos) eff[p.clave] = overrides.has(p.clave) ? !!overrides.get(p.clave) : defaultDe(p.clave)
      setEstado(eff)
      setCargando(false)
    })()
    return () => {
      activo = false
    }
  }, [usuario.id, permisos, defaultDe])

  const grupos = useMemo(() => {
    const m = new Map<string, Permiso[]>()
    for (const p of permisos) {
      const arr = m.get(p.modulo) ?? []
      arr.push(p)
      m.set(p.modulo, arr)
    }
    return Array.from(m.entries())
  }, [permisos])

  function toggle(clave: string) {
    setEstado((s) => ({ ...s, [clave]: !s[clave] }))
  }
  function setTodos(v: boolean) {
    setEstado(() => Object.fromEntries(permisos.map((p) => [p.clave, v])))
  }

  async function guardar() {
    if (!supabase) return
    setGuardando(true)
    setError(null)
    // Diferencia contra el default del rol: si coincide, sin override; si difiere, grant/revoke.
    const upserts: { usuario_id: string; permiso_clave: string; efecto: 'grant' | 'revoke' }[] = []
    const borrar: string[] = []
    for (const p of permisos) {
      const deseado = !!estado[p.clave]
      const def = defaultDe(p.clave)
      if (deseado === def) borrar.push(p.clave)
      else upserts.push({ usuario_id: usuario.id, permiso_clave: p.clave, efecto: deseado ? 'grant' : 'revoke' })
    }
    if (borrar.length) {
      const { error: e1 } = await supabase
        .from('usuario_permisos')
        .delete()
        .eq('usuario_id', usuario.id)
        .in('permiso_clave', borrar)
      if (e1) {
        setError(e1.message)
        setGuardando(false)
        return
      }
    }
    if (upserts.length) {
      const { error: e2 } = await supabase
        .from('usuario_permisos')
        .upsert(upserts, { onConflict: 'usuario_id,permiso_clave' })
      if (e2) {
        setError(e2.message)
        setGuardando(false)
        return
      }
    }
    setGuardando(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-soft-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="font-display font-semibold text-ink">Permisos de {usuario.nombre}</h2>
            <p className="truncate text-xs text-sub">{usuario.email}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-sub hover:bg-line hover:text-ink">
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-line px-4 py-2">
          <button onClick={() => setTodos(true)} className="btn-press rounded-lg border border-line bg-surface2 px-2.5 py-1 text-xs text-ink hover:bg-line">
            Seleccionar todo
          </button>
          <button onClick={() => setTodos(false)} className="btn-press rounded-lg border border-line bg-surface2 px-2.5 py-1 text-xs text-ink hover:bg-line">
            Deseleccionar todo
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {cargando ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sub">
              <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando permisos…
            </div>
          ) : (
            <div className="space-y-4">
              {grupos.map(([modulo, items]) => (
                <div key={modulo}>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-sub">{modulo.replace('area_', 'Área: ')}</p>
                  <div className="divide-y divide-line/70 overflow-hidden rounded-xl border border-line">
                    {items.map((p) => (
                      <label key={p.clave} className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 hover:bg-surface2">
                        <span className="text-sm text-ink">{p.label}</span>
                        <input
                          type="checkbox"
                          checked={!!estado[p.clave]}
                          onChange={() => toggle(p.clave)}
                          className="h-4 w-4 accent-brand-600"
                        />
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
          <button
            onClick={guardar}
            disabled={guardando || cargando}
            className="btn-press inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {guardando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Check size={16} aria-hidden />}
            {guardando ? 'Guardando…' : 'Guardar cambios'}
          </button>
          <button onClick={onClose} className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2.5 text-sm font-medium text-ink hover:bg-line">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
