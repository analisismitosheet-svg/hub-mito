/**
 * Órdenes de compras: tipos, listas fijas y acceso a datos.
 * Base: sql/ordenes_compra.sql (tabla public.ordenes_compra + RPC oc_*).
 * Pantalla: src/pages/OrdenesCompra.tsx.
 */
import { supabase } from '@/lib/supabase'

export type PasoClave = 'valid' | 'autor' | 'env' | 'acep' | 'f_oc' | 'f_rem' | 'f_fac'
export interface PasoHecho {
  por: string
  uid?: string | null
  at: string
  via?: 'hub' | 'whatsapp' | 'planilla'
}

export interface ItemDragon {
  articulo: string
  descripcion?: string
  color: string
  talle: string
  cantidad: number
  precio: number
}

export interface OrdenCompra {
  numero: number
  tipo: 'Producto' | 'Gastos' | 'Servicios' | 'Talleres'
  planificable: boolean
  metodo: 'Sin anticipo' | 'Con anticipo' | 'Compra directa'
  area: string | null
  responsable: string | null
  proveedor: string
  proveedor_cuit: string | null
  contacto: string | null
  telefono: string | null
  mail: string | null
  observacion: string | null
  fecha_compra: string | null
  fecha_entrega: string | null
  forma_pago: string | null
  plazo: string | null
  monto_bruto: number | null
  archivo_url: string | null
  archivo_path: string | null
  obs_propias: string | null
  pasos: Partial<Record<PasoClave, PasoHecho>>
  cancelada_at: string | null
  cancelada_por: string | null
  cancelada_motivo: string | null
  no_autorizada: boolean
  pedida_at: string | null
  pedida_por: string | null
  pedida_a: string[] | null
  ampliada_at: string | null
  dragon: boolean
  dragon_base: string | null
  dragon_proveedor: string | null
  dragon_proveedor_nombre: string | null
  dragon_motivo: string | null
  dragon_condicion: string | null
  dragon_lista: string | null
  dragon_items: ItemDragon[]
  dragon_estado: 'pendiente' | 'enviando' | 'ok' | 'error' | null
  dragon_error: string | null
  dragon_codigo: string | null
  dragon_por: string | null
  dragon_at: string | null
  importada: boolean
  creada_por: string | null
  creada_por_nombre: string | null
  creada_at: string
}

export interface EventoOc {
  id: number
  numero: number
  at: string
  por: string | null
  texto: string
}

export interface PasoDef {
  k: PasoClave
  titulo: string
  quien: 'compras' | 'autorizador' | 'administracion'
  permiso: string
}
export const PASOS: PasoDef[] = [
  { k: 'valid', titulo: 'Validación Dto. Compras', quien: 'compras', permiso: 'ordenes_compra.compras' },
  { k: 'autor', titulo: 'Autorización financiera', quien: 'autorizador', permiso: 'ordenes_compra.autorizar' },
  { k: 'env', titulo: 'Enviada al proveedor', quien: 'compras', permiso: 'ordenes_compra.compras' },
  { k: 'acep', titulo: 'Aceptada por el proveedor', quien: 'compras', permiso: 'ordenes_compra.compras' },
  { k: 'f_oc', titulo: 'OC cargada en Flexxus', quien: 'administracion', permiso: 'ordenes_compra.flexxus' },
  { k: 'f_rem', titulo: 'Remito cargado en Flexxus', quien: 'administracion', permiso: 'ordenes_compra.flexxus' },
  { k: 'f_fac', titulo: 'Factura cargada en Flexxus', quien: 'administracion', permiso: 'ordenes_compra.flexxus' },
]
export const QUIEN_TXT = { compras: 'Compras', autorizador: 'Autorizador', administracion: 'Administración' } as const

export const TIPOS = ['Producto', 'Gastos', 'Servicios', 'Talleres'] as const
export const AREAS = ['Compras', 'Depósito', 'Diseño', 'Arquitectura', 'Administración'] as const

