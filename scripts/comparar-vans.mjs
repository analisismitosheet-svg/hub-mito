// Compara el precio de la web de Vans (vans.com.ar) con TUS artículos.
//
// El ID de Vans (ej. VN0A3TKN6BT1) es el mismo que usás en tus productos y es
// el que va en la URL https://www.vans.com.ar/Product/Detail/<ID>. El precio
// sale del JSON-LD (schema.org/Product) que trae la propia página.
//
// Uso:
//   node scripts/comparar-vans.mjs VN0A3TKN6BT1 VN0A36C3BM1 ...
//   node scripts/comparar-vans.mjs --desde "mi lista.xlsx"
//   node scripts/comparar-vans.mjs --desde lista.csv --col-id ARTICULO --col-precio PRECIO
//   node scripts/comparar-vans.mjs --ids vans-ids.txt --salida comparacion.xlsx
//
// El archivo de entrada puede ser .xlsx, .csv o .txt (un ID por línea). Si tiene
// una columna de precio (precio, price, venta, costo, publico…), se compara contra
// el precio de Vans y se calcula la diferencia. Si no, igual baja el precio de Vans.
//
// Opciones:
//   --desde <archivo>     Archivo con los IDs (+ precio opcional).
//   --ids <archivo>       Igual que --desde pero solo IDs (txt/csv).
//   --col-id <nombre>     Columna/encabezado con el ID (default: autodetecta).
//   --col-precio <nom>    Columna con TU precio (default: autodetecta).
//   --salida <archivo>    Excel de salida (default: comparar-vans.xlsx).
//   --concurrencia <n>    Pedidos en paralelo (default 4).
//   --pausa <ms>          Pausa entre pedidos por worker (default 150).
//   --json                Además del Excel, imprime la tabla por consola.
//   --sin-precio          No incluye (ni busca) tu precio: solo trae el de Vans.
//
// Requisitos: conexión a internet. No toca ninguna base ni el SQL.

import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, extname } from 'node:path'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(`${RAIZ}/package.json`)
const XLSX = require('xlsx')

const BASE = 'https://www.vans.com.ar/Product/Detail/'

/* ------------------------------ CLI ------------------------------ */

function parseArgs(argv) {
  const o = { ids: [], archivo: null, colId: null, colPrecio: null, salida: 'comparar-vans.xlsx', concurrencia: 4, pausa: 150, json: false, sinPrecio: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const val = () => argv[++i]
    if (a === '--desde' || a === '--ids') o.archivo = val()
    else if (a === '--col-id') o.colId = val()
    else if (a === '--col-precio') o.colPrecio = val()
    else if (a === '--salida') o.salida = val()
    else if (a === '--concurrencia') o.concurrencia = Math.max(1, Number(val()) || 4)
    else if (a === '--pausa') o.pausa = Math.max(0, Number(val()) || 0)
    else if (a === '--json') o.json = true
    else if (a === '--sin-precio') o.sinPrecio = true
    else if (a.startsWith('--')) { console.error(`Opción desconocida: ${a}`); process.exit(1) }
    else o.ids.push(a)
  }
  return o
}

/* --------------------------- Utilidades --------------------------- */

