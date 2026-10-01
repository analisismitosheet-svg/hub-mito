/**
 * Prueba end-to-end del módulo F12: filas REALES de ZooLogic.vw_ARTICULOS_MITO
 * (sacadas del Puente SQL local) recorridas por src/lib/articulosConsulta.ts,
 * para comprobar que la pantalla recibe los 7 campos ya resueltos.
 *
 * Necesita el Puente SQL levantado en la PC central (localhost:3128).
 *
 *   node scripts/test-consulta-articulos-sql.mjs
 */
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const raiz = process.cwd()

/* ---------------------------------------------------------------- */
/* 1. Filas reales del Puente SQL                                  */
/* ---------------------------------------------------------------- */
const cfg = {}
for (const l of readFileSync(join(raiz, 'puente-sql', '.env'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) cfg[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const puenteUrl = `http://localhost:${cfg.PUENTE_PORT || 3128}/`

async function puente(body) {
  const r = await fetch(puenteUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Puente-Token': cfg.PUENTE_TOKEN || '' },
    body: JSON.stringify(body),
  })
  const texto = await r.text()
  if (!r.ok) throw new Error(`Puente ${r.status}: ${texto.slice(0, 200)}`)
  return JSON.parse(texto)
}

const VISTA = 'DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_ARTICULOS_MITO'
console.log(`Trayendo filas reales de ${VISTA}…`)
const crudas = await puente({
  vista: VISTA,
  top: 40,
  donde: 'ID_ARTICULO,NOMBRE_COMPLETO',
  valor: 'ZH0602',
  coincide: 'contiene',
})
if (!Array.isArray(crudas) || crudas.length === 0) {
  console.error('El Puente SQL no devolvió filas. ¿Está el puente en localhost:3128?')
  process.exit(1)
}
console.log(`  ${crudas.length} filas crudas\n`)

/* ---------------------------------------------------------------- */
/* 2. La lib de la pantalla, compilada con stubs                    */
/* ---------------------------------------------------------------- */
const dir = mkdtempSync(join(tmpdir(), 'consulta-art-sql-'))
const stub = (nombre, contenido) => {
  const p = join(dir, `${nombre}.mjs`)
  writeFileSync(p, contenido)
  return p
}

const alias = {
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
    export const COLUMNAS_BUSQUEDA = ['ARTCOD','ID_ARTICULO','ARTICULO','NOMBRE_COMPLETO','DESCRIPCION','ARTDES','ARTDESADIC']
    export const leerVista = (...a) => globalThis.__leerVista(...a)
    export const leerVistaFiltrada = (...a) => globalThis.__leerFiltrada(...a)
  `),
  '@/lib/mapeo': stub('mapeo', `
    export const claveSku = (c, co = '', t = '') =>
      [c, co, t].map((v) => String(v ?? '').trim().toUpperCase()).join('|')
    export const compararUbicaciones = (a, b) => a.localeCompare(b, undefined, { numeric: true })
    export const ubicacionesSkuDeArticulos = async () => new Map()
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

globalThis.__supabase = { from: () => ({ select: () => ({ in: () => ({ range: async () => ({ data: [], error: null }) }) }) }) }
globalThis.__leerVista = async () => crudas
globalThis.__leerFiltrada = async () => crudas

const { consultarArticulos, filasParaExcel } = await import(pathToFileURL(salida).href)

/* ---------------------------------------------------------------- */
/* 3. Aserciones sobre lo que ve la pantalla                       */
/* ---------------------------------------------------------------- */
let fallos = 0
function ok(nombre, cond, extra = '') {
  if (cond) console.log(`  ok   ${nombre}`)
  else {
    console.error(`  FALLA ${nombre} ${extra}`)
    fallos++
  }
}

// Sin término la pantalla no pide nada: solo muestra lo que se escribe (commit 668098b)
ok('sin término no trae filas', (await consultarArticulos('')).filas.length === 0)
ok('con 1 carácter no trae filas', (await consultarArticulos('Z')).filas.length === 0)

const res = await consultarArticulos('ZH0602')
ok('devuelve filas', res.filas.length > 0, `(${res.filas.length})`)
ok('sin aviso de filtrado en cliente (el puente filtra)', !res.filtradoEnCliente)

const f = res.filas[0]
ok('idArticulo viene del SQL', /^[A-Z0-9]{2,15}$/i.test(f.idArticulo), f.idArticulo)
ok('nombre viene del SQL (no queda vacío)', f.nombre.length > 0, JSON.stringify(f.nombre))
ok('material viene del SQL', f.material.length > 0, f.material)
ok('grupo viene del SQL', f.grupo.length > 0, f.grupo)
ok('color viene del SQL', f.color.length > 0, f.color)
ok('talle viene del SQL', f.talle.length > 0, f.talle)
ok('stock es número (no null)', typeof f.stock === 'number', String(f.stock))
ok('precio es número (no null)', typeof f.precio === 'number', String(f.precio))

// El código del artículo de la primera fila tiene que estar en las filas crudas
ok(
  'idArticulo corresponde a una fila real',
  crudas.some((c) => String(c.ID_ARTICULO).trim() === f.idArticulo),
  f.idArticulo,
)
// La fila ya viene filtrada por ZH0602 desde el SQL
ok('el SQL aplicó el filtro del código', res.filas.every((a) => a.idArticulo.startsWith('ZH0602')))

// SEARCH por descripción: mismo camino, pero buscando texto
globalThis.__leerVista = async () => crudas
globalThis.__leerFiltrada = async () => {
  const v = 'ZIMITH'
  return crudas.filter((c) => String(c.NOMBRE_COMPLETO).toUpperCase().includes(v))
}
const porTexto = await consultarArticulos('ZIMITH')
ok('buscar por descripción trae filas', porTexto.filas.length > 0, `(${porTexto.filas.length})`)
ok('buscar por descripción respeta el texto', porTexto.filas.every((a) => a.nombre.toUpperCase().includes('ZIMITH')))

// Excel
const excel = filasParaExcel(res.filas)
ok('el Excel trae una fila por SKU', excel.length === res.filas.length, `${excel.length} vs ${res.filas.length}`)
const CAMPOS = [
  'ID artículo', 'Color', 'Talle', 'Nombre completo', 'Material',
  'Grupo', 'Stock en MITO', 'Ubicación', 'Precio',
]
ok(
  'el Excel trae las columnas de la pantalla',
  CAMPOS.every((c, i) => excel.every((fila) => Object.keys(fila)[i] === c)),
  JSON.stringify(Object.keys(excel[0])),
)

console.log(`\n${fallos ? `${fallos} fallas` : 'Todo OK'}`)
console.log('\nEjemplo de fila para la pantalla:')
console.log(f)
process.exitCode = fallos ? 1 : 0