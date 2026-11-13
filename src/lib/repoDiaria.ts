import { supabase } from '@/lib/supabase'

/**
 * Compras > Repo diaria (cliente). Pide /api/sql/repo-diaria y, mientras el
 * Puente lee el DWH (~45 s), vuelve a preguntar cada pocos segundos.
 * Ver src/lib/repoDiariaApi.ts y puente-sql/repo-diaria.js.
 */

export interface FilaRepo {
  cliente: string
  base: string
  proveedor_id: string
  articulo: string
  desc_adicional: string
  descripcion: string
  color: string
  talle: string
  sku: string
  /** stock REAL de MITO = físico - comprometido */
  stock_mito: number
  stock_fisico: number
  comprometido: number
  venta_local: number
  venta_total: number
  a_reponer: number
  metodo: 'COMPLETO' | 'PARCIAL'
  tienda: string
  proveedor: string
}

export interface ResumenRepo {
  cliente: string
  skus: number
  unidades: number
  completitud: number
}

export interface RepoDiaria {
  estado: 'listo'
  /** cuándo se leyó el DWH */
  foto: string
  segundos: number | null
  dias: string[]
  fecha_iso: string
  fecha_str: string
  archivo: string
  filas: FilaRepo[]
  resumen: ResumenRepo[]
  unidades: number
  dias_disponibles: Array<{ dia: string; unidades: number }>
}

async function token(): Promise<string> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { data } = await supabase.auth.getSession()
  const t = data.session?.access_token
  if (!t) throw new Error('Sin sesión activa.')
  return t
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Trae la repo de `fechas` (vacío = último día con venta). Con `forzar` pide una
 * foto nueva del DWH. `alEsperar` recibe los segundos que lleva calculando.
 */
export async function cargarRepoDiaria(
  fechas: string[],
  forzar: boolean,
  alEsperar?: (segundos: number) => void,
  cancelado?: () => boolean,
): Promise<RepoDiaria> {
  const t = await token()
  const inicio = Date.now()
  let primera = true
  // Tope: 4 minutos (la lectura normal tarda ~45 s)
  while (Date.now() - inicio < 240_000) {
    const qs = new URLSearchParams()
    if (fechas.length) qs.set('fechas', fechas.join(','))
    if (forzar && primera) qs.set('forzar', '1')
    primera = false
    const res = await fetch(`/api/sql/repo-diaria${qs.size ? `?${qs}` : ''}`, { headers: { Authorization: `Bearer ${t}` } })
    const body = (await res.json().catch(() => null)) as (Partial<RepoDiaria> & { estado?: string; error?: string }) | null
    if (!res.ok || !body) throw new Error(body?.error ?? `Error ${res.status} calculando la repo diaria`)
    if (body.estado === 'listo') return body as RepoDiaria
    if (cancelado?.()) throw new Error('cancelado')
    alEsperar?.(Math.round((Date.now() - inicio) / 1000))
    await espera(4000)
  }
  throw new Error('El Puente SQL tardó más de 4 minutos en leer el DWH. Probá de nuevo con Actualizar.')
}

/* ---- Carga en Dragon: un pedido de venta VTD por local (lo hace el Puente por la API) ---- */

export type EstadoLocalDragon = 'pendiente' | 'ya_estaba' | 'cargando' | 'cargado' | 'en_seco' | 'error'

export interface LocalDragon {
  cliente: string
  renglones: number
  unidades: number
  lista: string
  estado: EstadoLocalDragon
  numero: number | string | null
  error: string | null
}

export interface CargaDragon {
  /** observación del pedido: "REPO DIARIA (11/11/2026)" */
  obs: string
  fecha_str: string
  en_curso: boolean
  /** el puente está en modo prueba: arma los pedidos pero no llama a Dragon */
  en_seco: boolean
  inicio: string | null
  fin: string | null
  locales: LocalDragon[]
}

async function postCarga(cuerpo: Record<string, unknown>): Promise<CargaDragon | null> {
  const t = await token()
  const res = await fetch('/api/sql/repo-diaria', {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })
  const body = (await res.json().catch(() => null)) as { carga?: CargaDragon | null; error?: string } | null
  if (!res.ok || !body) throw new Error(body?.error ?? `Error ${res.status} con la carga en Dragon`)
  return body.carga ?? null
}

/** Qué se va a cargar y qué locales ya tienen su pedido VTD con esta observación. */
export async function revisarCargaDragon(r: RepoDiaria): Promise<CargaDragon> {
  const c = await postCarga({ modo: 'revisar', fechas: r.dias, foto: r.foto })
  if (!c) throw new Error('El Puente no devolvió la revisión')
  return c
}