const norm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** "129000", "129.000,00", "$ 129.000" -> 129000 */
function num(v) {
  if (v === null || v === undefined) return null
  let s = String(v).replace(/\s/g, '').replace(/[^\d.,-]/g, '')
  if (!s || s === '-') return null
  const c = s.lastIndexOf(','), p = s.lastIndexOf('.')
  if (c > -1 && p > -1) s = c > p ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  else if (c > -1) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const COD_ALIAS = ['id', 'idarticulo', 'articulo', 'art', 'codigo', 'cod', 'sku', 'codigoarticulo', 'idvans', 'modelo']
const PRE_ALIAS = ['precio', 'precioventa', 'preciopublico', 'preciolista', 'pventa', 'venta', 'price', 'pvp', 'costo', 'neto', 'importe']

function elegirColumna(headers, alias, pedida) {
  if (pedida) {
    const exacta = headers.find((h) => norm(h) === norm(pedida))
    if (exacta) return exacta
    const parcial = headers.find((h) => norm(h).includes(norm(pedida)))
    return parcial || pedida
  }
  for (const a of alias) {
    const h = headers.find((x) => norm(x) === a)
    if (h) return h
  }
  for (const a of alias) {
    const h = headers.find((x) => norm(x).includes(a))
    if (h) return h
  }
  return null
}

/** Devuelve [{ id, precio }] desde texto o planilla. */
function leerEntrada(o) {
  // IDs sueltos por línea de comandos
  if (!o.archivo) {
    const ids = o.ids.map((s) => s.trim().toUpperCase()).filter(Boolean)
    if (!ids.length) {
      console.error('Falta la lista. Pasá IDs ("node scripts/comparar-vans.mjs VN0A... VN0B...") o --desde <archivo>.')
      process.exit(1)
    }
    return ids.map((id) => ({ id, precio: null }))
  }

  const ruta = resolve(process.cwd(), o.archivo)
  if (!existsSync(ruta)) { console.error(`No existe: ${ruta}`); process.exit(1) }
  const ext = extname(ruta).toLowerCase()

  if (ext === '.xlsx' || ext === '.xls' || ext === '.xlsm') {
    const wb = XLSX.readFile(ruta)
    const sh = wb.Sheets[wb.SheetNames[0]]
    const filas = XLSX.utils.sheet_to_json(sh, { defval: null })
    if (!filas.length) { console.error('La planilla está vacía.'); process.exit(1) }
    const headers = Object.keys(filas[0])
    const colId = elegirColumna(headers, COD_ALIAS, o.colId)
    const colPre = o.sinPrecio ? null : elegirColumna(headers, PRE_ALIAS, o.colPrecio)
    console.error(`Columna de ID    : ${colId}`)
    console.error(`Columna de precio: ${colPre ?? '(ninguna)'}`)
    return filas
      .map((f) => ({ id: String(f[colId] ?? '').trim().toUpperCase(), precio: colPre ? num(f[colPre]) : null }))
      .filter((r) => r.id)
  }

  // .csv / .txt
  const txt = readFileSync(ruta, 'utf8')
  const lineas = txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!lineas.length) { console.error('El archivo está vacío.'); process.exit(1) }
  const sep = ext === '.csv' || /[;,\t]/.test(lineas[0]) ? /[;,\t]/ : null
  const cols = sep ? lineas[0].split(sep).map((s) => s.trim()) : [lineas[0]]
  const esCabecera = cols.some((c) => aliasCoincide(c))
  if (esCabecera) {
    const colId = elegirColumna(cols, COD_ALIAS, o.colId)
    const colPre = o.sinPrecio ? null : elegirColumna(cols, PRE_ALIAS, o.colPrecio)
    const iId = cols.indexOf(colId)
    const iPre = colPre ? cols.indexOf(colPre) : -1
    return lineas.slice(1).map((l) => {
      const p = l.split(sep)
      return { id: String(p[iId] ?? '').trim().toUpperCase(), precio: iPre >= 0 ? num(p[iPre]) : null }
    }).filter((r) => r.id)
  }
  // sin cabecera: primera columna = id, segunda (si hay) = precio
  return lineas.map((l) => {
    const p = sep ? l.split(sep) : [l]
    return { id: String(p[0] ?? '').trim().toUpperCase(), precio: o.sinPrecio ? null : num(p[1]) }
  }).filter((r) => r.id)
}

const aliasCoincide = (c) => [...COD_ALIAS, ...PRE_ALIAS].includes(norm(c))

/* ------------------------- Scraping de Vans ------------------------- */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36'

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

