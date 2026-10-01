// Consulta directa al SQL Server de MITO con las credenciales de puente-sql/.env.
// A diferencia del puente (que solo hace SELECT TOP), acá se puede correr
// cualquier SQL: sirve para explorar y para crear la vista.
//
//   node scripts/sql.mjs "SELECT TOP 5 * FROM ZooLogic.vw_PRODUCTOS_WEB"
//   node scripts/sql.mjs --json "SELECT ..."          (salida JSON)
//   node scripts/sql.mjs -f sql/archivo.sql           (desde un archivo)
//   node scripts/sql.mjs -i                          (interactivo: SQL por línea)
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import readline from 'node:readline'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// mssql vive en puente-sql/node_modules (el puente lo usa, el hub no)
const require = createRequire(path.join(raiz, 'puente-sql', 'package.json'))

const cfg = {}
for (const linea of readFileSync(path.join(raiz, 'puente-sql', '.env'), 'utf8').split(/\r?\n/)) {
  const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) cfg[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const sql = require('mssql')

/** Las vistas de MITO con joins pesados tardan más que los 15 s por defecto. */
const TIMEOUT_MS = Number(process.env.SQL_TIMEOUT_MS || 120_000)

/** Abre un pool contra el principal (ZOOLOGIC) o el local, por alias. */
export async function abrir(alias) {
  if (alias) {
    return new sql.ConnectionPool({
      connectionString:
        `Driver={ODBC Driver 18 for SQL Server};Server=${cfg.SQL2_SERVER};Database=${cfg.SQL2_DATABASE};` +
        `Trusted_Connection=yes;TrustServerCertificate=yes;`,
    })
  }
  const [host, port] = String(cfg.SQL_SERVER).split(':')
  return new sql.ConnectionPool({
    server: host,
    ...(port ? { port: Number(port) } : {}),
    database: cfg.SQL_DATABASE,
    user: cfg.SQL_USER,
    password: cfg.SQL_PASSWORD,
    options: {
      encrypt: cfg.SQL_ENCRYPT === 'true',
      trustServerCertificate: cfg.SQL_TRUST_CERT !== 'false',
      requestTimeout: TIMEOUT_MS,
    },
  })
}

function imprimir(recordsets) {
  for (const rs of recordsets) {
    if (!rs.length) continue
    const cols = Object.keys(rs[0])
    console.log(`-- ${rs.length} fila(s) | columnas: ${cols.join(', ')}`)
    for (const fila of rs) console.log(cols.map((c) => `${c}=${fila[c] ?? 'null'}`).join('  '))
  }
}

/**
 * Los "lotes" se mandan de a uno: CREATE VIEW / USE tienen que ser la
 * primera sentencia del lote y GO no es SQL. Se parten por la línea sola
 * con GO y se ejecutan en orden, cada uno en su request.
 */
function lotes(sqlTexto) {
  // Se saca el bloque de comentario /* ... */ y se parte por la línea "GO"
  return sqlTexto
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/^\s*GO\s*$/gim)
    .map((lote) => lote.trim())
    .filter((lote) => lote && !/^(--[^\n]*\n?)+$/.test(lote))
}

async function correr(sqlTexto, { json = false, alias = '' } = {}) {
  const pool = await abrir(alias)
  await pool.connect()
  const errores = []
  const verboso = process.argv.includes('--lote')
  try {
    for (const [i, lote] of lotes(sqlTexto).entries()) {
      if (verboso) console.log(`\n===== lote ${i + 1} =====\n${lote}\n`)
      try {
        const r = await pool.request().query(lote)
        if (json) console.log(JSON.stringify(r.recordsets, null, 2))
        else imprimir(r.recordsets)
      } catch (e) {
        // Se sigue con el resto del archivo para reportar todos los errores juntos
        const linea = e.lineNumber ?? e.originalError?.lineNumber ?? e.number
        const donde = Number.isFinite(linea) ? ` (línea ${linea} del lote)` : ''
        errores.push({ lote: lote.split('\n')[0].slice(0, 80), error: e.message + donde })
      }
    }
  } finally {
    await pool.close()
  }
  if (errores.length) {
    for (const x of errores) console.error(`ERROR en [${x.lote}]: ${x.error}`)
    process.exitCode = 1
  }
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('sql.mjs')) {
  const args = process.argv.slice(2)
  const json = args.includes('--json')
  const quiet = args.includes('--quiet')
  const idxAlias = args.indexOf('--alias')
  const alias = idxAlias >= 0 ? args[idxAlias + 1] : ''

  if (args.includes('-f')) {
    const f = args[args.indexOf('-f') + 1]
    await correr(readFileSync(f, 'utf8'), { json, alias })
  } else if (args.includes('-i')) {
    const pool = await abrir(alias)
    await pool.connect()
    console.log('SQL interactivo. "salir" para terminar.')
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'sql> ' })
    rl.prompt()
    for await (const linea of rl) {
      if (/^\s*(salir|exit|quit)\s*$/i.test(linea)) break
      if (linea.trim()) {
        try {
          imprimir((await pool.request().query(linea)).recordsets)
        } catch (e) {
          console.error('ERROR:', e.message)
        }
      }
      rl.prompt()
    }
    await pool.close()
  } else {
    // El SQL es el resto: se descartan las banderas y el valor de --alias
    const aliasPos = args.indexOf('--alias')
    const texto = args
      .filter((a, i) => !a.startsWith('--') && !(aliasPos >= 0 && i === aliasPos + 1))
      .join(' ')
    if (!texto) {
      console.log('Uso: node scripts/sql.mjs [--json] [--quiet] "SELECT ..." | -f archivo.sql | -i')
    } else {
      const r = await correr(texto, { json, alias })
      void r
      void quiet
    }
  }
}
