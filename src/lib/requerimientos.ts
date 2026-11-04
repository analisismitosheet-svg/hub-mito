/* ------------------------------------------------------------------ */
/*  Arquitectura → Requerimientos (sql/requerimientos.sql).            */
/*  Tipos, rubros (tabla requerimientos_rubros), prioridades y estados */
/*  comunes a las pantallas:                                           */
/*  Nuevo requerimiento (locales), Bandeja (Arquitectura) y Tareas de  */
/*  mantenimiento.                                                     */
/* ------------------------------------------------------------------ */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Zap, BrickWall, Droplets, Flame, PaintRoller, KeyRound, Blinds, Hammer, Axe, Store, Wrench,
  Lightbulb, Fan, Snowflake, Plug, Monitor, Cctv, Wifi, Sparkles, Bug, DoorOpen, Lock, Truck, Paintbrush,
  Thermometer, Sofa, Ruler, Drill, Trash2,
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

/**
 * Íconos que se pueden elegir para un rubro (Arquitectura → Requerimientos → Rubros).
 * La tabla requerimientos_rubros guarda la clave; una clave desconocida cae en Wrench.
 */
export const ICONOS_RUBRO: Record<string, LucideIcon> = {
  Zap, Lightbulb, Plug, BrickWall, Droplets, Flame, Thermometer, Snowflake, Fan, PaintRoller, Paintbrush,
  KeyRound, Lock, DoorOpen, Blinds, Hammer, Drill, Axe, Ruler, Store, Sofa, Monitor, Cctv, Wifi,
  Sparkles, Bug, Trash2, Truck, Wrench,
}

export interface Rubro { id: number; nombre: string; icono: string; color: string; orden: number; activo: boolean }
export interface RubroDef { id: string; icon: LucideIcon; color: string }

const SIN_RUBRO: RubroDef = { id: 'GENERAL', icon: Wrench, color: '#6366f1' }
const aDef = (r: Rubro): RubroDef => ({ id: r.nombre, icon: ICONOS_RUBRO[r.icono] ?? Wrench, color: r.color })

/**
 * Rubros de la tabla requerimientos_rubros. `rubros` = los activos (formulario),
 * `todos` = también los ocultos (filtros e historial), `rubroDef` = ícono y color de un nombre.
 */
export function useRubros() {
  const [lista, setLista] = useState<Rubro[]>([])
  const recargar = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase.from('requerimientos_rubros').select('id,nombre,icono,color,orden,activo').order('orden').order('nombre')
    setLista((data as Rubro[] | null) ?? [])
  }, [])
  useEffect(() => { void recargar() }, [recargar])
  return useMemo(() => {
    const porNombre = new Map(lista.map((r) => [r.nombre, aDef(r)]))
    return {
      lista,
      recargar,
      rubros: lista.filter((r) => r.activo).map(aDef),
      todos: lista.map(aDef),
      rubroDef: (nombre: string): RubroDef => porNombre.get(nombre) ?? { ...SIN_RUBRO, id: nombre },
    }
  }, [lista, recargar])
}

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
