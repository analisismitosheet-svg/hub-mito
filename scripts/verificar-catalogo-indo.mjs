/**
 * Compara el catálogo de proveedores REAL de Postgres contra la vista real del SQL Server.
 *
 *   node scripts/verificar-catalogo-indo.mjs
 *
 * Antes comparaba el .sql del seed contra la vista. Esto es más fuerte: interpola lo que
 * quedó realmente en la tabla recepcion_indo_proveedores, así también detecta filas que
 * el INSERT no entró (truncadas, duplicadas, con comillas mal escapadas).
 *
 * Necesita SUPABASE_ACCESS_TOKEN en .env.local (Management API) y el puente SQL.
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VISTA = 'DRAGONFISH_INDOD.dbo.PROVEEDORES_INDO'

const env = {}
for (const archivo of ['.env.local', '.env']) {
  const ruta = `${RAIZ}/${archivo}`
  if (!existsSync(ruta)) continue
  for (const linea of readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([^#=\s][^=]*)=(.*)$/)
    if (m) env[m[1].trim()] ??= m[2].trim().replace(/^["']|["']$/g, '')
  }
}
const token = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN
const proyecto = env.SUPABASE_PROJECT || env.VITE_SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\./)?.[1]
if (!token) {
  console.error('Falta SUPABASE_ACCESS_TOKEN en .env.local')
  process.exit(1)
}

/* --- 1. La vista del SQL Server --- */
const consulta = `SELECT LTRIM(RTRIM(Codigo)) AS codigo, LTRIM(RTRIM(Nombre)) AS nombre FROM ${VISTA}`
const crudo = spawnSync(process.execPath, [`${RAIZ}/scripts/sql.mjs`, '--json', consulta], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
if (crudo.status !== 0) {
  console.error('Falló la consulta al SQL Server:', (crudo.stderr || crudo.stdout).slice(0, 600))
  process.exit(1)
}
// sql.mjs --json envuelve el recordset en un array más: [[{...}, {...}]]
const plano = JSON.parse(crudo.stdout)
const filasVista = (Array.isArray(plano) && Array.isArray(plano[0]) ? plano.flat() : plano)
  .filter((r) => r && typeof r === 'object')
const vista = filasVista
  .map((r) => ({ codigo: String(r.codigo ?? '').trim(), nombre: String(r.nombre ?? '').trim() }))
  .filter((r) => r.codigo && r.nombre)

/* --- 2. La tabla de Postgres --- */
const r = await fetch(`https://api.supabase.com/v1/projects/${proyecto}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: `SELECT codigo, nombre FROM public.recepcion_indo_proveedores ORDER BY codigo`,
  }),
})
if (!r.ok) {
  console.error('Falló la consulta a Postgres:', (await r.text()).slice(0, 600))
  process.exit(1)
}
const tabla = (await r.json()).map((x) => ({ codigo: String(x.codigo), nombre: String(x.nombre) }))

/* --- 3. Comparación --- */
const porCodigo = new Map(vista.map((v) => [v.codigo, v.nombre]))
const nombres = new Set(tabla.map((t) => t.nombre))
const conApostrofe = tabla.filter((t) => t.nombre.includes("'")).length
const conComa = tabla.filter((t) => t.nombre.includes(',')).length

const faltantes = vista.filter((v) => !tabla.some((t) => t.codigo === v.codigo))
const sobras = tabla.filter((t) => !porCodigo.has(t.codigo))
const distintas = tabla.filter((t) => porCodigo.get(t.codigo) !== t.nombre)

console.log(`  vista ${VISTA}          : ${vista.length} proveedores utilizables`)
console.log(`  tabla Postgres          : ${tabla.length} filas, ${nombres.size} nombres distintos`)
console.log(`  códigos repetidos       : ${tabla.length - new Set(tabla.map((t) => t.codigo)).size}`)
console.log(`  nombres con apóstrofe   : ${conApostrofe}   con coma: ${conComa}`)
console.log(`  en la vista, no en la tabla: ${faltantes.length}`)
console.log(`  en la tabla, no en la vista: ${sobras.length}`)
console.log(`  mismo código, otro nombre: ${distintas.length}`)
for (const d of distintas.slice(0, 5)) {
  console.log(`    ${d.codigo}: tabla="${d.nombre}"  vista="${porCodigo.get(d.codigo)}"`)
}

const ok = faltantes.length === 0 && sobras.length === 0 && distintas.length === 0
  && tabla.length === new Set(tabla.map((t) => t.codigo)).size
console.log(ok ? '  TODO OK: la tabla coincide con la vista' : '  FALLA')
process.exit(ok ? 0 : 1)
