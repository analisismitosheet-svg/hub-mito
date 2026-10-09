/* ------------------------------------------------------------------ */
/*  Avisos push en el celular (armado de pedidos).                      */
/*  activarAvisos() anota este celular (pide permiso de notificaciones,  */
/*  se suscribe con la clave VAPID de /api/push-armado y lo guarda con   */
/*  push_suscribir). avisarArmados() lo llama el mayorista después de    */
/*  pedir_armado para que suene en los celulares aunque estén bloqueados.*/
/* ------------------------------------------------------------------ */
import { supabase } from './supabase'

export type EstadoAvisos = 'no-soportado' | 'bloqueado' | 'inactivo' | 'activo' | 'ios-instalar'

/** iPhone/iPad: Web Push solo anda con la app instalada en la pantalla de inicio */
function esIosSinInstalar(): boolean {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const instalada = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
  return ios && !instalada
}

function soportado(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined'
}

async function registro(): Promise<ServiceWorkerRegistration | null> {
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.ready)
  } catch {
    return null
  }
}

export async function estadoAvisos(): Promise<EstadoAvisos> {
  if (esIosSinInstalar()) return 'ios-instalar'
  if (!soportado()) return 'no-soportado'
  if (Notification.permission === 'denied') return 'bloqueado'
  if (Notification.permission !== 'granted') return 'inactivo'
  const reg = await registro()
  const sub = await reg?.pushManager.getSubscription()
  return sub ? 'activo' : 'inactivo'
}

function aBytes(base64: string): Uint8Array {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  const b = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(b, (c) => c.charCodeAt(0))
}

/**
 * Anota este celular para recibir los avisos. Tiene que llamarse desde un toque
 * (botón): si no, el navegador no muestra el pedido de permiso.
 * Devuelve un texto de error o null si quedó activo.
 */
export async function activarAvisos(): Promise<string | null> {
  if (esIosSinInstalar()) return 'En iPhone primero instalá la app: Compartir → "Agregar a pantalla de inicio", y abrila desde ahí.'
  if (!soportado()) return 'Este navegador no permite avisos. Usá Chrome en Android.'
  if (!supabase) return 'Sin conexión con la base.'
  const permiso = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permiso !== 'granted') return 'Las notificaciones están bloqueadas: habilitalas en los ajustes del navegador para esta app.'
  const reg = await registro()
  if (!reg) return 'La app todavía no terminó de instalarse. Recargá y probá de nuevo.'
  try {
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      const r = await fetch('/api/push-armado')
      const { publicKey } = (await r.json()) as { publicKey?: string }
      if (!publicKey) return 'No se pudo obtener la clave de avisos.'
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: aBytes(publicKey) as BufferSource })
    }
    const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    const { error } = await supabase.rpc('push_suscribir', {
      p_endpoint: j.endpoint,
      p_p256dh: j.keys?.p256dh,
      p_auth: j.keys?.auth,
      p_agente: navigator.userAgent,
    })
    if (error) return error.message
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

/** Si ya hay permiso, vuelve a anotar la suscripción en silencio (por si se renovó). */
export async function refrescarAvisos(): Promise<void> {
  if (!soportado() || Notification.permission !== 'granted') return
  await activarAvisos()
}

/** Después de pedir_armado: avisa por push a los celulares (no rompe si falla). */
export async function avisarArmados(): Promise<void> {
  try {
    if (!supabase) return
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return
    await fetch('/api/push-armado', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
  } catch {
    /* el aviso dentro de la app (campana) sigue andando */
  }
}

/** Después de pedir una pausa: avisa por push a los que autorizan (no rompe si falla). */
export async function avisarPausa(): Promise<void> {
  try {
    if (!supabase) return
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return
    await fetch('/api/push-pausa', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
  } catch {
    /* el aviso dentro de la app (campana) sigue andando */
  }
}

/** Después de finalizar un armado con faltantes: avisa por push a los que ven los
 * faltantes de stock (permiso mayorista.faltantes.ver o admin). No rompe si falla. */
export async function avisarFaltantes(armadoId: string): Promise<void> {
  try {
    if (!supabase) return
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return
    await fetch('/api/push-faltantes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ armado_id: armadoId }),
    })
  } catch {
    /* el aviso dentro de la app (campana) sigue andando */
  }
}