/** Formas de pago y plazos de la planilla (hoja «Formas de Pagos»). */
export const PLAZOS: Record<string, string[]> = {
  Bancos: ['Transferencias', 'E-cheq propios', 'Tarjeta Corporativa', 'Débitos Automáticos', '7 Días Fecha Factura', 'Contado Anticipado', 'Debin'],
  Cheques3ros: ['15 Días', '15 y 30 Días', '30 Días', '30 y 45 Días', '30 y 60 Días', '30, 60 y 90 Días', '30, 60, 90 y 120 Días',
    '60, 90, 120 y 150 Días', '45 Días', '60 Días', '60 y 90 Días', '60, 90 y 120 Días', '90 Días', '90 y 120 Días', '120 Días',
    '120 y 150 Días', '90, 120, 150 Días', '180, 210, 240 Días', '90, 120, 150, 180', '120, 150 y 180 Días',
    'Prechequeado Invierno', 'Prechequeado Verano'],
  Efectivo: ['-'],
  MercadoPago: ['Indonesia', 'Captain Fin', 'Locales'],
}

/* ---------------- Dragon (DRAGONFISH_INDOD, leídos por la API el 05/11/2026) ---------------- */
export const BASES_DRAGON = [
  { codigo: 'INDOD', nombre: 'DRAGONFISH_INDOD · M1T0O1\\ZOOLOGIC', activa: true },
  { codigo: 'NOMED', nombre: 'DRAGONFISH_NOMED · 100.85.74.68\\ZOO2024 (todavía no)', activa: false },
]
export const MOTIVOS_DRAGON: Array<[string, string]> = [
  ['S27', 'SUMMER 27'], ['W26', 'WINTER 2026'], ['S26', 'SUMMER 26'], ['W25', 'WINTER 2025'], ['S25', 'SUMMER 25'],
  ['COM', 'PEDIDO DE COMPRA'], ['01', 'CREACION DE PRODUCTO'], ['02', 'ESTAMPAR'], ['03', 'BORDAR'], ['04', 'SUBLIMAR'],
  ['05', 'CONFECCIONAR'], ['06', 'LAVAR'], ['07', 'TERMINACION, PLANCHA Y CONTROL'], ['08', 'ARREGLO'], ['09', 'PREPARADO DE AVIOS'],
  ['10', 'DESCUENTO POR FALLA'], ['11', 'PRODUCTO FINALIZADO'], ['12', 'MUESTRA'], ['13', 'INGRESO MATERIA PRIMA'], ['14', 'CORTE'],
  ['15', 'PRIMERA LOCALES'], ['I', 'Importacion'], ['MKT', 'MARKETING'], ['NMO', 'nomeolvides'], ['INT', 'INTERNO'], ['D', 'DIRECTA'],
  ['MA', 'MUESTRA'], ['MI', 'MASTER TEMPORADA INVIERNO'], ['MV', 'MASTER TEMPORADA VERANO'], ['MM', 'MASTER MAYORISTA'], ['MO', 'MASTER OUTLET'],
]
export const CONDICIONES_DRAGON: Array<[string, string]> = [
  ['1', 'Pago contra factura'], ['PCF1', 'A 15 días'], ['PCF2', 'A 15 y 30 días'], ['PCF3', 'A 30 días'], ['PCF4', 'A 30 y 45 días'],
  ['PCF5', 'A 30 y 60 días'], ['PCF6', 'A 30, 60 y 90 días'], ['PCF7', 'A 30, 60, 90 y 120 días'], ['PCF8', 'A 45 días'], ['PCF9', 'A 60 días'],
  ['PCF10', 'A 60 y 90 días'], ['PCF11', 'A 60, 90 y 120 días'], ['PCF12', 'A 90 días'], ['PCF13', 'A 90 y 120 días'], ['PCF14', 'A 120 días'],
  ['PCF15', '120 y 150 días'], ['PCF16', '45, 60 y 90 días'], ['PCF17', '60, 90, 120 y 150 días'], ['PCF18', '90, 120 y 150 días'],
  ['PCF19', 'A 180, 210 y 240'], ['PCF20', 'A 90, 120, 150 y 180 días'], ['PCF21', '120, 150 y 180 días'],
  ['PREI', 'Prechequeado invierno'], ['PREV', 'Prechequeado verano'], ['TRANS', 'Transferencia'],
]
export const LISTAS_DRAGON: Array<[string, string]> = [['LISTA0', 'Compra'], ['FABRIC', 'LP Producción'], ['LISTA9', 'Producción'], ['DOLAR', 'Dólares']]
/** El plazo de la OC sugiere la condición de pago de Dragon */
export const PLAZO_A_CONDICION: Record<string, string> = {
  '15 Días': 'PCF1', '15 y 30 Días': 'PCF2', '30 Días': 'PCF3', '30 y 45 Días': 'PCF4', '30 y 60 Días': 'PCF5', '30, 60 y 90 Días': 'PCF6',
  '30, 60, 90 y 120 Días': 'PCF7', '45 Días': 'PCF8', '60 Días': 'PCF9', '60 y 90 Días': 'PCF10', '60, 90 y 120 Días': 'PCF11',
  '90 Días': 'PCF12', '90 y 120 Días': 'PCF13', '120 Días': 'PCF14', '120 y 150 Días': 'PCF15', '90, 120, 150 Días': 'PCF18',
  'Prechequeado Invierno': 'PREI', 'Prechequeado Verano': 'PREV', Transferencias: 'TRANS',
}
export const IVA = 0.21

