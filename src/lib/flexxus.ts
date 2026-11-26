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
  /** debe − haber acumulado en el ejercicio antes del rango (incluye la apertura) */
  previo: number
  debe: number
  haber: number
  lineas: number
}

export interface Ejercicio {
  codigo: number
  descripcion: string
  inicio: string
  fin: string
}

/** Quién hizo cada asiento: manual (con historia de cambios) o automático (usuario del comprobante). */
export interface UsuarioAsiento {
  asiento: number
  manual: boolean
  creo: string
  creo_en: string
  edito: string
  edito_en: string
  ediciones: number
  /** tipo del comprobante que generó el asiento (FA, PA, IN…) */
  origen: string
}

export interface LineaMayor {
  asiento: number
  numero: number
  fecha: string
  obs: string
  debe: number
  haber: number
}

export interface CentroCosto {
  centro: string
  descripcion: string
  rubro: string
  activo: boolean
}

interface Meta {
  calculado: string | null
  cacheado: boolean
  segundos?: number
}

export type Ventas = Meta & { comprobantes: ComprobanteVenta[] }
export type Saldos = Meta & { deuda: DeudaCliente[]; hoy: string }
export type Asientos = Meta & { asientos: CabezaAsiento[]; lineas: LineaAsiento[]; cuentas: Cuenta[]; usuarios?: UsuarioAsiento[] }
export type Balance = Meta & { movimientos: MovimientoCuenta[]; cuentas: Cuenta[]; ejercicio?: Ejercicio }
export type Mayor = Meta & { cuenta: string; lineas: LineaMayor[]; recortado: boolean }
export type Centros = Meta & {
  centros: CentroCosto[]
  apropiado: { centro: string; cuenta: string; neto: number; lineas: number }[]
  totales: { cuenta: string; neto: number }[]
  cuentas: Cuenta[]
}

/** Cuenta de Resultados no asignados: recibe el resultado del ejercicio anterior al rango. */
export const CUENTA_RNA = '3300000001'

/** Patrimoniales (Activo, Pasivo, Patrimonio neto): las que empiezan con 1, 2 o 3 arrastran saldo. */
export const arrastraSaldo = (cuenta: string) => /^[123]/.test(cuenta)

export interface FilaBalance extends MovimientoCuenta {
  inicial: number
  final: number
}

/**
 * Saldo inicial de cada cuenta según las reglas del contador:
 *  - 1, 2 y 3 arrastran el saldo (apertura + movimientos del ejercicio antes del rango);
 *  - las de resultado arrancan en 0 en el rango;
 *  - Resultados no asignados suma, además, el resultado de las cuentas de resultado
 *    desde el inicio del ejercicio hasta el día anterior al rango (el «mes anterior»).
 */
export function armarBalance(movs: MovimientoCuenta[]): FilaBalance[] {
  const resultadoPrevio = movs.filter((m) => !arrastraSaldo(m.cuenta)).reduce((t, m) => t + m.previo, 0)
  const filas = movs.map((m) => {
    let inicial = arrastraSaldo(m.cuenta) ? m.previo : 0
    if (m.cuenta === CUENTA_RNA) inicial += resultadoPrevio
    return { ...m, inicial, final: inicial + m.debe - m.haber }
  })
  if (Math.abs(resultadoPrevio) >= 0.5 && !filas.some((f) => f.cuenta === CUENTA_RNA)) {
    filas.push({ cuenta: CUENTA_RNA, previo: 0, debe: 0, haber: 0, lineas: 0, inicial: resultadoPrevio, final: resultadoPrevio })
  }
  return filas.filter((f) => Math.abs(f.inicial) >= 0.5 || f.debe || f.haber)
}

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
export const cargarMayor = (desde: string, hasta: string, cuenta: string) =>
  pedir<Mayor>({ consulta: 'mayor', desde, hasta, cuenta })
export const cargarCentros = (desde: string, hasta: string, forzar = false) =>
  pedir<Centros>({ consulta: 'centros', desde, hasta, ...f(forzar) })

/* ------------------- clasificación propia de cuentas ------------------- */

/**
 * Clasificación del contador para cada cuenta (tabla flexxus_clasificacion en
 * Supabase, NO en Flexxus): Clasificación → Rubro → Nota, como su planilla.
 */
export interface Clasificacion {
  cuenta: string
  clasificacion: string
  rubro: string
  nota: string
}

export async function cargarClasificacion(): Promise<Map<string, Clasificacion>> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { data, error } = await supabase.from('flexxus_clasificacion').select('cuenta, clasificacion, rubro, nota')
  if (error) throw new Error(error.message)
  return new Map((data ?? []).map((c) => [c.cuenta as string, c as Clasificacion]))
}

/** Guarda la clasificación de una cuenta; si quedan los tres vacíos, la borra. */
export async function guardarClasificacion(c: Clasificacion): Promise<void> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const fila = { cuenta: c.cuenta, clasificacion: c.clasificacion.trim(), rubro: c.rubro.trim(), nota: c.nota.trim() }
  const { error } =
    !fila.clasificacion && !fila.rubro && !fila.nota
      ? await supabase.from('flexxus_clasificacion').delete().eq('cuenta', c.cuenta)
      : await supabase.from('flexxus_clasificacion').upsert(fila, { onConflict: 'cuenta' })
  if (error) throw new Error(error.message)
}

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
