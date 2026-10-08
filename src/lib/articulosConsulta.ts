import { supabase } from '@/lib/supabase'
import { COLUMNAS_BUSQUEDA, leerVista, leerVistaFiltrada, type FilaSql } from '@/lib/sqlApi'
import { compararUbicaciones, ubicacionesDeArticulos } from '@/lib/mapeo'

/**
 * ============================================================
 *  F12 · CONSULTA ARTÍCULOS (Mayorista)
 * ============================================================
 *
 * El dato de stock / precio / material / grupo viene del SQL Server de MITO
 * por el proxy /api/sql (Lógica App o Puente SQL). Cada fila es un SKU:
 * artículo + color + talle.
 *
 * La vista se define en sql/vw_ARTICULOS_MITO.sql (VISTAS_CONSOLIDADAS, que
 * lee MITO por el servidor vinculado) y hay que habilitarla en Configuraciones >
 * Conexión SQL. Se puede cambiar con VITE_SQL_VISTA_ARTICULOS.
 *
 * Lo que el SQL no trae (o no se llama como lo espera) se completa con lo que
 * ya está copiado en Supabase:
 *   - descripción, material, grupo y precio -> tabla `articulos` (sync-articulos)
 *   - ubicación                           -> tabla `mapeo_deposito` (QR del depósito)
 */

/**
 * Vista del SQL Server: una fila por artículo + color + talle.
 *
 * Vive en VISTAS_CONSOLIDADAS, en la instancia local de esta PC, y de ahí lee
 * los datos de MITO por el servidor vinculado "MITO". Por eso el nombre lleva
 * el alias del servidor adelante: ALIAS:BASE.ESQUEMA.VISTA. Sin el alias el
 * puente mira en su servidor principal (ZOOLOGIC) y no la encuentra.
 */
export const VISTA_ARTICULOS =
  (import.meta.env.VITE_SQL_VISTA_ARTICULOS as string | undefined)?.trim() ||
  'DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_ARTICULOS_MITO'

/** Tope de filas cuando se busca un término (el proxy lo recorta a SQL_MAX_ROWS). */
const TOP_BUSQUEDA = 500
/** Tope de filas cuando el destino no filtra y hay que acotar en el navegador. */
const TOP_LISTA = 1000

export interface Articulo {
  idArticulo: string
  /** código del color (COLOR_CODIGO, ej. "02") */
  colorCodigo: string
  /** descripción del color (ej. "NEGRO") */
  color: string
  talle: string
  /** código del talle (TALLE_CODIGO) */
  talleCodigo: string
  nombre: string
  material: string
  grupo: string
  /** stock FÍSICO en MITO (columna STOCK_FISICO de la vista); null si el SQL no lo trajo */
  stock: number | null
  /** unidades en pedido (columna EN_PEDIDO); null si el SQL no la trajo */
  pedido: number | null
  precio: number | null
  ubicaciones: string[]
}

export interface ResultadoConsulta {
  filas: Articulo[]
  /** el servidor devolvió exactamente el tope: puede haber más */
  truncado: boolean
  /** el destino no aplicó el filtro (Lógica App) y se filtró en el navegador */
  filtradoEnCliente: boolean
}

type Campo = 'idArticulo' | 'colorCodigo' | 'color' | 'talleCodigo' | 'talle' | 'nombre' | 'material' | 'grupo' | 'stock' | 'pedido' | 'precio'

/**
 * Nombre de columna que se acepta para cada campo, del más exacto al más
 * genérico. Así la pantalla funciona con la vista nueva (ID_ARTICULO,
 * NOMBRE_COMPLETO, STOCK_MITO…) y también con las que ya había
 * (ARTCOD/ARTDES, codigo_modelo/modelo, …).
 * El orden de ORDEN importa: la primera coincidencia gana la columna.
 */
