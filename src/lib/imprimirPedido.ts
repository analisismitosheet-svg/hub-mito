import { supabase } from '@/lib/supabase'
import { compararUbicaciones, ubicacionesDeArticulos } from '@/lib/mapeo'

/* ------------------------------------------------------------------ */
/*  Impresión de un pedido (Pedidos de venta): hoja A4 que combina el  */
/*  formato de los repos de Mayorista (ubicación del Mapeo, material,  */
/*  orden del recorrido del depósito, casilla ✓) con el del pedido     */
/*  (número, fecha, cliente). Sin precios: es la hoja para armarlo.    */
/*  Mismo método que imprimirRepo.ts (ventana nueva + print()).        */
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

/** Datos del depósito por código de artículo (en mayúsculas). */
export interface ExtrasImprimir {
  ubicaciones: Map<string, string[]>
  materiales: Map<string, string>
}

// Código de material de Dragonfish -> nombre (mismos que trae el Excel de repos: "5 REMERAS")
const MATERIALES: Record<string, string> = {
  '0': 'ACCESORIOS', '1': 'CALZADO', '2': 'PANTALONES', '3': 'BERMUDAS', '4': 'BOARDSHORTS-BIKINIS',
  '5': 'REMERAS', '6': 'BUZOS', '7': 'CAMISAS', '9': 'CAMPERAS',
}

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const n0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const fechaCorta = (f: string | null) => (f ? f.split('-').reverse().join('/') : '—')
const clave = (codigo: string | null) => String(codigo ?? '').trim().toUpperCase()

// Todo el tamaño va en em: la letra base (--fs) la elige el usuario en la vista previa o se ajusta sola a 1 hoja
const CSS = `
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; }
  .hoja { font-size: var(--fs, 11px); }
  .cab { display: flex; justify-content: space-between; align-items: flex-start; gap: 1.2em;
         border-bottom: 2px solid #000; padding-bottom: .5em; }
  .nombre { font-size: 2.1em; font-weight: 800; line-height: 1.1; }
  .sub { font-size: 1.15em; margin-top: .15em; }
  .anulado { display: inline-block; margin-top: .3em; border: 2px solid #000; padding: .1em .7em; font-weight: 800; }
  .der { display: flex; gap: .9em; align-items: flex-start; }
  .letra { width: 3.6em; height: 3.6em; border: 2px solid #000; border-radius: .5em; display: flex;
           align-items: center; justify-content: center; font-size: 1em; }
  .letra b { font-size: 2.3em; font-weight: 800; }
  .nro { text-align: right; }
  .et { font-size: .82em; text-transform: uppercase; letter-spacing: .04em; color: #444; }
  .val { font-size: 1.08em; font-weight: 700; }
  .mono { font-family: Consolas, 'Courier New', monospace; }
  .meta { font-size: .95em; margin-top: .3em; }
  .datos { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: .3em 1.2em; padding: .5em 0 .6em; border-bottom: 1px solid #000; margin-bottom: .5em; }
  .datos .ancho { grid-column: 1 / -1; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th { text-align: left; border-bottom: 1.5px solid #000; padding: .3em .35em; font-size: .86em; text-transform: uppercase; }
  td { border-bottom: 1px solid #bbb; padding: .22em .35em; vertical-align: top; white-space: nowrap; line-height: 1.2; }
  tr { page-break-inside: avoid; }
  .ubic { font-weight: 800; white-space: nowrap; }
  .sin { color: #888; font-weight: 400; }
  .mat { white-space: nowrap; font-size: .9em; }
  .cod { font-weight: 700; white-space: nowrap; }
  /* Descripción: siempre en una línea; usa el ancho que sobra y si no entra se corta con … */
  .desc { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 0; width: 100%; }
  .num { text-align: right; white-space: nowrap; }
  .neg { font-weight: 700; }
  .chk { width: 1.8em; }
  .chk span { display: inline-block; width: 1.05em; height: 1.05em; border: 1.5px solid #000; vertical-align: middle; }
  tr.fin td { border-bottom: none; border-top: 1.5px solid #000; font-weight: 700; padding-top: .45em; }
  .pie { margin-top: 1em; font-size: .82em; color: #555; display: flex; justify-content: space-between; }

  /* Vista previa en pantalla: la hoja con el ancho útil de un A4 y la barra de controles (no se imprime) */
  @media screen {
    body { background: #e5e5e5; padding: 64px 16px 24px; }
    .hoja { width: 190mm; margin: 0 auto; background: #fff; padding: 0; box-shadow: 0 2px 12px rgba(0,0,0,.25);
            outline: 10mm solid #fff; }
    .barra { position: fixed; top: 0; left: 0; right: 0; z-index: 10; display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
             justify-content: center; padding: 10px 12px; background: #1f1f1f; color: #fff; font: 14px Arial, sans-serif; }
    .barra button { font: 600 14px Arial, sans-serif; border: 1px solid #555; background: #333; color: #fff; border-radius: 8px;
                    padding: 7px 12px; cursor: pointer; }
    .barra button.prim { background: #d97706; border-color: #d97706; }
    .barra .info { min-width: 9em; text-align: center; }
    .barra .ok { color: #4ade80; } .barra .mal { color: #fbbf24; }
    .corte { position: absolute; left: 0; right: 0; border-top: 2px dashed #dc2626; pointer-events: none; }
    .corte span { position: absolute; right: 4px; top: -18px; color: #dc2626; font: 11px Arial, sans-serif; }
  }
  @media print { .barra, .corte { display: none !important; } }
`

