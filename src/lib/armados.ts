/* ------------------------------------------------------------------ */
/*  Armados de pedidos (sql/mayorista_armados.sql)                     */
/*  El mayorista pide el armado de uno o varios pedidos de venta;      */
/*  la tarea entra a Mi repo de todos los legajos y el primero que     */
/*  la acepta se la queda. A medida que escanea, el avance se guarda   */
/*  acá y Pedidos de venta lo muestra en verde.                        */
/* ------------------------------------------------------------------ */
import { supabase } from '@/lib/supabase'

export type PrioridadArmado = 'urgente' | 'normal' | 'baja'
export type EstadoArmado = 'pendiente' | 'aceptado' | 'hecho'
export type EstadoItemArmado = 'pendiente' | 'hecho' | 'faltante'

export interface Armado {
  id: string
  pedido_codigo: string
  pedido_numero: number | null
  cliente: string | null
  cliente_nombre: string | null
  prioridad: PrioridadArmado
  estado: EstadoArmado
  obs: string | null
  creado_at: string
  creado_por: string | null
  aceptado_at: string | null
  aceptado_por: string | null
  aceptado_legajo: string | null
  aceptado_nombre: string | null
  hecho_at: string | null
  faltantes: number
  /** Responsable del local en Repos Mayorista (sql/armado_responsable.sql): si está, el armado es solo suyo */
  asignado_legajo: string | null
  asignado_nombre: string | null
  asignado_local: string | null
}

/** Renglón del pedido copiado al armado, con su avance. */
export interface ArmadoItem {
  armado_id?: string
  linea: number
  articulo: string | null
  descripcion: string | null
  color: string | null
  talle: string | null
  cantidad: number
  escaneadas: number
  estado: EstadoItemArmado
}

export interface AvanceArmado {
  lineas: number
  lineasOk: number
  unidades: number
  unidadesOk: number
}

export const COLUMNAS_ARMADO =
  'id,pedido_codigo,pedido_numero,cliente,cliente_nombre,prioridad,estado,obs,creado_at,creado_por,' +
  'aceptado_at,aceptado_por,aceptado_legajo,aceptado_nombre,hecho_at,faltantes,asignado_legajo,asignado_nombre,asignado_local'

export const COLUMNAS_ITEM_ARMADO = 'armado_id,linea,articulo,descripcion,color,talle,cantidad,escaneadas,estado'

export const PRIORIDADES: Record<PrioridadArmado, { label: string; color: string; icono: string; pitidos: number }> = {
  urgente: { label: 'Urgente', color: '#ef4444', icono: '🚨', pitidos: 3 },
  normal: { label: 'Normal', color: '#f59e0b', icono: '⏰', pitidos: 2 },
  baja: { label: 'Baja', color: '#38bdf8', icono: '🌙', pitidos: 1 },
}

const RANK: Record<PrioridadArmado, number> = { urgente: 0, normal: 1, baja: 2 }

/** Urgente arriba, después Normal y Baja; dentro de la misma, el más viejo. */
export function ordenArmados(a: Armado, b: Armado): number {
  return RANK[a.prioridad] - RANK[b.prioridad] || a.creado_at.localeCompare(b.creado_at)
}

/** ¿Le toca a este legajo? Los asignados, solo a su responsable; los sin asignar, a todos. */
export const paraLegajo = (a: Armado, legajo: string | null | undefined): boolean =>
  !a.asignado_legajo || String(a.asignado_legajo).trim() === String(legajo ?? '').trim()

export const esMio = (a: Armado, uid: string | null | undefined): boolean => !!uid && a.aceptado_por === uid

/** Avance de un armado a partir de sus renglones. */
export function avanceDe(items: Pick<ArmadoItem, 'cantidad' | 'escaneadas' | 'estado'>[]): AvanceArmado {
  let lineas = 0
  let lineasOk = 0
  let unidades = 0
  let unidadesOk = 0
  for (const i of items) {
    lineas++
    unidades += i.cantidad
    const ok = i.estado === 'hecho' || i.escaneadas >= i.cantidad
    if (ok) lineasOk++
    unidadesOk += Math.min(i.escaneadas, i.cantidad)
  }
  return { lineas, lineasOk, unidades, unidadesOk }
}

/**
 * Avance de varios armados de una sola consulta (para la lista de Pedidos de
 * venta: el mayorista quiere ver el pedido ponerse en verde en vivo).
 */
export async function avanceDeArmados(ids: string[]): Promise<Record<string, AvanceArmado>> {
  const out: Record<string, AvanceArmado> = {}
  if (!supabase || ids.length === 0) return out
  const porId = new Map<string, Pick<ArmadoItem, 'cantidad' | 'escaneadas' | 'estado'>[]>()
  for (let i = 0; i < ids.length; i += 100) {
    const lote = ids.slice(i, i + 100)
    const { data, error } = await supabase
      .from('mayorista_armados_items')
      .select('armado_id,cantidad,escaneadas,estado')
      .in('armado_id', lote)
      .limit(5000)
    if (error || !data) continue
    for (const f of data as { armado_id: string; cantidad: number; escaneadas: number; estado: EstadoItemArmado }[]) {
      const arr = porId.get(f.armado_id) ?? []
      arr.push(f)
      porId.set(f.armado_id, arr)
    }
  }
  for (const [id, its] of porId) out[id] = avanceDe(its)
  return out
}

/** "N° 10032" o el código, si el pedido no trae número. */
export const nroDePedido = (a: Pick<Armado, 'pedido_numero' | 'pedido_codigo'>): string =>
  a.pedido_numero != null ? String(a.pedido_numero) : a.pedido_codigo
