// Vista previa local de la imagen "Eficiencia mayorista" (sin mandar nada).
//   npx tsx scripts/preview-eficiencia.ts <datos.json> <salida.png>
// datos.json: { fecha, avance, vtd: [[local, venta, repo, faltante, segundos, uni_crono, responsable, resp_id]], piso: [...] }
import { readFileSync, writeFileSync } from 'node:fs'
import { bloquesEficiencia, type FilaVtd } from '../src/lib/informeEficiencia'
import { renderReporteImagen } from '../src/lib/informesImagen'

const [, , entrada, salida = 'eficiencia.png'] = process.argv
const d = JSON.parse(readFileSync(entrada, 'utf8'))
const vtd: FilaVtd[] = d.vtd.map((r: unknown[]) => ({
  lote_id: 'x', fecha: d.fecha, venta_fecha: d.venta_fecha ?? null, lote_estado: 'finalizado',
  local: r[0], venta: r[1], repo: r[2], faltante: r[3], segundos: r[4], uni_crono: r[5], responsable: r[6], responsable_id: r[7],
}))
const { subtitulo, bloques } = bloquesEficiencia({ fecha: d.fecha, vtd, piso: d.piso, avance: d.avance })
const png = await renderReporteImagen({ titulo: 'Eficiencia mayorista', subtitulo, pie: 'Hub Mito · Mayorista', bloques })
writeFileSync(salida, png)
console.log('ok', salida, png.length)
