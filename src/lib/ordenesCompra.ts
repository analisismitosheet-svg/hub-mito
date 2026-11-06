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
  via?: 'hub' | 'whatsapp' | 'telegram' | 'planilla'
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
  /** Subtipo del árbol de autorizadores (`ordenes_compra_subtipos`). */
  subtipo_id: number | null
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
  /** Elegidos a mano por categoría: «tipo:Producto», «tipo:Gastos» (el resto) o «gastos:RESPONSABLE» → ids de contactos. */
  reglas: Record<string, string[]>
}
export async function cargarConfig(): Promise<ConfigOc | null> {
  const { data } = await sb().from('ordenes_compra_config').select('autorizadores,reparto_auto,horas_espera,reglas').eq('id', 1).maybeSingle()
  return (data as ConfigOc | null) ?? null
}
export const guardarConfig = (c: ConfigOc) =>
  rpc('oc_config_guardar', { p_autorizadores: c.autorizadores, p_reparto_auto: c.reparto_auto, p_horas: c.horas_espera, p_reglas: null })

/* ---------------- Árbol de autorizadores (tipo → subtipos) ---------------- */
export interface SubtipoOc {
  id: number
  tipo: OrdenCompra['tipo']
  nombre: string
  autorizadores: string[]
  orden: number
}
/** Subtipos activos (los ve cualquiera con la pantalla: el formulario los usa). */
export async function cargarSubtipos(): Promise<SubtipoOc[]> {
  const { data, error } = await sb().from('ordenes_compra_subtipos').select('id,tipo,nombre,autorizadores,orden').eq('activo', true).order('orden')
  if (error) throw new Error(error.message)
  return (data ?? []) as SubtipoOc[]
}
/** Todos los subtipos, también los borrados (para mostrar el de una OC vieja). */
export async function nombresSubtipos(): Promise<Record<number, string>> {
  const { data } = await sb().from('ordenes_compra_subtipos').select('id,nombre')
  return Object.fromEntries((data ?? []).map((s: { id: number; nombre: string }) => [s.id, s.nombre]))
}
export interface NodoArbol {
  tipo: OrdenCompra['tipo']
  autorizadores: string[]
  subs: Array<{ id?: number; nombre: string; autorizadores: string[] }>
}
/** Guarda el árbol entero (solo admin): quién autoriza cada tipo y sus subtipos; los subtipos que faltan se desactivan. */
export const guardarArbol = (arbol: NodoArbol[]) => rpc('oc_arbol_guardar', { p: arbol })
export const contactosAgenda = () => rpc<Array<{ id: string; nombre: string; fin: string; activo: boolean }>>('oc_contactos', {})
/** Claves del link de autorización (solo admin): quién tiene y quién está bloqueado; el valor nunca vuelve. */
export const clavesEstado = () => rpc<Array<{ contacto_id: string; bloqueada: boolean }>>('oc_claves_estado', {})
export const guardarClave = (contacto: string, clave: string) => rpc('oc_clave_guardar', { p_contacto: contacto, p_clave: clave })
export const desbloquearClave = (contacto: string) => rpc('oc_clave_desbloquear', { p_contacto: contacto })
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

/* Datos de contacto de los proveedores: tabla ordenes_compra_proveedores (maestro de Dragon,
   ZooLogic.PROV + primer contacto de CONTPROVDET; la llena el puente cada 1 hora). */
