import { estadoConexion, leerVista, type FilaSql } from '@/lib/sqlApi'

/**
 * ============================================================
 *  Stock por SKU (Pedidos de venta · columna "Stock")
 * ============================================================
 *
 * A diferencia del mapeo —que guarda solo el artículo— cada línea de un
 * pedido de venta es un SKU: articulo + color + talle. Lo que importa al
 * prepararlo es si hay de ESE color y ESE talle, así que esta lib trae el
 * stock por combinación.
 *
 * Sale de la vista `vw_STOCK_SKU_MITO` (17 691 SKUs x 4 columnas,
 * 1,45 MB), creada con `node scripts/sql.mjs --alias -f
 * sql/vw_STOCK_SKU_MITO.sql` sobre vw_ARTICULOS_MITO: mismo número que F12
 * Consulta artículos y misma fórmula de stock.
 *
 * Por qué no se lee vw_ARTICULOS_MITO: trae 14 columnas y 6,8 MB, que no
 * entra en la respuesta de una función serverless.
 *
 * La vista está fija en el env SQL_VIEWS de Vercel (junto con
 * vw_STOCK_ARTICULO_MITO), así que no depende de habilitarla a mano en
 * Configuraciones > Conexión SQL. Se cambia el nombre con
 * VITE_SQL_VISTA_STOCK_SKU.
 *
 * Semántica del resultado: SKU presente -> su número; ausente + vista
 * entera -> 0; ausente + vista cortada o tope desconocido -> null (se
 * muestra "—", no se adivina); vista vacía o sin columnas reconocibles ->
 * tira error.
 */

export const VISTA_STOCK_SKU =
  (import.meta.env.VITE_SQL_VISTA_STOCK_SKU as string | undefined)?.trim() ||
  'DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_STOCK_SKU_MITO'

/** Techo propio de esta lib. Hoy trae 17 691 filas; el servidor recorta
 *  antes con sql_conexion.max_rows (29 900 000): el que corte primero
 *  manda y eso se detecta con `limite`. */
const TOPE_PEDIDO = 40000

export interface StockSku {
  /** SKU "ARTICULO|COLOR|TALLE" (mayúsculas, sin espacios) -> stock */
  porSku: Map<string, number>
  /** artículo -> stock total de todos sus SKUs (para el tooltip) */
  porArticulo: Map<string, number>
  /** true si vino entera: con eso, un SKU que no aparece es que está en 0 */
  completo: boolean
  /** tope de filas del proxy (Configuraciones > Conexión SQL) */
  tope: number | null
  /** límite con el que se pidió: min(tope del proxy, el que pide esta lib) */
  limite: number | null
  /** filas que devolvió la vista */
  filas: number
}

const parte = (v: unknown): string => String(v ?? '').trim().toUpperCase()

/** Stock de TODOS los SKUs de un artículo (para el tooltip de la línea). */
export function stockArticuloDe(stock: StockSku | null, articulo: unknown): number | null {
  if (!stock) return null
  return stock.porArticulo.get(parte(articulo)) ?? null
}

/** Clave de un SKU. Idéntica para la vista y para la línea del pedido. */
export function claveSku(articulo: unknown, color: unknown, talle: unknown): string {
  return `${parte(articulo)}|${parte(color)}|${parte(talle)}`
}

/**
 * Stock de un SKU, o null si no hay dato (la línea no aparece en la vista
 * y además no se pudo confirmar que vino entera).
 */
export function stockSkuDe(
  stock: StockSku | null,
  articulo: unknown,
  color: unknown,
  talle: unknown,
): number | null {
  if (!stock) return null
  const v = stock.porSku.get(claveSku(articulo, color, talle))
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

/** Columnas que se aceptan para cada campo. */
const ALIAS: Record<'articulo' | 'color' | 'talle' | 'stock', string[]> = {
  articulo: ['idarticulo', 'artcod', 'codigo', 'articulo'],
  color: ['colorcodigo', 'colorcod', 'ccolor'],
  talle: ['tallecodigo', 'tallecod', 'tcod'],
  stock: ['stockmito', 'stock', 'stockdisponible', 'existencia', 'stocktotal'],
}

type Campos = { articulo: string | null; color: string | null; talle: string | null; stock: string | null }

/** Columna de cada campo, resuelta por fila (si la vista cambia de nombre, no rompe). */
function columnasDe(fila: FilaSql): Campos {
  const porNorm = new Map<string, string>()
  for (const k of Object.keys(fila)) porNorm.set(norm(k), k)
  const buscar = (nombres: string[]) => nombres.map((a) => porNorm.get(a)).find(Boolean) ?? null
  return {
    articulo: buscar(ALIAS.articulo),
    color: buscar(ALIAS.color),
    talle: buscar(ALIAS.talle),
    stock: buscar(ALIAS.stock),
  }
}

/** Arma el índice. Se usa también para el stock total por artículo. */
function indexar(filas: FilaSql[]): { porSku: Map<string, number>; porArticulo: Map<string, number> } {
  const porSku = new Map<string, number>()
  const porArticulo = new Map<string, number>()
  for (const f of filas) {
    const { articulo, color, talle, stock } = columnasDe(f)
    if (!articulo || !stock) continue
    const art = parte(f[articulo])
    const n = num(f[stock])
    if (!art || n === null) continue
    const col = color ? parte(f[color]) : ''
    const tal = talle ? parte(f[talle]) : ''
    // La vista escribe 'UNICO' donde el pedido puede traer el talle vacío:
    // se indexa con las dos formas para que la línea igual encuentre su stock.
    const clave = `${art}|${col}|${tal}`
    porSku.set(clave, (porSku.get(clave) ?? 0) + n)
    if (tal === 'UNICO') porSku.set(`${art}|${col}|`, (porSku.get(`${art}|${col}|`) ?? 0) + n)
    porArticulo.set(art, (porArticulo.get(art) ?? 0) + n)
  }
  return { porSku, porArticulo }
}

async function leerStockSku(): Promise<StockSku> {
  // El tope efectivo sale del estado del proxy: sirve para saber si la
  // vista vino entera o cortada.
  const [filas, estado] = await Promise.all([
    leerVista(VISTA_STOCK_SKU, TOPE_PEDIDO),
    estadoConexion().catch(() => null),
  ])
  if (filas.length === 0) throw new Error('La vista de stock por SKU devolvió 0 filas.')

  const { porSku, porArticulo } = indexar(filas)
  if (porSku.size === 0) {
    throw new Error(
      'La vista de stock por SKU no trae columnas reconocibles (ID_ARTICULO, COLOR_CODIGO, TALLE_CODIGO, STOCK_MITO).',
    )
  }

  const tope = estado?.maxRows ?? null
  const limite = tope === null ? null : Math.min(TOPE_PEDIDO, tope)
  const completo = limite !== null && filas.length < limite
  return { porSku, porArticulo, completo, tope, limite, filas: filas.length }
}

// Se carga una vez por sesión (17 691 filas): Pedidos de venta cambia de
// pedido sin volver a bajar la vista. Los errores no se guardan.
let cache: Promise<StockSku> | null = null

export function cargarStockSku(opciones: { refrescar?: boolean } = {}): Promise<StockSku> {
  if (!opciones.refrescar && cache) return cache
  const p = leerStockSku()
  cache = p
  void p.catch(() => {
    if (cache === p) cache = null
  })
  return p
}

/** Para los tests (y para forzar una recarga contra la vista). */
export function limpiarCacheStockSku(): void {
  cache = null
}
