/**
 * Set de números de pedido de compra que existen en la base, para decidir qué OC de
 * Recepción INDO se puede linkear y cuál no.
 *
 * Se pide solo la columna `numero` (601 filas) y una vez por sesión. Si la consulta falla
 * casi siempre es que el usuario no tiene 'pedidos_compra.view': la política de RLS de
 * public.pedidos_compra lo exige, igual que la ruta /compras/pedidos-compra. En ese caso
 * se devuelve un set vacío y la columna N° OC queda sin links, que es lo correcto: no
 * se puede abrir el detalle de un pedido que no tiene permiso de ver.
 */
import { supabase } from './supabase'

let promesa: Promise<Set<string>> | null = null

export function numerosPedidoCompra(): Promise<Set<string>> {
  if (!promesa) {
    promesa = (async () => {
      if (!supabase) return new Set<string>()
      const { data, error } = await supabase
        .from('pedidos_compra')
        .select('numero')
        .range(0, 4999)
      if (error) {
        // Sin permiso (o sin tabla): se cachea igual el resultado vacío para no reintentar
        // en cada render.
        return new Set<string>()
      }
      return new Set(
        ((data as { numero: number | null }[] | null) ?? [])
          .map((p) => String(p.numero ?? '').trim())
          .filter(Boolean),
      )
    })()
  }
  return promesa
}

/** El Excel a veces trae varias OC en una celda: "15183/15347/15329". */
export function ocsDeFila(nOc: string | null | undefined): string[] {
  return String(nOc ?? '')
    .split(/[/;,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}
