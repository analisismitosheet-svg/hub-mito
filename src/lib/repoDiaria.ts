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
  /** días que ya tienen pedidos «REPO DIARIA (…)» en Dragon */
  dias_en_dragon?: string[]
  /** cascada entre locales con lo que MITO no cubrió (puente-sql/cascada.js) */
  cascada?: Cascada | { error: string } | null
}

export interface FilaCascada {
  donante: string
  receptor: string
  articulo: string
  descripcion: string
  material: string
  grupo: string
  proveedor: string
  proveedor_id: string
  color: string
  talle: string
  sku: string
  cantidad: number
  /** venta del receptor y lo que ya le manda MITO */
  venta: number
  mito: number
  stock_donante: number
  stock_receptor: number
  /** con prioridad por venta: categoría del artículo y lo que vendió cada uno de ella */
  categoria?: string
  venta_cat_receptor?: number
  venta_cat_donante?: number
}

export interface Cascada {
  archivo: string
  filas: FilaCascada[]
  unidades: number
  faltante_despues_mito: number
  /** unidades que cubrieron los donantes principales (INDOD) antes que los locales */
  de_principal?: number
  pares_eliminados: number
  unidades_eliminadas?: number
  /** por qué quedó sin cubrir lo que faltaba (unidades) */
  no_cubierto?: { transito: number; ya_tiene: number; restriccion: number; sin_donante: number; envio_chico: number }
  por_material: Record<string, number>
  matriz: Record<string, Record<string, number>>
  donantes: string[]
  receptores: string[]
  /** con prioridad por venta: venta de cada local por categoría (las que salen en la cascada) */
  ranking_venta?: { dias: string[]; por: string[]; por_nombre?: string; categorias: Record<string, [string, number][]> } | null
  /** los parámetros con que se calculó (ya completos) */
  params?: ParamsCascada
}

/* ---- Parámetros de la cascada (puente-sql/cascada.js: PARAMS_DEFAULT y normalizarParams) ---- */

export interface ReglaNumero { activo: boolean; valor: number }
export interface ReglaLista { activo: boolean; lista: string[] }
export interface ParamsCascada {
  prioridad: string[]
  no_donan: string[]
  no_reciben: string[]
  restar_mito: boolean
  respetar_transito: boolean
  receptor_max: ReglaNumero
  donante_queda: number
  tope_sku: ReglaNumero
  min_envio: ReglaNumero
  restriccion: { activo: boolean; receptores: string[]; proveedores: string[] }
  pase_extra: { activo: boolean; locales: string[] }
  /** bases que donan primero, como MITO (sin quedarse con nada, sin topes): INDOD */
  donante_principal: { activo: boolean; bases: string[] }
  materiales: ReglaLista
  excluir_temporadas: ReglaLista
  excluir_grupos: ReglaLista
  excluir_articulos: ReglaLista
  excluir_proveedores: ReglaLista
  excluir_lineas: ReglaLista
  orden_receptores: 'alfabetico' | 'prioridad'
  orden_donantes: 'stock' | 'prioridad'
  /** ordenar por la venta de cada local de la categoría del artículo (últimos `dias` con venta) */
  prioridad_venta: { activo: boolean; por: DimensionVenta[]; dias: number; aplica: 'receptores' | 'donantes' | 'ambos' }
}

/** Atributos del artículo (DWH + Dragon) por los que se puede comparar la venta (cascada.js DIMENSIONES). */
export const DIMENSIONES_VENTA = [
  { clave: 'proveedor', nombre: 'Proveedor' },
  { clave: 'material', nombre: 'Material' },
  { clave: 'grupo', nombre: 'Grupo' },
  { clave: 'familia', nombre: 'Familia' },
  { clave: 'linea', nombre: 'Línea' },
  { clave: 'temporada', nombre: 'Temporada' },
  { clave: 'categoria', nombre: 'Categoría' },
  { clave: 'clasificacion', nombre: 'Clasificación' },
  { clave: 'tipo', nombre: 'Tipo' },
  { clave: 'marca', nombre: 'Marca' },
  { clave: 'anio', nombre: 'Año' },
  { clave: 'articulo', nombre: 'Artículo' },
  { clave: 'color', nombre: 'Color' },
  { clave: 'talle', nombre: 'Talle' },
] as const
export type DimensionVenta = (typeof DIMENSIONES_VENTA)[number]['clave']

