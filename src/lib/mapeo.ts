import { supabase } from '@/lib/supabase'
// El orden del depósito vive en ordenPiso.ts (sin dependencias, lo usa también Mi repo)
export { PLANTAS, ordenPlanta, compararUbicaciones } from '@/lib/ordenPiso'
import { PLANTAS, ordenPlanta, compararUbicaciones } from '@/lib/ordenPiso'

/* ------------------------------------------------------------------ */
/*  Mapeo depósito: tipos y helpers compartidos entre sus pantallas    */
/*  (sql/mapeo_deposito.sql)                                           */
/* ------------------------------------------------------------------ */

/** Fila de public.mapeo_deposito */
export interface Mapeo {
  id: string
  orden: number
  codigo: string
  color: string | null
  talle: string | null
  ubicacion: string | null
  escaneado_at: string
  /** Fecha en que se vio en stock 0 (MITO): desde ahí ya no tiene posición */
  sin_stock_at: string | null
}

/** Fila de public.mapeo_ubicaciones (lista de pasillos / niveles).
 *  El pasillo se guarda como número (1 = A) para ordenar; se muestra con letra. */
export interface Ubicacion {
  codigo: string
  planta: string
  pasillo: number
  nivel: number
}

export function nombrePlanta(planta: string): string {
  return PLANTAS.find((p) => p.codigo === planta)?.nombre ?? planta
}

/** 1 -> "A", 2 -> "B" … */
export function letraPasillo(pasillo: number): string {
  return String.fromCharCode(64 + pasillo)
}

/** "A" -> 1, "b" -> 2; null si no es una letra A..Z */
export function numeroPasillo(letra: string): number | null {
  const l = letra.trim().toUpperCase()
  return /^[A-Z]$/.test(l) ? l.charCodeAt(0) - 64 : null
}

/** Lo que devuelve mapeo_escanear() */
export interface FilaEscaneo {
  estado: 'nuevo' | 'movido' | 'agregado' | 'ya_aca' | 'ya_mapeado'
  /** null en 'ya_mapeado' (todavía no se guardó nada) */
  id: string | null
  orden: number | null
  codigo: string
  color: string | null
  talle: string | null
  ubicacion: string | null
  /** otras ubicaciones donde ya estaba el artículo */
  otras: string | null
}

/** Qué hacer con un artículo que ya está en otra ubicación */
export type AccionRepetido = 'mover' | 'agregar'

const COLUMNAS = 'id,orden,codigo,color,talle,ubicacion,escaneado_at,sin_stock_at'

/** Todo el mapeo en orden de recorrido (paginado: Supabase corta en 1000 filas) */
export async function cargarMapeo(): Promise<Mapeo[]> {
  if (!supabase) return []
  const todas: Mapeo[] = []
  const paso = 1000
  for (let desde = 0; ; desde += paso) {
    const { data, error } = await supabase
      .from('mapeo_deposito')
      .select(COLUMNAS)
      .order('orden', { ascending: true })
      .range(desde, desde + paso - 1)
    if (error) throw new Error(error.message)
    const lote = (data as Mapeo[] | null) ?? []
    todas.push(...lote)
    if (lote.length < paso) break
  }
  return todas
}

/** Pasillos / niveles creados, ordenados */
export async function cargarUbicaciones(): Promise<Ubicacion[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('mapeo_ubicaciones')
    .select('codigo,planta,pasillo,nivel')
    .order('planta', { ascending: true })
    .order('pasillo', { ascending: true })
    .order('nivel', { ascending: true })
    .range(0, 9999)
  if (error) throw new Error(error.message)
  return ((data as Ubicacion[] | null) ?? []).sort(
    (a, b) =>
      ordenPlanta(a.planta) - ordenPlanta(b.planta) || a.planta.localeCompare(b.planta) || a.pasillo - b.pasillo || a.nivel - b.nivel,
  )
}

/**
 * Marca como «sin stock» las filas que se vieron en stock 0: pierden la posición.
 * Si el stock vuelve, Orden mapeado las muestra «Sin posición». No borra nada.
 */
export async function marcarSinStockMapeo(ids: string[]): Promise<number> {
  if (!supabase || ids.length === 0) return 0
  const { data, error } = await supabase.rpc('mapeo_marcar_sin_stock', { p_ids: ids })
  if (error) throw new Error(error.message)
  return (data as number | null) ?? 0
}

