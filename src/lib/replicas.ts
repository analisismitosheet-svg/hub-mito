import { supabase } from '@/lib/supabase'

/**
 * Sistemas > Réplicas: estado de las bases copiadas por el Replicador SQL de
 * la PC central (ver api/replicas.ts y puente-sql/server.js).
 *
 * `actualizacion` viene del SQL local como "naive" (hora de la PC central,
 * p. ej. DESKTOP-OA4GU6I) serializada con o sin zona: por eso NO se la pasa a
 * new Date() para mostrarla. Se leen los campos directo del string
 * (formatearFecha) y, para calcular "hace cuánto", se re-offsetea con
 * instanteReal(). Los campos con hora real (`consultado`, `ultimo_latido`)
 * sí usan formatearInstante().
 */

export interface Replica {
  base: string
  sucursal: string
  origen: string
  actualizacion: string | null
  tablas: number
  corrida_fin: string
  estado: string
  ultimo_error: string
}

export interface Agente {
  vivo: boolean
  ultimo_latido: string | null
}

export interface EstadoReplicas {
  servidor: string
  replicas: Replica[]
  agente: Agente
  consultado: string | null
}

/** Nombres por código (fallback si no hay nombre del Replicador ni en `locales`). */
export const NOMBRES: Record<string, string> = {
  '9DEJU': '9 DE JULIO',
  '9DEJU2': '9 DE JULIO',
  BUSTD: 'BUSTOS',
  CFD: 'CF BUSTOS',
  CENTRALD: 'CENTRAL',
  CFPO: 'CF PATIO OLMOS',
  CFR4: 'CF RIO CUARTO',
  CFRA: 'CF RIVERA',
  CFR9: 'CF RUTA 9',
  DINOD: 'DINO',
  ESPID: 'ESPINOSA',
  GPAZD: 'GENERAL PAZ',
  INDO: 'INDO',
  INDOD: 'INDO',
  LIBED: 'LIBERTAD',
  MITO: 'MITO',
  MITOD: 'MITO',
  MITOSHD: 'MITO',
  MMAXD: 'MARIANO MAX',
  MUNOD: 'MUÑOZ',
  NCEND: 'NUEVO CENTRO',
  NCEND2: 'NUEVO CENTRO',
  NVOCED: 'NUEVO CENTRO',
  NVOCED2: 'NUEVO CENTRO',
  OUTLETD: 'OUTLET',
  POLO52: 'POLO 52',
  R9D: 'RUTA 9',
  RIVED: 'RIVERA',
  'TX-POLO': 'POLO 52',
  VCPD: 'CARLOS PAZ',
  WALTD: 'WALMART',
  ZONAFRAN: 'ZONA FRANCA',
}

/** GET /api/replicas con el JWT de la sesión activa. */
export async function cargarReplicas(): Promise<EstadoReplicas> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sin sesión activa.')

  const res = await fetch('/api/replicas', { headers: { Authorization: `Bearer ${token}` } })
  const body = (await res.json().catch(() => null)) as (EstadoReplicas & { error?: string }) | null
  if (!res.ok || !body) throw new Error(body?.error ?? `Error ${res.status} consultando las réplicas`)

  return {
    servidor: body.servidor ?? '',
    replicas: body.replicas ?? [],
    agente: body.agente ?? { vivo: false, ultimo_latido: null },
    consultado: body.consultado ?? null,
  }
}

/** DRAGONFISH_VCPD -> VCPD */
export const codigoDe = (base: string): string => base.replace(/^DRAGONFISH_/i, '')

/**
 * Nombre visible, por prioridad: el que informó el Replicador (config.json) >
 * la tabla `locales` (editable en Sistemas > Locales) > alias conocidos > código.
 */
export function nombreDe(r: { base: string; sucursal?: string }, locales: Record<string, string | null>): string {
  const codigo = codigoDe(r.base).trim().toUpperCase()
  return r.sucursal?.trim() || locales[codigo]?.trim() || NOMBRES[codigo] || codigo
}

const PARTE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/

/** "2026-09-25T15:27:17" -> { a, m, d, h, min } (hora de la PC central). */
function partes(iso: string | null): { a: string; m: string; d: string; h: string; min: string } | null {
  if (!iso) return null
  const g = PARTE.exec(iso)
  if (!g) return null
  return { a: g[1], m: g[2], d: g[3], h: g[4], min: g[5] }
}

/** Formato del módulo: 25/09/26 15.27 */
export function formatearFecha(iso: string | null): string {
  const p = partes(iso)
  if (!p) return '—'
  return `${p.d}/${p.m}/${p.a.slice(2)} ${p.h}.${p.min}`
}

/**
 * Mismo formato, pero para instantes REALES (`consultado`, `ultimo_latido`),
 * que sí vienen con zona horaria: ahí sí corresponde usar la hora local.
 */
export function formatearInstante(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ${p(d.getHours())}.${p(d.getMinutes())}`
}

/**
 * Instante real (ms epoch) de una fecha "naive" de la PC central serializada
 * como UTC. Ej.: dice 15:27 y llega "…T15:27:00.000Z": Date.parse daría 12:27
 * hora local, así que hay que sumar el offset.
 */
export function instanteReal(iso: string | null): number | null {
  const p = partes(iso)
  if (!p) return null
  const t = Date.parse(`${p.a}-${p.m}-${p.d}T${p.h}:${p.min}:00Z`)
  if (!Number.isFinite(t)) return null
  return t + new Date().getTimezoneOffset() * 60_000
}

/** "recién" / "hace 5 min" / "hace 3 h" / "hace 2 d" */
export function haceTexto(iso: string | null): string {
  const t = instanteReal(iso)
  if (t === null) return 'sin fecha'
  const min = Math.round((Date.now() - t) / 60_000)
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 48) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} d`
}

/** El Replicador corre un ciclo cada pocos minutos: 15 min = al día. */
export type Estado = 'ok' | 'atraso' | 'viejo' | 'sin-dato'

export function estadoDe(iso: string | null): Estado {
  const t = instanteReal(iso)
  if (t === null) return 'sin-dato'
  const min = (Date.now() - t) / 60_000
  if (min < 15) return 'ok'
  if (min < 60) return 'atraso'
  return 'viejo'
}

/** Chip de estado: errores de la última corrida > antigüedad > sin fecha. */
export function estadoChip(r: Replica): { clave: Estado | 'error'; texto: string } {
  if (r.estado.toUpperCase().includes('ERROR')) return { clave: 'error', texto: 'con errores' }
  const e = estadoDe(r.actualizacion)
  if (e === 'sin-dato') return { clave: e, texto: 'sin fecha' }
  if (e === 'viejo') return { clave: e, texto: 'desactualizada' }
  if (e === 'atraso') return { clave: e, texto: 'atraso' }
  return { clave: e, texto: 'al día' }
}
