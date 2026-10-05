/**
 * Verifica que sql/recepcion_indo_proveedores.sql sea reversible: desarma los VALUES,
 * desescapa las comillas y los compara contra la vista real del SQL Server.
 *
 *   node scripts/sql.mjs --json "SELECT Codigo, LTRIM(RTRIM(Codigo)) AS cod, LTRIM(RTRIM(Nombre)) AS nombre FROM DRAGONFISH_INDOD.dbo.PROVEEDORES_INDO" > prov_indo.json
 *   node scripts/verificar-seed-proveedores.mjs prov_indo.json
 */
import { readFileSync } from 'node:fs'

const entrada = process.argv[2] ?? 'prov_indo.json'
const semilla = process.argv[3] ?? 'sql/recepcion_indo_proveedores.sql'

const leer = (ruta) => {
  const buf = readFileSync(ruta)
  return buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le').replace(/^﻿/, '') : buf.toString('utf8')
}

const vista = JSON.parse(leer(entrada))[0]
  .map((r) => ({ codigo: String(r.cod ?? '').trim(), nombre: String(r.nombre ?? '').trim() }))
  .filter((r) => r.codigo && r.nombre)

const sql = leer(semilla)
const LINEA = /^ {2}\('((?:[^']|'')*)', '((?:[^']|'')*)'\),?$/gm
const filas = [...sql.matchAll(LINEA)].map((m) => ({
  codigo: m[1].replace(/''/g, "'"),
  nombre: m[2].replace(/''/g, "'"),
}))

const conApostrofe = filas.filter((f) => f.nombre.includes("'")).length
const porCodigo = new Map(vista.map((v) => [v.codigo, v.nombre]))
let malas = 0
for (const f of filas) {
  const real = porCodigo.get(f.codigo)
  if (real !== f.nombre) {
    if (malas < 5) console.log('  MISMATCH', JSON.stringify(f), '->', JSON.stringify(real))
    malas++
  }
}

const sinComaFinal = /,\s*\nON CONFLICT/.test(sql)
console.log(`  valores en el seed: ${filas.length}  (vista: ${vista.length})`)
console.log(`  nombres con apóstrofe escapado: ${conApostrofe}`)
console.log(`  la última fila lleva coma antes del ON CONFLICT: ${sinComaFinal}`)
console.log(`  termina en COMMIT;: ${sql.trim().endsWith('COMMIT;')}`)
console.log(`  proveedores que no coinciden con la vista: ${malas}`)
console.log(malas === 0 && filas.length === vista.length && !sinComaFinal ? '  TODO OK' : '  FALLA')