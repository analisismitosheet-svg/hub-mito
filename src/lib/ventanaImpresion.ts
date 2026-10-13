/**
 * Ventanas de impresión (window.open + document.write). Antes cada HTML traía su propio
 * <script> inline para imprimir o para los controles de la hoja; con la CSP del hub
 * (vercel.json, script-src 'self') esas ventanas heredan la política y un script inline no
 * corre. Por eso la lógica vive acá y se ejecuta desde la ventana principal sobre el
 * documento de la emergente (es del mismo origen).
 */

/** Imprime cuando cargaron las imágenes que coinciden con `selector` (o al toque si no hay). */
export function imprimirCuandoCarguen(w: Window, selector = 'img', esperaMs = 250): void {
  const imgs = Array.from(w.document.querySelectorAll<HTMLImageElement>(selector))
  let pendientes = imgs.length
  let listo = false
  const imprimir = () => {
    if (listo) return
    listo = true
    setTimeout(() => { w.focus(); w.print() }, esperaMs)
  }
  if (!pendientes) return imprimir()
  const una = () => { if (--pendientes <= 0) imprimir() }
  for (const img of imgs) {
    if (img.complete) una()
    else { img.addEventListener('load', una); img.addEventListener('error', una) }
  }
}

/**
 * Vista previa del pedido (imprimirPedido.ts): tamaño de letra A− / A+ (queda guardado en
 * este navegador) y "Ajustar a 1 hoja" (achica la letra hasta que entre en el alto útil de un
 * A4, sin bajar de 7 px; si ni así entra, deja la letra normal y sale en varias hojas).
 * Si nunca se eligió un tamaño, arranca ajustado a 1 hoja.
 */
export function controlesHojaPedido(w: Window): void {
  const MIN = 7, MAX = 16, NORMAL = 11, CLAVE = 'pedido.imprimir.fs'
  const d = w.document
  const hoja = d.getElementById('hoja')
  if (!hoja) return
  const medida = d.createElement('div')
  medida.style.cssText = 'position:absolute;visibility:hidden;height:277mm;width:1px'
  d.body.appendChild(medida)
  const altoA4 = medida.getBoundingClientRect().height // alto útil (A4 con márgenes de 10 mm)
  medida.remove()
  let cortes: HTMLElement[] = []
  const hojas = () => Math.max(1, Math.ceil((hoja.offsetHeight - 2) / altoA4))
  const poner = (fs: number, guardar: boolean) => {
    fs = Math.max(MIN, Math.min(MAX, Math.round(fs * 4) / 4))
    hoja.style.setProperty('--fs', fs + 'px')
    const etiqueta = d.getElementById('fs')
    if (etiqueta) etiqueta.textContent = 'Letra ' + String(fs).replace('.', ',') + ' px'
    const n = hojas()
    const el = d.getElementById('hojas')
    if (el) {
      el.textContent = n === 1 ? 'entra en 1 hoja' : 'ocupa ' + n + ' hojas'
      el.className = n === 1 ? 'ok' : 'mal'
    }
    cortes.forEach((c) => c.remove())
    cortes = []
    hoja.style.position = 'relative'
    for (let i = 1; i < n; i++) {
      const c = d.createElement('div')
      c.className = 'corte'
      c.style.top = i * altoA4 + 'px'
      const s = d.createElement('span')
      s.textContent = 'corte de hoja ' + i
      c.appendChild(s)
      hoja.appendChild(c)
      cortes.push(c)
    }
    if (guardar) { try { localStorage.setItem(CLAVE, String(fs)) } catch { /* sin almacenamiento */ } }
    return fs
  }
  const ajustar = (guardar: boolean) => {
    // Solo achica: arranca en la letra normal (agrandar se hace a mano con A+)
    let fs = poner(NORMAL, false)
    while (fs > MIN && hojas() > 1) fs = poner(fs - 0.25, false)
    // Si ni con la letra mínima entra en 1 hoja, achicar no sirve: tamaño normal y varias hojas
    if (hojas() > 1) fs = NORMAL
    return poner(fs, guardar)
  }
  let guardado = NaN
  try { guardado = parseFloat(localStorage.getItem(CLAVE) ?? '') } catch { /* sin almacenamiento */ }
  let actual = guardado ? poner(guardado, false) : ajustar(false)
  d.querySelectorAll<HTMLElement>('[data-d]').forEach((b) => {
    b.addEventListener('click', () => { actual = poner(actual + parseFloat(b.getAttribute('data-d') ?? '0'), true) })
  })
  d.getElementById('ajustar')?.addEventListener('click', () => { actual = ajustar(true) })
  d.getElementById('imprimir')?.addEventListener('click', () => w.print())
}
