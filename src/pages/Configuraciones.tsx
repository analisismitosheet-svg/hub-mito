import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldCheck,
  UserCheck,
  Store,
  UserRound,
  AlertTriangle,
  ChevronRight,
  ListChecks,
  QrCode,
  Loader2,
  UserX,
  UserCheck as UserCheckIcon,
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
interface Rol {
  codigo: string
  nombre: string
  es_admin: boolean
  protegido: boolean
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
  const [roles, setRoles] = useState<Rol[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    if (!supabase) { setCargando(false); return }
    setCargando(true)
    const [u, rl] = await Promise.all([
      supabase.from('usuarios').select('id,email,nombre,rol,estado,created_at,motivo_rechazo,local').order('nombre'),
      supabase.from('roles').select('codigo,nombre,es_admin,protegido').order('orden'),
    ])
    if (u.error) setError(u.error.message)
    setUsuarios((u.data as UsuarioRow[]) ?? [])
    setRoles((rl.data as Rol[]) ?? [])
    setCargando(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  const pendientes = usuarios.filter((u) => u.estado === 'pendiente')

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
        <BackButton />
        <div className="flex items-center justify-center gap-2 py-20 text-sub">
          <Loader2 size={18} className="animate-spin" aria-hidden /> Cargando configuración…
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <BackButton />

      <div className="mb-6 mt-2 flex items-center gap-3">
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
        className="mb-4 flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-soft transition duration-250 hover:border-line2"
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

      {/* QR Locales */}
      <Link
        to="/qr-locales"
        className="mb-4 flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-soft transition duration-250 hover:border-line2"
      >
        <div className="rounded-xl border p-3" style={{ color: '#22c55e', backgroundColor: '#22c55e24', borderColor: '#22c55e40' }}>
          <QrCode size={22} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display font-semibold text-ink">QR Locales</div>
          <p className="text-sm text-sub">Sectores, QR únicos por local y diseño de etiquetas.</p>
        </div>
        <ChevronRight size={18} className="shrink-0 text-sub" aria-hidden />
      </Link>

      {/* Usuarios */}
      <Link
        to="/usuarios"
        className="mb-4 flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-soft transition duration-250 hover:border-line2"
      >
        <div className="rounded-xl border p-3" style={{ color: '#e11d48', backgroundColor: '#e11d4824', borderColor: '#e11d4840' }}>
          <UserCheck size={22} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display font-semibold text-ink">Usuarios</div>
          <p className="text-sm text-sub">Gestionar usuarios, aprobar solicitudes y permisos individuales.</p>
        </div>
        <ChevronRight size={18} className="shrink-0 text-sub" aria-hidden />
      </Link>

      {/* Roles */}
      <Link
        to="/roles"
        className="mb-4 flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-soft transition duration-250 hover:border-line2"
      >
        <div className="rounded-xl border p-3" style={{ color: '#7c3aed', backgroundColor: '#7c3aed24', borderColor: '#7c3aed40' }}>
          <ShieldCheck size={22} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display font-semibold text-ink">Roles y permisos</div>
          <p className="text-sm text-sub">Crear roles y configurar permisos por rol.</p>
        </div>
        <ChevronRight size={18} className="shrink-0 text-sub" aria-hidden />
      </Link>

      {/* Locales */}
      <Link
        to="/locales"
        className="mb-4 flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-soft transition duration-250 hover:border-line2"
      >
        <div className="rounded-xl border p-3" style={{ color: '#16a34a', backgroundColor: '#16a34a24', borderColor: '#16a34a40' }}>
          <Store size={22} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display font-semibold text-ink">Locales</div>
          <p className="text-sm text-sub">Alta, edición y baja de locales/sucursales.</p>
        </div>
        <ChevronRight size={18} className="shrink-0 text-sub" aria-hidden />
      </Link>

      {/* Empleados */}
      <Link
        to="/empleados"
        className="mb-4 flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-soft transition duration-250 hover:border-line2"
      >
        <div className="rounded-xl border p-3" style={{ color: '#0891b2', backgroundColor: '#0891b224', borderColor: '#0891b240' }}>
          <UserRound size={22} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display font-semibold text-ink">Empleados</div>
          <p className="text-sm text-sub">Alta, edición y baja de empleados.</p>
        </div>
        <ChevronRight size={18} className="shrink-0 text-sub" aria-hidden />
      </Link>
    </Layout>
  )
}

function SolicitudCard({
  u, roles, onAprobar, onRechazar,
}: {
  u: UsuarioRow; roles: Rol[]
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
        <select value={rol} onChange={(e) => setRol(e.target.value)} className="rounded-lg border border-line bg-surface2 px-2 py-1.5 text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40" aria-label="Rol al aprobar">
          {roles.map((r) => (
            <option key={r.codigo} value={r.codigo}>{r.nombre}</option>
          ))}
        </select>
        <button
          onClick={async () => { setBusy(true); await onRechazar(u); setBusy(false) }}
          disabled={busy}
          className="btn-press inline-flex items-center gap-1 rounded-lg border border-line bg-surface2 px-3 py-1.5 text-xs font-medium text-sub hover:text-ink disabled:opacity-50"
        >
          <UserX size={14} aria-hidden /> Rechazar
        </button>
        <button
          onClick={async () => { setBusy(true); await onAprobar(u, rol); setBusy(false) }}
          disabled={busy}
          className="btn-press inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          <UserCheckIcon size={14} aria-hidden /> Aprobar
        </button>
      </div>
    </div>
  )
}
