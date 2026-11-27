/**
 * Administración > Tablero locales: las hojas Caja y Errores de caja del Tablero del local
 * (TableroLocal.exe), para uno o varios locales. Datos en vivo de la base Dragonfish de cada
 * local por el Puente SQL (POST /api/sql/tablero-locales, ver tableroLocalesApi.ts y
 * puente-sql/tablero-locales.js). Solo lectura.
 */
import { supabase } from '@/lib/supabase'

export interface DiaVenta { fecha: string; monto: number; unidades: number; tickets: number }
export interface ValorCaja { id: string; nombre: string; grupo: string; recargo: number; monto: number }
export interface VendedorCaja { id: string; nombre: string | null; tickets: number; unidades: number; monto: number; primeraVenta: string; ultimaVenta: string }
export interface ComprobanteCaja {
  fecha: string; hora: string; numero: number; origdest: string; vendedor: string; concepto: string
  conceptoDesc: string | null; tipo: 'ENTRADA' | 'SALIDA'; observaciones: string | null; total: number
}
export interface Arqueo { codigo: string; numero: number; fecha: string; hora: string; vendedor: string; diferencia: number; arqueado: number; sistema: number }
export interface CajaLocal {
  local: string
  ok: boolean
  error?: string
  dias: DiaVenta[]
  valores: ValorCaja[]
  vendedores: VendedorCaja[]
  comprobantes: ComprobanteCaja[]
  arqueos: Arqueo[]
  cierres: Array<{ fecha: string; hora: string }>
}
export interface RespCaja { desde: string; hasta: string; locales: CajaLocal[]; objetivos: Array<{ local: string; fecha: string; objetivo: number | null }> }
export interface Billete { billete: string; cantidad: number; total: number }
export interface Cobro {
  local: string; codigo: string; fecha: string; hora: string; factura: string; valor: string; valorDesc: string | null
  recibi: number; recargo: number; totalFactura: number; vendedor: string
}
export interface RespErrores { filas: Cobro[]; recortado: boolean; fallidos: Array<{ local: string; error: string }> }
export interface ArticuloComp { articulo: string; descripcion: string | null; color: string; talle: string; unidades: number; precio: number; monto: number; dtoPromo: number }

async function pedir<T>(cuerpo: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sin sesión activa.')
  const res = await fetch('/api/sql/tablero-locales', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok || !body) throw new Error(body?.error ?? `Error ${res.status} leyendo el tablero`)
  return body
}

export const cargarCaja = (desde: string, hasta: string, locales: string[]) => pedir<RespCaja>({ hoja: 'caja', desde, hasta, locales })
export const cargarBilletes = (local: string, arqueo: string) => pedir<{ billetes: Billete[] }>({ hoja: 'billetes', local, arqueo })
export const cargarErrores = (desde: string, hasta: string, locales: string[]) => pedir<RespErrores>({ hoja: 'errores', desde, hasta, locales })
export const cargarArticulos = (local: string, codigo: string) => pedir<{ articulos: ArticuloComp[] }>({ hoja: 'articulos', local, codigo })

/** Captain Fin = códigos que empiezan con CF; el resto son locales Mito. */
export const esCaptain = (cod: string) => /^CF/i.test(cod)
