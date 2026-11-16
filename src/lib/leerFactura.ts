/* Lee una factura (PDF de ARCA/AFIP o foto) y saca los datos para completar una OC.
   - PDF con texto: se arma el texto por renglones (pdfjs) y se buscan las etiquetas de la factura electrónica.
   - Foto o PDF escaneado: se lee el QR de ARCA (fecha, CUIT, punto de venta, número, importe, moneda y cotización).
   Todo corre en el navegador: el archivo no sale a ningún servicio externo. */

export interface DatosFactura {
  tipo: string | null // FACTURA, NOTA DE CRÉDITO…
  letra: string | null // A, B, C, M
  puntoVenta: string | null
  numero: string | null
  fecha: string | null // ISO yyyy-mm-dd
  vencimientoPago: string | null
  cuit: string | null // emisor, solo dígitos
  razonSocial: string | null
  nombreFantasia: string | null
  condicionVenta: string | null
  moneda: string | null // PES, USD, EUR
  cotizacion: number | null
  total: number | null // en la moneda de la factura
  totalPesos: number | null
  detalle: string | null // qué se compra (renglones de la factura)
  cae: string | null
  origen: 'texto' | 'qr'
}

/** CUIT de MITO: en la factura es el receptor, nunca el proveedor */
const CUITS_PROPIOS = new Set(['30709055883'])

const LETRA_POR_CODIGO: Record<string, string> = { '1': 'A', '2': 'A', '3': 'A', '6': 'B', '7': 'B', '8': 'B', '11': 'C', '12': 'C', '13': 'C', '51': 'M', '201': 'A', '206': 'B', '211': 'C' }
const TIPO_POR_CODIGO: Record<string, string> = { '1': 'FACTURA', '6': 'FACTURA', '11': 'FACTURA', '51': 'FACTURA', '2': 'NOTA DE DÉBITO', '7': 'NOTA DE DÉBITO', '12': 'NOTA DE DÉBITO', '3': 'NOTA DE CRÉDITO', '8': 'NOTA DE CRÉDITO', '13': 'NOTA DE CRÉDITO', '201': 'FACTURA DE CRÉDITO', '206': 'FACTURA DE CRÉDITO', '211': 'FACTURA DE CRÉDITO' }

