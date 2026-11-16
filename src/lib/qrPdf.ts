/**
 * PDF del QR de la consulta de precios y stock (/precios), para imprimir
 * (botón «QR para imprimir» de la consulta, solo usuarios del hub).
 * A4: el QR grande (15 cm) centrado, el link abajo y una línea para recortar.
 * El link es FIJO: va impreso en las remeras de los empleados (ver App.tsx).
 */
export async function descargarQrPdf(pngQr: string, link: string): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const ancho = doc.internal.pageSize.getWidth()

  const lado = 150
  const x = (ancho - lado) / 2
  const y = 40

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text('Consulta de precios y stock', ancho / 2, 25, { align: 'center' })

  doc.addImage(pngQr, 'PNG', x, y, lado, lado, undefined, 'FAST')

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(13)
  doc.text(link, ancho / 2, y + lado + 12, { align: 'center' })
  doc.setFontSize(10)
  doc.setTextColor(110)
  doc.text('Escaneá el código con la cámara del celular para ver el precio y el stock del local.', ancho / 2, y + lado + 20, {
    align: 'center',
  })

  // Marco de recorte punteado alrededor del QR
  doc.setDrawColor(170)
  doc.setLineWidth(0.2)
  doc.setLineDashPattern([2, 2], 0)
  doc.rect(x - 6, y - 6, lado + 12, lado + 12)

  doc.save('qr-consulta-stock-precios.pdf')
}
