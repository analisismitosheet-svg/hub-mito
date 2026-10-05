import { estadoConexion, leerVista, type FilaSql } from '@/lib/sqlApi'

/**
 * ============================================================
 *  Stock por artículo (Mapeo depósito · Orden mapeado)
 * ============================================================
 *
 * El mapeo guarda solo el artículo (sin color ni talle), así que lo que se
 * muestra al lado del código es el stock TOTAL del artículo: la suma del
 * stock de todos sus SKUs en MITO.
 *
 * Sale de la vista `vw_STOCK_ARTICULO_MITO` (una fila por artículo), creada
 * con `node scripts/sql.mjs --alias -f sql/vw_STOCK_ARTICULO_MITO.sql` sobre
 * vw_ARTICULOS_MITO, así el número es idéntico al de F12 Consulta artículos.
 * Hay que habilitarla en Configuraciones > Conexión SQL (si no, el proxy
 * contesta "Vista no habilitada") y conviene subir el tope de filas a 3000
 * o más: con el default (1000) la vista viene cortada. Se cambia el nombre
 * con VITE_SQL_VISTA_STOCK_ARTICULO.
 */

export const VISTA_STOCK_ARTICULO =
  (import.meta.env.VITE_SQL_VISTA_STOCK_ARTICULO as string | undefined)?.trim() ||
  'DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_STOCK_ARTICULO_MITO'

/** Tope que se le pide al proxy: el servidor igual recorta a sql_conexion.max_rows. */
const TOPE_PEDIDO = 60000

export interface StockArticulos {
  /** código en mayúsculas -> stock total del artículo */
  porCodigo: Map<string, number>
  /** true si vino entero (no se cortó por el tope de filas del proxy) */
  completo: boolean
  /** tope de filas efectivo (Configuraciones > Conexión SQL) */
  tope: number | null
  /** filas que devolvió la vista */
  filas: number
}

export function claveArticulo(codigo: string): string {
  return codigo.trim().toUpperCase()
}

/**
 * Stock de un artículo, o null si no hay dato (el artículo no aparece en la
 * vista y además no se pudo confirmar que la vista vino entera).
 */
export function stockDe(stock: StockArticulos | null, codigo: string): number | null {
  if (!stock) return null
  const v = stock.porCodigo.get(claveArticulo(codigo))
  return v ?? (stock.completo ? 0 : null)
}

/** "ID_ARTICULO" -> "idarticulo" (minúsculas, sin tildes ni separadores) */
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/** Número del SQL Server: acepta "1234.50", "1234,50" y "1.234,56". */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const crudo = String(v).trim().replace(/\s/g, '')
  if (crudo === '') return null
  const s = crudo.replace(/[^\d.,-]/g, '')
  if (s === '' || s === '-') return null
  const coma = s.lastIndexOf(',')
  const punto = s.lastIndexOf('.')
  let normalizado = s
  if (coma > -1 && punto > -1) {
    // el separador decimal es el que aparece último
    normalizado = coma > punto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (coma > -1) {
    normalizado = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '')
  }
  const n = Number(normalizado)
  return Number.isFinite(n) ? n : null
}

/** Columnas que se aceptan para cada campo (misma lista que F12 Consulta artículos). */
const ALIAS: Record<'codigo' | 'stock', string[]> = {
  codigo: ['idarticulo', 'artcod', 'codigo', 'idart', 'articulo', 'art'],
  stock: ['stockmito', 'stock', 'stockdisponible', 'existencia', 'cantidad', 'stocktotal', 'stockalmacen'],
}

/** Columna de cada campo, resuelta por fila (si la vista cambia de nombre, no rompe). */
function columnasDe(fila: FilaSql): { codigo: string | null; stock: string | null } {
  const porNorm = new Map<string, string>()
  for (const k of Object.keys(fila)) porNorm.set(norm(k), k)
  return {
    codigo: ALIAS.codigo.map((a) => porNorm.get(a)).find(Boolean) ?? null,
    stock: ALIAS.stock.map((a) => porNorm.get(a)).find(Boolean) ?? null,
  }
}

/**
 * Trae el stock total de todos los artículos de la vista.
 *
 * Tira error si la vista no responde o viene vacía: la pantalla decide qué
 * mostrar, pero con una lista vacía NO se puede concluir que todo está en 0.
 */
export async function cargarStockArticulos(): Promise<StockArticulos> {
  // El tope efectivo sale del estado del proxy: sirve para saber si la vista
  // vino entera o cortada (sin eso, "no aparece" y "está en 0" se confunden).
  const [filas, estado] = await Promise.all([
    leerVista(VISTA_STOCK_ARTICULO, TOPE_PEDIDO),
    estadoConexion().catch(() => null),
  ])
  if (filas.length === 0) throw new Error('La vista de stock devolvió 0 filas.')

  const porCodigo = new Map<string, number>()
  for (const f of filas) {
    const { codigo, stock } = columnasDe(f)
    if (!codigo) continue
    const clave = claveArticulo(String(f[codigo] ?? ''))
    const n = num(stock ? f[stock] : null)
    if (!clave || n === null) continue
    // Por si la vista alguna vez devuelve el artículo repetido: se suma
    porCodigo.set(clave, (porCodigo.get(clave) ?? 0) + n)
  }
  if (porCodigo.size === 0) {
    throw new Error('La vista de stock no trae columnas reconocibles (ID_ARTICULO, STOCK_MITO).')
  }

  // Vino entero solo si pudimos saber el tope y el servidor no nos cortó.
  // Con el tope desconocido se da por cortado: adivinar lo contrario haría
  // que "no aparece" se lea como "está en 0".
  const tope = estado?.maxRows ?? null
  const completo = tope !== null && filas.length < tope
  return { porCodigo, completo, tope, filas: filas.length }
}