/** "658.411,42" / "658411,42" / "416.98" -> número */
export function numeroAr(t: string): number | null {
  let s = t.replace(/[^\d.,-]/g, '')
  if (!s) return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
const fechaIso = (t: string | undefined | null) => {
  const m = t?.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}
/** Dígito verificador del CUIT */
export function cuitValido(c: string): boolean {
  if (!/^\d{11}$/.test(c)) return false
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const s = pesos.reduce((a, p, i) => a + p * Number(c[i]), 0)
  const v = 11 - (s % 11)
  return (v === 11 ? 0 : v === 10 ? 9 : v) === Number(c[10])
}
export const cuitConGuiones = (c: string) => (c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c)

/* ---------------- Texto del PDF ---------------- */
type ItemTexto = { str: string; x: number; y: number }

/** Junta los pedazos de texto de pdfjs en renglones (misma altura), de izquierda a derecha. */
export function armarRenglones(items: ItemTexto[]): string[] {
  const filas: Array<{ y: number; partes: ItemTexto[] }> = []
  for (const it of items) {
    if (!it.str.trim()) continue
    const fila = filas.find((f) => Math.abs(f.y - it.y) < 3)
    if (fila) fila.partes.push(it)
    else filas.push({ y: it.y, partes: [it] })
  }
  return filas
    .sort((a, b) => b.y - a.y) // en PDF la y crece hacia arriba
    .map((f) => f.partes.sort((a, b) => a.x - b.x).map((p) => p.str.trim()).join('  ').replace(/\s{3,}/g, '  ').trim())
}

const ETIQUETAS_SUELTAS = /^(ORIGINAL|DUPLICADO|TRIPLICADO|CUADRUPLICADO|FACTURA|NOTA DE CR[EÉ]DITO|NOTA DE D[EÉ]BITO|RECIBO|[ABCM]|COD\.?\s*\d+)$/i

/** Saca los datos de los renglones de texto de la primera hoja. */
export function interpretarTexto(renglones: string[]): DatosFactura {
  const todo = renglones.join('\n')
  const buscar = (re: RegExp) => todo.match(re)?.[1]?.trim() ?? null

  // Letra y código: «A  COD. 01» (a veces en renglones separados)
  const cod = buscar(/COD\.?\s*(\d{1,3})/i)
  const letra = buscar(/(?:^|\s)([ABCM])\s*(?:\n\s*)?COD\.?\s*\d/m) ?? (cod ? LETRA_POR_CODIGO[String(Number(cod))] ?? null : null)
  const tipo = buscar(/\b(FACTURA DE CR[EÉ]DITO|NOTA DE CR[EÉ]DITO|NOTA DE D[EÉ]BITO|FACTURA|RECIBO)\b/i)?.toUpperCase() ?? (cod ? TIPO_POR_CODIGO[String(Number(cod))] ?? null : null)

  // CUIT del emisor: el primero válido que no sea de MITO ni esté en el renglón del receptor
  let cuit: string | null = null
  for (const r of renglones) {
    if (/Apellido y Nombre|Se[nñ]or(es)?:|Cliente:/i.test(r)) continue // renglón del receptor: sus CUIT no cuentan
    for (const m of r.matchAll(/\b(\d{2})-?(\d{8})-?(\d)\b/g)) {
      const c = m[1] + m[2] + m[3]
      if (!CUITS_PROPIOS.has(c) && cuitValido(c)) { cuit = c; break }
    }
    if (cuit) break
  }

  // Razón social del emisor: «Razón Social:» que no sea la del receptor («Apellido y Nombre / Razón Social:»)
  let razonSocial: string | null = null
  for (const r of renglones) {
    const limpio = r.replace(/Apellido y Nombre\s*\/\s*Raz[oó]n Social:.*/i, '')
    const m = limpio.match(/Raz[oó]n Social:\s*(.+?)(?:\s{2,}|$)/i)
    if (m && m[1].trim()) { razonSocial = m[1].trim(); break }
  }

  // Nombre de fantasía: lo que va arriba de todo, antes de «Razón Social»
  let nombreFantasia: string | null = null
  const iRazon = renglones.findIndex((r) => /Raz[oó]n Social:/i.test(r))
  for (const r of renglones.slice(0, iRazon > 0 ? iRazon : 4)) {
    for (const parte of r.split(/\s{2,}/)) {
      const p = parte.trim()
      if (p.length < 3 || p.includes(':') || ETIQUETAS_SUELTAS.test(p) || /\d{3,}/.test(p)) continue
      nombreFantasia = p
      break
    }
    if (nombreFantasia) break
  }
  if (nombreFantasia && razonSocial && nombreFantasia.toUpperCase() === razonSocial.toUpperCase()) nombreFantasia = null

  const condicionVenta = buscar(/Condici[oó]n de venta:\s*([^\n]+?)(?:\s{2,}|\n|$)/i)
  const puntoVenta = buscar(/Punto de Venta:\s*(\d{1,5})/i)
  const numero = buscar(/Comp\.?\s*Nro:?\s*(\d{1,8})/i)
  const fecha = fechaIso(buscar(/Fecha de Emisi[oó]n:\s*(\d{2}\/\d{2}\/\d{4})/i))
  const vencimientoPago = fechaIso(buscar(/Vto\.? para el pago:\s*(\d{2}\/\d{2}\/\d{4})/i))
  const cae = buscar(/CAE\s*N[°º]?:?\s*(\d{14})/i)

  let moneda: string | null = 'PES'
  const textoMoneda = buscar(/Moneda:\s*([^\n]+)/i)
  if (textoMoneda) moneda = /USD|d[oó]lar/i.test(textoMoneda) ? 'USD' : /EUR|euro/i.test(textoMoneda) ? 'EUR' : 'PES'
  else if (/Precio Unit\.?\s*\(USD\)/i.test(todo)) moneda = 'USD'

  const total = numeroAr(buscar(/Importe Total:\s*(?:USD|EUR|\$)?\s*([\d.]+,\d{2})/i) ?? '')
  const cotizacion = numeroAr(buscar(/tipo de cambio[\s\S]{0,40}?consignado de\s*([\d.,]+)/i) ?? '')
  let totalPesos = numeroAr(buscar(/asciende a:?\s*\$\s*([\d.]+,\d{2})/i) ?? '')
  if (totalPesos == null && total != null) totalPesos = moneda === 'PES' ? total : cotizacion ? Math.round(total * cotizacion * 100) / 100 : null

  // Detalle: los renglones entre el encabezado de la grilla y los totales / el CAE
  const iDesde = renglones.findIndex((r) => /Producto\s*\/\s*Servicio|Descripci[oó]n/i.test(r))
  let detalle: string | null = null
  if (iDesde >= 0) {
    const partes: string[] = []
    for (const r of renglones.slice(iDesde + 1)) {
      // restos del encabezado de la grilla («IVA  (USD)», «Alicuota  Subtotal c/IVA»)
      if (/^(IVA|Alicuota|Subtotal c\/IVA|\(?(USD|EUR|\$)\)?)(\s+(IVA|Subtotal c\/IVA|\(?(USD|EUR|\$)\)?))*$/i.test(r)) continue
      if (/^(CAE|Importe|Subtotal|Moneda|IVA\s|Otros Tributos|El total de este|Pág\.|Comprobante Autorizado)/i.test(r) || /Importe (Neto|Total|Exento)/i.test(r)) break
      if (/^\(?(USD|EUR)\)?$|^IVA$/i.test(r)) continue
      // se queda con el texto y saca las columnas de números (cantidad, unidad, precios, alícuota)
      const texto = r
        .replace(/\s\d[\d.]*,\d{2}\b.*$/, '')
        .replace(/\/{2,}/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (texto && !/^\d[\d.,]*$/.test(texto)) partes.push(texto)
    }
    detalle = partes.join(' · ') || null
  }

  return { tipo, letra, puntoVenta, numero, fecha, vencimientoPago, cuit, razonSocial, nombreFantasia, condicionVenta, moneda, cotizacion, total, totalPesos, detalle, cae, origen: 'texto' }
}

/* ---------------- QR de ARCA ---------------- */
/** https://www.afip.gob.ar/fe/qr/?p=BASE64(JSON) -> datos */
export function interpretarQr(texto: string): DatosFactura | null {
  const p = texto.match(/[?&]p=([^&\s]+)/)?.[1]
  if (!p) return null
  try {
    const b64 = decodeURIComponent(p).replace(/-/g, '+').replace(/_/g, '/')
    const j = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as {
      fecha?: string; cuit?: number | string; ptoVta?: number; tipoCmp?: number; nroCmp?: number; importe?: number; moneda?: string; ctz?: number; codAut?: number | string
    }
    const moneda = j.moneda === 'DOL' ? 'USD' : j.moneda === '060' ? 'EUR' : j.moneda ?? 'PES'
    const cotizacion = j.ctz && j.ctz !== 1 ? Number(j.ctz) : null
    const total = j.importe != null ? Number(j.importe) : null
    const tipoCmp = j.tipoCmp != null ? String(j.tipoCmp) : ''
    return {
      tipo: TIPO_POR_CODIGO[tipoCmp] ?? null, letra: LETRA_POR_CODIGO[tipoCmp] ?? null,
      puntoVenta: j.ptoVta != null ? String(j.ptoVta).padStart(5, '0') : null,
      numero: j.nroCmp != null ? String(j.nroCmp).padStart(8, '0') : null,
      fecha: j.fecha?.slice(0, 10) ?? null, vencimientoPago: null,
      cuit: j.cuit != null ? String(j.cuit) : null, razonSocial: null, nombreFantasia: null, condicionVenta: null,
      moneda, cotizacion, total,
      totalPesos: total == null ? null : moneda === 'PES' ? total : cotizacion ? Math.round(total * cotizacion * 100) / 100 : null,
      detalle: null, cae: j.codAut != null ? String(j.codAut) : null, origen: 'qr',
    }
  } catch {
    return null
  }
}

async function leerQr(img: ImageData): Promise<DatosFactura | null> {
  const [{ prepareZXingModule, readBarcodes }, { default: wasmUrl }] = await Promise.all([
    import('zxing-wasm/reader'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ])
  await prepareZXingModule({
    overrides: { locateFile: (ruta: string, prefijo: string) => (ruta.endsWith('.wasm') ? wasmUrl : prefijo + ruta) },
    fireImmediately: true,
  })
  const res = await readBarcodes(img, { formats: ['QRCode'], tryHarder: true, tryRotate: true, maxNumberOfSymbols: 4 })
  for (const r of res) {
    const d = interpretarQr(r.text)
    if (d) return d
  }
  return null
}

function canvasAImagen(c: HTMLCanvasElement): ImageData {
  return c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
}

/* ---------------- Entrada ---------------- */
/** Junta lo del texto con lo del QR: el texto manda; el QR completa lo que falte. */
function combinar(a: DatosFactura, b: DatosFactura | null): DatosFactura {
  if (!b) return a
  const r = { ...a }
  for (const k of Object.keys(b) as Array<keyof DatosFactura>) {
    if (r[k] == null && b[k] != null) (r as Record<string, unknown>)[k] = b[k]
  }
  return r
}
const leidoAlgo = (d: DatosFactura) => Boolean(d.cuit || d.total || d.fecha || d.razonSocial)

export async function leerFactura(archivo: File): Promise<DatosFactura | null> {
  const esPdf = archivo.type === 'application/pdf' || /\.pdf$/i.test(archivo.name)
  if (esPdf) {
    const [pdfjs, { default: workerUrl }] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ])
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await archivo.arrayBuffer()) }).promise
    try {
      const hoja = await doc.getPage(1) // las facturas traen original/duplicado/triplicado: alcanza con la primera
      const contenido = await hoja.getTextContent()
      const items = contenido.items.flatMap((it) => ('str' in it ? [{ str: it.str, x: it.transform[4], y: it.transform[5] }] : []))
      const porTexto = items.length > 5 ? interpretarTexto(armarRenglones(items)) : null
      if (porTexto && porTexto.cuit && porTexto.total != null && porTexto.fecha) return porTexto
      // Sin texto (escaneado) o con datos faltantes: se dibuja la hoja y se busca el QR
      const vista = hoja.getViewport({ scale: 2.5 })
      const canvas = document.createElement('canvas')
      canvas.width = vista.width
      canvas.height = vista.height
      await hoja.render({ canvasContext: canvas.getContext('2d')!, viewport: vista }).promise
      const qr = await leerQr(canvasAImagen(canvas)).catch(() => null)
      if (porTexto) { const d = combinar(porTexto, qr); return leidoAlgo(d) ? d : null }
      return qr
    } finally {
      void doc.destroy()
    }
  }
  if (archivo.type.startsWith('image/')) {
    const bmp = await createImageBitmap(archivo)
    const escala = Math.min(1, 2400 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * escala)
    canvas.height = Math.round(bmp.height * escala)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return leerQr(canvasAImagen(canvas))
  }
  return null
}
