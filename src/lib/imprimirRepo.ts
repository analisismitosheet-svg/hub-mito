import { compararUbicaciones, ubicacionesDeArticulos } from '@/lib/mapeo'

/* ------------------------------------------------------------------ */
/*  Impresión de repos: una hoja por local, con la ubicación del       */
/*  Mapeo depósito y los artículos en el orden del recorrido.          */
/* ------------------------------------------------------------------ */

export interface ItemImprimir {
  local: string
  orden: number
  codigo: string | null
  articulo: string | null
  color: string | null
  talle: string | null
  cantidad: number
}

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const CSS = `
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; margin: 0; }
  .hoja { page-break-after: always; break-after: page; }
  .hoja:last-child { page-break-after: auto; break-after: auto; }
  .cab { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #000; padding-bottom: 4px; margin-bottom: 8px; }
  .local { font-size: 26px; font-weight: 800; }
  .lote { font-size: 13px; }
  .meta { font-size: 11px; text-align: right; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; border-bottom: 1.5px solid #000; padding: 4px 5px; font-size: 11px; text-transform: uppercase; }
  td { border-bottom: 1px solid #bbb; padding: 4px 5px; vertical-align: top; }
  tr { page-break-inside: avoid; }
  .ubic { font-weight: 800; white-space: nowrap; }
  .sin { color: #888; font-weight: 400; }
  .cod { font-weight: 700; white-space: nowrap; }
  .num { text-align: right; font-weight: 700; white-space: nowrap; }
  .chk { width: 22px; }
  .chk span { display: inline-block; width: 13px; height: 13px; border: 1.5px solid #000; }
  .tot td { border-bottom: none; font-weight: 700; padding-top: 6px; }
`

/**
 * Abre la ventana de impresión con una hoja por local.
 * La ventana se abre al toque (dentro del click, si no el navegador la bloquea)
 * y se completa cuando llegan las ubicaciones.
 */
export async function imprimirRepos(
  titulo: string,
  locales: [string, ItemImprimir[]][],
): Promise<void> {
  const w = window.open('', '_blank')
  if (!w) {
    alert('El navegador bloqueó la ventana de impresión. Permití las ventanas emergentes para este sitio.')
    return
  }
  w.document.write('<p style="font-family:Arial;padding:16px">Preparando impresión…</p>')

  let ubic = new Map<string, string[]>()
  try {
    ubic = await ubicacionesDeArticulos(locales.flatMap(([, its]) => its.map((i) => i.codigo ?? '')))
  } catch { /* sin mapeo: se imprime sin ubicaciones */ }
  const ubicDe = (i: ItemImprimir) => ubic.get(String(i.codigo ?? '').trim().toUpperCase()) ?? []

  const fecha = new Date().toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })

  const hojas = locales.map(([local, its]) => {
    // Orden del recorrido del depósito; los que no están mapeados, al final
    const ordenados = [...its].sort((a, b) => {
      const ua = ubicDe(a)[0]
      const ub = ubicDe(b)[0]
      const porUbic = ua && ub ? compararUbicaciones(ua, ub) : ua ? -1 : ub ? 1 : 0
      return porUbic || a.orden - b.orden || String(a.codigo ?? '').localeCompare(String(b.codigo ?? ''))
    })
    const unidades = its.reduce((s, i) => s + (i.cantidad || 0), 0)
    const filas = ordenados
      .map((i) => {
        const u = ubicDe(i)
        return `<tr>
          <td class="ubic">${u.length ? esc(u.join(' · ')) : '<span class="sin">—</span>'}</td>
          <td class="cod">${esc(i.codigo)}</td>
          <td>${esc(String(i.articulo ?? '').replace(/^\(\)\s*/, ''))}</td>
          <td>${esc(i.color)}</td>
          <td>${esc(i.talle)}</td>
          <td class="num">${esc(i.cantidad)}</td>
          <td class="chk"><span></span></td>
        </tr>`
      })
      .join('')
    return `<section class="hoja">
      <div class="cab">
        <div><div class="local">${esc(local)}</div><div class="lote">${esc(titulo)}</div></div>
        <div class="meta">${its.length} artículos · ${unidades} unidades<br>Impreso ${esc(fecha)}</div>
      </div>
      <table>
        <thead><tr><th>Ubicación</th><th>Código</th><th>Artículo</th><th>Color</th><th>Talle</th><th class="num">Cant.</th><th class="chk">✓</th></tr></thead>
        <tbody>${filas}</tbody>
        <tfoot><tr class="tot"><td colspan="5">Total</td><td class="num">${unidades}</td><td></td></tr></tfoot>
      </table>
    </section>`
  })

  w.document.open()
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${CSS}</style></head>
    <body>${hojas.join('')}</body></html>`)
  w.document.close()
  w.focus()
  // Espera a que el navegador dibuje antes de abrir el diálogo de impresión
  w.setTimeout(() => w.print(), 300)
}