/**
 * Script de la vista previa: tamaño de letra (A− / A+, queda guardado en este navegador) y
 * "Ajustar a 1 hoja" (achica la letra hasta que entre en el alto útil de un A4, sin bajar de 7 px;
 * si ni así entra, deja la letra normal y sale en varias hojas).
 * Si nunca se eligió un tamaño, arranca ajustado a 1 hoja.
 */
const SCRIPT_HOJA = `
(function () {
  var MIN = 7, MAX = 16, NORMAL = 11, CLAVE = 'pedido.imprimir.fs';
  var hoja = document.getElementById('hoja');
  var medida = document.createElement('div');
  medida.style.cssText = 'position:absolute;visibility:hidden;height:277mm;width:1px';
  document.body.appendChild(medida);
  var altoA4 = medida.getBoundingClientRect().height; // alto útil (A4 con márgenes de 10 mm)
  medida.remove();
  var cortes = [];
  function hojas() { return Math.max(1, Math.ceil((hoja.offsetHeight - 2) / altoA4)); }
  function poner(fs, guardar) {
    fs = Math.max(MIN, Math.min(MAX, Math.round(fs * 4) / 4));
    hoja.style.setProperty('--fs', fs + 'px');
    document.getElementById('fs').textContent = 'Letra ' + String(fs).replace('.', ',') + ' px';
    var n = hojas(), el = document.getElementById('hojas');
    el.textContent = n === 1 ? 'entra en 1 hoja' : 'ocupa ' + n + ' hojas';
    el.className = n === 1 ? 'ok' : 'mal';
    cortes.forEach(function (c) { c.remove(); });
    cortes = [];
    hoja.style.position = 'relative';
    for (var i = 1; i < n; i++) {
      var c = document.createElement('div');
      c.className = 'corte';
      c.style.top = (i * altoA4) + 'px';
      c.innerHTML = '<span>corte de hoja ' + i + '</span>';
      hoja.appendChild(c);
      cortes.push(c);
    }
    if (guardar) { try { localStorage.setItem(CLAVE, String(fs)); } catch (e) {} }
    return fs;
  }
  function ajustar(guardar) {
    // Solo achica: arranca en la letra normal (agrandar se hace a mano con A+)
    var fs = NORMAL;
    poner(fs, false);
    while (fs > MIN && hojas() > 1) fs = poner(fs - 0.25, false);
    // Si ni con la letra mínima entra en 1 hoja, achicar no sirve: tamaño normal y varias hojas
    if (hojas() > 1) fs = NORMAL;
    return poner(fs, guardar);
  }
  var actual, guardado = null;
  try { guardado = parseFloat(localStorage.getItem(CLAVE)); } catch (e) {}
  actual = guardado ? poner(guardado, false) : ajustar(false);
  document.querySelectorAll('[data-d]').forEach(function (b) {
    b.addEventListener('click', function () { actual = poner(actual + parseFloat(b.getAttribute('data-d')), true); });
  });
  document.getElementById('ajustar').addEventListener('click', function () { actual = ajustar(true); });
  document.getElementById('imprimir').addEventListener('click', function () { window.print(); });
})();
`

