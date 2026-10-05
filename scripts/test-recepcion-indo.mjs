/**
 * Prueba rápida de src/lib/recepcionIndo.ts: el casteo de las columnas sucias del
 * Excel "Recepción de Mercadería" (seriales de Excel, links de Drive, "----",
 * "22/09/0226", el estado sin nombre "Columna 17") y la clave natural del upsert.
 * No toca la red ni la base.
 *
 *   node scripts/test-recepcion-indo.mjs
 *   node scripts/test-recepcion-indo.mjs "Recepcion Indo.xlsx"   # además contra el archivo real
 */
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

const dir = mkdtempSync(join(tmpdir(), 'recepcion-indo-'))
const salida = join(dir, 'lib.mjs')
await build({
  entryPoints: ['src/lib/recepcionIndo.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: salida,
  logLevel: 'warning',
})

const lib = await import(pathToFileURL(salida).href)
const { leerRecepcionIndo, resolverIndices, normalizar, aFecha, aNumero, aBooleano, claveRecepcion } = lib

let fallos = 0
function ok(nombre, cond, extra = '') {
  if (cond) console.log(`  ok   ${nombre}`)
  else {
    console.error(`  FALLA ${nombre} ${extra}`)
    fallos++
  }
}

/* ---- 1. Casteos tolerantes ---- */
ok('serial de Excel -> fecha', aFecha(46294) === '2026-09-29', String(aFecha(46294)))
ok('serial 25569 = 1970-01-01', aFecha(25569) === '1970-01-01', String(aFecha(25569)))
ok('fecha como texto dd/mm/aaaa', aFecha('05/10/2026') === '2026-10-05', String(aFecha('05/10/2026')))
ok('año de 4 dígitos raro', aFecha('22/09/0226') === '2026-09-22', String(aFecha('22/09/0226')))
ok('texto ---- no es fecha', aFecha('----') === null, String(aFecha('----')))
ok('"SIN REMITO" no es fecha', aFecha('SIN REMITO') === null)
ok('link de Drive no es fecha', aFecha('https://drive.google.com/file/d/1UBX643/view') === null)
ok('vacío y null dan null', aFecha('') === null && aFecha(null) === null && aFecha(undefined) === null)
ok('número en texto', aNumero('3') === 3 && aNumero(7.5) === 7.5)
ok('número no numérico da null', aNumero('consignacion') === null, String(aNumero('consignacion')))
ok('IVA con separador de miles', aNumero('24.199.070') === 24199070, String(aNumero('24.199.070')))
ok('booleanos del Excel', aBooleano(false) === false && aBooleano(true) === true && aBooleano('SI') === true && aBooleano('') === false)
ok('normaliza ° y acentos', normalizar('N° de Guía ') === 'N DE GUIA', normalizar('N° de Guía '))

/* ---- 2. Encabezados: no se pisan "N° de factura" y "Fecha de factura" ---- */
const CAB = [
  'N de Guia', 'Transporte', 'Bultos', 'Deposito', 'Proveedor', 'N° Remito', 'Fecha del remito', 'Mes',
  'N° OC', 'OC Cargada en Dragon', 'N° de factura', 'Fecha de factura', 'Factura', 'Fecha de ingreso',
  'Fecha de controlada', 'Días de atraso control', 'Columna 17', 'IVA $', 'Detalle',
]
const idx = resolverIndices(CAB)
ok('N° de factura -> 10', idx.nFactura === 10, String(idx.nFactura))
ok('Fecha de factura -> 11', idx.fechaFactura === 11, String(idx.fechaFactura))
ok('Factura (link) -> 12', idx.facturaLink === 12, String(idx.facturaLink))
ok('N° OC -> 8', idx.nOc === 8, String(idx.nOc))
ok('estado sin nombre -> 16 ("Columna 17")', idx.estado === 16, String(idx.estado))
ok('N° OC con varias -> texto entero', idx.nOc === 8)
ok('Bultos -> 2', idx.bultos === 2, String(idx.bultos))
ok('Días de atraso control NO se toma como estado', idx.estado !== 15)

/* ---- 3. Lectura de una hoja hecha a mano ---- */
const HOJA = [
  CAB,
  ['44-41856', 'lancioni', 3, 'Indo', 'RACE IN SRL', '12-28811', 46294, 9, 15281, false, '3-25579', 46294, null, 46300, null, 0, 'En deposito', 640316.88, null],
  // link de Drive en la columna Factura, fecha de controlada y atraso reales
  ['32-145563', 'lancioni', 6, 'Indo', 'GUILUTO SA', '13463', 45524, 8, 8886, false, '11-967', null, 'https://drive.google.com/file/d/1UBX643/view', 45526, 45539, 13, 'Cargado en Flexxus', null, null],
  // varias OC en una fila
  ['88-5358', 'ag', 14, 'Indo', 'TARCO S.A.', '1-328238', 46283, 9, '15183/15347/15329', false, '48-46517', 46283, null, null, null, null, 'Cargado en Flexxus', 4942733.61, null],
  // fila con formato pero vacía
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
  // celdas sucias: fecha de remito como texto, factura "----", sin bultos
  ['7-1', 'bull', null, 'Mito', 'ELORDI S.A.', '1-1', '22/09/0226', 9, null, false, null, '----', null, '05/10/2026', '05/10/2026', 0, 'En deposito', null, 'para devolver'],
  // sin un solo comprobante: se descarta y se cuenta
  [null, null, null, 'Indo', 'PROVEEDOR SUELTO', null, null, null, null, false, null, null, null, null, null, null, 'En deposito', null, null],
  // repetida con la misma clave natural
  ['44-41856', 'lancioni', 3, 'Indo', 'RACE IN SRL', '12-28811', 46294, 9, 15281, false, '3-25579', 46294, null, 46300, null, 0, 'En deposito', 640316.88, null],
]
const r = leerRecepcionIndo(HOJA)
ok('encabeza en la fila 0', r.filaEncabezado === 0, String(r.filaEncabezado))
ok('trae 4 filas (descarta la vacía, la suelta y la repetida)', r.filas.length === 4, String(r.filas.length))
ok('cuenta la fila sin comprobante', r.descartadas === 1, String(r.descartadas))
ok('cuenta la duplicada', r.duplicadas === 1, String(r.duplicadas))
ok('avisa de las celdas que no son fecha', r.fechasCero === 1, String(r.fechasCero))
ok('sin columnas faltantes', r.faltantes.length === 0, JSON.stringify(r.faltantes))

const [f1, f2, f3, f4] = r.filas
ok('guía + bultos + depósito', f1.nGuia === '44-41856' && f1.bultos === 3 && f1.deposito === 'Indo')
ok('remito y OC numérica', f1.nRemito === '12-28811' && f1.nOc === '15281')
ok('fecha de ingreso y de controlada', f1.fechaIngreso === '2026-10-05' && f1.fechaControlada === null, `${f1.fechaIngreso} / ${f1.fechaControlada}`)
ok('estado e IVA', f1.estado === 'En deposito' && f1.iva === 640316.88)
ok('link de Drive en Factura', f2.facturaLink === 'https://drive.google.com/file/d/1UBX643/view', String(f2.facturaLink))
ok('fechas del 2024 (45539 - 45526 = 13 días)', f2.fechaControlada === '2024-09-04' && f2.fechaIngreso === '2024-08-22', `${f2.fechaIngreso} -> ${f2.fechaControlada}`)
ok('estado "Cargado en Flexxus"', f2.estado === 'Cargado en Flexxus')
ok('OC multiple queda como texto', f3.nOc === '15183/15347/15329', f3.nOc)
ok('fecha de remito "22/09/0226" -> 2026-09-22', f4.fechaRemito === '2026-09-22', String(f4.fechaRemito))
ok('bultos vacío -> 0', f4.bultos === 0)
ok('factura "----" -> null', f4.nFactura === '' && f4.fechaFactura === null)
ok('detalle con espacios', f4.detalle === 'para devolver', f4.detalle)
ok('sin link de factura', f1.facturaLink === null)

/* ---- 4. La clave natural no cambia al reimportar el mismo Excel ---- */
const misma = { ...f1, estado: 'Cargado en Flexxus', iva: 1, detalle: 'otra cosa', fechaControlada: '2026-10-04' }
ok('la clave ignora estado/IVA/detalle/control', claveRecepcion(misma) === f1.clave, `${claveRecepcion(misma)} vs ${f1.clave}`)
ok('la clave cambia si cambia la guía', claveRecepcion({ ...f1, nGuia: '44-41857' }) !== f1.clave)
ok('la clave cambia si cambia el depósito', claveRecepcion({ ...f1, deposito: 'Mito' }) !== f1.clave)
ok('todas las claves del lote son distintas', new Set(r.filas.map((x) => x.clave)).size === r.filas.length)

/* ---- 5. Encabezados con tildes, minúsculas y columnas de más ---- */
const r2 = leerRecepcionIndo([
  ['Recepción de Mercadería', null, null],
  ['n° de GUÍA', 'TRANSPORTE ', 'bultos', 'Depósito', 'proveedor', 'N° remito', 'fecha del remito', 'mes', 'N° OC', 'OC cargada en dragon', 'n° de factura', 'fecha de factura', 'factura', 'fecha de ingreso', 'fecha de controlada', 'días de atraso control', 'Columna 17', 'IVA $', 'detalle', 'columna de más'],
  ['1-1', 'bull', 2, 'Indo', 'X S.A.', '9', 46294, 9, 1, false, '2-2', 46294, null, 46294, 46294, 0, 'En deposito', 10, null, 'ignorar'],
])
ok('encabeza en la fila 1 (hay un título antes)', r2.filaEncabezado === 1, String(r2.filaEncabezado))
ok('lee la fila aunque el encabezado tenga tildes y minúsculas', r2.filas.length === 1 && r2.filas[0].proveedor === 'X S.A.', JSON.stringify(r2.filas))
ok('ignora la columna de más', r2.filas[0].nGuia === '1-1')

/* ---- 6. Sin encabezados: error claro ---- */
let fallo = ''
try {
  leerRecepcionIndo([['a', 'b'], ['c', 'd']])
} catch (e) {
  fallo = e instanceof Error ? e.message : String(e)
}
ok('avisa si el Excel no tiene los encabezados', /encabezados/i.test(fallo), fallo)

/* ---- 7. Contra el archivo real (opcional) ---- */
const archivo = process.argv[2] ?? 'Recepcion Indo.xlsx'
if (existsSync(archivo)) {
  const XLSX = (await import('xlsx')).default
  const wb = XLSX.readFile(archivo)
  const hoja = wb.SheetNames.find((n) => normalizar(n).includes('RECEPCION DE MERCADERIA')) ?? wb.SheetNames[0]
  const filas = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { header: 1, raw: true, defval: null, blankrows: false })
  const rr = leerRecepcionIndo(filas)
  console.log(`\n  ${archivo} · hoja "${hoja}"`)
  ok('el archivo real se lee entero', rr.filas.length > 1000, String(rr.filas.length))
  ok('sin columnas faltantes en el archivo real', rr.faltantes.length === 0, JSON.stringify(rr.faltantes))
  ok('claves únicas en el archivo real', new Set(rr.filas.map((x) => x.clave)).size === rr.filas.length)

  const sinControl = rr.filas.filter((x) => !x.fechaControlada)
  const bultosSinControl = sinControl.reduce((s, x) => s + x.bultos, 0)
  const ocDistintas = new Set(sinControl.filter((x) => x.nOc !== '').map((x) => x.nOc)).size
  const conAtraso = rr.filas.filter((x) => x.fechaControlada && x.fechaIngreso)
  const atrasoProm =
    conAtraso.reduce((s, x) => s + diasEntre(x.fechaIngreso, x.fechaControlada), 0) / (conAtraso.length || 1)
  // El Excel calcula "OC sin controlar" = COUNTIFS(N°OC;">0"; fechaControlada;""), o sea
  // solo las pendientes cuya OC es un NÚMERO mayor que cero. De las 97 pendientes:
  // 75 tienen OC numérica, 9 la tienen como texto ("15172/15173", "----") y 13 no
  // tienen OC. El módulo cuenta las 97: una recepción sin OC también está sin controlar.
  const conOc = sinControl.filter((x) => x.nOc !== '').length
  const ocNumerica = sinControl.filter((x) => Number(x.nOc) > 0 && String(x.nOc) === String(Number(x.nOc))).length
  console.log(`\n  KPIs que calcula el módulo (el atraso promedia solo las controladas):`)
  console.log(`    bultos sin controlar ........ ${bultosSinControl}   (el Excel: 1534)`)
  console.log(`    recepciones sin controlar .... ${sinControl.length}  ·  con OC: ${conOc}  ·  con OC numérica: ${ocNumerica} (el Excel: 75)`)
  console.log(`    OC distintas pendientes ...... ${ocDistintas}`)
  console.log(`    atraso promedio .............. ${atrasoProm.toFixed(2)} días   (el Excel: 9,04, que suma además las no controladas por "hoy - ingreso")`)
  ok('bultos sin controlar = 1534 (como el Excel)', bultosSinControl === 1534, String(bultosSinControl))
  ok('las pendientes con OC numérica son las 75 del Excel', ocNumerica === 75, String(ocNumerica))
  ok('las pendientes con OC (texto o número) son 84', conOc === 84, String(conOc))
} else {
  console.log(`\n  (no está "${archivo}": se salteó la prueba contra el archivo real)`)
}

function diasEntre(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)
}

console.log(fallos ? `\n${fallos} prueba(s) fallaron` : '\nTodo ok')
process.exit(fallos ? 1 : 0)
