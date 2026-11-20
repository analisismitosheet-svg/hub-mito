import { supabase } from '@/lib/supabase'

/**
 * Mayorista > Stock: dos solapas, las dos de DRAGONFISH_MITO.
 *  - Depósito: stock por artículo + color + talle (ZooLogic.COMB).
 *  - Tapera: lo remitido a clientes mayoristas que todavía no se facturó
 *    (remitos de venta menos lo que les descontaron facturas y cancelaciones).
 *
 * Sale de /api/sql/stock-mayorista → Puente SQL → puente-sql/sql/stock-mayorista.sql.
 */

export interface LineaDeposito {
  a: string
  c: string
  t: string
  u: number
  tr: number
}

export interface LineaTapera {
  remito: number
  fecha: string
  cli: string
  cli_nom: string
  a: string
  c: string
  t: string
  u: number
  precio: number
}

export interface ArticuloInfo {
  a: string
  des: string
  mat: string
  mat_nom: string
  prov: string
  prov_nom: string
}

export interface StockMayorista {
  deposito: LineaDeposito[]
  tapera: LineaTapera[]
  articulos: ArticuloInfo[]
  colores: { c: string; des: string }[]
  calculado: string | null
  cacheado?: boolean
  segundos?: number
}

export async function cargarStockMayorista(forzar = false): Promise<StockMayorista> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sin sesión activa.')

  const res = await fetch(`/api/sql/stock-mayorista${forzar ? '?forzar=1' : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = (await res.json().catch(() => null)) as (StockMayorista & { error?: string }) | null
  if (!res.ok || !body) throw new Error(body?.error ?? `Error ${res.status} leyendo el stock`)
  return {
    deposito: body.deposito ?? [],
    tapera: body.tapera ?? [],
    articulos: body.articulos ?? [],
    colores: body.colores ?? [],
    calculado: body.calculado ?? null,
    cacheado: body.cacheado === true,
    segundos: body.segundos,
  }
}

const ORDEN_LETRAS = ['U', 'XXS', 'XS', 'S', 'SM', 'M', 'L', 'LXL', 'XL', 'XXL', '2XL', '3XL', 'XXXL', '4XL', '5XL']

/** Orden de talles: letras en su orden natural, números de menor a mayor. */
export function compararTalles(a: string, b: string): number {
  const ia = ORDEN_LETRAS.indexOf(a.toUpperCase())
  const ib = ORDEN_LETRAS.indexOf(b.toUpperCase())
  if (ia >= 0 && ib >= 0) return ia - ib
  const na = Number(a)
  const nb = Number(b)
  const esNa = a !== '' && !Number.isNaN(na)
  const esNb = b !== '' && !Number.isNaN(nb)
  if (esNa && esNb) return na - nb
  if (ia >= 0 || esNa) return -1
  if (ib >= 0 || esNb) return 1
  return a.localeCompare(b)
}

export const numero = (n: number) => n.toLocaleString('es-AR')
export const pesos = (n: number) => `$ ${Math.round(n).toLocaleString('es-AR')}`

/** Días entre una fecha YYYY-MM-DD y hoy. */
export function diasDesde(fecha: string): number {
  const d = new Date(`${fecha}T00:00:00`)
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  return Math.max(0, Math.round((hoy.getTime() - d.getTime()) / 864e5))
}
