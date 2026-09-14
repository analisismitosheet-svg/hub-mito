import { supabase } from '@/lib/supabase'

export interface TipoNovedad {
  id: string
  nombre: string
}

/** Tipos por defecto (fallback mientras no haya config en la base). */
export const TIPOS_DEFECTO: TipoNovedad[] = [
  { id: 'MITO', nombre: 'MITO' },
  { id: 'PPP', nombre: 'PPP' },
  { id: 'MAS26', nombre: 'MAS26' },
  { id: 'PFOMENTAR', nombre: 'PFOMENTAR' },
]

let cache: TipoNovedad[] | null = null
let promesa: Promise<TipoNovedad[]> | null = null

/** Carga los tipos desde la tabla novedades_tipos (con fallback). */
export function cargarTipos(): Promise<TipoNovedad[]> {
  if (cache) return Promise.resolve(cache)
  if (!promesa) {
    promesa = (async () => {
      try {
        if (!supabase) return TIPOS_DEFECTO
        const { data } = await supabase.from('novedades_tipos').select('id,nombre').order('nombre')
        if (!data || data.length === 0) return TIPOS_DEFECTO
        cache = data as TipoNovedad[]
        return cache
      } catch {
        return TIPOS_DEFECTO
      }
    })()
  }
  return promesa
}

/** Devuelve los nombres de los tipos (para selects). */
export async function nombresTipos(): Promise<string[]> {
  const tipos = await cargarTipos()
  return tipos.map((t) => t.nombre)
}

/** Invalida el cache (tras editar tipos desde el ABM). */
export function invalidarTipos(): void {
  cache = null
  promesa = null
}