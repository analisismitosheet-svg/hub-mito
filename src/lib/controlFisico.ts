/* ------------------------------------------------------------------ */
/*  Control físico de mercadería · Depósito Indo (sql/control_fisico.sql) */
/*                                                                      */
/*  Compras hace el picking contra la factura (Recepción INDO); con el  */
/*  picking hecho se habilita el control físico: el depósito cuenta     */
/*  cada renglón y desglosa en color × talle los que vienen 00 / U.     */
/*  Maqueta: mockups/control-mercaderia-indo.html                       */
/* ------------------------------------------------------------------ */
import { supabase } from '@/lib/supabase'
import { leerVista } from '@/lib/sqlApi'
import { compararTalles } from '@/lib/ordenPiso'

export type EstadoControl = 'pendiente' | 'en_curso' | 'terminado'

export interface ControlResumen {
  factura_clave: string
  recepcion_clave: string | null
  proveedor: string
  n_factura: string
  n_oc: string
  fecha_ingreso: string | null
  control_id: string | null
  estado: EstadoControl
  iniciado_nombre: string | null
  iniciado_at: string | null
  terminado_nombre: string | null
  terminado_at: string | null
  renglones: number
  para_desglosar: number
  desglosados: number
  controlados: number
  unidades_picking: number
  unidades_contadas: number
  importe_picking: number
  faltan: number
  sobran: number
  faltan_importe: number
  sobran_importe: number
  con_diferencias: boolean
  ultimo_at: string | null
}

export interface Desglose {
  color: string
  color_desc?: string | null
  talle: string
  cantidad: number
}

export interface LineaControl {
  codigo: string
  numero: string | null
  articulo: string
  descripcion: string | null
  color: string
  talle: string
  picking: number
  precio: number | null
  requiere_desglose: boolean
  contado: number | null
  motivo: string | null
  desglose: Desglose[] | null
  actualizado_nombre: string | null
  actualizado_at: string | null
}

export const MOTIVOS_DIFERENCIA = ['No llegó', 'Llegó fallado', 'Vino otro artículo', 'Otro'] as const

const num = (v: unknown) => Number(v ?? 0) || 0

function sb() {
  if (!supabase) throw new Error('Supabase no está configurado')
  return supabase
}

export async function listarControles(): Promise<ControlResumen[]> {
  const { data, error } = await sb().rpc('control_fisico_lista')
  if (error) throw new Error(error.message)
  return ((data ?? []) as ControlResumen[]).map((c) => ({
    ...c,
    renglones: num(c.renglones),
    para_desglosar: num(c.para_desglosar),
    desglosados: num(c.desglosados),
    controlados: num(c.controlados),
    unidades_picking: num(c.unidades_picking),
    unidades_contadas: num(c.unidades_contadas),
    importe_picking: num(c.importe_picking),
    faltan: num(c.faltan),
    sobran: num(c.sobran),
    faltan_importe: num(c.faltan_importe),
    sobran_importe: num(c.sobran_importe),
    con_diferencias: !!c.con_diferencias,
  }))
}

export async function lineasControl(factura: string): Promise<LineaControl[]> {
  const { data, error } = await sb().rpc('control_fisico_detalle', { p_factura: factura })
  if (error) throw new Error(error.message)
  return ((data ?? []) as LineaControl[]).map((l) => ({
    ...l,
    picking: num(l.picking),
    precio: l.precio == null ? null : Number(l.precio),
    contado: l.contado == null ? null : Number(l.contado),
    desglose: Array.isArray(l.desglose) ? l.desglose.map((d) => ({ ...d, cantidad: num(d.cantidad) })) : null,
  }))
}

export async function guardarLinea(
  factura: string,
  l: Pick<LineaControl, 'codigo' | 'articulo' | 'color' | 'talle'>,
  contado: number | null,
  motivo: string | null,
  desglose: Desglose[] | null,
): Promise<void> {
  const { error } = await sb().rpc('control_fisico_guardar', {
    p_factura: factura,
    p_codigo: l.codigo,
    p_articulo: l.articulo,
    p_color: l.color,
    p_talle: l.talle,
    p_contado: contado,
    p_motivo: motivo,
    p_desglose: desglose,
  })
  if (error) throw new Error(error.message)
}

