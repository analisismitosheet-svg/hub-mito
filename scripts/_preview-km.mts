/**
 * Temporal: arma la imagen del informe «Km recorridos del transporte» con datos
 * ya consultados, para mirar cómo queda sin mandar nada.
 *   npx tsx scripts/_preview-km.mts <datos.json> <salida.png>
 */
import fs from 'node:fs'
import { bloquesKm } from '../src/lib/informeKmTransporte.js'
import { renderReporteImagen } from '../src/lib/informesImagen.js'

const [, , entrada, salida] = process.argv
const datos = JSON.parse(fs.readFileSync(entrada, 'utf8'))
const { subtitulo, bloques, texto } = bloquesKm(datos)
const png = await renderReporteImagen({ titulo: 'Km recorridos del transporte', subtitulo, bloques })
fs.writeFileSync(salida, png)
console.log('--- TEXTO DE WHATSAPP ---')
console.log(texto)
console.log('--- PNG ---', salida, png.length, 'bytes')
