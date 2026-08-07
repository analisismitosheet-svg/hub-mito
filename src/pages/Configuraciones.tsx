import { useCallback, useEffect, useMemo, useState } from 'react'
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
  AlertTriangle,
} from 'lucide-react'
import Layout from '@/components/Layout'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'

interface UsuarioRow {
  id: string
  email: string
  nombre: string
  rol: 'administrador' | 'usuario'
  estado: 'pendiente' | 'aprobado' | 'rechazado' | 'desactivado'
  created_at: string
  motivo_rechazo: string | null
}
interface Permiso {
  clave: string
  modulo: string
  accion: string
  label: string
  orden: number
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
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [gestion, setGestion] = useState<UsuarioRow | null>(null)

  const cargar = useCallback(async () => {
    if (!supabase) {
      setCargando(false)
      return
    }
    setCargando(true)
    setError(null)
    const [u, p, rp] = await Promise.all([
      supabase.from('usuarios').select('id,email,nombre,rol,estado,created_at,motivo_rechazo').order('created_at', { ascending: false }),
      supabase.from('permisos').select('clave,modulo,accion,label,orden').order('orden'),
      supabase.from('rol_permisos').select('rol,permiso_clave'),
    ])
    if (u.error) setError(u.error.message)
    setUsuarios((u.data as UsuarioRow[]) ?? [])
    setPermisos((p.data as Permiso[]) ?? [])
    setRolPermisos(
      new Set(((rp.data as { rol: string; permiso_clave: string }[]) ?? []).map((r) => `${r.rol}|${r.permiso_clave}`)),
    )
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
  async function aprobar(u: UsuarioRow, rol: 'administrador' | 'usuario') {
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
              <SolicitudCard key={u.id} u={u} onAprobar={aprobar} onRechazar={rechazar} />
            ))}
          </div>
        </section>
      )}

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
                <th className="px-3 py-2.5 font-medium">Email</th>
                <th className="px-3 py-2.5 font-medium">Rol</th>
                <th className="px-3 py-2.5 font-medium">Estado</th>
                <th className="px-3 py-2.5 font-medium">Alta</th>
                <th className="px-3 py-2.5 text-right font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => {
                const esYo = u.id === perfil?.id
                return (
                  <tr key={u.id} className="border-t border-line align-middle">
                    <td className="px-3 py-2.5 font-medium text-ink">{u.nombre}</td>
                    <td className="px-3 py-2.5 text-sub">{u.email}</td>
                    <td className="px-3 py-2.5">
                      <select
                        value={u.rol}
                        disabled={esYo}
                        onChange={(e) => actualizar(u.id, { rol: e.target.value as UsuarioRow['rol'] })}
                        className="rounded-lg border border-line bg-surface2 px-2 py-1 text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-50"
                        aria-label={`Rol de ${u.nombre}`}
                      >
                        <option value="usuario">Usuario</option>
                        <option value="administrador">Administrador</option>
                      </select>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${ESTADO_STYLE[u.estado] ?? ''}`}>
                        {u.estado}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-sub">{fmtFecha(u.created_at)}</td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        {u.estado === 'aprobado' && !esYo && (
                          <button
                            onClick={() => actualizar(u.id, { estado: 'desactivado' })}
                            className="btn-press inline-flex items-center gap-1 rounded-lg border border-line bg-surface2 px-2 py-1 text-xs text-sub hover:text-ink"
                            title="Desactivar"
                          >
                            <Ban size={13} aria-hidden /> Desactivar
                          </button>
                        )}
                        {(u.estado === 'desactivado' || u.estado === 'rechazado') && (
                          <button
                            onClick={() => actualizar(u.id, { estado: 'aprobado', motivo_rechazo: null })}
                            className="btn-press inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-400"
                            title="Reactivar"
                          >
                            <RotateCcw size={13} aria-hidden /> Reactivar
                          </button>
                        )}
                        <button
                          onClick={() => setGestion(u)}
                          disabled={u.rol === 'administrador'}
                          className="btn-press inline-flex items-center gap-1 rounded-lg border border-line bg-surface2 px-2 py-1 text-xs text-ink hover:bg-line disabled:opacity-40"
                          title={u.rol === 'administrador' ? 'El administrador tiene acceso total' : 'Gestionar permisos'}
                        >
                          <SlidersHorizontal size={13} aria-hidden /> Permisos
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
    </Layout>
  )
}

function SolicitudCard({
  u,
  onAprobar,
  onRechazar,
}: {
  u: UsuarioRow
  onAprobar: (u: UsuarioRow, rol: 'administrador' | 'usuario') => Promise<void>
  onRechazar: (u: UsuarioRow) => Promise<void>
}) {
  const [rol, setRol] = useState<'administrador' | 'usuario'>('usuario')
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
          onChange={(e) => setRol(e.target.value as 'administrador' | 'usuario')}
          className="rounded-lg border border-line bg-surface2 px-2 py-1.5 text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          aria-label="Rol al aprobar"
        >
          <option value="usuario">Usuario</option>
          <option value="administrador">Administrador</option>
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