/** HTML completo de la hoja (separado para poder previsualizarlo sin abrir la ventana). */
export function htmlPedido(
  p: PedidoImprimir,
  items: ItemPedidoImprimir[],
  extras: ExtrasImprimir = { ubicaciones: new Map(), materiales: new Map() },
): string {
  const ubicDe = (i: ItemPedidoImprimir) => extras.ubicaciones.get(clave(i.articulo)) ?? []
  // Orden del recorrido del depósito (como los repos); los que no están mapeados, al final en el orden del pedido
  const ordenados = items
    .map((i, n) => ({ i, n }))
    .sort((a, b) => {
      const ua = ubicDe(a.i)[0]
      const ub = ubicDe(b.i)[0]
      const porUbic = ua && ub ? compararUbicaciones(ua, ub) : ua ? -1 : ub ? 1 : 0
      return porUbic || a.n - b.n
    })
    .map((x) => x.i)

  const tot = { cant: items.reduce((a, i) => a + (i.cantidad ?? 0), 0) }
  const filas = ordenados
    .map((i) => {
      const u = ubicDe(i)
      return `<tr>
        <td class="ubic">${u.length ? esc(u.join(' · ')) : '<span class="sin">—</span>'}</td>
        <td class="mat">${esc(extras.materiales.get(clave(i.articulo)) ?? '')}</td>
        <td class="cod">${esc(i.articulo)}</td>
        <td class="desc">${esc(i.descripcion)}</td>
        <td>${esc(i.color)}</td>
        <td>${esc(i.talle)}</td>
        <td class="num neg">${n0.format(i.cantidad ?? 0)}</td>
        <td class="chk"><span></span></td>
      </tr>`
    })
    .join('')
  const datos = p.datos
    .map((d) => `<div class="${d.etiqueta === 'Observación' ? 'ancho' : ''}"><div class="et">${esc(d.etiqueta)}</div><div class="val">${esc(d.valor || '—')}</div></div>`)
    .join('')
  const impreso = new Date().toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(p.titulo)} ${esc(p.comprobante)}</title><style>${CSS}</style></head>
  <body>
    <div class="barra">
      <button type="button" data-d="-0.5" title="Letra más chica">A−</button>
      <span class="info"><span id="fs"></span> · <span id="hojas"></span></span>
      <button type="button" data-d="0.5" title="Letra más grande">A+</button>
      <button type="button" id="ajustar">Ajustar a 1 hoja</button>
      <button type="button" id="imprimir" class="prim">Imprimir</button>
    </div>
    <div class="hoja" id="hoja">
    <div class="cab">
      <div>
        <div class="nombre">${esc(p.persona.nombre || p.persona.codigo || '')}</div>
        <div class="sub">${esc(p.titulo)} ${esc(p.comprobante)}</div>
        ${p.anulado ? '<div class="anulado">ANULADO</div>' : ''}
      </div>
      <div class="der">
        <div class="letra"><b>${esc(p.comprobante.charAt(0))}</b></div>
        <div class="nro">
          <div class="et">Número</div><div class="val mono">${esc(p.comprobante)}</div>
          <div class="et" style="margin-top:4px">Fecha</div><div class="val">${esc(fechaCorta(p.fecha))}</div>
          <div class="meta">${items.length} artículos · ${n0.format(tot.cant)} unidades</div>
        </div>
      </div>
    </div>
    <div class="datos">
      <div><div class="et">${esc(p.persona.etiqueta)}</div><div class="val">${esc(p.persona.codigo ?? '')} ${esc(p.persona.nombre ?? '')}</div></div>
      ${datos}
    </div>
    <table>
      <thead><tr><th>Ubicación</th><th>Material</th><th>Código</th><th>Artículo</th><th>Color</th><th>Talle</th><th class="num">Cant.</th><th class="chk">✓</th></tr></thead>
      <tbody>${filas}
        <tr class="fin"><td colspan="6">Total · ${items.length} artículos</td><td class="num">${n0.format(tot.cant)}</td><td></td></tr>
      </tbody>
    </table>
    <div class="pie"><span>Hub MITO · copia de Dragonfish</span><span>Impreso ${esc(impreso)}</span></div>
    </div>
    <script>${SCRIPT_HOJA}</script>
  </body></html>`
}

/** Material de cada artículo, desde el maestro (articulos.id_material). */
async function materialesDeArticulos(codigos: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unicos = [...new Set(codigos.map(clave).filter(Boolean))]
  if (!supabase || unicos.length === 0) return out
  const TANDA = 200 // el filtro .in() va en la URL: de a tandas
  for (let i = 0; i < unicos.length; i += TANDA) {
    const { data, error } = await supabase.from('articulos').select('id_art,id_material').in('id_art', unicos.slice(i, i + TANDA))
    if (error) throw new Error(error.message)
    for (const r of (data as { id_art: string; id_material: string | null }[] | null) ?? []) {
      const cod = String(r.id_material ?? '').trim()
      if (cod) out.set(r.id_art, MATERIALES[cod] ?? cod)
    }
  }
  return out
}

/**
 * Abre la vista previa de impresión. Se abre al toque (dentro del click, si no el navegador la bloquea)
 * y se completa cuando llegan las ubicaciones del Mapeo y los materiales.
 */
export async function imprimirPedido(p: PedidoImprimir, items: ItemPedidoImprimir[]): Promise<void> {
  const w = window.open('', '_blank')
  if (!w) {
    alert('El navegador bloqueó la ventana de impresión. Permití las ventanas emergentes para este sitio.')
    return
  }
  w.document.write('<p style="font-family:Arial;padding:16px">Preparando impresión…</p>')

  const codigos = items.map((i) => i.articulo ?? '')
  const [ubicaciones, materiales] = await Promise.all([
    ubicacionesDeArticulos(codigos).catch(() => new Map<string, string[]>()), // sin mapeo: sin ubicaciones
    materialesDeArticulos(codigos).catch(() => new Map<string, string>()),
  ])

  w.document.open()
  w.document.write(htmlPedido(p, items, { ubicaciones, materiales }))
  w.document.close()
  // Queda la vista previa: se ajusta la letra y se imprime con el botón de la barra
  w.focus()
}
