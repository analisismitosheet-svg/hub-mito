import { supabase } from '@/lib/supabase'
import { NOMBRES, codigoDe } from '@/lib/replicas'

/**
 * Administradores > Stock valorizado: unidades y plata (a costo) por sucursal.
 *
 * Sale de /api/sql/stock-valorizado → Puente SQL → sql/stock-valorizado.sql.
 * El costo es el de la lista "Compra" (LISTA0) de la base INDO, cargada por artículo:
 * las unidades de un artículo sin costo cargado se cuentan pero valen 0, y la
 * pantalla las muestra aparte para que el número no engañe.
 *
 * Los nombres de sucursal se reusan de `replicas.ts` (DRAGONFISH_VCPD →
 * "CARLOS PAZ"), que es la misma tabla de códigos que usa Sistemas > Réplicas.
 */

export interface BaseValorizada {
  base: string
  unidades: number
  valorizado: number
  unidades_sin_costo: number
  skus: number
  /** mercadería en tránsito (ya sumada en unidades/valorizado); falta con un puente viejo */
  transito?: number
  transito_val?: number
}

export interface ArticuloValorizado {
  articulo: string
  descripcion: string
  unidades: number
  valorizado: number
  costo: number | null
  /** de esas unidades, las que están en tránsito */
  transito?: number
  /** código de proveedor (ART.ARTFAB) y de material (ART.MAT); faltan con un puente viejo */
  proveedor?: string
  material?: string
}

/** Artículo con stock que no tiene costo cargado en la lista Compra: vale $0. */
export interface ArticuloSinCosto {
  articulo: string
  descripcion: string
  /** unidades totales, sumando todas las sucursales */
  unidades: number
  /** de esas, las que están en sucursales que valorizan (no insumos tipo NOMED) */
  unidades_val: number
  sucursales: number
  /** sucursales donde está, ya sin el prefijo DRAGONFISH_ */
  bases: string
  proveedor?: string
  material?: string
}

/** Una fila por artículo sin costo y sucursal: dónde están esas unidades. */
export interface SinCostoPorBase {
  articulo: string
  base: string
  unidades: number
  /** si esa base suma al total (las de insumos tipo NOMED valen $0 enteras) */
  valoriza: boolean
}

/**
 * Sucursal x proveedor x material. Con esto la pantalla rearma las tarjetas y la
 * tabla por sucursal al filtrar, sin volver a pedirle nada al puente: cada
 * artículo cae en un solo proveedor y un solo material, así que sumar las filas
 * que pasan el filtro da el mismo número que recorrer artículo por artículo.
 */
export interface CrucePorBase {
  base: string
  proveedor: string
  material: string
  unidades: number
  valorizado: number
  unidades_sin_costo: number
  skus: number
  transito: number
  transito_val: number
}

/** Nombre de un código: `tipo` es 'prov' (proveedor) o 'mat' (material). */
export interface NombreClasificacion {
  tipo: string
  codigo: string
  nombre: string
}

export interface StockValorizado {
  servidor: string
  bases: BaseValorizada[]
  articulos: ArticuloValorizado[]
  sin_costo: ArticuloSinCosto[]
  sin_costo_detalle: SinCostoPorBase[]
  cruce: CrucePorBase[]
  clasificaciones: NombreClasificacion[]
  costo: { lista: string; lista_nombre: string; base: string; articulos_con_costo: number }
  calculado: string | null
  cacheado: boolean
  segundos: number | null
}