export interface DatosProveedor {
  proveedor: string
  proveedor_cuit: string | null
  contacto: string | null
  telefono: string | null
  mail: string | null
  /** Código del proveedor en Dragon cuando el dato sale del maestro */
  dragon?: string
}
interface FilaProvDragon { codigo: string; nombre: string; cuit: string | null; contacto: string | null; telefono: string | null; mail: string | null }
const deDragon = (p: FilaProvDragon): DatosProveedor => ({
  proveedor: p.nombre, proveedor_cuit: p.cuit, contacto: p.contacto, telefono: p.telefono, mail: p.mail, dragon: p.codigo,
})
const COLS_PROV = 'codigo,nombre,cuit,contacto,telefono,mail'
/** Palabras que no sirven para reconocer a un proveedor (forma societaria, artículos) */
const PALABRAS_VACIAS = new Set(['SA', 'SRL', 'SAS', 'SACI', 'SAIC', 'SAIYC', 'SH', 'SC', 'SOC', 'CO', 'LTD', 'LTDA', 'INC', 'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'E'])
const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
/** "NEW ARRECIFE S.A." -> [NEW, ARRECIFE] (las letras sueltas de S.A. / S.R.L. quedan afuera) */
function palabrasProveedor(t: string): string[] {
  const n = normalizar(t)
  return [...new Set(n.split(' ').filter((w) => w.length >= 2 && !PALABRAS_VACIAS.has(w)))]
}
const cuitConGuiones = (v: string) => { const d = v.replace(/\D/g, ''); return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : null }
const tieneDatos = (p: { cuit?: string | null; proveedor_cuit?: string | null; contacto: string | null; telefono: string | null; mail: string | null }) =>
  Boolean((p.cuit ?? p.proveedor_cuit) || p.contacto || p.telefono || p.mail)

async function provDragonPorPalabras(palabras: string[], limite: number): Promise<FilaProvDragon[]> {
  if (!palabras.length) return []
  let q = sb().from('ordenes_compra_proveedores').select(COLS_PROV)
  for (const w of palabras.slice(0, 5)) q = q.ilike('nombre', `%${w}%`)
  const { data, error } = await q.order('nombre').limit(limite)
  if (error) throw new Error(error.message)
  return (data ?? []) as FilaProvDragon[]
}

/** Busca en el maestro de Dragon los datos de un proveedor elegido por razón social (o por CUIT).
    Si el nombre coincide con más de un proveedor distinto, no adivina: devuelve null. */
export async function datosProveedorDragon(nombre: string, cuit?: string | null): Promise<DatosProveedor | null> {
  const c = cuit ? cuitConGuiones(cuit) : null
  if (c) {
    const { data } = await sb().from('ordenes_compra_proveedores').select(COLS_PROV).eq('cuit', c).limit(5)
    const conDatos = ((data ?? []) as FilaProvDragon[]).filter(tieneDatos)
    if (conDatos.length) return deDragon(conDatos.find((p) => p.contacto || p.telefono || p.mail) ?? conDatos[0])
  }
  const palabras = palabrasProveedor(nombre)
  if (!palabras.length) return null
  // Cada palabra del nombre tiene que estar entera en el nombre de Dragon («ARRECIFE» no es «ARRECIFES»)
  const cand = (await provDragonPorPalabras(palabras, 30)).filter((p) => {
    const ws = new Set(normalizar(p.nombre).split(' '))
    return palabras.every((w) => ws.has(w))
  }).filter(tieneDatos)
  if (!cand.length) return null
  if (cand.length === 1) return deDragon(cand[0])
  const clave = palabras.join(' ')
  const exacto = cand.filter((p) => palabrasProveedor(p.nombre).join(' ') === clave)
  if (exacto.length === 1) return deDragon(exacto[0])
  // Varios códigos del mismo proveedor (ej. 47 STREET): vale si es el mismo CUIT
  const cuits = new Set(cand.map((p) => p.cuit).filter(Boolean))
  if (cuits.size === 1) return deDragon(cand.find((p) => p.contacto || p.telefono || p.mail) ?? cand[0])
  return null
}

/** Datos de contacto del proveedor en el historial de OC (las importadas traen contacto/teléfono/mail de la planilla).
    Busca por CUIT o por nombre («REEF - NEW ARRECIFE» encuentra «NEW ARRECIFE S.A.»: las palabras de uno están en el otro)
    y arma cada dato con la OC más reciente que lo tenga. Si el nombre coincide con proveedores distintos, no adivina. */
export async function datosProveedorHistorial(nombre: string, cuit?: string | null): Promise<DatosProveedor | null> {
  const palabras = palabrasProveedor(nombre)
  const c = cuit ? cuitConGuiones(cuit) : null
  if (!palabras.length && !c) return null
  const larga = [...palabras].sort((a, b) => b.length - a.length)[0]
  const filtros = [c && `proveedor_cuit.eq.${c}`, larga && `proveedor.ilike.%${larga}%`].filter(Boolean).join(',')
  const { data, error } = await sb().from('ordenes_compra').select('numero,proveedor,proveedor_cuit,contacto,telefono,mail')
    .or(filtros)
    .order('numero', { ascending: false }).limit(200)
  if (error || !data?.length) return null
  type Fila = Pick<OrdenCompra, 'numero' | 'proveedor' | 'proveedor_cuit' | 'contacto' | 'telefono' | 'mail'>
  const filas = (data as Fila[]).filter((f) => f.contacto || f.telefono || f.mail || f.proveedor_cuit)
  const propias = new Set(palabras)
  /** Cuántas palabras comparten si las de uno están todas en el otro (0 = no es el mismo proveedor) */
  const parecido = (otro: string) => {
    const ws = palabrasProveedor(otro)
    const comunes = ws.filter((w) => propias.has(w)).length
    const menor = Math.min(ws.length, propias.size)
    return menor > 0 && comunes === menor && (menor >= 2 || ws.length === propias.size) ? comunes : 0
  }
  let elegidas = c ? filas.filter((f) => f.proveedor_cuit === c) : []
  if (!elegidas.length) {
    const puntaje = new Map<string, number>()
    for (const f of filas) { const k = normalizar(f.proveedor); if (!puntaje.has(k)) puntaje.set(k, parecido(f.proveedor)) }
    const mejor = Math.max(0, ...puntaje.values())
    const ganadores = [...puntaje].filter(([, v]) => v === mejor && v > 0).map(([k]) => k)
    if (ganadores.length !== 1) return null
    elegidas = filas.filter((f) => normalizar(f.proveedor) === ganadores[0])
  }
  if (!elegidas.length) return null
  const primero = (k: 'proveedor_cuit' | 'contacto' | 'telefono' | 'mail') => elegidas.find((f) => f[k]?.trim())?.[k] ?? null
  return { proveedor: elegidas[0].proveedor, proveedor_cuit: primero('proveedor_cuit'), contacto: primero('contacto'), telefono: primero('telefono'), mail: primero('mail') }
}

/** Datos de un proveedor de Dragon por código (al elegirlo en la sección Dragon). */
export async function datosProveedorPorCodigo(codigo: string): Promise<DatosProveedor | null> {
  const { data } = await sb().from('ordenes_compra_proveedores').select(COLS_PROV).eq('codigo', codigo.trim()).maybeSingle()
  return data ? deDragon(data as FilaProvDragon) : null
}

/** Buscador de razón social del alta: proveedores ya usados en OC (la última de cada uno) + el maestro de Dragon. */
export async function buscarProveedoresOc(texto: string): Promise<DatosProveedor[]> {
  const w = texto.replace(/[,()*%\\]/g, ' ').trim()
  if (w.length < 2) return []
  const [oc, dragon] = await Promise.all([
    sb().from('ordenes_compra').select('proveedor,proveedor_cuit,contacto,telefono,mail,numero')
      .ilike('proveedor', `%${w}%`).order('numero', { ascending: false }).limit(80),
    provDragonPorPalabras(normalizar(w).split(' ').filter(Boolean), 12).catch(() => [] as FilaProvDragon[]),
  ])
  if (oc.error) throw new Error(oc.error.message)
  const vistos = new Map<string, DatosProveedor>()
  for (const f of (oc.data ?? []) as OrdenCompra[]) {
    const k = normalizar(f.proveedor)
    const v = vistos.get(k)
    if (!v) vistos.set(k, { proveedor: f.proveedor, proveedor_cuit: f.proveedor_cuit, contacto: f.contacto, telefono: f.telefono, mail: f.mail })
    else {
      // La última OC puede venir sin algún dato: se completa con la más reciente que lo tenga
      v.proveedor_cuit ||= f.proveedor_cuit
      v.contacto ||= f.contacto
      v.telefono ||= f.telefono
      v.mail ||= f.mail
    }
  }
  const lista = [...vistos.values()].slice(0, 12)
  // Los de Dragon con datos primero (hay nombres repetidos con códigos vacíos, ej. 3 «HAVAIANAS»)
  const cuantos = (p: FilaProvDragon) => [p.cuit, p.contacto, p.telefono, p.mail].filter(Boolean).length
  for (const p of [...dragon].sort((a, b) => cuantos(b) - cuantos(a))) if (!vistos.has(normalizar(p.nombre))) lista.push(deDragon(p))
  return lista
}

export interface ArticuloBusqueda {
  articulo: string
  descripcion: string
  proveedor: string | null
  /** Precio vigente (sin IVA) en la lista de precios pedida; null si no tiene o no se pidió lista */
  precio?: number | null
}
async function pedirArticulosDragon<T>(base: string, parametro: string): Promise<T[]> {
  const { data } = await sb().auth.getSession()
  const r = await fetch(`/api/sql/dragon-articulos?base=${encodeURIComponent(base)}&${parametro}`, {
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}` },
  })
  const j = (await r.json().catch(() => null)) as T[] | { error?: string } | null
  if (!r.ok || !Array.isArray(j)) throw new Error((j as { error?: string } | null)?.error ?? 'No se pudo consultar Dragon')
  return j
}

/** Artículos en vivo de la base de Dragon elegida: por código o descripción, cada palabra tiene que estar. */
export function buscarArticulos(texto: string, base = 'INDOD', lista = ''): Promise<ArticuloBusqueda[]> {
  return pedirArticulosDragon<ArticuloBusqueda>(base, `q=${encodeURIComponent(texto.trim())}${lista ? `&lista=${encodeURIComponent(lista)}` : ''}`)
}

export interface Variantes {
  colores: Array<{ codigo: string; nombre: string }>
  talles: string[]
}

export type ArticuloDragon = ArticuloBusqueda & Variantes

/** Descripción, colores y talles de muchos artículos en vivo (de a 100). Solo vuelven los que existen en esa base. */
export async function datosArticulosDragon(codigos: string[], base = 'INDOD', lista = ''): Promise<ArticuloDragon[]> {
  const unicos = [...new Set(codigos)]
  const tandas: string[][] = []
  for (let i = 0; i < unicos.length; i += 100) tandas.push(unicos.slice(i, i + 100))
  const res = await Promise.all(tandas.map((t) => pedirArticulosDragon<ArticuloDragon>(base, `codigos=${encodeURIComponent(t.join(','))}${lista ? `&lista=${encodeURIComponent(lista)}` : ''}`)))
  return res.flat()
}

export interface LineaTxt {
  linea: number
  texto: string
  cantidad: number
  articulo: string
  /** Lo que viene después del %: color + talle pegados (02XXL). */
  variante: string
}
/** Lee el txt de artículos: una línea por SKU, `CANTIDAD+ARTICULO%COLORTALLE` (24+zh000200%02xxl). Sin `N+` es 1 unidad. */
export function leerTxtArticulos(contenido: string): { lineas: LineaTxt[]; malas: Array<{ linea: number; texto: string }> } {
  const lineas: LineaTxt[] = []
  const malas: Array<{ linea: number; texto: string }> = []
  contenido.split(/\r?\n/).forEach((cruda, i) => {
    const texto = cruda.replace(/\s/g, '').replace(/^﻿/, '').toUpperCase()
    if (!texto) return
    const m = /^(?:(\d+)\+)?([^+%]+)%([^+%]+)$/.exec(texto)
    const cantidad = m ? Number(m[1] ?? 1) : 0
    if (!m || cantidad < 1) { malas.push({ linea: i + 1, texto: cruda.trim() }); return }
    lineas.push({ linea: i + 1, texto: cruda.trim(), cantidad, articulo: m[2], variante: m[3] })
  })
  return { lineas, malas }
}

/** Separa color y talle con lo que existe en Dragon (el color no siempre tiene 2 caracteres). null si esa combinación no existe. */
export function separarVariante(variante: string, v: Variantes): { color: string; talle: string } | null {
  for (const c of v.colores) {
    const color = c.codigo.toUpperCase()
    if (variante.startsWith(color) && v.talles.some((t) => t.toUpperCase() === variante.slice(color.length))) {
      return { color: c.codigo, talle: v.talles.find((t) => t.toUpperCase() === variante.slice(color.length)) as string }
    }
  }
  return null
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