/** Termina el control (marca «Controlada» en Recepción INDO) y dispara el aviso push. */
export async function terminarControl(factura: string): Promise<void> {
  const { data, error } = await sb().rpc('control_fisico_terminar', { p_factura: factura })
  if (error) throw new Error(error.message)
  if (data) void avisarControlTerminado(String(data))
}

export async function reabrirControl(factura: string): Promise<void> {
  const { error } = await sb().rpc('control_fisico_reabrir', { p_factura: factura })
  if (error) throw new Error(error.message)
}

export async function marcarVisto(factura: string): Promise<void> {
  await sb().rpc('control_fisico_visto', { p_factura: factura })
}

/** Push «Control físico terminado» al depósito (api/push.ts?tipo=control_fisico). */
async function avisarControlTerminado(controlId: string): Promise<void> {
  try {
    const { data } = await sb().auth.getSession()
    const token = data.session?.access_token
    if (!token) return
    await fetch('/api/push?tipo=control_fisico', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ control_id: controlId }),
    })
  } catch {
    /* el aviso es un extra: el control ya quedó terminado */
  }
}

/* --------------------------- maestros de Dragon --------------------------- */

export interface ItemMaestro {
  codigo: string
  descripcion: string
}

export const VISTA_COLORES_INDOD = 'DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_COLORES_INDOD'
export const VISTA_TALLES_INDOD = 'DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_TALLES_INDOD'

let cacheColores: Promise<ItemMaestro[]> | null = null
let cacheTalles: Promise<ItemMaestro[]> | null = null

function aMaestro(filas: Record<string, unknown>[]): ItemMaestro[] {
  const lista = filas
    .map((f) => ({ codigo: String(f.CODIGO ?? '').trim().toUpperCase(), descripcion: String(f.DESCRIPCION ?? '').trim() }))
    .filter((x) => x.codigo && x.codigo !== '00')
  // Vacío = el puente no contestó (o la vista no está habilitada): mejor avisar que mostrar «nada»
  if (!lista.length) throw new Error('Dragon no devolvió la lista (¿el puente SQL está andando?)')
  return lista
}

/** Colores de Dragon Indo (788). Se piden una vez por sesión; `forzar` los relee. */
export function coloresDragon(forzar = false): Promise<ItemMaestro[]> {
  if (!cacheColores || forzar) {
    cacheColores = leerVista(VISTA_COLORES_INDOD, 5000)
      .then((f) => aMaestro(f).sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true })))
      .catch((e) => { cacheColores = null; throw e })
  }
  return cacheColores
}

/** Talles de Dragon Indo (310), ordenados por tamaño. */
export function tallesDragon(forzar = false): Promise<ItemMaestro[]> {
  if (!cacheTalles || forzar) {
    cacheTalles = leerVista(VISTA_TALLES_INDOD, 5000)
      .then((f) => aMaestro(f).filter((t) => t.codigo !== 'U').sort((a, b) => compararTalles(a.codigo, b.codigo)))
      .catch((e) => { cacheTalles = null; throw e })
  }
  return cacheTalles
}

/** Curvas rápidas de talles (se agregan solo las que existen en Dragon). */
export const CURVAS_RAPIDAS: { nombre: string; talles: string[] }[] = [
  { nombre: 'S a 4XL', talles: ['S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'] },
  { nombre: 'XS a XXL', talles: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
  { nombre: '36 al 46', talles: ['36', '38', '40', '42', '44', '46'] },
  { nombre: '1 al 16', talles: ['1', '2', '4', '6', '8', '10', '12', '14', '16'] },
  { nombre: '3.5 al 8', talles: ['3.5', '4', '4.5', '5', '5.5', '6', '6.5', '7', '7.5', '8'] },
]

/* ------------------------------- helpers ------------------------------- */

export const claveLinea = (l: Pick<LineaControl, 'codigo' | 'articulo' | 'color' | 'talle'>) =>
  `${l.codigo}|${l.articulo}|${l.color}|${l.talle}`

export const n0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
export const pesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })

