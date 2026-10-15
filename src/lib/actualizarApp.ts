import { registerSW } from 'virtual:pwa-register'

/**
 * Actualización automática de la PWA.
 *
 * - Busca versión nueva cada 5 min y cada vez que se vuelve a la app (desbloquear el
 *   celular, volver de otra app).
 * - Cuando hay una, la aplica sola en un momento seguro: al cambiar de pantalla, o al
 *   volver a la app estando en el menú. Nunca en medio de una pantalla (formularios a
 *   medio cargar, armado de pedidos): ahí espera a que el usuario se mueva.
 * - Después de recargar muestra «✓ App actualizada» un par de segundos.
 */
const CADA_MS = 5 * 60 * 1000
const MARCA = 'hub-app-actualizada'

/** Pantallas sin nada a medio cargar: se puede recargar apenas se vuelve a la app. */
const esPantallaSegura = (path: string) => path === '/' || path.startsWith('/area/') || path === '/login'

export function iniciarActualizacionAutomatica() {
  if (!('serviceWorker' in navigator)) return
  let pendiente = false
  let aplicando = false

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      pendiente = true
      if (esPantallaSegura(location.pathname) && document.visibilityState === 'visible') aplicar()
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return
      setInterval(() => { void reg.update() }, CADA_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return
        void reg.update()
        if (pendiente && esPantallaSegura(location.pathname)) aplicar()
      })
    },
  })

  function aplicar() {
    if (!pendiente || aplicando) return
    aplicando = true
    try { sessionStorage.setItem(MARCA, '1') } catch { /* sin storage: solo no se muestra el aviso */ }
    void updateSW(true)
  }

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
