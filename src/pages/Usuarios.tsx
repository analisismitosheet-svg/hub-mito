import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Loader2,
  Check,
  X,
  Ban,
  RotateCcw,
  SlidersHorizontal,
  KeyRound,
  UserCheck,
  UserX,
  AlertTriangle,
  Copy,
  Pencil,
  ChevronDown,
} from 'lucide-react'
import Layout from '@/components/Layout'
import BackButton from '@/components/BackButton'
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

const ESTADO_STYLE: Record<string, string> = {
  aprobado: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  pendiente: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  rechazado: 'bg-brand-600/15 text-brand-400 border-brand-600/30',
  desactivado: 'bg-surface2 text-sub border-line2',
}

function iniciales(nombre: string | null): string {
  if (!nombre) return '?'
  const p = nombre.replace(',', ' ').trim().split(/\s+/)
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).slice(0, 2).toUpperCase() || '?'
}

function fmtFecha(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short' }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

export default function Usuarios() {
  const { perfil } = useAuth()
  const [usuarios, setUsuarios] = useState<UsuarioRow[]>([])
  const [usuarioRoles, setUsuarioRoles] = useState<Map<string, string[]>>(new Map())
  const [permisos, setPermisos] = useState<Permiso[]>([])
  const [rolPermisos, setRolPermisos] = useState<Set<string>>(new Set())
  const [locales, setLocales] = useState<Local[]>([])
  const [roles, setRoles] = useState<Rol[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [gestion, setGestion] = useState<UsuarioRow | null>(null)
  const [pwUser, setPwUser] = useState<UsuarioRow | null>(null)
  const [editUser, setEditUser] = useState<UsuarioRow | null>(null)

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    setCargando(true)
    setError(null)
    const [u, p, rp, lc, rl, ur] = await Promise.all([
      supabase.from('usuarios').select('id,email,nombre,rol,estado,created_at,motivo_rechazo,local').order('nombre', { ascending: true }),
      supabase.from('permisos').select('clave,modulo,accion,label,orden').order('orden'),
      supabase.from('rol_permisos').select('rol,permiso_clave'),
      supabase.from('locales').select('codigo,nombre').order('codigo', { ascending: true }),
      supabase.from('roles').select('codigo,nombre,es_admin,protegido').order('orden', { ascending: true }),
      supabase.from('usuario_roles').select('usuario_id,rol_codigo'),
    ])
    if (u.error) setError(u.error.message)
    setUsuarios((u.data as UsuarioRow[]) ?? [])
    setPermisos((p.data as Permiso[]) ?? [])
    setRolPermisos(
      new Set(((rp.data as { rol: string; permiso_clave: string }[]) ?? []).map((r) => `${r.rol}|${r.permiso_clave}`)),
    )
    setLocales((lc.data as Local[]) ?? [])
    setRoles((rl.data as Rol[]) ?? [])

    const mapa = new Map<string, string[]>()
    for (const row of (ur.data as { usuario_id: string; rol_codigo: string }[]) ?? []) {
      const arr = mapa.get(row.usuario_id) ?? []
      arr.push(row.rol_codigo)
      mapa.set(row.usuario_id, arr)
    }
    setUsuarioRoles(mapa)
    setCargando(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  const pendientes = useMemo(() => usuarios.filter((u) => u.estado === 'pendiente'), [usuarios])

  async function actualizar(id: string, patch: Partial<UsuarioRow>) {
    if (!supabase) return
    const payload: Record<string, unknown> = { ...patch }
    if (patch.estado && patch.estado !== 'pendiente') {
      payload.revisado_at = new Date().toISOString()
      payload.revisado_por = perfil?.id ?? null
    }
    const { error } = await supabase.from('usuarios').update(payload).eq('id', id)
    if (error) { setError(error.message); return }
    await cargar()
  }

  async function notificar(tipo: 'aprobado' | 'rechazado', u: UsuarioRow, motivo?: string) {
    if (!supabase) return
    try {
      await supabase.functions.invoke('notificar-acceso', {
        body: { tipo, nombre: u.nombre, email: u.email, motivo: motivo ?? '' },
      })
    } catch { /* email opcional */ }
  }

  async function aprobar(u: UsuarioRow, rolesSeleccionados: string[]) {
    if (rolesSeleccionados.length === 0) { setError('Selecciona al menos un rol.'); return }
    await actualizar(u.id, { estado: 'aprobado', rol: rolesSeleccionados[0], motivo_rechazo: null })
    await supabase!.rpc('set_usuario_roles', { uid: u.id, roles_codes: rolesSeleccionados })
    await notificar('aprobado', u)
    await cargar()
  }

  async function rechazar(u: UsuarioRow) {
    const motivo = window.prompt('Motivo del rechazo (opcional):') ?? ''
    await actualizar(u.id, { estado: 'rechazado', motivo_rechazo: motivo.trim() || null })
    await notificar('rechazado', u, motivo.trim() || undefined)
  }

  function getUserRoles(uid: string): string[] {
    return usuarioRoles.get(uid) ?? []
  }

  function getRolNombre(codigo: string): string {
    return roles.find((r) => r.codigo === codigo)?.nombre ?? codigo
  }

  if (cargando) {
    return (
      <Layout>
        <div className="flex items-center justify-center gap-2 py-20 text-sub">
          <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando usuarios…
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <BackButton />

      <div className="mb-6 flex items-center gap-3">
        <div className="rounded-xl border border-brand-600/40 bg-brand-600/15 p-3 text-brand-500">
          <UserCheck size={26} aria-hidden />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Usuarios</h1>
          <p className="text-sm text-sub">Gestión de usuarios, aprobación de solicitudes y permisos.</p>
        </div>
      </div>

      {error && (
        <p role="alert" aria-live="polite" className="mb-4 rounded-xl border border-brand-600/30 bg-brand-600/10 p-3 text-sm text-brand-400">
          {error}
        </p>
      )}

      {pendientes.length > 0 && (
        <section className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="mb-3 flex items-center gap-2 font-display font-semibold text-amber-300">
            <AlertTriangle size={18} aria-hidden /> Solicitudes pendientes: {pendientes.length}
          </div>
          <div className="space-y-3">
            {pendientes.map((u) => (
              <SolicitudCard
                key={u.id}
                u={u}
                roles={roles}
                userRoles={getUserRoles(u.id)}
                onAprobar={aprobar}
                onRechazar={rechazar}
              />
            ))}
          </div>
        </section>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-ink">Usuarios <span className="text-sm font-normal text-sub">({usuarios.length})</span></h2>
      </div>

      <div className="rounded-2xl border border-line overflow-hidden">
        <table className="w-full text-[13px] leading-tight">
          <thead>
            <tr className="border-b border-line bg-zinc-800 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-300">
              <th className="w-[15%] px-2 py-2 whitespace-nowrap">Nombre</th>
              <th className="w-[25%] px-2 py-2 whitespace-nowrap">Email</th>
              <th className="w-[12%] px-2 py-2 whitespace-nowrap">Roles</th>
              <th className="w-[18%] px-2 py-2 whitespace-nowrap">Local/Área</th>
              <th className="w-[10%] px-2 py-2 whitespace-nowrap">Estado</th>
              <th className="w-[8%] px-2 py-2 whitespace-nowrap">Alta</th>
              <th className="w-[12%] px-2 py-2 text-right whitespace-nowrap">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/50 bg-surface">
            {usuarios.map((u) => {
              const esYo = u.id === perfil?.id
              const rolesUsuario = getUserRoles(u.id)
              const esAdmin = rolesUsuario.some((rc) => roles.find((r) => r.codigo === rc)?.es_admin)
              return (
                <tr key={u.id} className="transition hover:bg-line/20">
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-[10px] font-semibold text-amber-400">{iniciales(u.nombre)}</div>
                      <span className="truncate font-medium text-ink" title={u.nombre}>{u.nombre}</span>
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="block truncate text-sub" title={u.email}>{u.email}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-nowrap gap-0.5">
                      {rolesUsuario.length > 0 ? (
                        rolesUsuario.slice(0, 2).map((rc) => (
                          <span key={rc} className="inline-block whitespace-nowrap rounded-full border border-brand-600/30 bg-brand-600/10 px-1.5 py-px text-[9px] font-medium text-brand-400">
                            {getRolNombre(rc)}
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] text-sub/50">—</span>
                      )}
                      {rolesUsuario.length > 2 && (
                        <span className="inline-block whitespace-nowrap rounded-full border border-line bg-surface2 px-1.5 py-px text-[9px] font-medium text-sub">+{rolesUsuario.length - 2}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      value={u.local ?? ''}
                      onChange={(e) => actualizar(u.id, { local: e.target.value || null })}
                      className="w-full rounded border border-line bg-surface2 px-1.5 py-0.5 text-[11px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                      aria-label={`Local/Área de ${u.nombre}`}
                    >
                      <option value="">—</option>
                      {locales.map((l) => (
                        <option key={l.codigo} value={l.codigo}>{l.codigo}{l.nombre ? ` · ${l.nombre}` : ''}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-px text-[10px] font-medium ${ESTADO_STYLE[u.estado] ?? ''}`}>
                      {u.estado}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-[11px] text-sub whitespace-nowrap">{fmtFecha(u.created_at)}</td>
                  <td className="px-2 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      <button
                        onClick={() => setEditUser(u)}
                        className="rounded border border-line p-1 text-ink transition hover:bg-line"
                        title="Editar"
                        aria-label={`Editar ${u.nombre}`}
                      >
                        <Pencil size={12} aria-hidden />
                      </button>
                      {u.estado === 'aprobado' && !esYo && (
                        <button
                          onClick={() => actualizar(u.id, { estado: 'desactivado' })}
                          className="rounded border border-line p-1 text-sub transition hover:text-ink"
                          title="Desactivar"
                          aria-label={`Desactivar ${u.nombre}`}
                        >
                          <Ban size={12} aria-hidden />
                        </button>
                      )}
                      {(u.estado === 'desactivado' || u.estado === 'rechazado') && (
                        <button
                          onClick={() => actualizar(u.id, { estado: 'aprobado', motivo_rechazo: null })}
                          className="rounded border border-emerald-500/30 bg-emerald-500/10 p-1 text-emerald-400 transition"
                          title="Reactivar"
                          aria-label={`Reactivar ${u.nombre}`}
                        >
                          <RotateCcw size={12} aria-hidden />
                        </button>
                      )}
                      <button
                        onClick={() => setPwUser(u)}
                        className="rounded border border-line p-1 text-ink transition hover:bg-line"
                        title="Contraseña"
                        aria-label={`Contraseña de ${u.nombre}`}
                      >
                        <KeyRound size={12} aria-hidden />
                      </button>
                      <button
                        onClick={() => setGestion(u)}
                        disabled={esAdmin}
                        className="rounded border border-line p-1 text-ink transition hover:bg-line disabled:opacity-40"
                        title={esAdmin ? 'Acceso total' : 'Permisos'}
                        aria-label={`Permisos de ${u.nombre}`}
                      >
                        <SlidersHorizontal size={12} aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {gestion && (
        <PermisosModal
          usuario={gestion}
          permisos={permisos}
          rolPermisos={rolPermisos}
          userRoles={getUserRoles(gestion.id)}
          onClose={() => setGestion(null)}
        />
      )}

      {pwUser && <PasswordModal usuario={pwUser} onClose={() => setPwUser(null)} />}

      {editUser && (
        <EditarUsuarioModal
          usuario={editUser}
          roles={roles}
          locales={locales}
          userRoles={getUserRoles(editUser.id)}
          onClose={() => setEditUser(null)}
          onSaved={async () => { setEditUser(null); await cargar() }}
        />
      )}
    </Layout>
  )
}

function SolicitudCard({
  u,
  roles,
  userRoles,
  onAprobar,
  onRechazar,
}: {
  u: UsuarioRow
  roles: Rol[]
  userRoles: string[]
  onAprobar: (u: UsuarioRow, roles: string[]) => Promise<void>
  onRechazar: (u: UsuarioRow) => Promise<void>
}) {
  const [rolesSel, setRolesSel] = useState<string[]>(userRoles.length > 0 ? userRoles : ['usuario'])
  const [busy, setBusy] = useState(false)

  function toggleRol(codigo: string) {
    setRolesSel((prev) =>
      prev.includes(codigo) ? prev.filter((r) => r !== codigo) : [...prev, codigo],
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium text-ink">{u.nombre}</p>
        <p className="truncate text-sm text-sub">{u.email} · {fmtFecha(u.created_at)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {roles.map((r) => (
            <label
              key={r.codigo}
              className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                rolesSel.includes(r.codigo)
                  ? 'border-brand-600/30 bg-brand-600/10 text-brand-400'
                  : 'border-line bg-surface2 text-sub hover:bg-line'
              }`}
            >
              <input
                type="checkbox"
                checked={rolesSel.includes(r.codigo)}
                onChange={() => toggleRol(r.codigo)}
                className="sr-only"
              />
              {r.nombre}
            </label>
          ))}
        </div>
        <button
          onClick={async () => { setBusy(true); await onRechazar(u); setBusy(false) }}
          disabled={busy}
          className="btn-press inline-flex items-center gap-1 rounded-lg border border-line bg-surface2 px-3 py-1.5 text-xs font-medium text-sub hover:text-ink disabled:opacity-50"
        >
          <UserX size={14} aria-hidden /> Rechazar
        </button>
        <button
          onClick={async () => {
            if (rolesSel.length === 0) return
            setBusy(true)
            await onAprobar(u, rolesSel)
            setBusy(false)
          }}
          disabled={busy || rolesSel.length === 0}
          className="btn-press inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          <UserCheck size={14} aria-hidden /> Aprobar
        </button>
      </div>
    </div>
  )
}

function EditarUsuarioModal({
  usuario,
  roles,
  locales,
  userRoles,
  onClose,
  onSaved,
}: {
  usuario: UsuarioRow
  roles: Rol[]
  locales: Local[]
  userRoles: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const [rolesSel, setRolesSel] = useState<string[]>(userRoles)
  const [local, setLocal] = useState(usuario.local ?? '')
  const [estado, setEstado] = useState(usuario.estado)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setDropdownOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function toggleRol(codigo: string) {
    setRolesSel((prev) =>
      prev.includes(codigo) ? prev.filter((r) => r !== codigo) : [...prev, codigo],
    )
  }

  function removeRol(codigo: string) {
    setRolesSel((prev) => prev.filter((r) => r !== codigo))
  }

  async function guardar() {
    if (!supabase) return
    if (rolesSel.length === 0) { setError('Debe tener al menos un rol.'); return }
    setBusy(true)
    setError(null)

    const { error: e1 } = await supabase.from('usuarios').update({
      local: local || null,
      estado,
      rol: rolesSel[0],
    }).eq('id', usuario.id)

    if (e1) { setError(e1.message); setBusy(false); return }

    const { error: e2 } = await supabase.rpc('set_usuario_roles', { uid: usuario.id, roles_codes: rolesSel })
    if (e2) { setError(e2.message); setBusy(false); return }

    setBusy(false)
    onSaved()
  }

  function getRolNombre(codigo: string): string {
    return roles.find((r) => r.codigo === codigo)?.nombre ?? codigo
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={() => !busy && onClose()}>
      <div
        className="w-full max-w-md rounded-t-2xl border border-line bg-surface shadow-soft-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-display font-semibold text-ink">
              <Pencil size={16} aria-hidden /> Editar usuario
            </h2>
            <p className="truncate text-xs text-sub">{usuario.email}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-sub hover:bg-line hover:text-ink">
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {/* Email (read-only) */}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-sub">Email</span>
            <input
              value={usuario.email}
              disabled
              className="w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-sm text-sub/70 outline-none"
            />
          </label>

          {/* Roles */}
          <div>
            <span className="mb-1 block text-xs font-medium text-sub">Roles</span>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {rolesSel.map((rc) => (
                <span key={rc} className="inline-flex items-center gap-1 rounded-full border border-brand-600/30 bg-brand-600/10 px-2.5 py-1 text-xs font-medium text-brand-400">
                  {getRolNombre(rc)}
                  <button
                    type="button"
                    onClick={() => removeRol(rc)}
                    className="ml-0.5 rounded-full p-0.5 transition hover:bg-brand-600/20"
                    aria-label={`Quitar ${getRolNombre(rc)}`}
                  >
                    <X size={11} aria-hidden />
                  </button>
                </span>
              ))}
              {rolesSel.length === 0 && <span className="text-xs text-sub/50">Ningún rol seleccionado</span>}
            </div>
            <div ref={dropRef} className="relative">
              <button
                type="button"
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface2 px-3 py-2 text-xs font-medium text-ink transition hover:bg-line"
              >
                Seleccionar roles <ChevronDown size={13} aria-hidden />
              </button>
              {dropdownOpen && (
                <div className="absolute z-10 mt-1 w-full rounded-xl border border-line bg-surface shadow-lg">
                  <div className="max-h-48 overflow-y-auto p-1">
                    {roles.map((r) => (
                      <label
                        key={r.codigo}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-line/50"
                      >
                        <input
                          type="checkbox"
                          checked={rolesSel.includes(r.codigo)}
                          onChange={() => toggleRol(r.codigo)}
                          className="h-4 w-4 accent-brand-600"
                        />
                        <span className="text-ink">{r.nombre}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Local / Area */}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-sub">Local / Área</span>
            <select
              value={local}
              onChange={(e) => setLocal(e.target.value)}
              className="w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            >
              <option value="">—</option>
              {locales.map((l) => (
                <option key={l.codigo} value={l.codigo}>{l.codigo}{l.nombre ? ` · ${l.nombre}` : ''}</option>
              ))}
            </select>
          </label>

          {/* Estado */}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-sub">Estado</span>
            <select
              value={estado}
              onChange={(e) => setEstado(e.target.value as typeof estado)}
              className="w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            >
              <option value="aprobado">Aprobado</option>
              <option value="pendiente">Pendiente</option>
              <option value="rechazado">Rechazado</option>
              <option value="desactivado">Desactivado</option>
            </select>
          </label>

          {error && <p className="text-sm text-brand-400">{error}</p>}
        </div>

        <div className="flex gap-2 border-t border-line px-4 py-3">
          <button
            onClick={guardar}
            disabled={busy || rolesSel.length === 0}
            className="btn-press inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Check size={16} aria-hidden />}
            {busy ? 'Guardando...' : 'Guardar cambios'}
          </button>
          <button onClick={onClose} disabled={busy} className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2.5 text-sm font-medium text-ink hover:bg-line disabled:opacity-50">
            Cancelar
          </button>
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
    if (pw.length < 6) { setError('La contraseña debe tener al menos 6 caracteres.'); return }
    setBusy(true); setError(null)
    const { data, error } = await supabase.functions.invoke('admin-set-password', {
      body: { userId: usuario.id, password: pw },
    })
    setBusy(false)
    const res = (data as { ok?: boolean; error?: string } | null) ?? null
    if (error || !res?.ok) { setError(error?.message ?? res?.error ?? 'No se pudo cambiar la contraseña.'); return }
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
          <button onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-sub hover:bg-line hover:text-ink"><X size={18} aria-hidden /></button>
        </div>
        {ok ? (
          <div className="space-y-3 p-4">
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">
              <Check size={16} aria-hidden /> Contraseña actualizada.
            </div>
            <p className="text-sm text-sub">Pasale esta contraseña al usuario:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-ink">{pw}</code>
              <button onClick={() => navigator.clipboard?.writeText(pw)} className="btn-press rounded-lg border border-line bg-surface2 p-2 text-sub hover:text-ink" title="Copiar"><Copy size={15} aria-hidden /></button>
            </div>
            <button onClick={onClose} className="btn-press w-full rounded-xl bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700">Listo</button>
          </div>
        ) : (
          <>
            <div className="space-y-3 p-4">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-ink">Nueva contraseña</span>
                <div className="flex items-center gap-2">
                  <input type="text" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Mínimo 6 caracteres" autoComplete="off" className="w-full rounded-xl border border-line bg-surface2 px-3 py-2 text-ink outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40" />
                  <button onClick={generar} className="btn-press shrink-0 rounded-lg border border-line bg-surface2 px-3 py-2 text-xs font-medium text-ink hover:bg-line">Generar</button>
                </div>
              </label>
              {error && <p className="text-sm text-brand-400">{error}</p>}
              <p className="text-xs text-sub">La contraseña se cambia al instante. El usuario podrá entrar con la nueva.</p>
            </div>
            <div className="flex gap-2 border-t border-line px-4 py-3">
              <button onClick={guardar} disabled={busy || pw.length < 6} className="btn-press inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <KeyRound size={16} aria-hidden />}
                {busy ? 'Cambiando…' : 'Cambiar contraseña'}
              </button>
              <button onClick={onClose} disabled={busy} className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2.5 text-sm font-medium text-ink hover:bg-line disabled:opacity-50">Cancelar</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function PermisosModal({
  usuario,
  permisos,
  rolPermisos,
  userRoles,
  onClose,
}: {
  usuario: UsuarioRow
  permisos: Permiso[]
  rolPermisos: Set<string>
  userRoles: string[]
  onClose: () => void
}) {
  const [estado, setEstado] = useState<Record<string, boolean>>({})
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const defaultDe = useCallback(
    (clave: string) => userRoles.some((rc) => rolPermisos.has(`${rc}|${clave}`)),
    [rolPermisos, userRoles],
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
    return () => { activo = false }
  }, [usuario.id, permisos, defaultDe])

  const grupos = useMemo(() => {
    const m = new Map<string, Permiso[]>()
    for (const p of permisos) { const arr = m.get(p.modulo) ?? []; arr.push(p); m.set(p.modulo, arr) }
    return Array.from(m.entries())
  }, [permisos])

  function toggle(clave: string) { setEstado((s) => ({ ...s, [clave]: !s[clave] })) }
  function setTodos(v: boolean) { setEstado(() => Object.fromEntries(permisos.map((p) => [p.clave, v]))) }

  async function guardar() {
    if (!supabase) return
    setGuardando(true); setError(null)
    const upserts: { usuario_id: string; permiso_clave: string; efecto: 'grant' | 'revoke' }[] = []
    const borrar: string[] = []
    for (const p of permisos) {
      const deseado = !!estado[p.clave]
      const def = defaultDe(p.clave)
      if (deseado === def) borrar.push(p.clave)
      else upserts.push({ usuario_id: usuario.id, permiso_clave: p.clave, efecto: deseado ? 'grant' : 'revoke' })
    }
    if (borrar.length) {
      const { error: e1 } = await supabase.from('usuario_permisos').delete().eq('usuario_id', usuario.id).in('permiso_clave', borrar)
      if (e1) { setError(e1.message); setGuardando(false); return }
    }
    if (upserts.length) {
      const { error: e2 } = await supabase.from('usuario_permisos').upsert(upserts, { onConflict: 'usuario_id,permiso_clave' })
      if (e2) { setError(e2.message); setGuardando(false); return }
    }
    setGuardando(false); onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-soft-lg sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="font-display font-semibold text-ink">Permisos de {usuario.nombre}</h2>
            <p className="truncate text-xs text-sub">{usuario.email}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-sub hover:bg-line hover:text-ink"><X size={18} aria-hidden /></button>
        </div>
        <div className="flex items-center gap-2 border-b border-line px-4 py-2">
          <button onClick={() => setTodos(true)} className="btn-press rounded-lg border border-line bg-surface2 px-2.5 py-1 text-xs text-ink hover:bg-line">Seleccionar todo</button>
          <button onClick={() => setTodos(false)} className="btn-press rounded-lg border border-line bg-surface2 px-2.5 py-1 text-xs text-ink hover:bg-line">Deseleccionar todo</button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {cargando ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sub"><Loader2 size={18} className="animate-spin" aria-hidden /> Cargando permisos…</div>
          ) : (
            <div className="space-y-4">
              {grupos.map(([modulo, items]) => (
                <div key={modulo}>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-sub">{modulo.replace('area_', 'Área: ')}</p>
                  <div className="divide-y divide-line/70 overflow-hidden rounded-xl border border-line">
                    {items.map((p) => (
                      <label key={p.clave} className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 hover:bg-surface2">
                        <span className="text-sm text-ink">{p.label}</span>
                        <input type="checkbox" checked={!!estado[p.clave]} onChange={() => toggle(p.clave)} className="h-4 w-4 accent-brand-600" />
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
            {guardando ? 'Guardando...' : 'Guardar cambios'}
          </button>
          <button onClick={onClose} className="btn-press rounded-xl border border-line bg-surface2 px-4 py-2.5 text-sm font-medium text-ink hover:bg-line">Cancelar</button>
        </div>
      </div>
    </div>
  )
}
