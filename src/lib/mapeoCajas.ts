import { supabase } from '@/lib/supabase'

/* ------------------------------------------------------------------ */
/*  Mapeo de cajas (Depósito): como el Mapeo depósito del Mayorista,   */
/*  pero la mercadería está en cajas numeradas (sql/mapeo_cajas.sql)   */
/* ------------------------------------------------------------------ */

/** Fila de public.mapeo_cajas */
export interface MapeoCaja {
  id: string
  orden: number
  caja: number
  codigo: string
  color: string | null
  talle: string | null
  escaneado_at: string
}

/** Lo que devuelve mapeo_cajas_escanear() */
export interface FilaEscaneoCaja {
  estado: 'nuevo' | 'movido' | 'agregado' | 'ya_aca' | 'ya_mapeado'
  /** null en 'ya_mapeado' (todavía no se guardó nada) */
  id: string | null
  orden: number | null
  codigo: string
  color: string | null
  talle: string | null
  caja: number
  /** otras cajas donde ya estaba el artículo */
  otras: number[] | null
}

export type AccionRepetidoCaja = 'mover' | 'agregar'

/** Lo que lleva el QR impreso: "CAJA:15" (el prefijo la distingue de un artículo) */
export function qrCaja(numero: number): string {
  return `CAJA:${numero}`
}

/** Prefijo del QR de caja. El lector inalámbrico con teclado en español
 *  manda ':' como 'Ñ': se aceptan esas variantes (igual que en ubicaciones). */
export const PREFIJO_CAJA = /^CAJA[:Ñ\-_ ]?/i

/** "CAJA:15", "cajaÑ15", "15", " 0015 " -> 15; null si no es un número de caja */
export function leerNumeroCaja(texto: string): number | null {
  const t = texto.trim().replace(PREFIJO_CAJA, '').trim()
  if (!/^\d{1,6}$/.test(t)) return null
  const n = Number(t)
  return n >= 1 ? n : null
}

/** Todo el mapeo en orden de recorrido (paginado: Supabase corta en 1000 filas) */
export async function cargarMapeoCajas(): Promise<MapeoCaja[]> {
  if (!supabase) return []
  const todas: MapeoCaja[] = []
  const paso = 1000
  for (let desde = 0; ; desde += paso) {
    const { data, error } = await supabase
      .from('mapeo_cajas')
      .select('id,orden,caja,codigo,color,talle,escaneado_at')
      .order('orden', { ascending: true })
      .range(desde, desde + paso - 1)
    if (error) throw new Error(error.message)
    const lote = (data as MapeoCaja[] | null) ?? []
    todas.push(...lote)
    if (lote.length < paso) break
  }
  return todas
}

/** Números de caja creados, de menor a mayor */
export async function cargarListaCajas(): Promise<number[]> {
  if (!supabase) return []
  const todas: number[] = []
  const paso = 1000
  for (let desde = 0; ; desde += paso) {
    const { data, error } = await supabase
      .from('mapeo_cajas_lista')
      .select('numero')
      .order('numero', { ascending: true })
      .range(desde, desde + paso - 1)
    if (error) throw new Error(error.message)
    const lote = ((data as { numero: number }[] | null) ?? []).map((r) => r.numero)
    todas.push(...lote)
    if (lote.length < paso) break
  }
  return todas
}

/** Tramos de a 50 para agrupar: 1–50, 51–100 … */
export const TRAMO_CAJAS = 50
export function tramoDe(caja: number): { desde: number; hasta: number } {
  const desde = Math.floor((caja - 1) / TRAMO_CAJAS) * TRAMO_CAJAS + 1
  return { desde, hasta: desde + TRAMO_CAJAS - 1 }
}