/** Arranca la carga (por detrás) y devuelve el primer estado. `confirmo` = la obs que vio el usuario. */
export async function cargarEnDragon(r: RepoDiaria, confirmo: string, locales?: string[]): Promise<CargaDragon> {
  const c = await postCarga({ modo: 'cargar', fechas: r.dias, foto: r.foto, confirmo, locales: locales ?? [] })
  if (!c) throw new Error('El Puente no devolvió la carga')
  return c
}

export async function estadoCargaDragon(): Promise<CargaDragon | null> {
  return postCarga({ modo: 'estado' })
}

/** Excel con las mismas 4 hojas que generaba repo_diaria.py (+ físico y comprometido al final de la 1ª). */
export async function bajarExcelRepo(r: RepoDiaria) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()

  // Hoja 1: REPO POR DIA
  const h1 = [
    'CLIENTE REPO', 'BASE DE DATOS', 'PROVEEDOR ID', 'ARTÍCULO', 'DESC ADICIONAL', 'DESCRIPCIÓN', 'COLOR', 'TALLE', 'SKU',
    'STOCK MITO', 'VENTA LOCAL', 'VENTA TOTAL', 'A REPONER', 'MÉTODO', 'TIENDA', 'PROVEEDOR', 'FECHA', 'TIPO', 'CANT ORIG',
    'STOCK FÍSICO', 'COMPROMETIDO',
  ]
  const s1 = XLSX.utils.aoa_to_sheet([
    [`REPOSICIÓN POR DÍA  —  ${r.fecha_str}  (STOCK MITO = físico - comprometido)`],
    h1,
    ...r.filas.map((f) => [
      f.cliente, f.base, f.proveedor_id, f.articulo, f.desc_adicional, f.descripcion, f.color, f.talle, f.sku,
      f.stock_mito, f.venta_local, f.venta_total, f.a_reponer, f.metodo, f.tienda, f.proveedor, r.fecha_iso, 'VENTA', f.venta_local,
      f.stock_fisico, f.comprometido,
    ]),
  ])
  s1['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 18 } }]
  s1['!freeze'] = { xSplit: 0, ySplit: 2 }
  XLSX.utils.book_append_sheet(wb, s1, 'REPO POR DIA')

  // Hoja 2: IMPORTAR DRAGON
  const s2 = XLSX.utils.aoa_to_sheet([
    [`IMPORTAR DRAGON  —  ${r.fecha_str}`],
    ['CLIENTE REPO', 'ARTÍCULO', 'COLOR', 'TALLE', 'CANTIDAD', 'VTD', 'OBSERVACIÓN'],
    ...r.filas.map((f) => [f.cliente, f.articulo, f.color, f.talle, f.a_reponer, 'VTD', `REPO DIARIA (${r.fecha_str})`]),
  ])
  s2['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }]
  XLSX.utils.book_append_sheet(wb, s2, 'IMPORTAR DRAGON')

  // Hoja 3: ORDENADA POR LOCAL (bloques por local con el encabezado repetido)
  const h3 = ['CLIENTE REPO', 'MATERIAL', 'ARTÍCULO', 'DESC ADICIONAL', 'COLOR', 'TALLE', 'CANTIDAD']
  const filas3: (string | number)[][] = []
  for (const cli of r.resumen.map((x) => x.cliente).filter((c) => c !== 'TOTAL')) {
    const sub = r.filas
      .filter((f) => f.cliente === cli)
      .sort((a, b) => cmp(a.descripcion, b.descripcion) || cmp(a.articulo, b.articulo) || cmp(a.color, b.color) || cmp(a.talle, b.talle))
    if (!sub.length) continue
    filas3.push(h3)
    for (const f of sub) filas3.push([f.cliente, f.descripcion, f.articulo, f.desc_adicional, f.color, f.talle, f.a_reponer])
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas3), 'ORDENADA POR LOCAL')

  // Hoja 4: RESUMEN
  const s4 = XLSX.utils.aoa_to_sheet([
    [`RESUMEN  —  ${r.fecha_str}`],
    ['CLIENTE REPO', 'SKUs A REPONER', 'UNIDADES A REPONER', '% COMPLETITUD'],
    ...r.resumen.map((x) => [x.cliente, x.skus, x.unidades, x.completitud]),
  ])
  for (let i = 0; i < r.resumen.length; i++) {
    const c = s4[XLSX.utils.encode_cell({ r: i + 2, c: 3 })]
    if (c) c.z = '0.00%'
  }
  s4['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }]
  XLSX.utils.book_append_sheet(wb, s4, 'RESUMEN')

  XLSX.writeFile(wb, r.archivo)
}

/** Orden de texto por código (igual que el script de Python). */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
