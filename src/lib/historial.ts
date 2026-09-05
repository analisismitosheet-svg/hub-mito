import { supabase } from '@/lib/supabase'

export interface HistorialEntry {
  id: string
  entidad: 'guia' | 'facturacion' | 'nota_credito'
  registro_id: string
  accion: 'creacion' | 'modificacion' | 'borrado'
  usuario_nombre: string | null
  usuario_email: string | null
  detalle: string | null
  created_at: string
}

/** Registra un evento en el historial (creación, modificación o borrado). */
export async function registrarHistorial(
  entidad: 'guia' | 'facturacion' | 'nota_credito',
  registroId: string,
  accion: 'creacion' | 'modificacion' | 'borrado',
  usuario: { nombre: string | null; email: string | null },
  detalle?: string,
): Promise<void> {
  if (!supabase) return
  try {
    await supabase.from('historial').insert({
      entidad,
      registro_id: registroId,
      accion,
      usuario_nombre: usuario.nombre,
      usuario_email: usuario.email,
      detalle: detalle || null,
    })
  } catch {
    /* el historial no debe romper la operacion principal */
  }
}

/** Trae el historial de un registro específico. */
export async function obtenerHistorial(entidad: 'guia' | 'facturacion' | 'nota_credito', registroId: string): Promise<HistorialEntry[]> {
  if (!supabase) return []
  const { data } = await supabase
    .from('historial')
    .select('*')
    .eq('entidad', entidad)
    .eq('registro_id', registroId)
    .order('created_at', { ascending: false })
    .limit(100)
  return (data as HistorialEntry[] | null) ?? []
}