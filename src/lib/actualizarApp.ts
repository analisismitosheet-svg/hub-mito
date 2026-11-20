import { Workbox } from 'workbox-window'

/**
 * Actualización automática de la PWA.
 *
 * - Busca versión nueva cada 5 min y cada vez que se vuelve a la app (desbloquear el
 *   celular, volver de otra app).
 * - Cuando hay una, la aplica sola en un momento seguro: al cambiar de pantalla, o al
 *   volver a la app estando en el menú. Nunca en medio de una pantalla (formularios a
 *   medio cargar, armado de pedidos): ahí espera a que el usuario se mueva.
 * - Pantallas con trabajo largo en memoria (Reparto manual) llaman a `bloquearActualizacion()`:
 *   mientras estén abiertas no se actualiza ni esa pestaña ni ninguna otra del mismo navegador
 *   (si otra pestaña pasaba a la versión nueva, el service worker recargaba todas y se perdía lo hecho).
 * - Después de recargar muestra «✓ App actualizada» un par de segundos.
 *
 * Se usa workbox-window directo (no `virtual:pwa-register`) porque aquel recarga la página
 * sí o sí cuando cambia el service worker, sin dejar frenarlo.
 */
const CADA_MS = 5 * 60 * 1000
const MARCA = 'hub-app-actualizada'
/** Aviso entre pestañas: «hay una pantalla que no se puede recargar» (se renueva mientras está abierta). */
const BLOQUEO = 'hub-no-actualizar'
const BLOQUEO_VENCE_MS = 60_000

/** Pantallas sin nada a medio cargar: se puede recargar apenas se vuelve a la app. */
const CARGA = Date.now()
/** Link público de propuesta (/p/:token): se actualiza solo recién abierto, antes de que el cliente elija nada. */
const esLinkRecienAbierto = (path: string) => path.startsWith('/p/') && Date.now() - CARGA < 20_000
const esPantallaSegura = (path: string) => path === '/' || path.startsWith('/area/') || path === '/login' || esLinkRecienAbierto(path)

let bloqueosAca = 0
let alDesbloquear: (() => void) | null = null

function bloqueadaEnOtraPestana() {
  try {
    const t = Number(localStorage.getItem(BLOQUEO) || 0)
    return Date.now() - t < BLOQUEO_VENCE_MS
  } catch {
    return false
  }
}
const hayTrabajoAbierto = () => bloqueosAca > 0 || bloqueadaEnOtraPestana()

/**
 * Frena la actualización automática mientras la pantalla está abierta. Devuelve la función que
 * la libera (para el return de un useEffect).
 */
export function bloquearActualizacion(): () => void {
  bloqueosAca++
  const marcar = () => { try { localStorage.setItem(BLOQUEO, String(Date.now())) } catch { /* sin storage: solo vale para esta pestaña */ } }
  marcar()
  const t = setInterval(marcar, BLOQUEO_VENCE_MS / 3)
  let liberado = false
  return () => {
    if (liberado) return
    liberado = true
    clearInterval(t)
    bloqueosAca = Math.max(0, bloqueosAca - 1)
    if (!bloqueosAca) {
      try { localStorage.removeItem(BLOQUEO) } catch { /* nada */ }
      alDesbloquear?.()
    }
  }
}

export function iniciarActualizacionAutomatica() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return
  let pendiente = false
  let aplicando = false
  /** El service worker nuevo ya tomó esta pestaña mientras estaba bloqueada: falta recargar. */
  let recargaPendiente = false

  const wb = new Workbox('/sw.js', { scope: '/' })

  const recargar = () => {
    try { sessionStorage.setItem(MARCA, '1') } catch { /* sin storage: solo no se muestra el aviso */ }
    window.location.reload()
  }

  const hayVersionNueva = () => {
    pendiente = true
    if (esPantallaSegura(location.pathname) && document.visibilityState === 'visible') aplicar()
  }
  wb.addEventListener('waiting', hayVersionNueva) // también cuando la instaló otra pestaña (isExternal)
  // El service worker nuevo tomó el control (esta pestaña u otra lo activó)
  wb.addEventListener('controlling', (e) => {
    if (!e.isUpdate && !e.isExternal) return
    if (bloqueosAca > 0) recargaPendiente = true // se recarga recién al salir de la pantalla
    else recargar()
  })

  function aplicar() {
    if (hayTrabajoAbierto()) return // queda pendiente para el próximo momento seguro
    if (recargaPendiente) { recargaPendiente = false; recargar(); return }
    if (!pendiente || aplicando) return
    aplicando = true
    try { sessionStorage.setItem(MARCA, '1') } catch { /* nada */ }
    wb.messageSkipWaiting() // al tomar el control dispara 'controlling' y recarga
  }
  alDesbloquear = () => { if (esPantallaSegura(location.pathname)) aplicar() }

  void wb.register({ immediate: true }).then((reg) => {
    if (!reg) return
    setInterval(() => { void reg.update() }, CADA_MS)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return
      void reg.update()
      if ((pendiente || recargaPendiente) && esPantallaSegura(location.pathname)) aplicar()
    })
  }).catch((e) => console.warn('[app] service worker:', e))

  // Cambio de pantalla = momento seguro (lo que había en la anterior ya se guardó o se dejó)
  let ruta = location.pathname
  setInterval(() => {
    if (location.pathname === ruta) return
    ruta = location.pathname
    aplicar()
  }, 1500)

  avisoSiSeActualizo()
}

function avisoSiSeActualizo() {
  try {
    if (sessionStorage.getItem(MARCA) !== '1') return
    sessionStorage.removeItem(MARCA)
  } catch {
    return
  }
  const el = document.createElement('div')
  el.textContent = '✓ App actualizada'
  el.setAttribute('role', 'status')
  Object.assign(el.style, {
    position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', zIndex: '9999',
    background: '#16a34a', color: '#fff', padding: '8px 16px', borderRadius: '999px',
    font: '600 14px system-ui, sans-serif', boxShadow: '0 6px 20px rgba(0,0,0,.25)', transition: 'opacity .4s',
  })
  document.body.appendChild(el)
  setTimeout(() => { el.style.opacity = '0' }, 2200)
  setTimeout(() => el.remove(), 2700)
}
