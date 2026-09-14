import { supabase } from '@/lib/supabase'

export interface Motivo {
  id: string
  nombre: string
  color: string
}

/** Motivos por defecto (fallback mientras no haya config en la base). */
export const MOTIVOS_DEFECTO: Motivo[] = [
  { id: 'INGRESO', nombre: 'INGRESO', color: '#00BFFF' },
  { id: 'AUSENTE', nombre: 'AUSENTE', color: '#FF4500' },
  { id: 'TARDANZA', nombre: 'TARDANZA', color: '#FFD700' },
  { id: 'APERCIBIM', nombre: 'APERCIBIM', color: '#4B0082' },
  { id: 'APERCIBIMIENTO', nombre: 'APERCIBIMIENTO', color: '#4B0082' },
  { id: 'EMBARGO', nombre: 'EMBARGO', color: '#FF00FF' },
  { id: 'CARPETA MÉDICA', nombre: 'CARPETA MÉDICA', color: '#FFA07A' },
  { id: 'CAMBIO COMISIÓN', nombre: 'CAMBIO COMISIÓN', color: '#008000' },
  { id: 'RESTAR', nombre: 'RESTAR', color: '#6495ED' },
  { id: 'SUSPENSION', nombre: 'SUSPENSION', color: '#FF0000' },
  { id: 'CAMBIO LOCAL', nombre: 'CAMBIO LOCAL', color: '#32CD32' },
  { id: 'CAMBIO', nombre: 'CAMBIO', color: '#DDA0DD' },
  { id: 'VACACIONES', nombre: 'VACACIONES', color: '#7FFFD4' },
  { id: 'BAJA', nombre: 'BAJA', color: '#00008B' },
  { id: 'LICENCIA', nombre: 'LICENCIA', color: '#FFDAB9' },
  { id: 'OTROS', nombre: 'OTROS', color: '#6A5ACD' },
  { id: 'RECUPERAR', nombre: 'RECUPERAR', color: '#FF8C00' },
  { id: 'SIN NOVEDADES', nombre: 'SIN NOVEDADES', color: '#FFFFFF' },
]

let cache: Motivo[] | null = null
let promesa: Promise<Motivo[]> | null = null

/** Carga los motivos desde la tabla novedades_motivos (con fallback). */
export function cargarMotivos(): Promise<Motivo[]> {
  if (cache) return Promise.resolve(cache)
  if (!promesa) {
    promesa = (async () => {
      try {
        if (!supabase) return MOTIVOS_DEFECTO
        const { data } = await supabase.from('novedades_motivos').select('id,nombre,color').order('nombre')
        if (!data || data.length === 0) return MOTIVOS_DEFECTO
        cache = (data as Motivo[]).map((m) => ({ ...m, color: m.color || '#6A5ACD' }))
        return cache
      } catch {
        return MOTIVOS_DEFECTO
      }
    })()
  }
  return promesa
}

/** Devuelve el nombre de los motivos (para selects). */
export async function nombresMotivos(): Promise<string[]> {
  const motivos = await cargarMotivos()
  return motivos.map((m) => m.nombre)
}

/** Invalida el cache (tras editar motivos desde el ABM). */
export function invalidarMotivos(): void {
  cache = null
  promesa = null
}

/**
 * Devuelve color de fondo (con alpha) y color de texto legible según el motivo.
 * Usa el color de la base; si el motivo no está, no pinta.
 */
export function colorFilaMotivo(motivo: string | null): { bg: string; fg: string } | null {
  const nombre = (motivo ?? '').trim().toUpperCase()
  const m = cache?.find((x) => x.nombre.trim().toUpperCase() === nombre)
  const c = m?.color ?? MOTIVOS_DEFECTO.find((x) => x.nombre === nombre)?.color
  if (!c) return null
  return { bg: c + '22', fg: c }
}