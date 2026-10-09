/* ------------------------------------------------------------------ */
/*  Cambios en vivo (Supabase Realtime)                                */
/*                                                                     */
/*  Reemplaza el refresco por temporizador de las pantallas que miran  */
/*  armados: en vez de volver a pedir la lista cada 10-15 s, la base   */
/*  avisa cuando algo cambia y recién ahí se recarga (con debounce,    */
/*  una sola vez por ráfaga de escaneos).                              */
/*                                                                     */
/*  Si las tablas no están publicadas (sql/pedidos_realtime.sql) o el  */
/*  navegador no soporta Realtime, no pasa nada: la pantalla conserva  */
/*  su refresco de respaldo (más lento).                               */
/* ------------------------------------------------------------------ */
import { supabase } from '@/lib/supabase'

/**
 * Escucha los cambios (INSERT/UPDATE/DELETE) de una o más tablas y llama a
 * `alCambiar` una sola vez por ráfaga. Devuelve la función para cortar la
 * suscripción al desmontar la pantalla.
 */
export function suscribirCambios(
  tablas: string[],
  alCambiar: () => void,
  opciones?: { espera?: number },
): () => void {
  if (!supabase || tablas.length === 0) return () => {}
  const espera = opciones?.espera ?? 600
  let temporizador: number | null = null
  const disparar = () => {
    if (temporizador != null) window.clearTimeout(temporizador)
    temporizador = window.setTimeout(() => {
      temporizador = null
      alCambiar()
    }, espera)
  }

  const canal = supabase.channel(`hub-cambios-${Math.random().toString(36).slice(2)}`)
  for (const tabla of tablas) {
    canal.on('postgres_changes', { event: '*', schema: 'public', table: tabla }, disparar)
  }
  canal.subscribe()

  return () => {
    if (temporizador != null) window.clearTimeout(temporizador)
    void supabase?.removeChannel(canal)
  }
}
