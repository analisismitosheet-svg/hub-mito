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
  /** Fecha en que se vio en stock 0 (INDOD): desde ahí ya no tiene caja */
  sin_stock_at: string | null
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
      .select('id,orden,caja,codigo,color,talle,escaneado_at,sin_stock_at')
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

/* ------------------------------------------------------------------ */
/*  Cajas llenas                                                       */
/* ------------------------------------------------------------------ */

/** Números de caja marcadas como llenas */
export async function cargarCajasLlenas(): Promise<Set<number>> {
  if (!supabase) return new Set()
  const { data, error } = await supabase.from('mapeo_cajas_llenas').select('caja').range(0, 9999)
  if (error) throw new Error(error.message)
  return new Set(((data as { caja: number }[] | null) ?? []).map((r) => r.caja))
}

/** Pone o saca el tilde de caja llena */
export async function marcarCajaLlena(caja: number, llena: boolean): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.rpc('mapeo_cajas_marcar_llena', { p_caja: caja, p_llena: llena })
  if (error) throw new Error(error.message)
}

/**
 * Marca como «sin stock» las filas que se vieron en stock 0: pierden la caja.
 * Si el stock vuelve, Cajas mapeadas las muestra «Sin posición». No borra nada.
 */
export async function marcarSinStockCajas(ids: string[]): Promise<number> {
  if (!supabase || ids.length === 0) return 0
  const { data, error } = await supabase.rpc('mapeo_cajas_marcar_sin_stock', { p_ids: ids })
  if (error) throw new Error(error.message)
  return (data as number | null) ?? 0
}

/**
 * Caja más cercana (por número) a `desde` que tenga lugar: creada en la lista
 * y sin el tilde de llena. Empate: la de número más bajo. null si no hay.
 */
export function cajaMasCercanaConLugar(desde: number, lista: number[], llenas: Set<number>): number | null {
  let mejor: number | null = null
  for (const n of lista) {
    if (llenas.has(n)) continue
    if (mejor === null || Math.abs(n - desde) < Math.abs(mejor - desde) || (Math.abs(n - desde) === Math.abs(mejor - desde) && n < mejor)) {
      mejor = n
    }
  }
  return mejor
}

/* ------------------------------------------------------------------ */
/*  Cajas de cada artículo (para Mi repo / transferencias de Depósito) */
/* ------------------------------------------------------------------ */

/** código en mayúsculas -> cajas donde está, de menor a mayor */
export async function cajasDeArticulos(codigos: string[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>()
  const unicos = [...new Set(codigos.map((c) => c.trim().toUpperCase()).filter(Boolean))]
  if (!supabase || unicos.length === 0) return out
  const TANDA = 200 // el filtro .in() va en la URL: de a tandas
  for (let i = 0; i < unicos.length; i += TANDA) {
    const { data, error } = await supabase
      .from('mapeo_cajas')
      .select('codigo,caja')
      .in('codigo', unicos.slice(i, i + TANDA))
      .is('sin_stock_at', null) // los que quedaron sin stock ya no tienen caja
      .range(0, 9999)
    if (error) throw new Error(error.message)
    for (const r of (data as { codigo: string; caja: number }[] | null) ?? []) {
      out.set(r.codigo, [...(out.get(r.codigo) ?? []), r.caja])
    }
  }
  for (const [k, v] of out) out.set(k, v.sort((a, b) => a - b))
  return out
}

/** Traduce lo que leyó el lector al código de artículo (sin guardar nada) */
export async function leerCodigoArticulo(bruto: string): Promise<string | null> {
  if (!supabase || !bruto.trim()) return null
  const { data, error } = await supabase.rpc('mapeo_cajas_leer_codigo', { p_codigo: bruto })
  if (error) throw new Error(error.message)
  return (data as string | null) ?? null
}