/** Trae y parsea una ficha. Devuelve { id, ok, nombre, color, precio, disponible, imagen, error }. */
async function traerVans(id, intentos = 3) {
  const url = BASE + encodeURIComponent(id)
  for (let n = 1; n <= intentos; n++) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 20000)
      const r = await fetch(url, { headers: { 'accept-language': 'es-AR', 'user-agent': UA, accept: 'text/html' }, signal: ctrl.signal })
      clearTimeout(t)
      const html = await r.text()
      if (r.status !== 200) {
        if (r.status >= 500 && n < intentos) { await dormir(400 * n); continue }
        return { id, ok: false, error: `HTTP ${r.status}` }
      }
      const m = html.match(/<script\s+type=application\/ld\+json>(.*?)<\/script>/s)
      if (!m) return { id, ok: false, error: 'sin datos (producto inexistente)' }
      let j
      try { j = JSON.parse(m[1]) } catch { return { id, ok: false, error: 'JSON inválido' } }
      const off = Array.isArray(j.offers) ? j.offers[0] : j.offers || {}
      return {
        id,
        ok: true,
        sku: j.sku || id,
        nombre: (j.name || '').trim(),
        color: (j.color || '').trim(),
        precio: num(off.price),
        moneda: off.priceCurrency || 'ARS',
        disponible: /InStock/i.test(off.availability || ''),
        imagen: (Array.isArray(j.image) ? j.image[0] : j.image) || '',
        url,
      }
    } catch (e) {
      if (n < intentos) { await dormir(400 * n); continue }
      return { id, ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message }
    }
  }
  return { id, ok: false, error: 'sin respuesta' }
}

/** Corre en paralelo respetando el orden y una pausa entre pedidos por worker. */
async function enParalelo(items, n, pausa, fn) {
  const out = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const k = i++
      out[k] = await fn(items[k], k)
      if (pausa) await dormir(pausa)
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return out
}

/* ------------------------------ Main ------------------------------ */

const o = parseArgs(process.argv.slice(2))
const entrada = leerEntrada(o)

console.error(`\nVans · comparando ${entrada.length} artículo(s) …\n`)

let hechos = 0
const filas = await enParalelo(entrada, o.concurrencia, o.pausa, async (it) => {
  const r = await traerVans(it.id)
  hechos++
  process.stderr.write(`\r  ${hechos}/${entrada.length}`)
  const base = { ID: it.id, 'Precio Vans': r.precio ?? '', Moneda: r.precio != null ? r.moneda : '', Encontrado: r.ok ? 'Sí' : 'No', Nombre: r.nombre ?? '', Color: r.color ?? '', Disponible: r.ok ? (r.disponible ? 'Sí' : 'No') : '', Error: r.error ?? '', URL: BASE + it.id }
  if (it.precio != null && r.precio != null) {
    const dif = r.precio - it.precio
    base['Tu precio'] = it.precio
    base['Diferencia'] = dif
    base['Dif %'] = it.precio ? Number(((dif / it.precio) * 100).toFixed(2)) : ''
  } else {
    if (!o.sinPrecio) base['Tu precio'] = it.precio ?? ''
  }
  return base
})
process.stderr.write('\n\n')

// Achicar el Excel: omitir columnas que quedaron vacías en todas las filas
const orden = ['ID', 'Encontrado', 'Nombre', 'Color', 'Precio Vans', 'Moneda', 'Tu precio', 'Diferencia', 'Dif %', 'Disponible', 'Error', 'URL']
const cols = orden.filter((c) => filas.some((f) => f[c] !== '' && f[c] !== undefined && f[c] !== null))
const salida = filas.map((f) => Object.fromEntries(cols.map((c) => [c, f[c] ?? ''])))

const hoja = XLSX.utils.json_to_sheet(salida, { header: cols })
hoja['!cols'] = cols.map((c) => ({ wch: c === 'URL' ? 60 : c === 'Nombre' ? 42 : Math.max(10, c.length + 2) }))
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, hoja, 'Comparación')
const rutaSalida = resolve(process.cwd(), o.salida)
XLSX.writeFile(wb, rutaSalida)

const ok = salida.filter((f) => f.Encontrado === 'Sí').length
console.error(`Listo: ${ok}/${salida.length} encontrados en Vans.`)
console.error(`Excel: ${rutaSalida}\n`)

if (o.json) console.log(JSON.stringify(salida, null, 2))
