/**
 * Reposición por escaneo: lectura del Excel y acceso a datos.
 * Base: sql/repo_escaneo.sql. Pantalla: src/pages/ReposicionEscaneo.tsx.
 */
import { supabase } from '@/lib/supabase'

export interface RepoAbierta {
  id: string
  nombre: string
  creada_por: string | null
  creada_at: string
  pedidas: number
  escaneadas: number
}

export interface HojaRepo {
  hoja: string
  locales: string[]
}

/** Celda que quedó afuera al leer el Excel */
export type CeldaRara = [hoja: string, articulo: string, color: string, talle: string, local: string, valor: string]

export interface ItemRepo {
  id: number
  hoja: string
  articulo: string
  color: string
  talle: string
  descripcion: string
  local: string
  pedido: number
  escaneado: number
}

export interface DetalleRepo {
  id: string
  nombre: string
  hojas: HojaRepo[]
  raros: CeldaRara[]
  items: ItemRepo[]
}

export interface UltimaLectura {
  id: number
  item: number
  por: string | null
  at: string
}

export interface AvanceRepo {
  cerrada_at: string | null
  /** [id de item, escaneado]; los que no vienen están en 0 */
  items: [number, number][]
  ultimos: UltimaLectura[]
}

export type ResultadoEscaneo =
  | {
      estado: 'ok'
      lectura: number
      item: number
      articulo: string
      color: string
      talle: string
      descripcion: string | null
      local: string
      pedido: number
      escaneado: number
      otras: string[]
    }
  | { estado: 'no_esta'; articulo: string; color: string | null; talle: string | null; otras_hojas: string[] }
  | { estado: 'ambiguo'; articulo: string; color: string | null; talle: string | null }
  | { estado: 'sobra'; articulo: string; color: string; talle: string; descripcion: string | null; pedidas: number }

export type ResultadoDeshacer =
  | { estado: 'nada' }
  | { estado: 'ok'; item: number; articulo: string; color: string; talle: string; local: string; escaneado: number }

export interface LibroLeido {
  hojas: HojaRepo[]
  items: { hoja: string; articulo: string; color: string; talle: string; descripcion: string; local: string; pedido: number }[]
  raros: CeldaRara[]
}

// ---- Excel ----
// Fila de encabezados: la primera con 5 o más celdas. Columnas Articulo / Descripcion /
// Color / Talle (si no se encuentran por nombre, las 4 primeras); el resto son locales.
const NO_LOCAL = /^(AAH|TOTAL|STOCK|VENTA|PRIORIDAD|OBS|OBSERVACIONES?)$/i
/** Más que esto para un local en un renglón es un error de tipeo, no una cantidad */
const MAX_POR_CELDA = 50

function txtCelda(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'number' && Number.isInteger(v)) return String(v)
  return String(v).trim().toUpperCase()
}

/** Lee el libro ya parseado por xlsx. No depende de la librería para poder cargarla recién al usarla. */
export function leerLibro(
  nombresHojas: string[],
  filasDeHoja: (nombre: string) => unknown[][],
): LibroLeido {
  const salida: LibroLeido = { hojas: [], items: [], raros: [] }
  for (const nombre of nombresHojas) {
    const filas = filasDeHoja(nombre)
    const fi = filas.findIndex((f) => f && f.filter((x) => x != null && x !== '').length >= 5)
    if (fi < 0) continue

    const h = filas[fi].map((x) => (x == null ? '' : String(x).trim()))
    const buscar = (re: RegExp) => h.findIndex((x) => re.test(x))
    const col = (re: RegExp, porDefecto: number) => {
      const i = buscar(re)
      return i < 0 ? porDefecto : i
    }
    const cA = col(/^art/i, 0)
    const cD = col(/^desc/i, 1)
    const cC = col(/^color/i, 2)
    const cT = col(/^talle/i, 3)
    const fijas = new Set([cA, cD, cC, cT])
    const locales = h
      .map((x, i) => [i, x] as const)
      .filter(([i, x]) => x && !fijas.has(i) && !NO_LOCAL.test(x))
      .map(([i, x]) => [i, x.toUpperCase()] as const)

    const usados = new Set<string>()
    for (const f of filas.slice(fi + 1)) {
      if (!f || f[cA] == null || f[cA] === '') continue
      const articulo = txtCelda(f[cA])
      const color = txtCelda(f[cC]).padStart(2, '0')
      const talle = txtCelda(f[cT])
      const descripcion = String(f[cD] ?? '')
      for (const [i, local] of locales) {
        const v = f[i]
        if (v == null || v === '') continue
        if (typeof v !== 'number' || v <= 0 || v > MAX_POR_CELDA || !Number.isInteger(v)) {
          salida.raros.push([nombre, articulo, color, talle, local, String(v)])
          continue
        }
        usados.add(local)
        salida.items.push({ hoja: nombre, articulo, color, talle, descripcion, local, pedido: v })
      }
    }
    if (usados.size) salida.hojas.push({ hoja: nombre, locales: locales.map(([, l]) => l).filter((l) => usados.has(l)) })
  }
  return salida
}

