import { supabase } from '@/lib/supabase'

/**
 * Descripción de cada artículo (código en mayúsculas -> descripción) desde el
 * maestro public.articulos: es la descripción ADICIONAL del DWH
 * (puente-sql/scripts/sync-articulos.js), la que se muestra en todo el hub.
 * La tabla la puede leer cualquier usuario logueado. Si falla, devuelve vacío.
 */
export async function descripcionesMaestro(codigos: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unicos = [...new Set(codigos.map((c) => c.trim().toUpperCase()).filter(Boolean))]
  if (!supabase || unicos.length === 0) return out
  for (let i = 0; i < unicos.length; i += 200) {
    const { data, error } = await supabase.from('articulos').select('id_art,descripcion').in('id_art', unicos.slice(i, i + 200))
    if (error) return out
    for (const a of (data as { id_art: string; descripcion: string | null }[] | null) ?? []) {
      if (a.descripcion) out.set(a.id_art.toUpperCase(), a.descripcion)
    }
  }
  return out
}
