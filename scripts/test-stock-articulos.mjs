/**
 * Prueba de src/lib/stockArticulos.ts: compila la lib con stubs del proxy SQL
 * y verifica el mapeo de columnas, el parseo de números, cuándo se considera
 * que la vista vino entera y la semántica de stockDe (que es lo que decide
 * qué artículos se muestran u ocultan en Orden mapeado). No toca la red ni la base.
 *
 *   node scripts/test-stock-articulos.mjs
 */
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'stock-art-'))
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
  entryPoints: ['src/lib/stockArticulos.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: salida,
  logLevel: 'warning',
  define: { 'import.meta.env.VITE_SQL_VISTA_STOCK_ARTICULO': 'undefined' },
  alias,
})

const { cargarStockArticulos, stockDe, claveArticulo, VISTA_STOCK_ARTICULO } = await import(
  pathToFileURL(salida).href
)

let fallos = 0
function ok(nombre, cond, extra = '') {
  if (cond) console.log(`  ok   ${nombre}`)
  else {
    console.error(`  FALLA ${nombre} ${extra}`)
    fallos++
  }
}

ok(
  'vista por defecto, con alias y base',
  VISTA_STOCK_ARTICULO === 'DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_STOCK_ARTICULO_MITO',
  VISTA_STOCK_ARTICULO,
)
ok('clave de artículo en mayúsculas y sin espacios', claveArticulo('  ab12  ') === 'AB12')

/* ---- 1. Vista con los nombres canónicos, entera (tope más alto que las filas) ---- */
globalThis.__estado = async () => ({ maxRows: 3000 })
globalThis.__leerVista = async () => [
  { ID_ARTICULO: 'AA1', STOCK_MITO: 12 },
  { ID_ARTICULO: 'AA2', STOCK_MITO: 0 },
  { ID_ARTICULO: 'AA3', STOCK_MITO: '1.234,50' },
  { ID_ARTICULO: 'AA3', STOCK_MITO: 6 }, // repetido: se suma
  { ID_ARTICULO: '  aa4 ', STOCK_MITO: null }, // sin stock legible: queda afuera
]
let st = await cargarStockArticulos()
ok('lee ID_ARTICULO / STOCK_MITO', st.porCodigo.get('AA1') === 12, JSON.stringify([...st.porCodigo]))
ok('cuenta el 0 como 0', st.porCodigo.get('AA2') === 0)
ok('parsea miles y decimal', st.porCodigo.get('AA3') === 1240.5, String(st.porCodigo.get('AA3')))
ok('sin stock legible queda sin dato', !st.porCodigo.has('AA4'))
ok('con menos filas que el tope, viene completo', st.completo === true, JSON.stringify(st))
ok('reporta filas y tope', st.filas === 5 && st.tope === 3000, JSON.stringify(st))

/* ---- 2. Cortada por el tope: falta la cola y NO se puede concluir que está en 0 ---- */
globalThis.__estado = async () => ({ maxRows: 1000 })
const cortadas = []
for (let i = 0; i < 998; i++) cortadas.push({ ID_ARTICULO: `X${i}`, STOCK_MITO: 3 })
cortadas.push({ ID_ARTICULO: 'BB1', STOCK_MITO: 0 }, { ID_ARTICULO: 'BB2', STOCK_MITO: 4 })
globalThis.__leerVista = async () => cortadas
st = await cargarStockArticulos()
ok('filas == tope se marca incompleto', st.completo === false && st.filas === 1000, JSON.stringify(st))
ok('lo que vino se lee igual', stockDe(st, 'BB1') === 0 && stockDe(st, 'BB2') === 4)
ok('sin dato y cortada: no devuelve 0', stockDe(st, 'NO-ESTA') === null, String(stockDe(st, 'NO-ESTA')))

/* ---- 3. Entera: el que no aparece es que no tiene stock ---- */
globalThis.__estado = async () => ({ maxRows: 3000 })
globalThis.__leerVista = async () => [
  { ID_ARTICULO: 'AA1', STOCK_MITO: 12 },
  { ID_ARTICULO: 'AA2', STOCK_MITO: 0 },
]
st = await cargarStockArticulos()
ok('con menos filas que el tope, viene completo', st.completo === true, JSON.stringify(st))
ok('sin dato y entera: devuelve 0', stockDe(st, 'NO-ESTA') === 0, String(stockDe(st, 'NO-ESTA')))

/* ---- 4. Sin estado del proxy: se asume cortado (a lo sumo no se borra nada) ---- */
globalThis.__estado = async () => { throw new Error('sin estado') }
st = await cargarStockArticulos()
ok('si no se pudo leer el tope, queda incompleto', st.completo === false && st.tope === null, JSON.stringify(st))

/* ---- 5. Vista vacía: nunca se puede interpretar como "todo en 0" ---- */
globalThis.__leerVista = async () => []
let fallo = null
try {
  await cargarStockArticulos()
} catch (e) {
  fallo = e
}
ok('0 filas tira error (no se oculta nada)', fallo !== null, String(fallo))

/* ---- 6. Columnas desconocidas ---- */
globalThis.__leerVista = async () => [{ OTRA_COLUMNA: 'x' }]
fallo = null
try {
  await cargarStockArticulos()
} catch (e) {
  fallo = e
}
ok('sin columnas reconocibles tira error', fallo !== null, String(fallo))

console.log(fallos === 0 ? '\nTodo bien.' : `\n${fallos} falla(s).`)
process.exit(fallos === 0 ? 0 : 1)
