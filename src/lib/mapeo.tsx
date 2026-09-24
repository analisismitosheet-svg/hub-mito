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
  pasillo: number
  nivel: number
}

/** Pasillos van por letra: A..Z */
export const MAX_PASILLOS = 26

/** 1 -> "A", 2 -> "B" … */
export function letraPasillo(pasillo: number): string {
  return String.fromCharCode(64 + pasillo)
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
    .select('codigo,pasillo,nivel')
    .order('pasillo', { ascending: true })
    .order('nivel', { ascending: true })
    .range(0, 9999)
  if (error) throw new Error(error.message)
  return (data as Ubicacion[] | null) ?? []
}

const dos = (n: number) => String(n).padStart(2, '0')

/** Código de una ubicación: pasillo 1 (A), nivel 2 -> "A-02" */
export function codigoUbicacion(pasillo: number, nivel: number): string {
  return `${letraPasillo(pasillo)}-${dos(nivel)}`
}

/** Lo que lleva el QR impreso: "UBI:A-02" (el prefijo la distingue de un artículo) */
export function qrUbicacion(codigo: string): string {
  return `UBI:${codigo}`
}

/** Prefijo del QR de ubicación (opcional al leer) */
export const PREFIJO_UBICACION = /^UBI[:\-_ ]?/i

export function limpiarUbicacion(texto: string): string {
  return texto.trim().replace(PREFIJO_UBICACION, '').trim().toUpperCase()
}

/** Talle numérico con "T" (T38); de letra tal cual (M, L, U) */
export function fmtTalle(talle: string | null): string | null {
  if (!talle) return null
  return /^\d/.test(talle) ? `T${talle}` : talle
}

/** Código + color + talle como chips */
export function ChipsArticulo({ m, chico = false }: { m: Pick<Mapeo, 'codigo' | 'color' | 'talle'>; chico?: boolean }) {
  const talle = fmtTalle(m.talle)
  const txt = chico ? 'text-[11px]' : 'text-xs'
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className={`${chico ? 'text-sm' : 'text-[15px]'} font-semibold text-ink`}>{m.codigo}</span>
      {m.color && (
        <span className={`rounded-md bg-sky-500/15 px-1.5 py-0.5 ${txt} font-semibold text-sky-400`} title="Color">{m.color}</span>
      )}
      {talle && (
        <span className={`rounded-md bg-violet-500/15 px-1.5 py-0.5 ${txt} font-semibold text-violet-400`} title="Talle">{talle}</span>
      )}
    </span>
  )
}
