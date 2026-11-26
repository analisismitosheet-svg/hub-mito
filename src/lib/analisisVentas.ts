/**
 * Compras > Análisis ventas: tipos y llamada a /api/sql/analisis-ventas (→ Puente SQL, accion 'analisis_ventas').
 * El cálculo vive en puente-sql/analisis-ventas.js; acá solo se pide y se tipa.
 */
import { supabase } from '@/lib/supabase'
import type { OpcionFiltro } from '@/lib/reparto'

export type Comparar = 'anio' | 'anterior' | 'nada'
export type Gran = 'dia' | 'sem' | 'mes' | 'anio'
export type DimFiltro = 'prov' | 'mat' | 'temp' | 'anio' | 'linea' | 'flia' | 'gen' | 'grupo'
export type Dim = DimFiltro | 'local' | 'art'
export type Origen = '' | 'MITO' | 'MARCAS'

export interface Totales { monto: number; unid: number; tickets: number }
export interface PuntoSerie extends Totales { lab: string; desde: string; hasta: string; dow?: number; comp: Totales | null }
export interface FilaTabla { cod: string; nom: string; monto: number; unid: number; tickets: number; comp: number | null; stock: number | null }
export interface AnioMarcas {
  anio: number
  hasta: string
  MITO: { unid: number; monto: number }
  MARCAS: { unid: number; monto: number }
  faltan: number
}

export interface Analisis {
  estado: 'listo'
  desde: string
  hasta: string
  ayer: string
  desde_min: string
  comparado: { desde: string; hasta: string } | null
  kpis: { actual: Totales; comp: Totales | null }
  serie: PuntoSerie[]
  dow: { monto: number; tickets: number; unid: number; dias: number }[] // 0 = domingo
  tabla: { dim: Dim; filas: FilaTabla[]; stock: boolean }
  anio: { desde: string; hasta: string; actual: Totales; comp: Totales | null }
  marcas: AnioMarcas[]
  faltan: { periodo: number; comparado: number }
  carga: { leyendo: boolean; desde: string | null; hasta: string | null; error: string | null; pendientes: number }
  maestro: string | null
  locales: { cod: string; nom: string }[]
  opciones?: Record<DimFiltro, OpcionFiltro[]> | null
}

export interface PedidoAnalisis {
  desde: string
  hasta: string
  comparar: Comparar
  gran: Gran
  dim: Dim
  camino: { dim: Dim; cod: string }[]
  corte: 'dia' | 'anio'
  filtros: Partial<Record<DimFiltro, string[]>> & { locales?: string[]; excluir?: string[]; origen?: Origen; art?: string }
  opciones?: boolean
}

export async function pedirAnalisis(p: PedidoAnalisis, signal?: AbortSignal): Promise<Analisis> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { data } = await supabase.auth.getSession()
  const t = data.session?.access_token
  if (!t) throw new Error('Sesión vencida: volvé a entrar.')
  const res = await fetch('/api/sql/analisis-ventas', {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
    signal,
  })
  const j = (await res.json().catch(() => null)) as (Analisis & { error?: string }) | null
  if (!res.ok || !j) throw new Error(j?.error ?? `Error ${res.status}`)
  return j
}

/** Depósitos, mayorista y bases que no son locales a la calle (afuera por defecto). */
export const NO_MINORISTAS = ['MITO', 'POLO52', 'INDO', 'INDOD', 'TX-POLO', 'FABRICA', 'CENTRALD', 'NOMED', 'OUTLETD']

export const TITULO_DIM: Record<Dim, string> = {
  prov: 'Proveedor', linea: 'Línea', grupo: 'Grupo', mat: 'Material', flia: 'Familia',
  temp: 'Temporada', anio: 'Año', gen: 'Género', local: 'Local', art: 'Artículo',
}
/** Orden de las pestañas «Abrir por» y a qué se abre una fila al tocarla. */
export const DIMS_TABLA: Dim[] = ['prov', 'linea', 'grupo', 'mat', 'flia', 'temp', 'anio', 'gen', 'local', 'art']
export const SIGUIENTE: Record<Dim, Dim | null> = {
  prov: 'linea', linea: 'grupo', grupo: 'art', mat: 'linea', flia: 'linea', temp: 'linea', anio: 'linea', gen: 'linea', local: 'prov', art: null,
}

const hoy = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Cordoba' })
export function sumarDias(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('sv-SE')
}
export const ayerISO = () => sumarDias(hoy(), -1)

export type Rapido = 'ayer' | 'semana' | 'mes' | 'mes_pasado' | 'anio' | '12m'
export const RAPIDOS: [Rapido, string][] = [
  ['ayer', 'Ayer'], ['semana', 'Esta semana'], ['mes', 'Este mes'], ['mes_pasado', 'Mes pasado'], ['anio', 'Este año'], ['12m', 'Últ. 12 meses'],
]
/** Rango de un botón rápido (siempre hasta ayer: el día de hoy no está cerrado). */
export function rangoRapido(r: Rapido): [string, string] {
  const a = ayerISO()
  if (r === 'ayer') return [a, a]
  if (r === 'semana') {
    const d = new Date(`${a}T12:00:00`)
    const lunes = sumarDias(a, -((d.getDay() + 6) % 7))
    return [lunes, a]
  }
  if (r === 'mes') return [`${a.slice(0, 8)}01`, a]
  if (r === 'mes_pasado') {
    const ini = new Date(`${a.slice(0, 8)}01T12:00:00`)
    ini.setMonth(ini.getMonth() - 1)
    const d = ini.toLocaleDateString('sv-SE')
    return [d, sumarDias(`${a.slice(0, 8)}01`, -1)]
  }
  if (r === 'anio') return [`${a.slice(0, 4)}-01-01`, a]
  return [sumarDias(a, -364), a]
}
