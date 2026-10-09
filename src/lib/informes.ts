/**
 * Tipos y helpers del creador de informes (área Sistemas), compartidos por la
 * pantalla y las funciones de Vercel. Acá no hay acceso a base ni a red.
 */

export type FuenteInforme = 'vista' | 'app' | 'texto'
export type ModoInforme = 'manual' | 'diario'
/** Cómo se entrega: mensaje de texto o una imagen PNG con el cuadro del informe. */
export type FormatoInforme = 'texto' | 'imagen'

export interface Destinatario {
  nombre: string
  telefono: string
}

/** Fuentes "de la app" (datos ya calculados por Supabase). */
export type TipoApp = 'recepcion_indo' | 'armados' | 'pedidos_compra'

export interface ConfigVista {
  vista: string
  donde?: string[]
  valor?: string
  coincide?: 'igual' | 'contiene'
  columnas?: string[]
  tope?: number
}
export interface ConfigApp {
  tipo: TipoApp
}
export interface ConfigTexto {
  plantilla: string
}

export interface Informe {
  id: string
  nombre: string
  activo: boolean
  fuente: FuenteInforme
  config: Record<string, unknown>
  encabezado: string | null
  pie: string | null
  destinatarios: Destinatario[]
  modo: ModoInforme
  hora: string | null
  dias: string[]
  ultimo_envio: string | null
  ultimo_ok: boolean | null
  ultimo_detalle: string | null
  creado_at: string
}

export interface EnvioInforme {
  id: number
  informe_id: string
  enviado_at: string
  destino: string | null
  ok: boolean
  detalle: string | null
  origen: 'manual' | 'cron' | 'prueba'
}

export const FUENTES: { id: FuenteInforme; label: string; desc: string }[] = [
  { id: 'texto', label: 'Texto libre', desc: 'Un mensaje redactado a mano, con {fecha}, {hora} y {dia}.' },
  { id: 'app', label: 'Datos de la app', desc: 'Recepción INDO, armados o pedidos de compra, ya resumidos.' },
  { id: 'vista', label: 'Vista del SQL Server', desc: 'Una vista habilitada en Datos SQL, con filtro y columnas.' },
]

export const FORMATOS: { id: FormatoInforme; label: string; desc: string }[] = [
  { id: 'texto', label: 'Texto', desc: 'Un mensaje de WhatsApp, como hasta ahora.' },
  { id: 'imagen', label: 'Imagen (PNG)', desc: 'Un cuadro con el informe, cómodo para reenviar.' },
]

export const TIPOS_APP: { id: TipoApp; label: string }[] = [
  { id: 'recepcion_indo', label: 'Recepción INDO (pendientes de controlar)' },
  { id: 'armados', label: 'Armados de pedidos (pendientes y en curso)' },
  { id: 'pedidos_compra', label: 'Pedidos de compra (últimos 7 días)' },
]

export const DIAS: { id: string; label: string }[] = [
  { id: 'lun', label: 'Lun' },
  { id: 'mar', label: 'Mar' },
  { id: 'mie', label: 'Mié' },
  { id: 'jue', label: 'Jue' },
  { id: 'vie', label: 'Vie' },
  { id: 'sab', label: 'Sáb' },
  { id: 'dom', label: 'Dom' },
]

export function fuenteLabel(f: FuenteInforme): string {
  return FUENTES.find((x) => x.id === f)?.label ?? f
}

/** Formato de entrega (vive dentro de `config`; por defecto, texto). */
export function formatoDe(i: Informe): FormatoInforme {
  const f = (i?.config as Record<string, unknown> | null | undefined)?.formato
  return f === 'imagen' ? 'imagen' : 'texto'
}

export function tipoAppLabel(t: string | undefined): string {
  return TIPOS_APP.find((x) => x.id === t)?.label ?? 'Datos de la app'
}

/**
 * Deja el teléfono en formato internacional sin '+' para la API de WhatsApp.
 * Best-effort para Argentina: 54 + 9 + área + número (móvil). Si el usuario ya
 * cargó el 54, se respeta lo que puso (sólo se sacan signos y espacios).
 */
export function normalizarTelefono(tel: string): string {
  let d = (tel || '').replace(/[^\d]/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  d = d.replace(/^0+/, '')
  if (d.startsWith('54')) return d
  if (d.length === 10) return `549${d}` // móvil argentino sin 0 ni 15
  if (d.length === 11) return `54${d}` // con característica
  return d
}

/** ¿Quedó un teléfono plausible? (internacional, 8 a 15 dígitos) */
export function telefonoValido(tel: string): boolean {
  const d = normalizarTelefono(tel)
  return d.length >= 8 && d.length <= 15
}

/** Resumen corto del contenido, para la lista. */
export function resumenInforme(i: Informe): string {
  if (i.fuente === 'texto') {
    const p = String((i.config as unknown as ConfigTexto)?.plantilla ?? '').replace(/\s+/g, ' ').trim()
    return p ? `“${p.slice(0, 60)}${p.length > 60 ? '…' : ''}”` : 'Texto sin redactar'
  }
  if (i.fuente === 'app') return tipoAppLabel((i.config as unknown as ConfigApp)?.tipo)
  const v = (i.config as unknown as ConfigVista)?.vista
  return v ? `Vista ${v}` : 'Vista sin elegir'
}

export function cuandoLabel(i: Informe): string {
  if (i.modo !== 'diario') return 'A mano'
  const dias = i.dias?.length ? i.dias.map((d) => DIAS.find((x) => x.id === d)?.label ?? d).join(' ') : 'Todos los días'
  return `${dias} · ${i.hora || '--:--'}`
}

/** Descripción legible del último envío. */
export function ultimoLabel(i: Informe): string {
  if (!i.ultimo_envio) return 'Nunca se envió'
  const cuando = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(i.ultimo_envio))
  return `${cuando} · ${i.ultimo_ok ? 'OK' : 'con error'}`
}
