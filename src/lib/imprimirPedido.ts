/* ------------------------------------------------------------------ */
/*  Impresión de un pedido (Pedidos de venta): hoja A4 tipo remito,    */
/*  mismo método que imprimirRepo.ts (ventana nueva + print()).        */
/* ------------------------------------------------------------------ */

export interface PedidoImprimir {
  titulo: string // "Pedido de venta"
  comprobante: string // "X 0001-00009896"
  fecha: string | null // AAAA-MM-DD
  persona: { etiqueta: string; codigo: string | null; nombre: string | null } // Cliente / Proveedor
  datos: { etiqueta: string; valor: string | null }[] // Vendedor, Usuario, Observación…
  total: number | null
  anulado: boolean
}

export interface ItemPedidoImprimir {
  articulo: string | null
  descripcion: string | null
  color: string | null
  talle: string | null
  cantidad: number | null
  precio: number | null
  neto: number | null
  iva: number | null
}

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const $ = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const n0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const plata = (v: number | null | undefined) => (v == null ? '—' : $.format(v))
const fechaCorta = (f: string | null) => (f ? f.split('-').reverse().join('/') : '—')

const CSS = `
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; margin: 0; font-size: 12px; }
  .cab { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
         border: 1.5px solid #000; border-radius: 6px; padding: 10px 12px; }
  .tit { font-size: 22px; font-weight: 800; letter-spacing: .5px; }
  .empresa { font-size: 11px; margin-top: 2px; }
  .letra { width: 46px; height: 46px; border: 2px solid #000; border-radius: 6px; display: flex;
           align-items: center; justify-content: center; font-size: 28px; font-weight: 800; }
  .der { display: flex; gap: 12px; align-items: flex-start; }
  .nro { text-align: right; }
  .et { font-size: 9.5px; text-transform: uppercase; letter-spacing: .4px; color: #444; }
  .val { font-size: 13px; font-weight: 700; }
  .mono { font-family: Consolas, 'Courier New', monospace; }
  .datos { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 6px 14px; border: 1.5px solid #000;
           border-top: none; border-radius: 0 0 6px 6px; padding: 8px 12px; margin-bottom: 10px; }
  .datos .ancho { grid-column: 1 / -1; }
  .anulado { display: inline-block; margin-top: 6px; border: 2px solid #000; padding: 2px 8px; font-weight: 800; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; border-bottom: 1.5px solid #000; padding: 4px 5px; font-size: 10px; text-transform: uppercase; }
  td { border-bottom: 1px solid #bbb; padding: 3.5px 5px; vertical-align: top; }
  tr { page-break-inside: avoid; }
  thead { display: table-header-group; }
  .cod { font-weight: 700; white-space: nowrap; }
  .num { text-align: right; white-space: nowrap; }
  .neg { font-weight: 700; }
  tr.fin td { border-bottom: none; border-top: 1.5px solid #000; font-weight: 700; padding-top: 5px; }
  .totales { margin-left: auto; margin-top: 10px; width: 260px; border: 1.5px solid #000; border-radius: 6px; padding: 8px 10px; page-break-inside: avoid; }
  .totales div { display: flex; justify-content: space-between; padding: 2px 0; }
  .totales .grande { border-top: 1.5px solid #000; margin-top: 4px; padding-top: 5px; font-size: 16px; font-weight: 800; }
  .pie { margin-top: 14px; font-size: 9.5px; color: #555; display: flex; justify-content: space-between; }
`

/** HTML completo de la hoja (separado para poder previsualizarlo sin abrir la ventana). */
export function htmlPedido(p: PedidoImprimir, items: ItemPedidoImprimir[]): string {
  const tot = items.reduce(
    (a, i) => ({ cant: a.cant + (i.cantidad ?? 0), neto: a.neto + (i.neto ?? 0), iva: a.iva + (i.iva ?? 0) }),
    { cant: 0, neto: 0, iva: 0 },
  )
  const ajuste = p.total != null ? tot.neto + tot.iva - p.total : 0
  const filas = items
    .map(
      (i) => `<tr>
        <td class="cod">${esc(i.articulo)}</td>
        <td>${esc(i.descripcion)}</td>
        <td>${esc(i.color)}</td>
        <td>${esc(i.talle)}</td>
        <td class="num">${n0.format(i.cantidad ?? 0)}</td>
        <td class="num">${plata(i.precio)}</td>
        <td class="num neg">${plata(i.neto)}</td>
      </tr>`,
    )
    .join('')
  const datos = p.datos
    .map((d) => `<div class="${d.etiqueta === 'Observación' ? 'ancho' : ''}"><div class="et">${esc(d.etiqueta)}</div><div class="val">${esc(d.valor || '—')}</div></div>`)
    .join('')
  const impreso = new Date().toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(p.titulo)} ${esc(p.comprobante)}</title><style>${CSS}</style></head>
  <body>
    <div class="cab">
      <div>
        <div class="tit">${esc(p.titulo.toUpperCase())}</div>
        <div class="empresa">MITO</div>
        ${p.anulado ? '<div class="anulado">ANULADO</div>' : ''}
      </div>
      <div class="der">
        <div class="letra">${esc(p.comprobante.charAt(0))}</div>
        <div class="nro">
          <div class="et">Número</div><div class="val mono">${esc(p.comprobante)}</div>
          <div class="et" style="margin-top:6px">Fecha</div><div class="val">${esc(fechaCorta(p.fecha))}</div>
        </div>
      </div>
    </div>
    <div class="datos">
      <div><div class="et">${esc(p.persona.etiqueta)}</div><div class="val">${esc(p.persona.codigo ?? '')} ${esc(p.persona.nombre ?? '')}</div></div>
      ${datos}
    </div>
    <table>
      <thead><tr><th>Artículo</th><th>Descripción</th><th>Color</th><th>Talle</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Monto</th></tr></thead>
      <tbody>${filas}
        <tr class="fin"><td colspan="4">Ítems: ${items.length}</td><td class="num">${n0.format(tot.cant)}</td><td></td><td class="num">${plata(tot.neto)}</td></tr>
      </tbody>
    </table>
    <div class="totales">
      <div><span>Subtotal neto</span><span>$ ${plata(tot.neto)}</span></div>
      <div><span>I.V.A.</span><span>$ ${plata(tot.iva)}</span></div>
      ${ajuste > 1 ? `<div><span>Descuento / ajustes</span><span>− $ ${plata(ajuste)}</span></div>` : ''}
      <div class="grande"><span>Total</span><span>$ ${plata(p.total ?? tot.neto + tot.iva)}</span></div>
    </div>
    <div class="pie"><span>Hub MITO · copia de Dragonfish</span><span>Impreso ${esc(impreso)}</span></div>
  </body></html>`
}

/** Abre la ventana de impresión (dentro del click, si no el navegador la bloquea). */
export function imprimirPedido(p: PedidoImprimir, items: ItemPedidoImprimir[]): void {
  const w = window.open('', '_blank')
  if (!w) {
    alert('El navegador bloqueó la ventana de impresión. Permití las ventanas emergentes para este sitio.')
    return
  }
  w.document.open()
  w.document.write(htmlPedido(p, items))
  w.document.close()
  w.focus()
  // Espera a que el navegador dibuje antes de abrir el diálogo de impresión
  w.setTimeout(() => w.print(), 300)
}
