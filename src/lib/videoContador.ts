import { supabase } from '@/lib/supabase'

/**
 * Video en vivo de la PC contadora (contador-camaras/vista.py).
 * No hay links fijos: se pide un PASE temporal con la sesión del hub; la PC contadora le
 * pregunta al hub si este usuario puede ver ese local (mismas reglas RLS) y, para calibrar,
 * si tiene contador.gestionar. El pase vence a los 30 min.
 */

export type Alcance = 'ver' | 'gestion'

export class ErrorVideo extends Error {
  constructor(message: string, public causa: 'permiso' | 'red' | 'pc') {
    super(message)
  }
}

const cache = new Map<string, { pase: string; vence: number }>()

export async function pedirPase(base: string, camara: string, alcance: Alcance = 'ver'): Promise<string> {
  const clave = `${base}|${camara}|${alcance}`
  const guardado = cache.get(clave)
  if (guardado && guardado.vence - 60 > Date.now() / 1000) return guardado.pase
  if (!supabase) throw new ErrorVideo('Supabase no está configurado.', 'pc')
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new ErrorVideo('Tu sesión del hub venció: volvé a ingresar.', 'permiso')
  let res: Response
  try {
    res = await fetch(`${base.replace(/\/$/, '')}/pase`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ camara, alcance }),
    })
  } catch {
    throw new ErrorVideo('No se pudo conectar con la PC contadora (apagada o sin internet).', 'red')
  }
  const cuerpo = (await res.json().catch(() => ({}))) as { pase?: string; vence?: number; error?: string }
  if (!res.ok || !cuerpo.pase) {
    throw new ErrorVideo(cuerpo.error ?? `La PC contadora respondió ${res.status}`, res.status === 403 || res.status === 401 ? 'permiso' : 'pc')
  }
  cache.set(clave, { pase: cuerpo.pase, vence: cuerpo.vence ?? Date.now() / 1000 + 1500 })
  return cuerpo.pase
}

const raiz = (base: string) => base.replace(/\/$/, '')
const cam = (camara: string) => encodeURIComponent(camara)

export const urlVideo = (base: string, camara: string, pase: string) => `${raiz(base)}/video/${cam(camara)}?k=${encodeURIComponent(pase)}`
export const urlFoto = (base: string, camara: string, pase: string, limpia = false) =>
  `${raiz(base)}/foto/${cam(camara)}?k=${encodeURIComponent(pase)}${limpia ? '&limpia=1' : ''}`
export const urlCanal = (base: string, camara: string, canal: number, pase: string) =>
  `${raiz(base)}/canal/${cam(camara)}/${canal}?k=${encodeURIComponent(pase)}`
