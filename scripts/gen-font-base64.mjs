import { readFileSync, writeFileSync } from 'node:fs'

const ttf = readFileSync('scripts/assets/Geist-Regular.ttf')
const b64 = ttf.toString('base64')

const contenido =
  `/**\n` +
  ` * Fuente "Geist Regular" (SIL Open Font License 1.1) embebida en base64 para que\n` +
  ` * viaje dentro de la función de Vercel sin depender de archivos ni de tracing de fs.\n` +
  ` * La usan los informes en formato imagen (satori arma el SVG).\n` +
  ` *\n` +
  ` * NO editar a mano: se regenera desde un .ttf con scripts/gen-font-base64.mjs.\n` +
  ` */\n` +
  `export const FUENTE_GEIST_BASE64 =\n  '${b64}'\n`

writeFileSync('src/lib/informeFuente.ts', contenido)
console.log('OK: src/lib/informeFuente.ts (' + b64.length + ' chars base64)')
