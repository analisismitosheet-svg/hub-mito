// Diseño e impresión de la etiqueta que acompaña al QR (optimizada para impresoras térmicas).

export interface QrLabelConfig {
  paper: string // clave de PAPELES ('50x30', 'roll58', 'a4', 'custom', ...)
  ancho_mm: number
  alto_mm: number // 0 = alto automático (rollos)
  align: 'left' | 'center' | 'right'
  bg_color: string
  text_color: string
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

/** Tamaños de papel / etiqueta disponibles. h = 0 => alto automático (rollo). */
export const PAPELES: { key: string; label: string; w: number; h: number }[] = [
  { key: '50x30', label: 'Etiqueta 50 × 30 mm', w: 50, h: 30 },
  { key: '40x30', label: 'Etiqueta 40 × 30 mm', w: 40, h: 30 },
  { key: '60x40', label: 'Etiqueta 60 × 40 mm', w: 60, h: 40 },
  { key: '100x50', label: 'Etiqueta 100 × 50 mm', w: 100, h: 50 },
  { key: 'roll58', label: 'Rollo 58 mm (alto automático)', w: 58, h: 0 },
  { key: 'roll80', label: 'Rollo 80 mm (alto automático)', w: 80, h: 0 },
  { key: 'a4', label: 'Hoja A4', w: 210, h: 297 },
  { key: 'a5', label: 'Hoja A5', w: 148, h: 210 },
  { key: 'custom', label: 'Personalizado', w: 50, h: 0 },
]

export function paperPorKey(key: string) {
  return PAPELES.find((p) => p.key === key) ?? PAPELES[0]
}

export const QR_LABEL_DEFAULT: QrLabelConfig = {
  paper: 'roll58',
  ancho_mm: 58,
  alto_mm: 0,
  align: 'center',
  bg_color: '#ffffff',
  text_color: '#000000',
  logo: null,
  logo_alto_mm: 12,
  mostrar_nombre: true,
  nombre_pt: 12,
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

/** Construye el HTML de la etiqueta para impresión (mm reales). */
export function buildLabelHtml(c: QrLabelConfig, nombre: string, url: string) {
  const contentW = Math.max(10, c.ancho_mm - 4) // margen 2mm cada lado
  const pageSize = c.alto_mm > 0 ? `${c.ancho_mm}mm ${c.alto_mm}mm` : `${c.ancho_mm}mm auto`
  const partes: string[] = []
  if (c.logo) partes.push(`<img class="logo" src="${escHtml(c.logo)}" alt=""/>`)
  if (c.texto_encabezado) partes.push(`<div class="enc">${escHtml(c.texto_encabezado)}</div>`)
  if (c.mostrar_nombre) partes.push(`<div class="nombre">${escHtml(nombre)}</div>`)
  partes.push(`<img class="qr" src="${qrImgUrl(url)}" alt="QR"/>`)
  if (c.cta) partes.push(`<div class="cta">${escHtml(c.cta)}</div>`)
  if (c.mostrar_url) partes.push(`<div class="url">${escHtml(url)}</div>`)

  return `<!doctype html><html><head><meta charset="utf-8"><title>QR ${escHtml(nombre)}</title>
<style>
  @page { size: ${pageSize}; margin: 2mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .lbl {
    width: ${contentW}mm; margin: 0 auto; text-align: ${c.align};
    font-family: Arial, Helvetica, sans-serif; padding: 1mm 0;
    background: ${c.bg_color}; color: ${c.text_color};
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .logo { height: ${c.logo_alto_mm}mm; object-fit: contain; display: block; margin: 0 auto 1.5mm; }
  .enc { font-size: ${c.encabezado_pt}pt; margin-bottom: 1mm; }
  .nombre { font-size: ${c.nombre_pt}pt; font-weight: ${c.nombre_bold ? 700 : 400}; line-height: 1.15; margin-bottom: 1.5mm; }
  .qr { width: ${c.qr_mm}mm; height: ${c.qr_mm}mm; display: block; margin: 0 auto; image-rendering: pixelated; }
  .cta { font-size: ${c.cta_pt}pt; margin-top: 1.5mm; }
  .url { font-size: ${c.url_pt}pt; word-break: break-all; margin-top: 1mm; }
  @media screen { body { padding: 16px; background: #ddd; } .lbl { border: 1px dashed #999; } }
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
  const w = window.open('', '_blank', 'width=480,height=680')
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
      style={{
        width: c.ancho_mm * MM,
        minHeight: c.alto_mm > 0 ? c.alto_mm * MM : undefined,
        padding: 2 * MM,
        background: c.bg_color,
        color: c.text_color,
        fontFamily: 'Arial, Helvetica, sans-serif',
        textAlign: c.align,
        display: 'flex',
        flexDirection: 'column',
        alignItems,
        justifyContent: c.alto_mm > 0 ? 'center' : 'flex-start',
      }}
      className="shadow-soft-lg"
    >
      {c.logo && <img src={c.logo} alt="" style={{ height: c.logo_alto_mm * MM, objectFit: 'contain', marginBottom: 1.5 * MM }} />}
      {c.texto_encabezado && <div style={{ fontSize: c.encabezado_pt * 1.333, marginBottom: 1 * MM }}>{c.texto_encabezado}</div>}
      {c.mostrar_nombre && (
        <div style={{ fontSize: c.nombre_pt * 1.333, fontWeight: c.nombre_bold ? 700 : 400, lineHeight: 1.15, marginBottom: 1.5 * MM }}>
          {nombre}
        </div>
      )}
      <img src={qrImgUrl(url, 300)} alt="QR" style={{ width: c.qr_mm * MM, height: c.qr_mm * MM, imageRendering: 'pixelated' }} />
      {c.cta && <div style={{ fontSize: c.cta_pt * 1.333, marginTop: 1.5 * MM }}>{c.cta}</div>}
      {c.mostrar_url && <div style={{ fontSize: c.url_pt * 1.333, marginTop: 1 * MM, wordBreak: 'break-all' }}>{url}</div>}
    </div>
  )
}
