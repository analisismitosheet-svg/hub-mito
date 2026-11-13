import { CONDICIONES_DRAGON, IVA, MOTIVOS_DRAGON, netoItem, type ItemDragon, type Variantes } from '@/lib/ordenesCompra'

/* PDF del pedido de compra con el mismo formato que imprime Dragon
   (ejemplo: «15558 - LOVE THIS ejemplo pdf dragon.pdf»): cabecera del proveedor, recuadro X,
   N° 0164-000NNNNN, datos de MITO, condición y motivo, grilla de artículos y totales con IVA 21 %. */

export interface DatosPdfOc {
  numero: number | null
  proveedor: string
  proveedor_cuit: string
  contacto: string
  telefono: string
  mail: string
  fecha_compra: string
  fecha_entrega: string
  base: string
  condicion: string
  motivo: string
  observacion: string
  descuentoGeneral: number
  items: ItemDragon[]
  variantes: Record<string, Variantes | null>
}

// Números como los imprime Dragon: 28,000.0000 / 168,000.00
const num = (v: number, dec = 2) => v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
const fecha = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '')

export function nombreArchivoPdf(d: DatosPdfOc) {
  const prov = (d.proveedor || 'proveedor').replace(/[^\w .-]+/g, '').trim().slice(0, 40)
  return `${d.numero ?? 'nueva'} - ${prov}.pdf`
}

