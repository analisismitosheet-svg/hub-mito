import type { PostgrestError } from '@supabase/supabase-js'

/**
 * Centraliza el manejo de "no autorizado" (403 / RLS).
 * En Supabase, una fila rechazada por RLS devuelve un PostgrestError con
 * code '42501' (insufficient_privilege). Detectamos ese caso y lo traducimos
 * a un mensaje entendible + un flag para la UI.
 */
export interface AccesoDenegado {
  denegado: boolean
  mensaje: string
}

export function esNoAutorizado(error: PostgrestError | { code?: string } | null | undefined): boolean {
  if (!error) return false
  const code = error.code ?? ''
  // 42501 = RLS / insufficient privilege · PGRST116 = no rows · PGRST205 = RLS
  return code === '42501' || code === '42504'
}

/** Normaliza un error de Supabase a un estado de autorización. */
export function interpretarError(error: PostgrestError | null): AccesoDenegado {
  if (esNoAutorizado(error)) {
    return { denegado: true, mensaje: 'No autorizado para esta acción.' }
  }
  return { denegado: false, mensaje: error?.message ?? '' }
}
