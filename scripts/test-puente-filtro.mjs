// Prueba del filtro del Puente SQL contra la vista de artículos.
//   node scripts/test-puente-filtro.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cfg = {}
for (const l of readFileSync(path.join(raiz, 'puente-sql', '.env'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) cfg[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const url = `http://localhost:${cfg.PUENTE_PORT || 3128}/`

async function puente(body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Puente-Token': cfg.PUENTE_TOKEN || '' },
    body: JSON.stringify(body),
  })
  return { status: r.status, texto: await r.text() }
}

const VISTA = 'DESKTOP-OA4GU6I:VISTAS_CONSOLIDADAS.dbo.vw_ARTICULOS_MITO'
const COLS_CLIENTE = ['ARTCOD', 'ID_ARTICULO', 'ARTICULO', 'NOMBRE_COMPLETO', 'DESCRIPCION', 'ARTDES', 'ARTDESADIC']

let pasa = 0
let falla = 0
function ok(cond, etiqueta, extra = '') {
  if (cond) {
    pasa++
    console.log(`  OK   ${etiqueta}`)
  } else {
    falla++
    console.log(`  FALLA ${etiqueta}${extra ? ' — ' + extra : ''}`)
  }
}

console.log('Filtro del Puente SQL sobre vw_ARTICULOS_MITO')

// 1. Columnas de un artículo exacto: solo ID_ARTICULO (las demás no existen en la vista)
{
  const { status, texto } = await puente({ vista: VISTA, top: 5, donde: 'ID_ARTICULO', valor: 'ZH060216' })
  const filas = JSON.parse(texto)
  ok(status === 200, 'ID_ARTICULO exacto responde 200', texto.slice(0, 160))
  ok(Array.isArray(filas) && filas.length > 0, 'trae filas para ZH060216')
  ok(
    filas.every((f) => String(f.ID_ARTICULO).trim() === 'ZH060216'),
    'todas las filas son del artículo pedido',
  )
}

// 2. La lista completa del cliente se acepta aunque la vista no tenga esas columnas
{
  const { status, texto } = await puente({
    vista: VISTA,
    top: 5,
    donde: COLS_CLIENTE.join(','),
    valor: 'ZIMITH',
    coincide: 'contiene',
  })
  const filas = JSON.parse(texto)
  ok(status === 200, 'lista completa del cliente (con columnas inexistentes) responde 200', texto.slice(0, 160))
  ok(Array.isArray(filas) && filas.length > 0, 'busca "contiene" y trae filas', texto.slice(0, 160))
  ok(
    filas.every((f) => String(f.ID_ARTICULO + ' ' + f.NOMBRE_COMPLETO).toUpperCase().includes('ZIMITH')),
    'las filas coinciden con el texto buscado',
  )
  ok(
    filas.every((f) => 'STOCK_MITO' in f && 'PRECIO' in f && 'COLOR' in f && 'TALLE' in f),
    'las filas traen las columnas que la pantalla usa',
  )
}

// 3. Sin coincidencia: array vacío, no error
{
  const { status, texto } = await puente({
    vista: VISTA,
    top: 5,
    donde: COLS_CLIENTE.join(','),
    valor: 'NOEXISTEZAAA99',
    coincide: 'contiene',
  })
  ok(status === 200 && JSON.parse(texto).length === 0, 'texto inexistente devuelve 0 filas sin error', texto.slice(0, 160))
}

// 4. 'coincide' ausente = igualdad exacta
{
  const { status, texto } = await puente({ vista: VISTA, top: 50, donde: COLS_CLIENTE.join(','), valor: 'ZIMITH' })
  const filas = JSON.parse(texto)
  ok(status === 200, 'sin coincide responde 200')
  ok(filas.every((f) => String(f.ID_ARTICULO + f.NOMBRE_COMPLETO).toUpperCase().includes('ZIMITH')),
    'sin coincide el match es exacto, no contiene')
}

// 5. Wildcards del usuario van escapados
{
  const { status, texto } = await puente({
    vista: VISTA,
    top: 5,
    donde: 'NOMBRE_COMPLETO',
    valor: '%',
    coincide: 'contiene',
  })
  ok(status === 200 && JSON.parse(texto).length === 0, 'el % del usuario no se interpreta como comodín', texto.slice(0, 160))
}

// 6. Seguridad: columna fuera de la lista blanca
{
  const { status } = await puente({ vista: VISTA, top: 5, donde: 'NOMBRE_COMPLETO; DROP TABLE x--', valor: 'a' })
  ok(status === 400, 'columna fuera de la lista blanca se rechaza con 400', String(status))
}

// 7. Seguridad: sin token
{
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"vista":"x","top":1}' })
  ok(r.status === 401, 'sin X-Puente-Token responde 401', String(r.status))
}

console.log(`\n${pasa} OK / ${falla} fallas`)
process.exitCode = falla ? 1 : 0