import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { DOMINIO_LOGIN_EMPLEADO } from '@/lib/loginEmpleado'

export type EstadoUsuario = 'pendiente' | 'aprobado' | 'rechazado' | 'desactivado'
export type RolUsuario = 'administrador' | 'usuario'

export interface Perfil {
  id: string
  email: string
  nombre: string
  rol: RolUsuario
  estado: EstadoUsuario
  es_admin: boolean
  motivo_rechazo: string | null
  local: string | null
  roles: string[]
  /** N° de legajo: liga esta cuenta con la fila de `empleados` (ingreso de piso). */
  legajo: string | null
}

interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
  configured: boolean
  perfil: Perfil | null
  permisos: Set<string>
  isAdmin: boolean
  isApproved: boolean
  /**
   * Cuenta de piso "pura": solo el rol empleado y sin permisos extra.
   * No ve menú: entra directo a Mi repo. Si se le suman pantallas, deja de serlo.
   */
  soloPiso: boolean
  /** Cuenta de legajo: entró con legajo + clave (email sintético de empleado) */
  esLegajo: boolean
  /** ¿El usuario tiene el permiso indicado? (admin siempre true) */
  can: (clave: string) => boolean
  refresh: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (
    email: string,
    password: string,
    nombre: string,
  ) => Promise<{ error: string | null; needsConfirm: boolean }>
  signOut: () => Promise<void>
}

// URL canónica del sitio: el link de confirmación del mail siempre apunta acá
// (evita que quede en localhost si te registrás en desarrollo). Configurable por env.
const SITE_URL =
  (import.meta.env.VITE_SITE_URL as string | undefined)?.trim() || 'https://hub-mito.vercel.app'

/** Rol y permisos de las cuentas de piso (sql/empleados_piso.sql) */
const ROL_PISO = 'empleado'
const PERMISOS_PISO = new Set(['mayorista.repos_piso', 'area_mayorista.view'])

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [permisos, setPermisos] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const cargandoPerfil = useRef(false)

  const cargarPerfil = useCallback(async () => {
    if (!supabase) return
    cargandoPerfil.current = true
    const [{ data: perfilData }, { data: permisosData }] = await Promise.all([
      supabase.rpc('mi_perfil'),
      supabase.rpc('mis_permisos'),
    ])
    const p = Array.isArray(perfilData) ? (perfilData[0] as Perfil | undefined) : null
    setPerfil(
      p
        ? // `legajo` puede no existir si todavía no se corrió sql/empleados_piso.sql
          { ...p, legajo: p.legajo ?? null, roles: p.roles ?? (p.rol ? [p.rol] : []) }
        : null,
    )
    const claves = Array.isArray(permisosData)
      ? (permisosData as { clave: string }[]).map((r) => r.clave)
      : []
    setPermisos(new Set(claves))
    cargandoPerfil.current = false
  }, [])

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }
    let activo = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!activo) return
      setSession(data.session)
      if (data.session?.user) await cargarPerfil()
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      if (!activo) return
      setSession(s)
      if (s?.user) {
        await cargarPerfil()
      } else {
        setPerfil(null)
        setPermisos(new Set())
      }
    })
    return () => {
      activo = false
      sub.subscription.unsubscribe()
    }
  }, [cargarPerfil])

  const value = useMemo<AuthState>(() => {
    const configured = isSupabaseConfigured
    const isAdmin = !configured || perfil?.rol === 'administrador' || perfil?.es_admin === true || (perfil?.roles ?? []).includes('administrador')
    const isApproved = !configured || perfil?.estado === 'aprobado'
    const roles = perfil?.roles ?? []
    const soloPiso =
      configured &&
      !isAdmin &&
      roles.length > 0 &&
      roles.every((r) => r === ROL_PISO) &&
      [...permisos].every((p) => PERMISOS_PISO.has(p))
    const esLegajo = !!session?.user?.email?.toLowerCase().endsWith(`@${DOMINIO_LOGIN_EMPLEADO}`)
    return {
      user: session?.user ?? null,
      session,
      loading,
      configured,
      perfil,
      permisos,
      isAdmin,
      isApproved,
      soloPiso,
      esLegajo,
      can(clave) {
        if (!configured) return true
        if (isAdmin) return true
        return permisos.has(clave)
      },
      refresh: cargarPerfil,
      async signIn(email, password) {
        if (!supabase) return { error: 'Supabase no está configurado.' }
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        return { error: error?.message ?? null }
      },
      async signUp(email, password, nombre) {
        if (!supabase) return { error: 'Supabase no está configurado.', needsConfirm: false }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { nombre },
            emailRedirectTo: `${SITE_URL}/login`,
          },
        })
        if (error) return { error: error.message, needsConfirm: false }
        // Aviso al administrador de la nueva solicitud (no bloquea el registro si falla)
        try {
          await supabase.functions.invoke('notificar-acceso', {
            body: { tipo: 'solicitud', nombre, email },
          })
        } catch {
          /* email opcional: se puede aprobar igual desde el panel */
        }
        return { error: null, needsConfirm: !data.session }
      },
      async signOut() {
        if (!supabase) return
        await supabase.auth.signOut()
        setPerfil(null)
        setPermisos(new Set())
      },
    }
  }, [session, loading, perfil, permisos, cargarPerfil])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}

/** Hook cómodo para chequear permisos en cualquier componente. */
export function useCan(clave: string): boolean {
  return useAuth().can(clave)
}