/** GET /api/sql/stock-valorizado con el JWT de la sesión activa. */
export async function cargarStockValorizado(forzar = false): Promise<StockValorizado> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sin sesión activa.')

  const res = await fetch(`/api/sql/stock-valorizado${forzar ? '?forzar=1' : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = (await res.json().catch(() => null)) as (StockValorizado & { error?: string }) | null
  if (!res.ok || !body) throw new Error(body?.error ?? `Error ${res.status} calculando el stock valorizado`)
  return {
    servidor: body.servidor ?? '',
    bases: body.bases ?? [],
    articulos: body.articulos ?? [],
    sin_costo: body.sin_costo ?? [],
    sin_costo_detalle: body.sin_costo_detalle ?? [],
    cruce: body.cruce ?? [],
    clasificaciones: body.clasificaciones ?? [],
    costo: body.costo ?? { lista: 'LISTA0', lista_nombre: 'Compra', base: 'INDO', articulos_con_costo: 0 },
    calculado: body.calculado ?? null,
    cacheado: body.cacheado === true,
    segundos: body.segundos ?? null,
  }
}

/** Un artículo dentro de una sucursal (lo que despliega cada fila de la tabla). */
export interface ArticuloDeBase {
  articulo: string
  unidades: number
  valorizado: number
  costo: number | null
  transito: number
}

/**
 * Los artículos de UNA sucursal, para el desplegable de la tabla por sucursal.
 *
 * No viajan con el resto: son 50.000 filas (5,6 MB) y la respuesta se iba a
 * 8,4 MB, muy arriba del tope de ~4,5 MB de Vercel. El puente las guarda de la
 * corrida completa y devuelve solo la base que se abre, así que es instantáneo
 * y es la misma foto que la fila que se está abriendo.
 */
export async function cargarArticulosDeBase(base: string): Promise<ArticuloDeBase[]> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sin sesión activa.')

  const res = await fetch(`/api/sql/stock-valorizado?base=${encodeURIComponent(base)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = (await res.json().catch(() => null)) as { articulos?: ArticuloDeBase[]; error?: string } | null
  if (!res.ok || !body) throw new Error(body?.error ?? `Error ${res.status} buscando los artículos de la sucursal`)
  return body.articulos ?? []
}

/**
 * Nombres de las bases que aparecen acá y no están en la tabla de `replicas.ts`
 * (esa usa los códigos del Replicador, que no siempre son el nombre de la base:
 * `BUSTD` vs `DRAGONFISH_BUSTOD`). Se consulta primero esta.
 */
const NOMBRES_BASE: Record<string, string> = {
  '9DEJUL2': '9 DE JULIO',
  BUSTOD: 'BUSTOS',
  CENTRALD: 'CENTRAL',
  DINOD: 'DINO',
  ESPINOD: 'ESPINOSA',
  FABRICA: 'FÁBRICA',
  FALLASD: 'FALLAS',
  GRALPAZ: 'GENERAL PAZ',
  LIBERD: 'LIBERTAD',
  MUNOZ: 'MUÑOZ',
  NOMED: 'NOMED (insumos)',
  NVOCED2: 'NUEVO CENTRO',
  OUTLETD: 'OUTLET',
  PRODUC: 'PRODUCCIÓN',
  RIVERAD: 'RIVERA',
  RUTA9D2: 'RUTA 9',
  'TX-POLO': 'POLO 52 (TX)',
  WALMARTD: 'WALMART',
}

/** 'DRAGONFISH_VCPD' -> 'CARLOS PAZ' (si no está en ninguna tabla, el código pelado). */
export function nombreBase(base: string): string {
  const cod = codigoDe(String(base ?? '').toUpperCase())
  return NOMBRES_BASE[cod] ?? NOMBRES[cod] ?? cod
}

const PESOS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})

const NUM = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

export const pesos = (v: number) => PESOS.format(Number.isFinite(v) ? v : 0)
export const numero = (v: number) => NUM.format(Number.isFinite(v) ? v : 0)

/** "$ 1.050 M" / "$ 12,3 M" / "$ 850 k": para los totales grandes de las tarjetas. */
export function pesosCorto(v: number): string {
  const n = Number.isFinite(v) ? v : 0
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return `$ ${(n / 1_000_000_000).toLocaleString('es-AR', { maximumFractionDigits: 2 })} MM`
  if (abs >= 1_000_000) return `$ ${(n / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M`
  if (abs >= 1_000) return `$ ${(n / 1_000).toLocaleString('es-AR', { maximumFractionDigits: 0 })} k`
  return pesos(n)
}

export interface TotalValorizado {
  unidades: number
  valorizado: number
  unidades_sin_costo: number
  skus: number
  sucursales: number
  transito: number
  transito_val: number
}

export function totalDe(bases: BaseValorizada[]): TotalValorizado {
  return bases.reduce<TotalValorizado>(
    (t, b) => ({
      unidades: t.unidades + b.unidades,
      valorizado: t.valorizado + b.valorizado,
      unidades_sin_costo: t.unidades_sin_costo + b.unidades_sin_costo,
      skus: t.skus + b.skus,
      sucursales: t.sucursales + 1,
      transito: t.transito + (b.transito ?? 0),
      transito_val: t.transito_val + (b.transito_val ?? 0),
    }),
    { unidades: 0, valorizado: 0, unidades_sin_costo: 0, skus: 0, sucursales: 0, transito: 0, transito_val: 0 },
  )
}

/**
 * Rehace la fila de cada sucursal con solo los proveedores y materiales
 * elegidos. Un set vacío quiere decir "todos". Devuelve lo mismo que manda el
 * SQL en la primera consulta (misma forma, mismo orden por plata, y sin las
 * sucursales que quedan en cero), así la pantalla no distingue un caso del otro.
 */
export function basesDesdeCruce(
  cruce: CrucePorBase[],
  proveedores: Set<string>,
  materiales: Set<string>,
): BaseValorizada[] {
  const porBase = new Map<string, BaseValorizada>()
  for (const f of cruce) {
    if (proveedores.size > 0 && !proveedores.has(f.proveedor)) continue
    if (materiales.size > 0 && !materiales.has(f.material)) continue
    const b = porBase.get(f.base)
    if (b) {
      b.unidades += f.unidades
      b.valorizado += f.valorizado
      b.unidades_sin_costo += f.unidades_sin_costo
      b.skus += f.skus
      b.transito = (b.transito ?? 0) + f.transito
      b.transito_val = (b.transito_val ?? 0) + f.transito_val
    } else {
      porBase.set(f.base, {
        base: f.base,
        unidades: f.unidades,
        valorizado: f.valorizado,
        unidades_sin_costo: f.unidades_sin_costo,
        skus: f.skus,
        transito: f.transito,
        transito_val: f.transito_val,
      })
    }
  }
  return [...porBase.values()].filter((b) => b.unidades !== 0).sort((a, b) => b.valorizado - a.valorizado)
}

/** Costo promedio por unidad (0 si no hay unidades). */
export const costoUnitario = (b: { unidades: number; valorizado: number }) =>
  b.unidades > 0 ? b.valorizado / b.unidades : 0
