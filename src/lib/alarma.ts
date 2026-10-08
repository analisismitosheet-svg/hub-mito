/* ------------------------------------------------------------------ */
/*  Aviso de ARMADO DE PEDIDOS en el celular del legajo                */
/*  (sonido + vibración + notificación del sistema).                   */
/*  Sin archivos de audio: todo generado con Web Audio, así el PWA      */
/*  sigue funcionando offline y no depende de ningún permiso más.      */
/* ------------------------------------------------------------------ */

export type PrioridadAviso = 'urgente' | 'normal' | 'baja'

/** Pitidos según la prioridad: cuanto más urgente, más insistente. */
const PITIDOS: Record<PrioridadAviso, { n: number; hz: number }> = {
  urgente: { n: 3, hz: 990 },
  normal: { n: 2, hz: 820 },
  baja: { n: 1, hz: 660 },
}

let ctx: AudioContext | null = null

function contexto(): AudioContext | null {
  try {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    if (!ctx) ctx = new AC()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

/**
 * Suena el celular: hace sonar `n` pitidos (según prioridad) y vibra.
 * Importa el estado de la pestaña: si la app está en primer plano suena igual
 * (Web Audio), y si está en segundo plano además tira la notificación del
 * sistema desde `notificarArmado`.
 *
 * Se llama con cada tarea NUEVA, sin importar cuántas haya activas.
 */
export function sonarArmado(prioridad: PrioridadAviso = 'normal'): void {
  const cfg = PITIDOS[prioridad] ?? PITIDOS.normal
  const ac = contexto()
  if (ac) {
    try {
      const t0 = ac.currentTime
      for (let i = 0; i < cfg.n; i++) {
        const t = t0 + i * 0.32
        const osc = ac.createOscillator()
        const gain = ac.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(cfg.hz, t)
        osc.frequency.exponentialRampToValueAtTime(cfg.hz * 1.5, t + 0.16)
        gain.gain.setValueAtTime(0.0001, t)
        gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.26)
        osc.connect(gain)
        gain.connect(ac.destination)
        osc.start(t)
        osc.stop(t + 0.3)
      }
    } catch {
      /* sin audio: no rompe nada */
    }
  }
  vibrarArmado(prioridad)
}

/** Vibración del celular (si el dispositivo la soporta). */
export function vibrarArmado(prioridad: PrioridadAviso = 'normal'): void {
  try {
    const n = (PITIDOS[prioridad] ?? PITIDOS.normal).n
    navigator.vibrate?.(Array.from({ length: n }, () => 220).flatMap((v, i) => (i ? [120, v] : [v])))
  } catch {
    /* sin vibración: no rompe nada */
  }
}

/**
 * Pide permiso para notificar. Va en una acción del usuario (tocar "Acepto",
 * abrir Mi repo, etc.): si no, los navegadores lo ignoran.
 */
export function pedirPermisoNotificaciones(): void {
  try {
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'default') void Notification.requestPermission()
  } catch {
    /* navegador sin notificaciones */
  }
}

/**
 * Notificación del sistema: aparece aunque la app esté en segundo plano.
 * Al tocarla vuelve a la pantalla de Mi repo.
 */
export function notificarArmado(titulo: string, cuerpo: string, ruta = '/mayorista/mi-repo'): void {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const n = new Notification(titulo, {
      body: cuerpo,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: ruta,
    })
    n.onclick = () => {
      window.focus()
      if (location.pathname !== ruta) location.assign(ruta)
      n.close()
    }
  } catch {
    /* sin notificaciones: se queda con el sonido */
  }
}
