import { supabase } from '@/lib/supabase'

/* ------------------------------------------------------------------ */
/*  Franquicias: cliente elegido -> base Dragonfish, sucursal de       */
/*  stock y teléfono de WhatsApp. Lo usan las pantallas de reposición, */
/*  propuestas y materiales. La configuración se edita en Sistemas.    */
/*  Tablas/RPC: sql/franquicias_clientes_bases.sql                     */
/* ------------------------------------------------------------------ */

export interface BaseFranquicia {
  base: string
  sucursal: string | null
  nombre: string | null
  activa: boolean
}

export interface MapaFranquicias {
  bases: BaseFranquicia[]
  /** cliente_id (5 dígitos, ej. 01140) -> base (ej. DRAGONFISH_CFU) */
  clientes: Record<string, string>
  /** cliente_id -> teléfono internacional sin '+' (ej. 5492901400000) */
  telefonos: Record<string, string>
}

export interface ClienteFranquicia {
  id: string
  /** código como lo usa Dragon: 5 dígitos (ej. 01140) */
  codigo: string
  /** código tal como está en la tabla clientes (ej. 1140) */
  nCliente: string
  razonSocial: string
}

/** Código de cliente normalizado a 5 dígitos (Dragon usa ceros adelante). */
export const claveCliente = (n: string | null | undefined) => String(n ?? '').trim().padStart(5, '0')

/** 'DRAGONFISH_CFU' -> 'CFU' (clave de la franquicia en propuestas/contactos). */
export const claveFranquicia = (base: string) => String(base ?? '').toUpperCase().replace(/^DRAGONFISH_/, '')

export async function cargarMapaFranquicias(): Promise<MapaFranquicias> {
  if (!supabase) return { bases: [], clientes: {}, telefonos: {} }
  const { data, error } = await supabase.rpc('franquicias_bases_mapa')
  if (error) throw new Error(error.message)
  const m = (data ?? {}) as Partial<MapaFranquicias>
  return { bases: m.bases ?? [], clientes: m.clientes ?? {}, telefonos: m.telefonos ?? {} }
}

export async function asignarBase(clienteId: string, base: string | null): Promise<void> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { error } = await supabase.rpc('franquicias_asignar_base', { p_cliente: claveCliente(clienteId), p_base: base })
  if (error) throw new Error(error.message)
}

/**
 * Guarda la base y el teléfono de WhatsApp de un cliente en una sola llamada.
 * Si la base queda vacía se borra la asignación completa (incluido el teléfono).
 */
export async function guardarAsignacion(clienteId: string, base: string | null, telefono: string | null): Promise<void> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { error } = await supabase.rpc('franquicias_guardar_asignacion', {
    p_cliente: claveCliente(clienteId),
    p_base: base?.trim() || null,
    p_telefono: telefono?.trim() || null,
  })
  if (error) throw new Error(error.message)
}

/** Cambia solo el teléfono (no toca la base). Requiere que el cliente tenga base. */
export async function guardarTelefonoCliente(clienteId: string, telefono: string | null): Promise<void> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { error } = await supabase.rpc('franquicias_asignar_telefono', {
    p_cliente: claveCliente(clienteId),
    p_telefono: telefono?.trim() || null,
  })
  if (error) throw new Error(error.message)
}

export async function crearBase(b: { base: string; sucursal: string; nombre: string }): Promise<void> {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const { error } = await supabase.from('franquicias_bases').insert({
    base: b.base.trim().toUpperCase(),
    sucursal: b.sucursal.trim().toUpperCase() || null,
    nombre: b.nombre.trim() || null,
  })
  if (error) throw new Error(error.message)
}

/**
 * Clientes activos del hub. La tabla guarda el código sin ceros (1140) y
 * Dragon/la asignación lo usa con 5 (01140): se normaliza en `codigo`.
 */
export async function cargarClientes(): Promise<ClienteFranquicia[]> {
  if (!supabase) return []
  const out: ClienteFranquicia[] = []
  for (let desde = 0; desde < 20000; desde += 1000) {
    const { data, error } = await supabase
      .from('clientes')
      .select('id,n_cliente,razon_social')
      .eq('estado', 'ACTIVO')
      .order('razon_social')
      .range(desde, desde + 999)
    if (error) throw new Error(error.message)
    const filas = (data as { id: string; n_cliente: string | null; razon_social: string | null }[] | null) ?? []
    for (const c of filas) {
      const n = String(c.n_cliente ?? '').trim()
      out.push({ id: c.id, nCliente: n, codigo: claveCliente(n), razonSocial: String(c.razon_social ?? '').trim() })
    }
    if (filas.length < 1000) break
  }
  return out
}

/** Clientes que ya tienen una base asignada, ordenados por razón social. */
export function clientesConBase(clientes: ClienteFranquicia[], mapa: MapaFranquicias): ClienteFranquicia[] {
  return clientes
    .filter((c) => Boolean(mapa.clientes[c.codigo]))
    .sort((a, b) => a.razonSocial.localeCompare(b.razonSocial, 'es'))
}

export interface DestinoFranquicia {
  /** cliente al que va el pedido (5 dígitos) */
  clienteId: string
  clienteNombre: string
  /** clave de la propuesta/contactos: CFU, ZIM… */
  id: string
  /** nombre visible: CF Ushuaia */
  nombre: string
  base: string
  origenStock: string
  /** teléfono configurado para el cliente (internacional sin '+') */
  telefono: string | null
}

/** Arma el destino (base + sucursal de stock) del cliente elegido. */
export function destinoDe(cliente: ClienteFranquicia, mapa: MapaFranquicias): DestinoFranquicia | null {
  const baseNombre = mapa.clientes[cliente.codigo]
  if (!baseNombre) return null
  const base = mapa.bases.find((b) => b.base === baseNombre)
  return {
    clienteId: cliente.codigo,
    clienteNombre: cliente.razonSocial,
    id: claveFranquicia(baseNombre),
    nombre: base?.nombre || baseNombre,
    base: baseNombre,
    origenStock: String(base?.sucursal ?? '').trim().toUpperCase(),
    telefono: mapa.telefonos[cliente.codigo] ?? null,
  }
}
