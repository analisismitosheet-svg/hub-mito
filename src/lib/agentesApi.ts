/**
 * Cliente del servidor de agentes IA (D:\PWA\mito-server, Ollama).
 * Solo administradores: se manda el token de la sesión del hub y el servidor verifica que sea admin.
 * Desde afuera de la PC del servidor se entra por Tailscale (VITE_URL_AGENTES = https://<pc>.<red>.ts.net).
 */
import { supabase } from '@/lib/supabase'

const BASE = (import.meta.env.VITE_URL_AGENTES as string | undefined)?.trim().replace(/\/$/, '') || 'http://localhost:4000'

export interface AgenteInfo {
  id: string
  nombre: string
  descripcion: string
}

export interface AccionPropuesta {
  id: string
  titulo: string
  detalle: string
  cambios: { campo: string; antes: unknown; despues: unknown }[]
}

export interface RespuestaAgente {
  conversacionId: string
  respuesta: string
  herramientasUsadas: { nombre: string; error?: string }[]
  acciones?: AccionPropuesta[]
}

export interface ResultadoAccion {
  mensaje: string
  /** Contraseña temporal: se muestra una sola vez */
  secreto?: string
}

async function pedir<T>(ruta: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const token = (await supabase?.auth.getSession())?.data.session?.access_token
  const res = await fetch(`${BASE}${ruta}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(init?.timeoutMs ?? 10_000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || `Error ${res.status}`)
  return data as T
}

/** true si el servidor de agentes responde y el modelo está listo */
export async function agentesDisponibles(): Promise<boolean> {
  try {
    const s = await pedir<{ ollama: { conectado: boolean; modeloInstalado: boolean } }>('/api/salud', { timeoutMs: 2500 })
    return s.ollama.conectado && s.ollama.modeloInstalado
  } catch {
    return false
  }
}

export const listarAgentes = () => pedir<AgenteInfo[]>('/api/agentes')

export const chatAgente = (agente: string, mensaje: string, conversacionId?: string) =>
  pedir<RespuestaAgente>(`/api/agentes/${agente}/chat`, {
    method: 'POST',
    body: JSON.stringify({ mensaje, conversacionId }),
    timeoutMs: 10 * 60_000, // el modelo corre en la CPU: puede tardar
  })

export const confirmarAccion = (id: string) =>
  pedir<ResultadoAccion>(`/api/acciones/${id}/confirmar`, { method: 'POST', timeoutMs: 60_000 })

export const cancelarAccion = (id: string) => pedir<{ ok: boolean }>(`/api/acciones/${id}/cancelar`, { method: 'POST' })

/** Campos que la IA local leyó de la foto de un remito de transporte (Recepción INDO). */
export interface DatosRemito {
  nGuia: string | null
  transporte: string | null
  bultos: number | null
  fechaRemito: string | null // AAAA-MM-DD
  remitente: string | null
  destino: string | null
  nRemito: string | null
  nFactura: string | null
  textoLeido: string | null
}

/**
 * Manda la foto (JPEG en base64, ya achicada) a mito-server, que la lee con Ollama.
 * No es solo para administradores: alcanza con el permiso de Depósito.
 */
export interface LecturaRemito {
  /** Uno o varios envíos: la factura del transporte trae una fila por guía */
  envios: DatosRemito[]
  documento: { tipo: string | null; numero: string | null; fecha: string | null }
  datos: DatosRemito
  modelo: string
  segundos: number
}

export const leerFotoRemito = (imagenBase64: string) =>
  pedir<LecturaRemito>('/ia/remito', {
    method: 'POST',
    body: JSON.stringify({ imagen: imagenBase64 }),
    timeoutMs: 7 * 60_000, // corre en el procesador: de 30 s a 3 min según la foto
  })
