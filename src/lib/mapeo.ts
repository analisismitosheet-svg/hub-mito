import { supabase } from '@/lib/supabase'

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
}

/** Fila de public.mapeo_ubicaciones (lista de pasillos / niveles).
 *  El pasillo se guarda como número (1 = A) para ordenar; se muestra con letra. */
export interface Ubicacion {
  codigo: string
  planta: string
  pasillo: number
  nivel: number
}

/** Plantas sugeridas (se puede escribir otra) */
export const PLANTAS: { codigo: string; nombre: string }[] = [
  { codigo: 'PB', nombre: 'Planta baja' },
  { codigo: 'EP', nombre: 'Entrepiso' },
  { codigo: 'P1', nombre: 'Primer piso' },
  { codigo: 'P2', nombre: 'Segundo piso' },
]

export function nombrePlanta(planta: string): string {
  return PLANTAS.find((p) => p.codigo === planta)?.nombre ?? planta
}

/** Orden de plantas: las sugeridas en su orden, después el resto alfabético */
export function ordenPlanta(planta: string): number {
  const i = PLANTAS.findIndex((p) => p.codigo === planta)
  return i === -1 ? PLANTAS.length : i
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

const COLUMNAS = 'id,orden,codigo,color,talle,ubicacion,escaneado_at'

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
function partesUbicacion(u: string): [number, string, string, number] | null {
  const m = /^([A-Z0-9]+)-([A-Z])(\d+)$/.exec(u.trim().toUpperCase())
  return m ? [ordenPlanta(m[1]), m[1], m[2], Number(m[3])] : null
}

/** Compara ubicaciones en el orden del depósito (PB-A1 < PB-A2 < PB-A10 < PB-B1 < EP-A1) */
export function compararUbicaciones(a: string, b: string): number {
  const pa = partesUbicacion(a)
  const pb = partesUbicacion(b)
  if (!pa || !pb) return pa ? -1 : pb ? 1 : a.localeCompare(b)
  return pa[0] - pb[0] || pa[1].localeCompare(pb[1]) || pa[2].localeCompare(pb[2]) || pa[3] - pb[3]
}

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
