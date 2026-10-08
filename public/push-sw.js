/* ------------------------------------------------------------------ */
/*  Avisos push del Hub (lo importa el service worker de la PWA:       */
/*  workbox.importScripts en vite.config.ts). Corre aunque la app esté */
/*  cerrada o el celular bloqueado: el sistema muestra la notificación */
/*  con su sonido y vibración.                                         */
/* ------------------------------------------------------------------ */

self.addEventListener('push', (event) => {
  let d = {}
  try {
    d = event.data ? event.data.json() : {}
  } catch (e) {
    d = { title: 'Hub Mito', body: event.data ? event.data.text() : '' }
  }
  const urgente = !!d.urgente
  event.waitUntil(
    self.registration.showNotification(d.title || 'Hub Mito', {
      body: d.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'armado-' + Date.now(),
      renotify: true,
      requireInteraction: true,
      silent: false,
      vibrate: urgente ? [400, 150, 400, 150, 400, 150, 400] : [300, 120, 300, 120, 300],
      data: { url: d.url || '/mayorista/mi-repo' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      for (const c of lista) {
        if ('focus' in c) {
          c.navigate(url).catch(() => {})
          return c.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
