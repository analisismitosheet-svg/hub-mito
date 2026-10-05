// Corre un .sql contra la base por la Management API de Supabase.
// No necesita service_role ni node-postgres: usa un personal access token.
//
//   node scripts/supabase-sql.mjs                       (lista los proyectos)
//   node scripts/supabase-sql.mjs <proyecto> archivo.sql
//   node scripts/supabase-sql.mjs <proyecto> archivo.sql --dry-run
//   node scripts/supabase-sql.mjs <proyecto> archivo.sql --raw   (una sola llamada, sin trocear)
//   node scripts/supabase-sql.mjs <proyecto> -c "SELECT 1"
//
// Una sentencia por llamada. La API devuelve solo el último resultset, así que el
// archivo va troceado: además de verse cada resultado, si algo falla te dice el número
// y el texto exacto de la sentencia culpable, que es lo que el SQL Editor no muestra
// cuando todo va dentro de un BEGIN.
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, basename } from 'node:path'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function leerEnv(ruta) {
  if (!existsSync(ruta)) return {}
  const out = {}
  for (const linea of readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([^#=\s][^=]*)=(.*)$/)
    if (m) out[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

/**
 * Parte el .sql en sentencias respetando cadenas y cuerpos $$...$$.
 * Un split ingenuo por ';' cortaría los CREATE FUNCTION por la mitad, que es
 * exactamente lo que no hay que hacer.
 */
export function partirSentencias(sql) {
  const out = []
  let actual = ''
  let i = 0
  let dollar = null      // etiqueta del $...$ abierto, si hay
  let enComilla = false   // '...'
  while (i < sql.length) {
    const c = sql[i]
    const dos = sql.slice(i, i + 2)
    if (!enComilla && !dollar && dos === '--') {                 // comentario de línea
      const fin = sql.indexOf('\n', i)
      i = fin === -1 ? sql.length : fin
      actual += ' '
      continue
    }
    if (!enComilla && !dollar && dos === '/*') {                 // comentario de bloque
      const fin = sql.indexOf('*/', i)
      i = fin === -1 ? sql.length : fin + 2
      actual += ' '
      continue
    }
    if (!dollar && c === "'") {                                  // cadena: '' escapa
      if (enComilla && dos === "''") { actual += "''"; i += 2; continue }
      enComilla = !enComilla
      actual += c; i++
      continue
    }
    if (!enComilla && c === '$') {                               // possible $tag$
      const m = sql.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)
      if (m) {
        if (!dollar) { dollar = m[0]; actual += m[0]; i += m[0].length; continue }
        if (m[0] === dollar) { dollar = null; actual += m[0]; i += m[0].length; continue }
      }
    }
    if (c === ';' && !enComilla && !dollar) {                    // fin de sentencia
      if (actual.trim()) out.push(actual.trim())
      actual = ''
      i++
      continue
    }
    actual += c
    i++
  }
  if (actual.trim()) out.push(actual.trim())
  return out
}

const etiqueta = (sql) => {
  const limpio = sql.replace(/^\s*(--[^\n]*\n|\s)+/, '')
  return (limpio.split('\n')[0] || '').trim().slice(0, 92)
}

const local = leerEnv(`${RAIZ}/.env.local`)
const base = leerEnv(`${RAIZ}/.env`)
const token = process.env.SUPABASE_ACCESS_TOKEN || local.SUPABASE_ACCESS_TOKEN
const proyecto = process.argv[2] || local.SUPABASE_PROJECT || base.VITE_SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\./)?.[1]

if (!token) {
  console.error(`Falta SUPABASE_ACCESS_TOKEN.
  Ponela en ${RAIZ}\\.env.local  ->  SUPABASE_ACCESS_TOKEN=sbp_...
  Se crea en https://supabase.com/dashboard/account/tokens`)
  process.exit(1)
}

async function api(ruta, cuerpo) {
  const r = await fetch(`https://api.supabase.com/v1${ruta}`, {
    method: cuerpo ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  })
  const texto = await r.text()
  let datos
  try { datos = JSON.parse(texto) } catch { datos = texto }
  if (!r.ok) {
    const msg = datos?.message || datos?.error || datos?.hint || texto
    throw new Error(`HTTP ${r.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`)
  }
  return datos
}

if (!process.argv[3]) {
  console.log(await api('/projects'))
  console.log('\nPara ejecutar SQL: node scripts/supabase-sql.mjs <proyecto> <archivo.sql>')
  process.exit(0)
}

const archivo = resolve(process.cwd(), process.argv[3])
const inline = process.argv[3] === '-c' ? process.argv.slice(4).join(' ') : null
if (!inline && !existsSync(archivo)) {
  console.error(`No existe: ${archivo}`)
  process.exit(1)
}
const seco = process.argv.includes('--dry-run')
const crudo = process.argv.includes('--raw')
const sql = inline ?? readFileSync(archivo, 'utf8')

// --raw manda el archivo entero en una sola llamada: necesario para BEGIN/ROLLBACK,
// porque cada llamada va en su propia transaccion y el ROLLBACK no podria deshacerlas.
if (crudo) {
  if (seco) {
    console.log(partirSentencias(sql).map((s, i) => `  ${String(i + 1).padStart(3)}. ${etiqueta(s)}`).join('\n'))
    process.exit(0)
  }
  const r = await api(`/projects/${proyecto}/database/query`, { query: sql })
  console.log(JSON.stringify(r, null, 2))
  process.exit(0)
}

const sentencias = partirSentencias(sql)

console.log(`Proyecto: ${proyecto}`)
console.log(`Origen  : ${inline ? 'inline' : basename(archivo)}  (${sentencias.length} sentencias, ${(Buffer.byteLength(sql, 'utf8') / 1024).toFixed(1)} KB)`)

if (seco) {
  sentencias.forEach((s, i) => console.log(`  ${String(i + 1).padStart(3)}. ${etiqueta(s)}`))
  process.exit(0)
}

const conFilas = (r) => Array.isArray(r) && r.length > 0
let hechas = 0
for (const [i, s] of sentencias.entries()) {
  const n = i + 1
  try {
    const r = await api(`/projects/${proyecto}/database/query`, { query: s })
    hechas++
    const filas = conFilas(r) ? r.length : 0
    console.log(`  ${String(n).padStart(3)}. ok    ${etiqueta(s)}${filas ? `   [${filas} fila(s)]` : ''}`)
    if (filas) console.log(`       ${JSON.stringify(r).slice(0, 1200)}`)
  } catch (e) {
    console.error(`\n  ${String(n).padStart(3)}. FALLA ${etiqueta(s)}`)
    console.error(`\n--- sentencia ${n} de ${sentencias.length} (${hechas} aplicada/s antes) ---`)
    console.error(s)
    console.error('---')
    console.error(`\n${String(e.message).slice(0, 1200)}`)
    process.exit(1)
  }
}
console.log(`\n${hechas}/${sentencias.length} sentencias OK`)