export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  } catch {
    return iso
  }
}

/** Cómo quedó un renglón: sin contar, igual, falta o sobra */
export function estadoLinea(l: LineaControl): 'sin' | 'ok' | 'falta' | 'sobra' {
  if (l.contado == null) return 'sin'
  if (l.contado === l.picking) return 'ok'
  return l.contado < l.picking ? 'falta' : 'sobra'
}

/* --------------------------- rango de talles --------------------------- */

/** Talles de letra de menor a mayor (2XL = XXL, 3XL = XXXL…). */
const ESCALA_LETRA = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'XXXXL', 'XXXXXL']
function rangoLetra(t: string): number {
  const s = t.trim().toUpperCase().replace(/^(\d)X(S|L)$/, (_, n: string, l: string) => `${'X'.repeat(Number(n))}${l}`)
  return ESCALA_LETRA.indexOf(s)
}
const aNumero = (t: string) => {
  const s = t.trim().replace(',', '.')
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN
}

export interface RangoTalles {
  talles: string[]
  /** del rango pedido, los que no existen en Dragon (no se agregan) */
  noEstan: string[]
  numerico: boolean
  error?: string
}

/**
 * Talles «desde → hasta» con los códigos de Dragon.
 *  - Letras: S → 4XL = S, M, L, XL, XXL, 3XL, 4XL (con la forma que use Dragon).
 *  - Números: 35 → 44 enteros; con `medios`, también 35.5, 36.5… (3 → 12 con medios = 3, 3.5, 4… 12).
 */
export function talleRango(desde: string, hasta: string, maestro: ItemMaestro[], medios: boolean): RangoTalles {
  const codigos = maestro.map((m) => m.codigo)
  const d = desde.trim().toUpperCase()
  const h = hasta.trim().toUpperCase()
  if (!d || !h) return { talles: [], noEstan: [], numerico: false, error: 'Poné desde y hasta' }

  const nd = aNumero(d)
  const nh = aNumero(h)
  if (Number.isFinite(nd) && Number.isFinite(nh)) {
    const [a, b] = nd <= nh ? [nd, nh] : [nh, nd]
    if (b - a > 60) return { talles: [], noEstan: [], numerico: true, error: 'El rango es demasiado grande' }
    const paso = medios ? 0.5 : 1
    const talles: string[] = []
    const noEstan: string[] = []
    for (let v = Math.ceil(a / paso) * paso; v <= b + 1e-9; v += paso) {
      const t = Number.isInteger(v) ? String(v) : v.toFixed(1)
      if (codigos.includes(t)) talles.push(t)
      else noEstan.push(t)
    }
    return { talles, noEstan, numerico: true }
  }

  const ld = rangoLetra(d)
  const lh = rangoLetra(h)
  if (ld < 0 || lh < 0) {
    return { talles: [], noEstan: [], numerico: false, error: 'Usá letras (XS, S… 4XL) o números (35, 3.5) en los dos' }
  }
  const [a, b] = ld <= lh ? [ld, lh] : [lh, ld]
  const talles: string[] = []
  const noEstan: string[] = []
  for (let i = a; i <= b; i++) {
    // la forma que tenga Dragon: XXL o 2XL, 3XL o XXXL…
    // si Dragon tiene las dos (XXS y 2XS) va la de letras
    const enDragon = codigos.filter((c) => rangoLetra(c) === i).sort((x, y) => Number(/\d/.test(x)) - Number(/\d/.test(y)))[0]
    if (enDragon) talles.push(enDragon)
    else noEstan.push(ESCALA_LETRA[i])
  }
  return { talles, noEstan, numerico: false }
}
