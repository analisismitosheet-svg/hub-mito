/**
 * Prueba rápida de src/lib/articulosConsulta.ts: compila la lib con stubs de
 * Supabase / SQL y verifica el mapeo de columnas, el parseo de números, el
 * orden, el filtro y las ubicaciones por SKU. No toca la red ni la base.
 *
 *   node scripts/test-consulta-articulos.mjs
 */
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'consulta-art-'))
const stub = (nombre, contenido) => {
  const p = join(dir, `${nombre}.mjs`)
  writeFileSync(p, contenido)
  return p
}

const alias = {
  // Se lee en cada llamada para poder cambiarlo desde la prueba
  '@/lib/supabase': stub('supabase', `
    export const supabase = {
      from: (...a) => {
        const c = globalThis.__supabase
        if (!c) throw new Error('supabase no configurado')
        return c.from(...a)
      },
    }
  `),
  '@/lib/sqlApi': stub('sqlApi', `
    export const COLUMNAS_BUSQUEDA = ['ARTCOD','ID_ARTICULO','ARTICULO','NOMBRE_COMPLETO','DESCRIPCION']
    export const leerVista = (...a) => globalThis.__leerVista(...a)
    export const leerVistaFiltrada = (...a) => globalThis.__leerFiltrada(...a)
  `),
  '@/lib/mapeo': stub('mapeo', `
    export const claveSku = (c, co = '', t = '') =>
      [c, co, t].map((v) => String(v ?? '').trim().toUpperCase()).join('|')
    export const compararUbicaciones = (a, b) => a.localeCompare(b, undefined, { numeric: true })
    export const ubicacionesSkuDeArticulos = (...a) => globalThis.__ubicaciones(...a)
  `),
}