export async function generarPdfOc(d: DatosPdfOc): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210
  const izq = 15
  const der = W - 15
  const items = d.items.filter((i) => i.articulo && Number(i.cantidad) > 0)
  const subtotal = items.reduce((s, i) => s + netoItem(i), 0)
  const desc = Math.min(Math.max(d.descuentoGeneral || 0, 0), 100)
  const montoDesc = subtotal * desc / 100
  const base = subtotal - montoDesc
  const iva = Math.round(base * IVA * 100) / 100
  const total = Math.round((base + iva) * 100) / 100
  const unidades = items.reduce((s, i) => s + (Number(i.cantidad) || 0), 0)
  const condicionDesc = CONDICIONES_DRAGON.find(([c]) => c === d.condicion)?.[1] ?? d.condicion
  const condicion = /^PCF/i.test(d.condicion) ? `Pago contra factura ${condicionDesc}` : condicionDesc
  const motivo = MOTIVOS_DRAGON.find(([c]) => c === d.motivo)?.[1] ?? d.motivo
  const nro = d.numero != null ? `0164-   ${String(d.numero).padStart(8, '0')}` : '0164-   (a asignar)'
  const corta = (t: string, ancho: number) => {
    let s = t
    while (s && doc.getTextWidth(s) > ancho) s = s.slice(0, -1)
    return s
  }

  // Columnas (x = borde izquierdo, salvo las numéricas que van alineadas a la derecha)
  const col = { art: izq, desc: 38, color: 72, colNom: 80, talle: 99, cant: 125, precio: 145, pdes: 148, mdes: 175, monto: der }
  const filaAlto = 4.2
  const yTablaIni = 84
  const yTablaFin = 262

  const cabecera = (pagina: number, paginas: number, transporte: number | null) => {
    doc.setTextColor(0)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
    doc.text(corta(d.proveedor.toUpperCase() || '—', 75), izq, 20)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
    const lineasProv = [
      d.contacto ? `Contacto: ${d.contacto}` : '',
      `TEL: ${d.telefono || ''}`,
      d.mail ? `Mail: ${d.mail}` : '',
      `CUIT: ${d.proveedor_cuit || ''}`,
    ].filter(Boolean)
    lineasProv.forEach((t, n) => doc.text(corta(t, 75), izq, 24.5 + n * 3.6))
    // Recuadro X
    doc.setLineWidth(0.35)
    doc.rect(96, 12, 13, 13)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(26)
    doc.text('X', 102.5, 22.6, { align: 'center' })
    doc.line(102.5, 25, 102.5, 45)
    // Número y fechas
    doc.setFontSize(9)
    doc.text('PEDIDO DE COMPRA Nº', 120, 16)
    doc.text(nro, der, 16, { align: 'right' })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5)
    doc.text(`FECHA: ${fecha(d.fecha_compra)}`, 120, 23)
    doc.text(`FECHA VENCIMIENTO: ${fecha(d.fecha_entrega || d.fecha_compra)}`, 120, 31)
    doc.text('DOCUMENTO NO VÁLIDO COMO FACTURA', 120, 41)
    doc.line(izq, 45, der, 45)
    // MITO
    doc.setFontSize(7.5)
    ;['MITO S.R.L.', 'Los Tulipanes 2387', 'Cordoba - ARGENTINA', `TEL: ${d.base}`].forEach((t, n) => doc.text(t, izq, 49 + n * 3.6))
    ;['Responsable Inscripto', 'CUIT: 30709055883'].forEach((t, n) => doc.text(t, 120, 49 + n * 3.6))
    if (transporte != null) {
      doc.text('Transporte Subtotal: $', 160, 64, { align: 'right' })
      doc.text(num(transporte), der, 64, { align: 'right' })
    }
    doc.text(corta(`Condición de pago: ${condicion.toUpperCase()}`, 100), izq, 73)
    doc.text(corta(`Motivo: ${motivo.toUpperCase()}`, 100), izq, 76.6)
    // Encabezado de la grilla
    doc.text('Artículo', col.art, 82)
    doc.text('Color', col.color, 82)
    doc.text('Talle', col.talle + 6, 82)
    doc.text('Cantidad', col.cant, 82, { align: 'right' })
    doc.text('Precio', col.precio, 82, { align: 'right' })
    doc.text('% Des.', col.pdes, 82)
    doc.text('Mto. des.', col.mdes, 82, { align: 'right' })
    doc.text('Monto', col.monto, 82, { align: 'right' })
    doc.setLineWidth(0.25)
    doc.line(izq, 83, der, 83)
    // Pie
    doc.text(`Página ${pagina} de ${paginas}`, izq, 287)
    doc.setFontSize(5.5); doc.setTextColor(140)
    doc.text('Comprobante generado desde el Hub MITO', W / 2, 291, { align: 'center' })
    doc.setTextColor(0); doc.setFontSize(7.5)
  }

  // Reparto en páginas: la última necesita lugar para los totales
  const porPagina = Math.floor((yTablaFin - yTablaIni) / filaAlto)
  const porPaginaUltima = Math.floor((200 - yTablaIni) / filaAlto)
  const paginasItems: ItemDragon[][] = []
  let resto = items.slice()
  while (resto.length > porPaginaUltima) {
    paginasItems.push(resto.slice(0, porPagina))
    resto = resto.slice(porPagina)
  }
  paginasItems.push(resto)
  const paginas = paginasItems.length

  let acumulado = 0
  paginasItems.forEach((lista, p) => {
    if (p > 0) doc.addPage()
    cabecera(p + 1, paginas, p > 0 ? acumulado : null)
    let y = yTablaIni + 2
    for (const it of lista) {
      const bruto = (Number(it.cantidad) || 0) * (Number(it.precio) || 0)
      const neto = netoItem(it)
      const colorNom = d.variantes[it.articulo]?.colores.find((c) => c.codigo === it.color)?.nombre ?? ''
      doc.text(it.articulo, col.art, y)
      doc.text(corta((it.descripcion ?? '').toUpperCase(), col.color - col.desc - 2), col.desc, y)
      doc.text(it.color, col.color, y)
      doc.text(corta(colorNom.toUpperCase(), col.talle - col.colNom - 1), col.colNom, y)
      doc.text(it.talle, col.talle, y)
      doc.text(num(Number(it.cantidad) || 0), col.cant, y, { align: 'right' })
      doc.text(num(Number(it.precio) || 0, 4), col.precio, y, { align: 'right' })
      if (it.descuento) {
        doc.text(num(it.descuento), col.pdes + 8, y, { align: 'right' })
        doc.text(num(bruto - neto), col.mdes, y, { align: 'right' })
      }
      doc.text(num(neto), col.monto, y, { align: 'right' })
      acumulado += neto
      y += filaAlto
    }
    if (p < paginas - 1) {
      doc.text('Transporte Subtotal parcial: $', 175, 287, { align: 'right' })
      doc.text(num(acumulado), der, 287, { align: 'right' })
    }
  })

  // Totales (última página)
  let y = 205
  doc.setLineWidth(0.35)
  doc.line(izq, y, der, y)
  y += 4.5
  doc.text(`Filas: ${items.length}`, izq, y)
  doc.text('Cantidad total:', 82, y)
  doc.text(num(unidades), 116, y, { align: 'right' })
  const tx = 120
  const fila = (etq: string, valor: string, negrita = true) => {
    doc.setFont('helvetica', 'normal'); doc.text(etq, tx, y)
    doc.setFont('helvetica', negrita ? 'bold' : 'normal'); doc.text(valor, der, y, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    y += 5
  }
  fila('Subtotal', num(subtotal))
  fila(desc ? `Descuento ${num(desc)} %` : 'Descuento', desc ? num(montoDesc) : '')
  fila('Recargo', '')
  y += 3
  doc.text('Impuesto', tx, y); doc.text('%', 147, y, { align: 'right' }); doc.text('Base', 170, y, { align: 'right' }); doc.text('Monto', der, y, { align: 'right' })
  doc.setLineWidth(0.25); doc.line(tx, y + 1, der, y + 1)
  y += 5
  doc.text('I.V.A.', tx, y); doc.text(num(IVA * 100), 147, y, { align: 'right' }); doc.text(num(base), 170, y, { align: 'right' }); doc.text(num(iva), der, y, { align: 'right' })
  y += 12
  fila('Total Impuestos', num(iva))
  y += 6
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
  doc.text('TOTAL', tx, y); doc.text('$', 145, y); doc.text(num(total), der, y, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
  if (d.observacion.trim()) {
    const obs = doc.splitTextToSize(`Observaciones: ${d.observacion.trim()}`, der - izq) as string[]
    doc.text(obs.slice(0, 3), izq, 276)
  }
  return doc.output('blob')
}