const ALIAS: Record<Campo, string[]> = {
  idArticulo: ['idarticulo', 'artcod', 'codigomodelo', 'codigo', 'idart', 'coart', 'articulo', 'art'],
  colorCodigo: ['colorcodigo', 'codcolor', 'idcolor', 'cocol', 'ccolor'],
  color: ['color', 'descripcolor', 'nombrecolor', 'descripcioncolor', 'colordescripcion'],
  talleCodigo: ['tallecodigo', 'codtalle', 'idtalle'],
  talle: ['talle', 'talledescripcion', 'descriptalle', 'descripciontalle'],
  nombre: [
    'nombrecompleto', 'nombre', 'descripcion', 'modelo', 'artdes',
    'descripcioncompleta', 'articulo_nombre', 'detalle',
  ],
  material: ['material', 'idmaterial', 'descripcionmaterial', 'nombrematerial', 'mater'],
  grupo: ['grupo', 'idgrupo', 'categoria', 'descripciongrupo', 'nombregrupo', 'rubro'],
  // El stock de MITO que se muestra es el FÍSICO (STOCK_FISICO); STOCK_MITO queda solo para vistas viejas
  stock: ['stockfisico', 'stockmito', 'stock', 'stockdisponible', 'existencia', 'cantidad', 'stocktotal', 'stock_almacen'],
  pedido: ['enpedido', 'pedido', 'stockpedido'],
  precio: ['precio', 'preciopublico', 'preciovigente', 'precio_unitario', 'precioventa', 'neto', 'preciodirecto'],
}

const ORDEN: Campo[] = ['idArticulo', 'colorCodigo', 'color', 'talleCodigo', 'talle', 'nombre', 'material', 'grupo', 'stock', 'pedido', 'precio']

/** Descripción "adicional" de las vistas viejas: se suma al nombre del modelo. */
const ALIAS_ADIC = ['artdesadic', 'descripcioncomplet', 'descripcionadicional']

interface Resolucion {
  col: Record<Campo, string | null>
  adic: string | null
}