/**
 * Posición vacía (creada y sin nada mapeado) más cercana a `desde`: primero la
 * misma planta, después el pasillo más próximo y dentro de él el nivel más
 * próximo. Si no hay ninguna vacía, la misma `desde` (si existe). null si no hay.
 */
export function posicionMasCercana(desde: string, ubicaciones: Ubicacion[], ocupadas: Set<string>): string | null {
  const m = /^([A-Z0-9]+)-([A-Z])(\d+)$/.exec(desde.trim().toUpperCase())
  const origen = m ? { planta: m[1], pasillo: m[2].charCodeAt(0) - 64, nivel: Number(m[3]) } : null
  let mejor: { codigo: string; d: number } | null = null
  for (const u of ubicaciones) {
    if (ocupadas.has(u.codigo.toUpperCase())) continue
    const d = origen
      ? (u.planta === origen.planta ? 0 : 1_000_000) + Math.abs(u.pasillo - origen.pasillo) * 1000 + Math.abs(u.nivel - origen.nivel)
      : ordenPlanta(u.planta) * 1_000_000 + u.pasillo * 1000 + u.nivel
    if (!mejor || d < mejor.d) mejor = { codigo: u.codigo, d }
  }
  if (mejor) return mejor.codigo
  return ubicaciones.some((u) => u.codigo.toUpperCase() === desde.toUpperCase()) ? desde : null
}

/** Código de una ubicación: planta baja, pasillo A, nivel 2 -> "PB-A2" */
export function codigoUbicacion(planta: string, pasillo: number, nivel: number): string {
  return `${planta}-${letraPasillo(pasillo)}${nivel}`
}

/** Lo que lleva el QR impreso: "UBI:PB-A2" (el prefijo la distingue de un artículo) */
export function qrUbicacion(codigo: string): string {
  return `UBI:${codigo}`
}

/** Prefijo del QR de ubicación (opcional al leer) */
// El lector inalámbrico "tipea" con teclado inglés: si la PC/celular está en español,
// ':' llega como 'Ñ' y '-' como '´' o '\''. Se aceptan esas variantes.
export const PREFIJO_UBICACION = /^UBI[:Ñ\-_ ]?/i

/** Guiones que puede mandar el lector según el idioma del teclado */
const GUIONES = /[´'`’?¿_]/g

export function limpiarUbicacion(texto: string): string {
  return texto.trim().replace(PREFIJO_UBICACION, '').trim().toUpperCase().replace(GUIONES, '-')
}

/* ------------------------------------------------------------------ */
/*  Orden físico de ubicaciones: planta -> pasillo (letra) -> nivel    */
/* ------------------------------------------------------------------ */

/** "PB-A10" -> [orden de planta, planta, letra, nivel]; otros textos van al final */
/** Ubicaciones mapeadas de cada artículo (código en mayúsculas -> ubicaciones ordenadas) */
export async function ubicacionesDeArticulos(codigos: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  const unicos = [...new Set(codigos.map((c) => c.trim().toUpperCase()).filter(Boolean))]
  if (!supabase || unicos.length === 0) return out
  const TANDA = 200 // el filtro .in() va en la URL: de a tandas
  for (let i = 0; i < unicos.length; i += TANDA) {
    const { data, error } = await supabase
      .from('mapeo_deposito')
      .select('codigo,ubicacion')
      .in('codigo', unicos.slice(i, i + TANDA))
      .is('sin_stock_at', null) // los que quedaron sin stock ya no tienen posición
      .range(0, 9999)
    if (error) throw new Error(error.message)
    for (const r of (data as { codigo: string; ubicacion: string | null }[] | null) ?? []) {
      if (!r.ubicacion) continue
      out.set(r.codigo, [...(out.get(r.codigo) ?? []), r.ubicacion])
    }
  }
  for (const [k, v] of out) out.set(k, v.sort(compararUbicaciones))
  return out
}

/** Descripción de cada artículo (código en mayúsculas -> descripción), sacada de transferencias y repos */
export async function descripcionesDeArticulos(codigos: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unicos = [...new Set(codigos.map((c) => c.trim().toUpperCase()).filter(Boolean))]
  if (!supabase || unicos.length === 0) return out
  const TANDA = 500
  for (let i = 0; i < unicos.length; i += TANDA) {
    const { data, error } = await supabase.rpc('mapeo_descripciones', { p_codigos: unicos.slice(i, i + TANDA) })
    if (error) throw new Error(error.message)
    for (const r of (data as { codigo: string; descripcion: string | null }[] | null) ?? []) {
      if (r.descripcion) out.set(r.codigo, r.descripcion)
    }
  }
  return out
}
