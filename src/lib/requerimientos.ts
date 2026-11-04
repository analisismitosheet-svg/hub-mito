/* ------------------------------------------------------------------ */
/*  Arquitectura → Requerimientos (sql/requerimientos.sql).            */
/*  Tipos, rubros, prioridades y estados comunes a las tres pantallas: */
/*  Nuevo requerimiento (locales), Bandeja (Arquitectura) y Tareas de  */
/*  mantenimiento.                                                     */
/* ------------------------------------------------------------------ */
import {
  Zap, BrickWall, Droplets, Flame, PaintRoller, KeyRound, Blinds, Hammer, Axe, Store, Wrench,
  type LucideIcon,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { comprimirImagen } from '@/lib/comprimirImagen'

export type Prioridad = 'alta' | 'media' | 'baja'
export type EstadoReq = 'pendiente' | 'programado' | 'en_curso' | 'a_confirmar' | 'resuelto' | 'no_corresponde'

export interface Requerimiento {
  id: number
  created_at: string
  origen: 'hub' | 'planilla'
  local: string | null
  local_original: string | null
  rubro: string
  prioridad: Prioridad
  solicitante_legajo: string | null
  solicitante_nombre: string | null
  descripcion: string
  fotos: string[]
  cargado_email: string | null
  estado: EstadoReq
  programado_para: string | null
  asignados_legajos: string[]
  asignados_nombres: string[]
  programado_nota: string | null
  programado_por: string | null
  iniciado_at: string | null
  iniciado_por: string | null
  terminado_at: string | null
  terminado_por: string | null
  terminado_comentario: string | null
  terminado_fotos: string[]
  rechazo_motivo: string | null
  rechazos: number
  /** Conformidad del local (o «No corresponde» de Arquitectura) */
  resuelto_at: string | null
  resuelto_por: string | null
  resuelto_comentario: string | null
}

export interface Persona { legajo: string; nombre: string; lugar: string | null; sector: string | null }

/** Los mismos rubros (y en el mismo orden) que el formulario viejo, más GAS. */
export const RUBROS: { id: string; icon: LucideIcon; color: string }[] = [
  { id: 'ELECTRICIDAD', icon: Zap, color: '#eab308' },
  { id: 'DURLOCK', icon: BrickWall, color: '#a8a29e' },
  { id: 'PLOMERÍA', icon: Droplets, color: '#0ea5e9' },
  { id: 'GAS', icon: Flame, color: '#f97316' },
  { id: 'PINTURA', icon: PaintRoller, color: '#d946ef' },
  { id: 'CERRAJERÍA', icon: KeyRound, color: '#f59e0b' },
  { id: 'PERSIANA - PORTONES', icon: Blinds, color: '#64748b' },
  { id: 'HERRERÍA', icon: Hammer, color: '#ef4444' },
  { id: 'CARPINTERÍA', icon: Axe, color: '#b45309' },
  { id: 'VIDRIERA', icon: Store, color: '#14b8a6' },
  { id: 'GENERAL', icon: Wrench, color: '#6366f1' },
]
export const rubroDef = (r: string) => RUBROS.find((x) => x.id === r) ?? RUBROS[RUBROS.length - 1]

export const PRIORIDADES: { id: Prioridad; label: string; clase: string }[] = [
  { id: 'alta', label: 'Alta', clase: 'border-red-500/40 bg-red-500/10 text-red-500' },
  { id: 'media', label: 'Media', clase: 'border-amber-500/40 bg-amber-500/10 text-amber-500' },
  { id: 'baja', label: 'Baja', clase: 'border-sky-500/40 bg-sky-500/10 text-sky-500' },
]
export const prioridadDef = (p: string) => PRIORIDADES.find((x) => x.id === p) ?? PRIORIDADES[1]

export const ESTADOS: Record<EstadoReq, { label: string; clase: string }> = {
  pendiente: { label: 'Sin programar', clase: 'border-amber-500/40 bg-amber-500/10 text-amber-500' },
  programado: { label: 'Programado', clase: 'border-sky-500/40 bg-sky-500/10 text-sky-500' },
  en_curso: { label: 'En curso', clase: 'border-violet-500/40 bg-violet-500/10 text-violet-500' },
  a_confirmar: { label: 'A confirmar por el local', clase: 'border-lime-500/40 bg-lime-500/10 text-lime-500' },
  resuelto: { label: 'Resuelto', clase: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500' },
  no_corresponde: { label: 'No corresponde', clase: 'border-line bg-surface2 text-sub' },
}

export const CAMPOS_REQ =
  'id,created_at,origen,local,local_original,rubro,prioridad,solicitante_legajo,solicitante_nombre,descripcion,fotos,cargado_email,estado,' +
  'programado_para,asignados_legajos,asignados_nombres,programado_nota,programado_por,iniciado_at,iniciado_por,' +
  'terminado_at,terminado_por,terminado_comentario,terminado_fotos,rechazo_motivo,rechazos,resuelto_at,resuelto_por,resuelto_comentario'

export const BUCKET_REQ = 'requerimientos'

/** Sube las fotos (achicadas a JPEG) y devuelve sus rutas en el bucket. */
export async function subirFotos(archivos: File[], carpeta: string): Promise<string[]> {
  if (!supabase || !archivos.length) return []
  const rutas: string[] = []
  for (const original of archivos) {
    const f = await comprimirImagen(original)
    const ruta = `${carpeta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
    const { error } = await supabase.storage.from(BUCKET_REQ).upload(ruta, f, { upsert: false, contentType: f.type || 'image/jpeg' })
    if (error) throw new Error(`No se pudo subir la foto: ${error.message}`)
    rutas.push(ruta)
  }
  return rutas
}

/** Las fotos de la planilla vieja son links de Drive; las nuevas, rutas del bucket privado. */
export async function urlFoto(f: string): Promise<string | null> {
  if (/^https?:\/\//i.test(f)) return f
  if (!supabase) return null
  const { data } = await supabase.storage.from(BUCKET_REQ).createSignedUrl(f, 3600)
  return data?.signedUrl ?? null
}

/** «MARCOS y MARIO» */
export const quienesVan = (r: Pick<Requerimiento, 'asignados_nombres'>) =>
  r.asignados_nombres.length <= 1 ? (r.asignados_nombres[0] ?? '') : `${r.asignados_nombres.slice(0, -1).join(', ')} y ${r.asignados_nombres[r.asignados_nombres.length - 1]}`

/** dd/mm/aaaa */
export const fechaCorta = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
/** dd/mm hh:mm */
export const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })

/**
 * Días corridos entre la carga y el cierre (o hoy si sigue abierto).
 * null = cerrado sin fecha de cierre (muchos de la planilla vieja no la tienen).
 */
export function diasAbierto(r: Pick<Requerimiento, 'created_at' | 'resuelto_at' | 'estado'>): number | null {
  const cerrado = r.estado === 'resuelto' || r.estado === 'no_corresponde'
  if (cerrado && !r.resuelto_at) return null
  const hasta = r.resuelto_at ? new Date(r.resuelto_at) : new Date()
  return Math.max(0, Math.floor((hasta.getTime() - new Date(r.created_at).getTime()) / 86400000))
}