/** Copia de PARAMS_DEFAULT de puente-sql/cascada.js (las reglas de cascada_05nov_conCalzado.py). */
export const PARAMS_DEFAULT: ParamsCascada = {
  prioridad: [
    'CFD', 'CFPO', 'CFRA', 'CFR4', 'CFR9', 'NVOCED', 'ESPINOD', 'LIBERD',
    '9DEJULIO', 'BUSTOD', 'MUNOZ', 'RIVERAD', 'RUTA9D2', 'DINOD', 'WALMARTD', 'VCPD', 'GRALPAZ',
  ],
  no_donan: ['GRALPAZ'],
  no_reciben: [],
  restar_mito: true,
  respetar_transito: true,
  receptor_max: { activo: true, valor: 2 },
  donante_queda: 1,
  tope_sku: { activo: true, valor: 2 },
  min_envio: { activo: true, valor: 2 },
  restriccion: { activo: true, receptores: ['CFR4', 'CFR9', 'CFD', 'CFPO', 'CFRA'], proveedores: ['MOCF', 'MOZH', 'MOFR'] },
  pase_extra: { activo: true, locales: ['NVOCED'] },
  donante_principal: { activo: true, bases: ['INDOD'] },
  materiales: { activo: true, lista: ['ACCESORIOS', 'PANTALONES', 'BERMUDAS', 'BOARDSHORTS-BIKINIS', 'REMERAS', 'CAMISAS', 'CALZADO'] },
  excluir_temporadas: { activo: true, lista: ['Invierno'] },
  excluir_grupos: { activo: true, lista: ['U02', 'U03'] },
  excluir_articulos: { activo: true, lista: ['BCF'] },
  excluir_proveedores: { activo: false, lista: [] },
  excluir_lineas: { activo: false, lista: [] },
  orden_receptores: 'alfabetico',
  orden_donantes: 'stock',
  prioridad_venta: { activo: false, por: ['material', 'grupo'], dias: 7, aplica: 'receptores' },
}

/** Recalcula solo la cascada con otros parámetros, sobre la misma foto que se está viendo. */
export async function recalcularCascada(r: RepoDiaria, params: ParamsCascada): Promise<Cascada> {
  const t = await token()
  const res = await fetch('/api/sql/repo-diaria', {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ modo: 'cascada', fechas: r.dias, foto: r.foto, params }),
  })
  const body = (await res.json().catch(() => null)) as { cascada?: Cascada; error?: string } | null
  if (!res.ok || !body?.cascada) throw new Error(body?.error ?? `Error ${res.status} recalculando la cascada`)
  return body.cascada
}

/* ---- Automático: parámetros guardados y programación (sql/repo_cascada_auto.sql) ---- */

export interface LogAuto { at: string; ok: boolean; texto: string }
export interface ConfigAuto {
  cascada_params: Partial<ParamsCascada>
  repo_activo: boolean
  repo_dias: number[]
  repo_hora: string
  repo_armado: boolean
  repo_armado_prioridad: 'urgente' | 'normal' | 'baja'
  cascada_activo: boolean
  cascada_dias: number[]
  cascada_hora: string
  repo_ahora_at: string | null
  cascada_ahora_at: string | null
  repo_log: LogAuto | null
  cascada_log: LogAuto | null
  actualizado_at: string
}

export async function leerConfigAuto(): Promise<ConfigAuto | null> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { data, error } = await supabase.from('repo_auto_config').select('*').eq('id', 1).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as ConfigAuto | null) ?? null
}

export async function guardarConfigAuto(cambios: Partial<Omit<ConfigAuto, 'repo_log' | 'cascada_log' | 'actualizado_at'>>) {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { error } = await supabase.rpc('repo_auto_guardar', { p: cambios })
  if (error) throw new Error(error.message)
}

export async function correrAhora(tarea: 'repo' | 'cascada') {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { error } = await supabase.rpc('repo_auto_correr_ahora', { p_tarea: tarea })
  if (error) throw new Error(error.message)
}