export async function leerArchivoExcel(archivo: File): Promise<LibroLeido> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await archivo.arrayBuffer(), { type: 'array' })
  return leerLibro(wb.SheetNames, (n) =>
    XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, raw: true, defval: null }),
  )
}

// ---- Nombres de los locales ----
// El Excel usa algunos códigos que no son los de la tabla locales.
const ALIAS_LOCAL: Record<string, string> = { RUTA9D: 'RUTA9D2', BUSTOS: 'BUSTOD', GRALPAZ: 'GPAZD' }
// Los que no están en la tabla locales. El resto se muestra y se dice por código.
const NOMBRES_FIJOS: Record<string, string> = { POLO52: 'Polo 52', MAYORD: 'Mayorista', DEPO: 'Depósito' }

function nombreLindo(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|\s)(\p{L})/gu, (_, esp: string, letra: string) => esp + letra.toUpperCase())
    .replace(/\bDe\b/g, 'de')
}

export async function traerNombresLocales(): Promise<Record<string, string>> {
  const salida: Record<string, string> = { ...NOMBRES_FIJOS }
  if (!supabase) return salida
  const { data } = await supabase.from('locales').select('codigo, nombre')
  for (const l of (data ?? []) as { codigo: string; nombre: string | null }[]) {
    if (l.nombre) salida[l.codigo.toUpperCase()] = nombreLindo(l.nombre)
  }
  for (const [alias, codigo] of Object.entries(ALIAS_LOCAL)) {
    if (salida[codigo]) salida[alias] = salida[codigo]
  }
  return salida
}

// ---- Base ----
async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Sin conexión a la base')
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

export const listarRepos = () => rpc<RepoAbierta[]>('repo_escaneo_lista')

export const crearRepo = (nombre: string, libro: LibroLeido) =>
  rpc<{ id: string; ya_existia: boolean }>('repo_escaneo_crear', {
    p_nombre: nombre,
    p_hojas: libro.hojas,
    p_items: libro.items,
    p_raros: libro.raros,
  })

export async function traerDetalle(id: string): Promise<DetalleRepo> {
  const d = await rpc<Omit<DetalleRepo, 'items'> & { items: [number, string, string, string, string, string | null, string, number, number][] }>(
    'repo_escaneo_detalle',
    { p_id: id },
  )
  return {
    ...d,
    items: d.items.map(([itemId, hoja, articulo, color, talle, descripcion, local, pedido, escaneado]) => ({
      id: itemId, hoja, articulo, color, talle, descripcion: descripcion ?? '', local, pedido, escaneado,
    })),
  }
}

export const traerAvance = (id: string, hoja: string) =>
  rpc<AvanceRepo>('repo_escaneo_avance', { p_id: id, p_hoja: hoja })

export const escanearPrenda = (id: string, hoja: string, codigo: string) =>
  rpc<ResultadoEscaneo>('repo_escaneo_escanear', { p_id: id, p_hoja: hoja, p_codigo: codigo })

export const deshacerUltima = (id: string) => rpc<ResultadoDeshacer>('repo_escaneo_deshacer', { p_id: id })

export const moverLectura = (lectura: number, local: string) =>
  rpc<ResultadoEscaneo>('repo_escaneo_mover', { p_lectura: lectura, p_local: local })

export const cerrarRepo = (id: string) => rpc<void>('repo_escaneo_cerrar', { p_id: id })