/* ---------------- Helpers ---------------- */
export const pesos = (v: number | null | undefined) =>
  v == null ? '—' : '$ ' + v.toLocaleString('es-AR', { maximumFractionDigits: 0 })
export const fechaCorta = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}${y !== String(new Date().getFullYear()) ? '/' + y.slice(2) : ''}`
}
export const fechaHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
export const nombreCorto = (n: string | null | undefined) =>
  (n ?? '').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0] + p.slice(1).toLowerCase()).join(' ') || '—'
export const totalItems = (items: ItemDragon[]) => items.reduce((s, i) => s + (Number(i.cantidad) || 0) * (Number(i.precio) || 0), 0)

export interface Etapa {
  clave: PasoClave | 'ok' | 'canc'
  texto: string
  tono: 'amber' | 'green' | 'red'
}
export function etapaDe(o: OrdenCompra): Etapa {
  if (o.cancelada_at) return { clave: 'canc', texto: o.no_autorizada ? 'No autorizada' : 'Cancelada', tono: 'red' }
  const falta = PASOS.find((p) => !o.pasos?.[p.k])
  if (!falta) return { clave: 'ok', texto: 'Completa', tono: 'green' }
  const txt: Record<PasoClave, string> = {
    valid: 'Falta validar compras', autor: o.pedida_at ? 'Esperando autorización' : 'Falta autorizar', env: 'Falta enviar',
    acep: 'Falta aceptación', f_oc: 'Falta OC en Flexxus', f_rem: 'Falta remito', f_fac: 'Falta factura',
  }
  return { clave: falta.k, texto: txt[falta.k], tono: 'amber' }
}
export const vencida = (o: OrdenCompra, hoy = new Date().toISOString().slice(0, 10)) =>
  !o.cancelada_at && !!o.fecha_entrega && o.fecha_entrega < hoy && !o.pasos?.acep

/* ---------------- Datos ---------------- */
function sb() {
  if (!supabase) throw new Error('Supabase no está configurado')
  return supabase
}

/** Todas las OC que el usuario puede ver (la RLS filtra). De a 1000 por el tope de PostgREST. */
export async function cargarOrdenes(): Promise<OrdenCompra[]> {
  const out: OrdenCompra[] = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb().from('ordenes_compra').select('*').order('numero', { ascending: false }).range(desde, desde + 999)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as OrdenCompra[]))
    if (!data || data.length < 1000) break
  }
  return out
}

export async function cargarOrden(numero: number): Promise<OrdenCompra | null> {
  const { data, error } = await sb().from('ordenes_compra').select('*').eq('numero', numero).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as OrdenCompra | null) ?? null
}

export async function cargarEventos(numero: number): Promise<EventoOc[]> {
  const { data, error } = await sb().from('ordenes_compra_eventos').select('*').eq('numero', numero).order('at')
  if (error) throw new Error(error.message)
  return (data ?? []) as EventoOc[]
}

async function rpc<T>(nombre: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().rpc(nombre, params)
  if (error) throw new Error(error.message)
  return data as T
}

export const guardarOrden = (p: Record<string, unknown>) => rpc<number>('oc_guardar', { p })
export const tildarPaso = (numero: number, paso: PasoClave, hecho: boolean) => rpc('oc_paso', { p_numero: numero, p_paso: paso, p_hecho: hecho })
export const cancelarOrden = (numero: number, motivo: string, reabrir = false) => rpc('oc_cancelar', { p_numero: numero, p_motivo: motivo, p_reabrir: reabrir })
export const borrarOrden = (numero: number) => rpc('oc_borrar', { p_numero: numero })
export const guardarObsPropias = (numero: number, texto: string) => rpc('oc_obs_propias', { p_numero: numero, p_texto: texto })
export const mandarADragon = (numero: number) => rpc('oc_mandar_dragon', { p_numero: numero })
export const sugeridoDe = (numero: number) =>
  rpc<{ nombres: string[]; resto: string[]; motivo: string | null; horas: number }>('oc_sugerido', { p_numero: numero })

export interface ConfigOc {
  autorizadores: string[]
  reparto_auto: boolean
  horas_espera: number
}
export async function cargarConfig(): Promise<ConfigOc | null> {
  const { data } = await sb().from('ordenes_compra_config').select('autorizadores,reparto_auto,horas_espera').eq('id', 1).maybeSingle()
  return (data as ConfigOc | null) ?? null
}
export const guardarConfig = (c: ConfigOc) =>
  rpc('oc_config_guardar', { p_autorizadores: c.autorizadores, p_reparto_auto: c.reparto_auto, p_horas: c.horas_espera })
export const contactosAgenda = () => rpc<Array<{ id: string; nombre: string; fin: string; activo: boolean }>>('oc_contactos', {})
export const repartoActual = () =>
  rpc<{ tipo: Record<string, { quien: string; n: number; de: number }>; gastos_responsable: Record<string, { quien: string; n: number; de: number }> }>('oc_reparto', {})

/** POST a /api/informe con la sesión del usuario (pedir autorización, plantilla de WhatsApp). */
export async function apiInforme<T>(cuerpo: Record<string, unknown>): Promise<T> {
  const { data } = await sb().auth.getSession()
  const r = await fetch('/api/informe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
    body: JSON.stringify(cuerpo),
  })
  const j = (await r.json().catch(() => null)) as (T & { error?: string }) | null
  if (!r.ok) throw new Error(j?.error ?? `Error ${r.status}`)
  return j as T
}
export const pedirAutorizacion = (numero: number) =>
  apiInforme<{ ok: boolean; enviados: number; errores: string[]; destinatarios: string[] }>({ ocPedir: numero })

/* ---------------- Búsquedas ---------------- */
export interface ProveedorDragon {
  codigo: string
  nombre: string
}
/** Proveedores de DRAGONFISH_INDOD (tabla sembrada para Recepción INDO, 1.518). Cada palabra tiene que coincidir. */
export async function buscarProveedoresDragon(texto: string): Promise<ProveedorDragon[]> {
  const palabras = texto.replace(/[,()*%\\]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 4)
  if (!palabras.length) return []
  let q = sb().from('recepcion_indo_proveedores').select('codigo,nombre')
  for (const w of palabras) q = q.or(`codigo.ilike.%${w}%,nombre.ilike.%${w}%`)
  const { data, error } = await q.order('nombre').limit(30)
  if (error) throw new Error(error.message)
  return ((data ?? []) as ProveedorDragon[]).map((p) => ({ codigo: p.codigo.trim(), nombre: p.nombre.trim() }))
}

/** Proveedores ya usados en OC (para el alta: razón social + CUIT/contacto de la última OC). */
export async function buscarProveedoresOc(texto: string): Promise<Array<Pick<OrdenCompra, 'proveedor' | 'proveedor_cuit' | 'contacto' | 'telefono' | 'mail'>>> {
  const w = texto.replace(/[,()*%\\]/g, ' ').trim()
  if (w.length < 2) return []
  const { data, error } = await sb()
    .from('ordenes_compra')
    .select('proveedor,proveedor_cuit,contacto,telefono,mail,numero')
    .ilike('proveedor', `%${w}%`)
    .order('numero', { ascending: false })
    .limit(80)
  if (error) throw new Error(error.message)
  const vistos = new Map<string, Pick<OrdenCompra, 'proveedor' | 'proveedor_cuit' | 'contacto' | 'telefono' | 'mail'>>()
  for (const f of (data ?? []) as OrdenCompra[]) {
    const k = f.proveedor.trim().toUpperCase()
    if (!vistos.has(k)) vistos.set(k, f)
  }
  return [...vistos.values()].slice(0, 15)
}

export interface ArticuloBusqueda {
  articulo: string
  descripcion: string
  proveedor: string | null
}
/** Maestro de artículos del hub (public.articulos, ~93 mil): por código o descripción, cada palabra tiene que estar. */
export async function buscarArticulos(texto: string): Promise<ArticuloBusqueda[]> {
  const palabras = texto.replace(/[,()*%\\]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 4)
  if (!palabras.length) return []
  let q = sb().from('articulos').select('id_art,descripcion,id_prov')
  for (const w of palabras) q = q.or(`id_art.ilike.%${w}%,descripcion.ilike.%${w}%`)
  const { data, error } = await q.order('id_art', { ascending: false }).limit(30)
  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<{ id_art: string; descripcion: string | null; id_prov: string | null }>).map((a) => ({
    articulo: a.id_art, descripcion: a.descripcion ?? '', proveedor: a.id_prov,
  }))
}

export interface Variantes {
  colores: Array<{ codigo: string; nombre: string }>
  talles: string[]
}
/** Colores y talles del artículo en Dragon (en vivo por el puente). null si el puente no lo tiene todavía. */
export async function variantesArticulo(articulo: string, base = 'INDOD'): Promise<Variantes | null> {
  const { data } = await sb().auth.getSession()
  try {
    const r = await fetch(`/api/sql/dragon-variantes?base=${encodeURIComponent(base)}&articulo=${encodeURIComponent(articulo)}`, {
      headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}` },
    })
    if (!r.ok) return null
    const j = (await r.json().catch(() => null)) as Variantes | null
    return j && Array.isArray(j.colores) ? j : null
  } catch {
    return null
  }
}

/** Archivo de la OC (bucket privado ordenes-compra). */
export async function subirArchivo(numeroTemporal: string, archivo: File): Promise<string> {
  const limpio = archivo.name.replace(/[^\w.-]+/g, '_').slice(-80)
  const path = `${numeroTemporal}/${Date.now()}_${limpio}`
  const { error } = await sb().storage.from('ordenes-compra').upload(path, archivo, { upsert: false })
  if (error) throw new Error(error.message)
  return path
}
export async function urlArchivo(path: string): Promise<string | null> {
  const { data } = await sb().storage.from('ordenes-compra').createSignedUrl(path, 600)
  return data?.signedUrl ?? null
}
