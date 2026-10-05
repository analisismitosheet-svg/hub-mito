/**
 * Prueba de src/lib/stockSku.ts: compila la lib con stubs del proxy SQL y
 * verifica el índice SKU (artículo + color + talle), el parseo de números,
 * cuándo se considera que la vista vino entera, la semántica de stockSkuDe
 * (la columna Stock de Pedidos de venta) y la caché por sesión.
 * No toca la red ni la base.
 *
 *   node scripts/test-stock-sku.mjs
 */
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'stock-sku-'))
const stub = (nombre, contenido) => {
  const p = join(dir, `${nombre}.mjs`)
  writeFileSync(p, contenido)
  return p
}

const alias = {
  '@/lib/sqlApi': stub('sqlApi', `
    export const leerVista = (...a) => globalThis.__leerVista(...a)
    export const estadoConexion = (...a) => globalThis.__estado(...a)
  `),
}

const salida = join(dir, 'lib.mjs')
await build({
  entryPoints: ['src/lib/stockSku.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: salida,
  logLevel: 'warning',
  define: { 'import.meta.env.VITE_SQL_VISTA_STOCK_SKU': 'undefined' },
  alias,
})

const {
  cargarStockSku, limpiarCacheStockSku, stockSkuDe, claveSku, VISTA_STOCK_SKU,
} = await import(pathToFileURL(salida).href)

let fallos = 0
function ok(nombre, cond, extra = '') {
  if (cond) console.log(`  ok   ${nombre}`)
  else {
    console.error(`  FALLA ${nombre} ${extra}`)
    fallos++
  }
}

ok(
  'vista por defecto con alias y base',
  VISTA_STOCK_SKU === 'DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_STOCK_SKU_MITO',
  VISTA_STOCK_SKU,
)
ok('la clave une artículo, color y talle', claveSku(' ab12 ', '02', ' 5 ') === 'AB12|02|5')
ok('clave vacía queda como vacío', claveSku(null, undefined, '') === '||')

/* ---- 1. Vista canónica, entera ---- */
globalThis.__estado = async () => ({ maxRows: 29_900_000 })
globalThis.__leerVista = async () => [
  { ID_ARTICULO: 'AA1', COLOR_CODIGO: '01', TALLE_CODIGO: '5', STOCK_MITO: 12 },
  { ID_ARTICULO: 'AA1', COLOR_CODIGO: '01', TALLE_CODIGO: '6', STOCK_MITO: 0 },
  { ID_ARTICULO: 'AA1', COLOR_CODIGO: '02', TALLE_CODIGO: '5', STOCK_MITO: '1.234,50' },
  { ID_ARTICULO: ' AA1 ', COLOR_CODIGO: '02', TALLE_CODIGO: '5', STOCK_MITO: 6 }, // repetido: se suma
  { ID_ARTICULO: 'BB1', COLOR_CODIGO: '', TALLE_CODIGO: 'UNICO', STOCK_MITO: 4 },
  { ID_ARTICULO: 'CC1', COLOR_CODIGO: '01', TALLE_CODIGO: '5', STOCK_MITO: null }, // sin número: queda afuera
]
let st = await cargarStockSku()
ok('lee SKU con espacios y minúsculas', stockSkuDe(st, 'aa1', '01', '5') === 12, String(stockSkuDe(st, 'AA1', '01', '5')))
ok('cuenta el 0 como 0', stockSkuDe(st, 'AA1', '01', '6') === 0, String(stockSkuDe(st, 'AA1', '01', '6')))
ok('parsea miles y decimal', stockSkuDe(st, 'AA1', '02', '5') === 1240.5, String(stockSkuDe(st, 'AA1', '02', '5')))
ok('talle UNICO también se encuentra vacío', stockSkuDe(st, 'BB1', '', '') === 4, String(stockSkuDe(st, 'BB1', '', '')))
ok('suma los SKU repetidos de la vista', st.porSku.get('AA1|02|5') === 1240.5, String(st.porSku.get('AA1|02|5')))
ok('arma el total por artículo', st.porArticulo.get('AA1') === 1252.5, String(st.porArticulo.get('AA1')))
ok('vino entera', st.completo === true, JSON.stringify(st))
ok('reporta filas y límite', st.filas === 6 && st.limite === 40000, JSON.stringify(st))

/* ---- 2. Cortada: lo que falta no se puede leer como 0 ---- */
globalThis.__estado = async () => ({ maxRows: 1000 })
const cortadas = []
for (let i = 0; i < 999; i++) cortadas.push({ ID_ARTICULO: `X${i}`, COLOR_CODIGO: '', TALLE_CODIGO: '', STOCK_MITO: 3 })
cortadas.push({ ID_ARTICULO: 'ZZ1', COLOR_CODIGO: '01', TALLE_CODIGO: '5', STOCK_MITO: 7 })
globalThis.__leerVista = async () => cortadas
limpiarCacheStockSku()
st = await cargarStockSku()
ok('filas == tope queda incompleto', st.completo === false && st.filas === 1000 && st.limite === 1000, JSON.stringify(st))
ok('lo que vino se lee igual', stockSkuDe(st, 'ZZ1', '01', '5') === 7, String(stockSkuDe(st, 'ZZ1', '01', '5')))
ok('sin dato y cortada: no devuelve 0', stockSkuDe(st, 'NO', 'ESTA', '1') === null, String(stockSkuDe(st, 'NO', 'ESTA', '1')))

/* ---- 3. Entera: el SKU que no aparece es que no tiene stock ---- */
globalThis.__estado = async () => ({ maxRows: 29_900_000 })
globalThis.__leerVista = async () => [{ ID_ARTICULO: 'AA1', COLOR_CODIGO: '01', TALLE_CODIGO: '5', STOCK_MITO: 2 }]
limpiarCacheStockSku()
st = await cargarStockSku()
ok('vista entera y SKU ausente: 0', st.completo === true && stockSkuDe(st, 'OTRO', '01', '5') === 0, String(stockSkuDe(st, 'OTRO', '01', '5')))

/* ---- 4. Columnas alias (como las devuelve el puente) ---- */
globalThis.__leerVista = async () => [{ ARTICULO: 'DD1', CCOLOR: '09', TCOD: 'S', STOCK: 5 }]
limpiarCacheStockSku()
st = await cargarStockSku()
ok('acepta alias de columna', stockSkuDe(st, 'DD1', '09', 'S') === 5, String(stockSkuDe(st, 'DD1', '09', 'S')))

/* ---- 5. Vista vacía y columnas desconocidas: nunca "todo en 0" ---- */
globalThis.__leerVista = async () => []
limpiarCacheStockSku()
let fallo = null
try {
  await cargarStockSku()
} catch (e) {
  fallo = e
}
ok('0 filas tira error', fallo !== null, String(fallo))

globalThis.__leerVista = async () => [{ OTRA_COLUMNA: 'x' }]
limpiarCacheStockSku()
fallo = null
try {
  await cargarStockSku()
} catch (e) {
  fallo = e
}
ok('sin columnas reconocibles tira error', fallo !== null, String(fallo))

/* ---- 6. Caché: se baja una vez por sesión, pero los errores no quedan ---- */
let llamadas = 0
globalThis.__leerVista = async () => {
  llamadas++
  return [{ ID_ARTICULO: 'EE1', COLOR_CODIGO: '01', TALLE_CODIGO: '5', STOCK_MITO: 1 }]
}
limpiarCacheStockSku()
const a = await cargarStockSku()
const b = await cargarStockSku()
ok('la segunda llamada reusa la caché', a === b && llamadas === 1, `llamadas=${llamadas}`)
limpiarCacheStockSku()
const c = await cargarStockSku()
ok('limpiar la caché vuelve a leer', c !== a && llamadas === 2, `llamadas=${llamadas}`)

globalThis.__leerVista = async () => {
  throw new Error('Vista no habilitada')
}
limpiarCacheStockSku()
fallo = null
try {
  await cargarStockSku()
} catch (e) {
  fallo = e
}
ok('un error no queda guardado en caché', fallo !== null && fallo.message === 'Vista no habilitada', String(fallo))

console.log(fallos === 0 ? '\nTodo bien.' : `\n${fallos} falla(s).`)
process.exit(fallos === 0 ? 0 : 1)
