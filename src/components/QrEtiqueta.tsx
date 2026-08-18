// Diseño e impresión de la etiqueta que acompaña al QR (optimizada para impresoras térmicas).

export interface QrLabelConfig {
  ancho_mm: number
  align: 'left' | 'center' | 'right'
  logo: string | null
  logo_alto_mm: number
  mostrar_nombre: boolean
  nombre_pt: number
  nombre_bold: boolean
  texto_encabezado: string
  encabezado_pt: number
  qr_mm: number
  cta: string
  cta_pt: number
  mostrar_url: boolean
  url_pt: number
}

export const QR_LABEL_DEFAULT: QrLabelConfig = {
  ancho_mm: 50,
  align: 'center',
  logo: null,
  logo_alto_mm: 12,
  mostrar_nombre: true,
  nombre_pt: 11,
  nombre_bold: true,
  texto_encabezado: '',
  encabezado_pt: 9,
  qr_mm: 40,
  cta: 'Escaneá y dejanos tu opinión',
  cta_pt: 8,
  mostrar_url: true,
  url_pt: 6,
}

export function qrImgUrl(url: string, sizePx = 600) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${sizePx}x${sizePx}&margin=0&ecc=M&data=${encodeURIComponent(url)}`
}

function escHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

/** Construye el HTML de la etiqueta para impresión (mm reales, monocromo). */
export function buildLabelHtml(c: QrLabelConfig, nombre: string, url: string) {
  const contentW = c.ancho_mm - 4 // margen 2mm cada lado
  const partes: string[] = []
  if (c.logo) partes.push(`<img class="logo" src="${escHtml(c.logo)}" alt=""/>`)
  if (c.texto_encabezado) partes.push(`<div class="enc">${escHtml(c.texto_encabezado)}</div>`)
  if (c.mostrar_nombre) partes.push(`<div class="nombre">${escHtml(nombre)}</div>`)
  partes.push(`<img class="qr" src="${qrImgUrl(url)}" alt="QR"/>`)
  if (c.cta) partes.push(`<div class="cta">${escHtml(c.cta)}</div>`)
  if (c.mostrar_url) partes.push(`<div class="url">${escHtml(url)}</div>`)

  return `<!doctype html><html><head><meta charset="utf-8"><title>QR ${escHtml(nombre)}</title>
<style>
  @page { size: ${c.ancho_mm}mm auto; margin: 2mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  .lbl { width: ${contentW}mm; margin: 0 auto; text-align: ${c.align}; font-family: Arial, Helvetica, sans-serif; padding: 1mm 0; }
  .logo { height: ${c.logo_alto_mm}mm; object-fit: contain; display: block; margin: 0 auto 1.5mm; }
  .enc { font-size: ${c.encabezado_pt}pt; margin-bottom: 1mm; }
  .nombre { font-size: ${c.nombre_pt}pt; font-weight: ${c.nombre_bold ? 700 : 400}; line-height: 1.15; margin-bottom: 1.5mm; }
  .qr { width: ${c.qr_mm}mm; height: ${c.qr_mm}mm; display: block; margin: 0 auto; image-rendering: pixelated; }
  .cta { font-size: ${c.cta_pt}pt; margin-top: 1.5mm; }
  .url { font-size: ${c.url_pt}pt; word-break: break-all; margin-top: 1mm; }
  @media screen { body { padding: 16px; } .lbl { border: 1px dashed #999; } }
</style></head>
<body><div class="lbl">${partes.join('')}</div>
<script>
  var img = document.querySelector('img.qr');
  function go(){ setTimeout(function(){ window.focus(); window.print(); }, 200); }
  if (img.complete) { go(); } else { img.onload = go; img.onerror = go; }
<\/script>
</body></html>`
}

/** Abre la ventana de impresión con la etiqueta ya maquetada. */
export function imprimirEtiquetaQR(c: QrLabelConfig, nombre: string, url: string) {
  const w = window.open('', '_blank', 'width=460,height=640')
  if (!w) return
  w.document.write(buildLabelHtml(c, nombre, url))
  w.document.close()
}

const MM = 3.78 // px por mm aprox (96dpi) para la vista previa en pantalla

/** Vista previa en pantalla de cómo saldrá impresa la etiqueta. */
export function QrLabelPreview({ config: c, nombre, url }: { config: QrLabelConfig; nombre: string; url: string }) {
  const alignItems = c.align === 'center' ? 'center' : c.align === 'right' ? 'flex-end' : 'flex-start'
  return (
    <div
      className="mx-auto bg-white text-black shadow-soft-lg"
      style={{
        width: c.ancho_mm * MM,
        padding: 2 * MM,
        fontFamily: 'Arial, Helvetica, sans-serif',
        textAlign: c.align,
        display: 'flex',
        flexDirection: 'column',
        alignItems,
      }}
    >
      {c.logo && <img src={c.logo} alt="" style={{ height: c.logo_alto_mm * MM, objectFit: 'contain', marginBottom: 1.5 * MM }} />}
      {c.texto_encabezado && (
        <div style={{ fontSize: c.encabezado_pt * 1.333, marginBottom: 1 * MM }}>{c.texto_encabezado}</div>
      )}
      {c.mostrar_nombre && (
        <div style={{ fontSize: c.nombre_pt * 1.333, fontWeight: c.nombre_bold ? 700 : 400, lineHeight: 1.15, marginBottom: 1.5 * MM }}>
          {nombre}
        </div>
      )}
      <img
        src={qrImgUrl(url, 300)}
        alt="QR"
        style={{ width: c.qr_mm * MM, height: c.qr_mm * MM, imageRendering: 'pixelated' }}
      />
      {c.cta && <div style={{ fontSize: c.cta_pt * 1.333, marginTop: 1.5 * MM }}>{c.cta}</div>}
      {c.mostrar_url && (
        <div style={{ fontSize: c.url_pt * 1.333, marginTop: 1 * MM, wordBreak: 'break-all' }}>{url}</div>
      )}
    </div>
  )
}
