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

/** Pedido de compra para el buscador de OC (Recepción INDO). */
export interface PedidoCompraOc {
  codigo: string
  numero: number
  fecha: string | null
  proveedor: string | null
  proveedor_nombre: string | null
  anulado: boolean
}

let promesaLista: Promise<PedidoCompraOc[]> | null = null

/**
 * Todas las OC de VISTAS_CONSOLIDADAS.dbo.PEDIDO_COMPRA (más nuevas primero), una vez por sesión.
 * Sale de public.pedidos_compra_oc: el listado completo, sin la exclusión del proveedor MITO que
 * tiene la copia de Pedidos de compra (sql/pedidos_compra_oc.sql). Vacío si no hay permiso.
 */
export function pedidosCompraParaOc(): Promise<PedidoCompraOc[]> {
  if (!promesaLista) {
    promesaLista = (async () => {
      if (!supabase) return []
      const lista: PedidoCompraOc[] = []
      for (let desde = 0; desde < 20000; desde += 1000) {
        const { data, error } = await supabase
          .from('pedidos_compra_oc')
          .select('codigo,numero,fecha,proveedor,proveedor_nombre,anulado')
          .not('numero', 'is', null)
          .order('fecha', { ascending: false })
          .order('numero', { ascending: false })
          .range(desde, desde + 999)
        if (error) return []
        const pagina = (data as PedidoCompraOc[] | null) ?? []
        lista.push(...pagina)
        if (pagina.length < 1000) break
      }
      return lista
    })()
  }
  return promesaLista
}

/** Une las OC elegidas como las guarda el Excel: "15183/15347". */
export function unirOcs(ocs: string[]): string {
  return [...new Set(ocs.map((s) => s.trim()).filter(Boolean))].join('/')
}

/** Artículo que coincidió en los ítems de una OC (buscador por artículo). */
export interface ArticuloOc {
  articulo: string
  cantidad: number
}

const cacheArticulos = new Map<string, Map<string, ArticuloOc[]>>()

/**
 * Busca las OC cuyos ÍTEMS coinciden con el texto: código del artículo
 * (pedidos_compra_items.articulo) o descripción del maestro (public.articulos).
 * Devuelve el codigo interno de cada OC -> artículos que coincidieron.
 *
 * Silencioso si no hay permiso 'pedidos_compra.view' (lo que exige la RLS de
 * esas tablas): devuelve vacío y el buscador sigue andando por N° y proveedor,
 * igual que los links de la columna N° OC.
 */
export function buscarOcsPorArticulo(texto: string): Promise<Map<string, ArticuloOc[]>> {
  const t = texto.trim().toUpperCase()
  if (t.length < 2 || !supabase) return Promise.resolve(new Map())
  const ya = cacheArticulos.get(t)
  if (ya) return Promise.resolve(ya)
  return (async () => {
    const out = new Map<string, ArticuloOc[]>()
    const anotar = (filas: { codigo: string | null; articulo: string | null; cantidad: number | null }[] | null) => {
      for (const f of filas ?? []) {
        if (!f.codigo || !f.articulo) continue
        const lista = out.get(f.codigo) ?? []
        if (!lista.some((a) => a.articulo === f.articulo)) {
          lista.push({ articulo: f.articulo, cantidad: Number(f.cantidad ?? 0) })
        }
        out.set(f.codigo, lista)
      }
    }
    // En paralelo: por código de artículo y por descripción del maestro
    const [porCodigo, porDescripcion] = await Promise.all([
      supabase.from('pedidos_compra_items').select('codigo,articulo,cantidad').ilike('articulo', `%${t}%`).limit(400),
      supabase.from('articulos').select('id_art').ilike('descripcion', `%${t}%`).limit(80),
    ])
    if (!porCodigo.error) anotar(porCodigo.data as Parameters<typeof anotar>[0])
    if (!porDescripcion.error) {
      const ids = ((porDescripcion.data as { id_art: string }[] | null) ?? []).map((a) => a.id_art).filter(Boolean)
      if (ids.length) {
        const r = await supabase.from('pedidos_compra_items').select('codigo,articulo,cantidad').in('articulo', ids).limit(400)
        if (!r.error) anotar(r.data as Parameters<typeof anotar>[0])
      }
    }
    cacheArticulos.set(t, out)
    return out
  })()
}

/** El Excel a veces trae varias OC en una celda: "15183/15347/15329". */
export function ocsDeFila(nOc: string | null | undefined): string[] {
  return String(nOc ?? '')
    .split(/[/;,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}