/** «261113 - CASCADA 12-11» / «261110 - CASCADA 07 AL 09-11» (igual que puente-sql/programador.js). */
export function nombreLoteCascada(dias: string[], hoy = new Date()): string {
  const u = dias[dias.length - 1]
  const dd = (x: string) => x.slice(8, 10)
  const tramo = dias.length > 1 ? `${dd(dias[0])} AL ${dd(u)}-${u.slice(5, 7)}` : `${dd(u)}-${u.slice(5, 7)}`
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${String(hoy.getFullYear()).slice(2)}${p2(hoy.getMonth() + 1)}${p2(hoy.getDate())} - CASCADA ${tramo}`
}

/** Crea el lote en Transferencias (como subir el Excel). Si ya hay uno con ese nombre en 7 días, no lo repite. */
export async function cargarCascadaEnTransferencias(
  nombre: string,
  c: Cascada,
): Promise<{ id: string; repetido: boolean; renglones: number; unidades: number }> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const items = c.filas.map((f) => ({
    origen: f.donante, destino: f.receptor, articulo: f.articulo, descripcion: f.descripcion,
    material: f.material, color: f.color, talle: f.talle, cantidad: f.cantidad,
  }))
  const { data, error } = await supabase.rpc('cascada_cargar_transferencias', { p_nombre: nombre, p_items: items })
  if (error) throw new Error(error.message)
  return data as { id: string; repetido: boolean; renglones: number; unidades: number }
}

export const esCascada = (c: RepoDiaria['cascada']): c is Cascada => !!c && !('error' in c)

/** Excel como los de cascada_*.py: GENERAL (donante x receptor), RESUMEN por artículo y una hoja por donante. */
export async function bajarExcelCascada(r: RepoDiaria, c: Cascada) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const titulo = `Venta ${r.fecha_str} - SOLO VENTA - lo que MITO no cubrió`

  const general: (string | number | null)[][] = [
    [titulo],
    ['DONOR \\ RECEPTOR', ...c.receptores, 'TOTAL'],
    ...c.donantes.map((d) => {
      const fila = c.receptores.map((rc) => c.matriz[d]?.[rc] ?? null)
      return [d, ...fila, fila.reduce<number>((s, v) => s + (v ?? 0), 0)]
    }),
  ]
  const g = XLSX.utils.aoa_to_sheet(general)
  g['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: c.receptores.length + 1 } }]
  XLSX.utils.book_append_sheet(wb, g, 'GENERAL')

  // RESUMEN por artículo x receptor
  const porArt = new Map<string, { f: FilaCascada; rec: Record<string, number> }>()
  for (const f of c.filas) {
    const x = porArt.get(f.articulo) ?? { f, rec: {} }
    x.rec[f.receptor] = (x.rec[f.receptor] ?? 0) + f.cantidad
    porArt.set(f.articulo, x)
  }
  const res = XLSX.utils.aoa_to_sheet([
    [`RESUMEN POR ARTICULO  |  ${r.fecha_str}`],
    ['ARTICULO', 'DESC ADICIONAL MACRO', 'MATERIAL', 'ID GRUPO', 'PROVEEDOR', 'TIPO', ...c.receptores, 'TOTAL'],
    ...[...porArt.values()]
      .sort((a, b) => cmp(a.f.articulo, b.f.articulo))
      .map(({ f, rec }) => {
        const v = c.receptores.map((rc) => rec[rc] ?? null)
        return [f.articulo, f.descripcion, f.material, f.grupo, f.proveedor, 'VENTA', ...v, v.reduce<number>((s, x) => s + (x ?? 0), 0)]
      }),
  ])
  XLSX.utils.book_append_sheet(wb, res, 'RESUMEN')

  // Una hoja por donante: SKU x receptor
  for (const d of c.donantes) {
    const sub = c.filas.filter((f) => f.donante === d)
    const recs = c.receptores.filter((rc) => sub.some((f) => f.receptor === rc))
    const porSku = new Map<string, { f: FilaCascada; rec: Record<string, number> }>()
    for (const f of sub) {
      const x = porSku.get(f.sku) ?? { f, rec: {} }
      x.rec[f.receptor] = (x.rec[f.receptor] ?? 0) + f.cantidad
      porSku.set(f.sku, x)
    }
    const hoja = XLSX.utils.aoa_to_sheet([
      [`CASCADA - ${d}  |  ${r.fecha_str}`],
      ['ARTICULO', 'DESC ADICIONAL MACRO', 'MATERIAL', 'ID GRUPO', 'COLOR', 'TALLE', 'TIPO', ...recs, 'TOTAL'],
      ...[...porSku.values()]
        .sort((a, b) => cmp(a.f.articulo, b.f.articulo) || cmp(a.f.color, b.f.color) || cmp(a.f.talle, b.f.talle))
        .map(({ f, rec }) => {
          const v = recs.map((rc) => rec[rc] ?? null)
          return [f.articulo, f.descripcion, f.material, f.grupo, f.color, f.talle, 'VENTA', ...v, v.reduce<number>((s, x) => s + (x ?? 0), 0)]
        }),
    ])
    XLSX.utils.book_append_sheet(wb, hoja, d.slice(0, 31))
  }

  XLSX.writeFile(wb, c.archivo)
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
