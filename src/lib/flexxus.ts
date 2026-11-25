import { supabase } from '@/lib/supabase'

/**
 * Administración > Flexxus: ventas, saldos de clientes y asientos de la base
 * Firebird de Flexxus (M1T0O1), en vivo y solo lectura.
 *
 * /api/sql/flexxus → Puente SQL (acción 'flexxus', puente-sql/flexxus.js) →
 * servidor vinculado FLEXXUS del SQL local. El puente cachea 2 minutos.
 */

export interface ComprobanteVenta {
  fecha: string
  tipo: string
  pv: number
  numero: number
  cliente: string
  razon: string
  total: number
  iva: number
  moneda: string
  /** total en pesos (con la cotización si el comprobante es en otra moneda) */
  pesos: number
}

export interface DeudaCliente {
  cliente: string
  razon: string
  cuit: string
  limite: number
  tipo: string
  numero: number
  fecha: string
  vence: string
  saldo: number
  moneda: string
}

export interface Cuenta {
  cuenta: string
  descripcion: string
  madre: string
  imputable: boolean
  patrimonial: boolean
}

export interface CabezaAsiento {
  asiento: number
  numero: number
  fecha: string
  obs: string
}

/** [asiento, cuenta, monto, esDebe(1/0)] */
export type LineaAsiento = [number, string, number, 0 | 1]

export interface MovimientoCuenta {
  cuenta: string
  debe: number
  haber: number
  lineas: number
}

interface Meta {
  calculado: string | null
  cacheado: boolean
  segundos?: number
}

export type Ventas = Meta & { comprobantes: ComprobanteVenta[] }
export type Saldos = Meta & { deuda: DeudaCliente[]; hoy: string }
export type Asientos = Meta & { asientos: CabezaAsiento[]; lineas: LineaAsiento[]; cuentas: Cuenta[] }
export type Balance = Meta & { movimientos: MovimientoCuenta[]; cuentas: Cuenta[] }

/** Días máximos del libro diario (lo mismo que acepta el puente). */
export const DIAS_MAX_ASIENTOS = 93

async function pedir<T>(params: Record<string, string>): Promise<T> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sin sesión activa.')
  const res = await fetch(`/api/sql/flexxus?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok || !body) throw new Error(body?.error ?? `Error ${res.status} leyendo Flexxus`)
  return body
}

const f = (forzar: boolean): Record<string, string> => (forzar ? { forzar: '1' } : {})

export const cargarVentas = (desde: string, hasta: string, forzar = false) =>
  pedir<Ventas>({ consulta: 'ventas', desde, hasta, ...f(forzar) })
export const cargarSaldos = (forzar = false) => pedir<Saldos>({ consulta: 'saldos', ...f(forzar) })
export const cargarAsientos = (desde: string, hasta: string, forzar = false) =>
  pedir<Asientos>({ consulta: 'asientos', desde, hasta, ...f(forzar) })
export const cargarBalance = (desde: string, hasta: string, forzar = false) =>
  pedir<Balance>({ consulta: 'balance', desde, hasta, ...f(forzar) })

/* ------------------------------ formatos ------------------------------ */

const PESOS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
const NUM = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
/** Redondea los restos de centavos para no mostrar «-$ 0». */
export const pesos = (v: number) => PESOS.format(Number.isFinite(v) && Math.abs(v) >= 0.5 ? v : 0)
export const numero = (v: number) => NUM.format(Number.isFinite(v) ? v : 0)

/** "$ 1,05 MM" / "$ 12,3 M" / "$ 850 k" para las tarjetas. */
export function pesosCorto(v: number): string {
  const n = Number.isFinite(v) ? v : 0
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return `$ ${(n / 1_000_000_000).toLocaleString('es-AR', { maximumFractionDigits: 2 })} MM`
  if (abs >= 1_000_000) return `$ ${(n / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M`
  if (abs >= 1_000) return `$ ${(n / 1_000).toLocaleString('es-AR', { maximumFractionDigits: 0 })} k`
  return pesos(n)
}

/** AAAA-MM-DD → DD/MM/AA */
export function fechaCorta(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y.slice(2)}`
}

/** Número de comprobante como lo muestra Flexxus: 00017-00029828 (el número trae el punto de venta adelante). */
export function nroComprobante(pv: number, numero: number): string {
  const n = String(numero)
  const resto = n.length > 8 ? n.slice(-8) : n
  return `${String(pv || Number(n.slice(0, -8)) || 0).padStart(5, '0')}-${resto.padStart(8, '0')}`
}

/** Fecha local AAAA-MM-DD. */
export function isoLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000) + 1
}

/** Tramos de antigüedad de la deuda según días vencidos. */
export const TRAMOS = [
  { id: 'a_vencer', texto: 'A vencer' },
  { id: 'd30', texto: '1–30 días' },
  { id: 'd60', texto: '31–60' },
  { id: 'd90', texto: '61–90' },
  { id: 'mas90', texto: '+90' },
] as const
export type Tramo = (typeof TRAMOS)[number]['id']

export function tramoDe(vence: string, hoy: string): Tramo {
  if (!vence) return 'a_vencer'
  const dias = diasEntre(vence, hoy) - 1
  if (dias <= 0) return 'a_vencer'
  if (dias <= 30) return 'd30'
  if (dias <= 60) return 'd60'
  if (dias <= 90) return 'd90'
  return 'mas90'
}

/** Rubro de una cuenta (la de primer nivel, p. ej. ACTIVO) subiendo por CUENTAMADRE. */
export function rubros(cuentas: Cuenta[]): Map<string, Cuenta> {
  const porCodigo = new Map(cuentas.map((c) => [c.cuenta, c]))
  const res = new Map<string, Cuenta>()
  for (const c of cuentas) {
    let actual = c
    for (let i = 0; i < 12; i++) {
      const madre = porCodigo.get(actual.madre)
      if (!madre || madre.cuenta === actual.cuenta) break
      actual = madre
    }
    res.set(c.cuenta, actual)
  }
  return res
}