/** "NOMBRE_COMPLETO" -> "nombrecompleto" (minúsculas, sin tildes ni separadores) */
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function txt(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
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

/**
 * Qué columna de la vista corresponde a cada campo (null si no está).
 * Se resuelve POR FILA y no por resultado: si el SQL mezcla filas con esquemas
 * distintos (o el driver omite columnas), cada una usa sus propias columnas.
 */
function resolverFila(fila: FilaSql): Resolucion {
  const porNorm = new Map<string, string>()
  for (const k of Object.keys(fila)) porNorm.set(norm(k), k)

  const col = {} as Record<Campo, string | null>
  const usadas = new Set<string>()
  for (const campo of ORDEN) {
    let encontrada: string | null = null
    for (const alias of ALIAS[campo]) {
      const c = porNorm.get(alias)
      if (c && !usadas.has(c)) {
        encontrada = c
        break
      }
    }
    col[campo] = encontrada
    if (encontrada) usadas.add(encontrada)
  }

  // Descripción adicional (ARTDESADIC): se suma al nombre si está y no vino ya
  let adic: string | null = null
  for (const alias of ALIAS_ADIC) {
    const c = porNorm.get(alias)
    if (c && !usadas.has(c)) {
      adic = c
      break
    }
  }
  return { col, adic }
}

/** Resoluciones cacheadas por firma de columnas (lo normal es una sola). */
const cacheResolucion = new Map<string, Resolucion>()

function resolver(fila: FilaSql): Resolucion {
  const firma = Object.keys(fila).join('\u0000')
  let r = cacheResolucion.get(firma)
  if (!r) {
    r = resolverFila(fila)
    if (cacheResolucion.size > 50) cacheResolucion.clear()
    cacheResolucion.set(firma, r)
  }
  return r
}

/* ------------------------------------------------------------------ */
/*  Complemento con lo que ya está copiado en Supabase                 */
/* ------------------------------------------------------------------ */

interface Maestro {
  descripcion: string
  material: string
  grupo: string
  precio: number | null
}

/** Descripción, material, grupo y precio del maestro de artículos (sql/articulos.sql). */
async function maestroDe(codigos: string[]): Promise<Map<string, Maestro>> {
  const out = new Map<string, Maestro>()
  const unicos = [...new Set(codigos.map((c) => c.trim().toUpperCase()).filter(Boolean))]
  if (!supabase || unicos.length === 0) return out
  const TANDA = 500
  for (let i = 0; i < unicos.length; i += TANDA) {
    const { data, error } = await supabase
      .from('articulos')
      .select('id_art,descripcion,id_material,id_grupo,precio_publico')
      .in('id_art', unicos.slice(i, i + TANDA))
      .range(0, TANDA - 1)
    if (error) throw new Error(error.message)
    for (const r of (data as { id_art: string; descripcion: string | null; id_material: string | null; id_grupo: string | null; precio_publico: number | null }[] | null) ?? []) {
      out.set(r.id_art.trim().toUpperCase(), {
        descripcion: txt(r.descripcion),
        material: txt(r.id_material),
        grupo: txt(r.id_grupo),
        precio: num(r.precio_publico),
      })
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/*  Consulta                                                           */
/* ------------------------------------------------------------------ */

function coincide(fila: Articulo, q: string): boolean {
  const n = norm(q)
  if (!n) return true
  return [fila.idArticulo, fila.nombre, fila.material, fila.grupo, fila.colorCodigo, fila.color, fila.talle].some((v) =>
    norm(v).includes(n),
  )
}

/* ------------------------------------------------------------------ */
/*  Orden de talles por tamaño                                         */
/* ------------------------------------------------------------------ */

/** Talles de letra de menor a mayor (2XL = XXL, 3XL = XXXL, …). */
const TALLES_LETRA = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'XXXXL', 'XXXXXL', 'XXXXXXL']

/** "XS - EXTRA SMALL" / "3XL" / "40" -> sigla normalizada ("XS", "XXXL", "40") */
function siglaTalle(f: Pick<Articulo, 'talle' | 'talleCodigo'>): string {
  // primero la descripción ("XS - EXTRA SMALL"): el código interno puede ser un número que no indica tamaño
  const crudo = (f.talle.split(' - ')[0] || f.talleCodigo || '').trim().toUpperCase()
  // "3XL" -> "XXXL"
  return crudo.replace(/^(\d)XL$/, (_, n: string) => `${'X'.repeat(Number(n))}L`)
}

/** [grupo, valor]: primero los de letra por tamaño, después los numéricos, al final el resto. */
function rangoTalle(f: Pick<Articulo, 'talle' | 'talleCodigo'>): [number, number] {
  const s = siglaTalle(f)
  const i = TALLES_LETRA.indexOf(s)
  if (i >= 0) return [0, i]
  const n = Number(s.replace(',', '.'))
  if (s !== '' && Number.isFinite(n)) return [1, n]
  return [2, 0]
}

function compararTalles(a: Articulo, b: Articulo): number {
  const [ga, va] = rangoTalle(a)
  const [gb, vb] = rangoTalle(b)
  return ga - gb || va - vb || a.talle.localeCompare(b.talle, undefined, { numeric: true })
}

/** Nombres de columna que la pantalla sabe leer (ver ALIAS). */
const COLUMNAS_ESPERADAS = 'ID_ARTICULO, COLOR, TALLE, NOMBRE_COMPLETO, MATERIAL, GRUPO, STOCK_FISICO, EN_PEDIDO, PRECIO'

/** Arma las filas ya con el complemento de Supabase (descripción, ubicación) y las ordena. */
async function armar(crudas: FilaSql[], q: string): Promise<Articulo[]> {
  const base: Articulo[] = []
  let recognized = false

  for (const f of crudas) {
    const { col, adic } = resolver(f)
    const val = (c: Campo) => (col[c] ? f[col[c] as string] : undefined)
    // Si la vista no trae ninguna columna reconocible, avisarlo es más útil que
    // mostrar una tabla entera de guiones.
    if (col.idArticulo || col.nombre) recognized = true

    // ARTDES + ARTDESADIC (o sola descripción adicional) = "nombre completo"
    const extra = adic ? txt(f[adic]) : ''
    let nombre = txt(val('nombre'))
    if (!nombre) nombre = extra
    else if (extra && !nombre.toLowerCase().includes(extra.toLowerCase())) nombre = `${nombre} - ${extra}`

    base.push({
      idArticulo: txt(val('idArticulo')).toUpperCase(),
      colorCodigo: txt(val('colorCodigo')),
      color: txt(val('color')),
      talle: txt(val('talle')),
      talleCodigo: txt(val('talleCodigo')),
      nombre,
      material: txt(val('material')),
      grupo: txt(val('grupo')),
      stock: num(val('stock')),
      pedido: num(val('pedido')),
      precio: num(val('precio')),
      ubicaciones: [],
    })
  }

  if (crudas.length > 0 && !recognized) {
    throw new Error(
      `La vista no trae las columnas esperadas (${COLUMNAS_ESPERADAS}). ` +
        'Renombrá las de la vista SQL o seteá VITE_SQL_VISTA_ARTICULOS con otra.',
    )
  }

  const codigos = base.map((f) => f.idArticulo).filter(Boolean)
  const [maestro, ubis] = await Promise.all([
    maestroDe(codigos).catch(() => new Map<string, Maestro>()),
    ubicacionesDeArticulos(codigos).catch(() => new Map<string, string[]>()),
  ])

  for (const fila of base) {
    const m = maestro.get(fila.idArticulo)
    if (m) {
      // La descripción del hub es la ADICIONAL del maestro (sync-articulos); la de la vista queda de respaldo
      fila.nombre = m.descripcion || fila.nombre
      fila.material = fila.material || m.material
      fila.grupo = fila.grupo || m.grupo
      fila.precio = fila.precio ?? m.precio
    }
    // La ubicación del mapeo es del artículo entero (código): va en todos sus colores y talles
    fila.ubicaciones = [...(ubis.get(fila.idArticulo.trim().toUpperCase()) ?? [])].sort(compararUbicaciones)
  }

  return base
    .filter((f) => coincide(f, q))
    .sort(
      (a, b) =>
        a.idArticulo.localeCompare(b.idArticulo) ||
        (a.colorCodigo || a.color).localeCompare(b.colorCodigo || b.color, undefined, { numeric: true }) ||
        compararTalles(a, b),
    )
}

/**
 * Busca artículos. Con menos de 2 caracteres no consulta nada (devuelve vacío).
 *
 * Primero se le pide al SQL el filtro (WHERE [col] LIKE '%texto%'). Si el
 * destino lo ignora —la Lógica App solo acepta { vista, top }— o no trae
 * nada, se reintenta sin filtro y se acota en el navegador: por eso el
 * `filtradoEnCliente` del resultado.
 */
export async function consultarArticulos(termino: string): Promise<ResultadoConsulta> {
  const q = termino.trim()
  let crudas: FilaSql[] = []
  let filtradoEnCliente = false

  // Sin término no se trae el listado: la pantalla solo muestra lo que se busca
  if (q.length < 2) return { filas: [], truncado: false, filtradoEnCliente: false }

  try {
    crudas = await leerVistaFiltrada(VISTA_ARTICULOS, {
      donde: COLUMNAS_BUSQUEDA,
      valor: q,
      coincide: 'contiene',
      limit: TOP_BUSQUEDA,
    })
  } catch {
    crudas = []
  }
  // Sin resultado: puede ser que el destino no aplique el filtro (la Lógica App
  // solo acepta { vista, top }). Se trae el tope de la vista y se acota en el
  // navegador, así la búsqueda por nombre igual encuentra lo suyo (en pantalla
  // solo quedan las coincidencias).
  if (crudas.length === 0) {
    filtradoEnCliente = true
    crudas = await leerVista(VISTA_ARTICULOS, TOP_LISTA)
  }

  const tope = filtradoEnCliente ? TOP_LISTA : TOP_BUSQUEDA
  return { filas: await armar(crudas, q), truncado: crudas.length >= tope, filtradoEnCliente }
}

/** "02 NEGRO": código + descripción del color (sin repetir si son iguales). */
export function colorEtiqueta(f: Pick<Articulo, 'colorCodigo' | 'color'>): string {
  if (!f.colorCodigo) return f.color
  if (!f.color || f.color.toUpperCase() === f.colorCodigo.toUpperCase()) return f.colorCodigo
  return `${f.colorCodigo} ${f.color}`
}

/** Columnas del Excel, en el mismo orden que la pantalla. */
export function filasParaExcel(filas: Articulo[]): Record<string, string | number>[] {
  return filas.map((f) => ({
    'ID artículo': f.idArticulo,
    Color: colorEtiqueta(f),
    Talle: f.talle,
    'Nombre completo': f.nombre,
    Material: f.material,
    Grupo: f.grupo,
    'Stock en MITO': f.stock ?? '',
    Pedido: f.pedido ?? '',
    Ubicación: f.ubicaciones.join(' · '),
    Precio: f.precio ?? '',
  }))
}