const salida = join(dir, 'lib.mjs')
await build({
  entryPoints: ['src/lib/articulosConsulta.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: salida,
  logLevel: 'warning',
  define: { 'import.meta.env.VITE_SQL_VISTA_ARTICULOS': 'undefined' },
  alias,
})

const { consultarArticulos, filasParaExcel, VISTA_ARTICULOS } = await import(pathToFileURL(salida).href)

let fallos = 0
function ok(nombre, cond, extra = '') {
  if (cond) console.log(`  ok   ${nombre}`)
  else {
    console.error(`  FALLA ${nombre} ${extra}`)
    fallos++
  }
}
const sinMaestro = async () => new Map()

ok('vista por defecto, con alias y base', VISTA_ARTICULOS === 'DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_ARTICULOS_MITO', VISTA_ARTICULOS)

/* ---- 1. Vista con los nombres canónicos ---- */
globalThis.__supabase = null
globalThis.__ubicaciones = sinMaestro
globalThis.__leerFiltrada = async () => [
  {
    ID_ARTICULO: 'BG011001', COLOR: 'AZUL', TALLE: 'M',
    NOMBRE_COMPLETO: 'Reloj digital - Acero', MATERIAL: 'ACERO', GRUPO: 'ACCESORIOS',
    STOCK_MITO: 12, PRECIO: 15450.5,
  },
  {
    ID_ARTICULO: 'BG011001', COLOR: 'ROJO', TALLE: 'M',
    NOMBRE_COMPLETO: 'Reloj digital - Acero', MATERIAL: 'ACERO', GRUPO: 'ACCESORIOS',
    STOCK_MITO: 0, PRECIO: '15.450,50',
  },
]
globalThis.__leerVista = async () => []

/* ---- 0. Al entrar no se trae el listado: solo busca lo que se escribe ---- */
let r = await consultarArticulos('')
ok('sin término no pide nada al SQL y no trae filas', r.filas.length === 0, JSON.stringify(r.filas))
r = await consultarArticulos('r')
ok('con 1 carácter tampoco', r.filas.length === 0, JSON.stringify(r.filas))

r = await consultarArticulos('reloj')
ok('filtra en el SQL (2 SKU)', r.filas.length === 2, JSON.stringify(r.filas))
ok('no marca filtrado en cliente', r.filtradoEnCliente === false)
ok('precio numérico simple', r.filas[0].precio === 15450.5, String(r.filas[0].precio))
ok('precio "15.450,50"', r.filas[1].precio === 15450.5, String(r.filas[1].precio))
ok('stock 0 se distingue de null', r.filas[1].stock === 0, String(r.filas[1].stock))
ok('nombre completo', r.filas[0].nombre === 'Reloj digital - Acero', r.filas[0].nombre)
ok('material y grupo', r.filas[0].material === 'ACERO' && r.filas[0].grupo === 'ACCESORIOS')

/* ---- 2. Orden por artículo, color y talle ---- */
// El SQL no trae nada: se cae al camino sin filtro + filtrado en el navegador.
globalThis.__leerFiltrada = async () => []
globalThis.__leerVista = async () => [
  { ID_ARTICULO: 'ZZ1', COLOR: 'B', TALLE: '1', NOMBRE_COMPLETO: 'camiseta' },
  { ID_ARTICULO: 'AA1', COLOR: 'B', TALLE: '10', NOMBRE_COMPLETO: 'camiseta' },
  { ID_ARTICULO: 'AA1', COLOR: 'B', TALLE: '2', NOMBRE_COMPLETO: 'camiseta' },
]
r = await consultarArticulos('camiseta')
ok('orden artículo/color/talle (talle numérico)',
  r.filas.map((f) => `${f.idArticulo}/${f.talle}`).join(' ') === 'AA1/2 AA1/10 ZZ1/1',
  r.filas.map((f) => `${f.idArticulo}/${f.talle}`).join(' '))
ok('sin llegar al tope no marca truncado', r.truncado === false)

/* ---- 3. Nombres de columnas legacy (ARTCOD / ARTDES / codigo_modelo) ---- */
globalThis.__leerFiltrada = async () => []
globalThis.__leerVista = async () => [
  { codigo_modelo: 'BG01', modelo: 'Campera', categoria: 'ROPA', stock: 3, precio: 900 },
  { ARTCOD: 'BG02', ARTDES: 'Pantalón', ARTDESADIC: 'Denim', GRUPO: 'ROPA', STOCK_DISPONIBLE: 7, PRECIO: 1000 },
]
// 'ropa' es el grupo de las dos filas: es lo único que las dos comparten
r = await consultarArticulos('ropa')
ok('alias legacy codigo_modelo/modelo',
  r.filas[0].idArticulo === 'BG01' && r.filas[0].nombre === 'Campera' && r.filas[0].grupo === 'ROPA' && r.filas[0].stock === 3 && r.filas[0].precio === 900,
  JSON.stringify(r.filas[0]))
ok('alias legacy ARTCOD/ARTDES', r.filas[1].idArticulo === 'BG02', r.filas[1].idArticulo)
ok('nombre completo = ARTDES + ARTDESADIC', r.filas[1].nombre === 'Pantalón - Denim', r.filas[1].nombre)
ok('alias legacy STOCK_DISPONIBLE', r.filas[1].stock === 7, String(r.filas[1].stock))
ok('cada fila usa sus propias columnas', r.filas[0].idArticulo === 'BG01' && r.filas[1].idArticulo === 'BG02')

/* ---- 4. Filtro en el cliente cuando el SQL no lo aplica ---- */
globalThis.__leerVista = async () => [
  { ID_ARTICULO: 'AA1', NOMBRE_COMPLETO: 'Campera roja' },
  { ID_ARTICULO: 'BB2', NOMBRE_COMPLETO: 'Pantalón azul' },
]
r = await consultarArticulos('pantalón')
ok('filtra en el navegador', r.filas.length === 1 && r.filas[0].idArticulo === 'BB2', JSON.stringify(r.filas))
ok('avisa que filtró en el navegador', r.filtradoEnCliente === true)

/* ---- 5. Ubicaciones por SKU y caída al artículo base ---- */
globalThis.__leerFiltrada = async () => []
globalThis.__leerVista = async () => [
  { ID_ARTICULO: 'AA1', COLOR: 'ROJO', TALLE: 'M', MATERIAL: 'ALGODON' },
  { ID_ARTICULO: 'BB2', COLOR: 'AZUL', TALLE: 'M', MATERIAL: 'ALGODON' },
]
globalThis.__ubicaciones = async () =>
  new Map([['AA1|ROJO|M', ['PB-B10', 'PB-B2']], ['AA1||', ['PB-A1']], ['BB2|AZUL|M', []]])
r = await consultarArticulos('algodon')
ok('ubicación del SKU, ordenada', r.filas[0].ubicaciones.join(',') === 'PB-B2,PB-B10', r.filas[0].ubicaciones.join(','))
ok('cae al artículo base', r.filas[0].ubicaciones.length === 2)
ok('sin ubicación mapeada queda vacío', r.filas[1].ubicaciones.length === 0)

/* ---- 6. Vista con columnas desconocidas ---- */
globalThis.__leerFiltrada = async () => []
globalThis.__leerVista = async () => [{ foo: 1, bar: 2 }]
let err = null
try {
  await consultarArticulos('aa')
} catch (e) {
  err = e
}
ok('avisa si la vista no tiene las columnas', !!err && /columnas esperadas/.test(err.message), String(err))

/* ---- 7. Complemento con el maestro de artículos ---- */
globalThis.__leerFiltrada = async () => []
globalThis.__leerVista = async () => [{ ID_ARTICULO: 'AA1', STOCK_MITO: 5 }]
globalThis.__supabase = {
  from: () => ({
    select: () => ({
      in: () => ({
        range: async () => ({
          error: null,
          data: [{ id_art: 'AA1', descripcion: 'Campera de denim', id_material: 'ALGODON', id_grupo: 'ROPA', precio_publico: 1234.5 }],
        }),
      }),
    }),
  }),
}
r = await consultarArticulos('aa')
ok('completa nombre del maestro', r.filas[0].nombre === 'Campera de denim', r.filas[0].nombre)
ok('completa material y grupo', r.filas[0].material === 'ALGODON' && r.filas[0].grupo === 'ROPA')
ok('stock del SQL no se pisa con el maestro', r.filas[0].stock === 5, String(r.filas[0].stock))
ok('precio del maestro', r.filas[0].precio === 1234.5, String(r.filas[0].precio))

/* ---- 8. Excel ---- */
const excel = filasParaExcel(r.filas)
ok('columnas del Excel', Object.keys(excel[0]).join('|') ===
  'ID artículo|Color|Talle|Nombre completo|Material|Grupo|Stock en MITO|Ubicación|Precio', Object.keys(excel[0]).join('|'))

console.log(fallos === 0 ? '\nTodo OK' : `\n${fallos} fallo(s)`)
process.exitCode = fallos === 0 ? 0 : 1
