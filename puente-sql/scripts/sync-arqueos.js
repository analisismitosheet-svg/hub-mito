/**
 * Arqueos de caja de los locales → Supabase (arqueos_locales), para Tesorería → Arqueos de locales
 * y el aviso a los locales que no arquearon a las 10, 14, 19 y 22 (sql/arqueos_locales.sql).
 *
 *   node scripts/sync-arqueos.js          (hoy y ayer)
 *   node scripts/sync-arqueos.js --todo   (últimos 30 días)
 *
 * Lee DWH.dbo.vw_FACT_ARQUEO del servidor principal (SQL_SERVER del .env) y además ARQCAJA + ARQEFECTDET de cada
 * DRAGONFISH_* del SQL de esta PC (DESKTOP-OA4GU6I, usuario de Windows), SOLO LECTURA: a veces el arqueo llega antes
 * a uno que al otro (Rivera 14:17 del 26/11 no estaba en el DWH), así que se juntan y, si está en los dos, gana el local.
 * `--ver` muestra los de hoy sin subir nada.
 * Una fila por arqueo, con el efectivo en pesos por billete/moneda.
 * Después de copiar le pide al hub que mande los avisos que tocan (/api/push?tipo=arqueo).
 *
 * Lo lanza la tarea "MITO - Pedidos franquicias" (sync-franquicias-dragon.ps1, cada 1 min), pero
 * corre de verdad cada 2 minutos (marca en data/sync-arqueos.ultimo).
 * Log: data/sync-arqueos.log (solo errores y corridas completas).
 */
const fs = require('fs')
const path = require('path')
const sql = require('mssql')

const RAIZ = path.join(__dirname, '..')
const LOG = path.join(RAIZ, 'data', 'sync-arqueos.log')
const MARCA = path.join(RAIZ, 'data', 'sync-arqueos.ultimo')
const CADA_MS = 2 * 60_000 - 5_000

function leerEnv(archivo) {
  const out = {}
  try {
    for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
      const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* opcional */
  }
  return out
}
const envPuente = leerEnv(path.join(RAIZ, '.env'))
const envHub = leerEnv(path.join(RAIZ, '..', '.env'))
const cfg = (k) => process.env[k] ?? envPuente[k]
const SUPABASE_URL = cfg('SUPABASE_URL') ?? envHub.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = cfg('SUPABASE_ANON_KEY') ?? envHub.VITE_SUPABASE_ANON_KEY
const HUB_URL = (cfg('HUB_URL') || 'https://hub-mito.vercel.app').replace(/\/$/, '')

/** Base de Dragon (sin DRAGONFISH_) → código del local en el hub, cuando no coinciden */
const LOCAL_DE_BASE = { '9DEJUL2': '9DEJULIO', GRALPAZ: 'GPAZD', NVOCED2: 'NVOCED' }

function anotar(texto) {
  const linea = `${new Date().toLocaleString('sv-SE')}  ${texto}`
  console.log(linea)
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true })
    fs.appendFileSync(LOG, linea + '\n')
  } catch {
    /* sin log en disco */
  }
}

async function rpc(nombre, params) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const cuerpo = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`${nombre}: HTTP ${r.status} ${cuerpo?.message ?? ''}`.trim())
  return cuerpo
}

const isoLocal = (d) => d.toLocaleDateString('sv-SE')

/** Bases del SQL local que no son locales que arquean */
const BASES_LOCALES_FUERA = new Set(['FABRICA', 'CFU'])

/** Arqueos (encabezado + efectivo) de cada DRAGONFISH_* del SQL de esta PC, con las mismas columnas que vw_FACT_ARQUEO */
async function leerLocales(desde) {
  const sqlLocal = require('mssql/msnodesqlv8')
  const [h2, p2] = String(cfg('SQL2_SERVER') || 'localhost').split(':')
  const pool = await new sqlLocal.ConnectionPool({
    connectionString:
      `Driver={${cfg('SQL2_ODBC_DRIVER') || 'ODBC Driver 18 for SQL Server'}};Server=${p2 ? `${h2},${p2}` : h2};` +
      `Database=master;Trusted_Connection=yes;TrustServerCertificate=yes;`,
    requestTimeout: 120_000,
  }).connect()
  const out = []
  try {
    const bases = (await pool.request().query(`SELECT name FROM sys.databases WHERE name LIKE 'DRAGONFISH[_]%' AND state = 0`)).recordset
      .map((r) => r.name)
      .filter((b) => /^DRAGONFISH_[A-Z0-9]+$/i.test(b) && !BASES_LOCALES_FUERA.has(b.replace(/^DRAGONFISH_/i, '').toUpperCase()))
    for (const b of bases) {
      try {
        const r = await pool.request().input('desde', sqlLocal.Date, desde).query(`
          SELECT '${b}' AS TIENDA, 'DETALLE' AS SECCION, A.CAJA, A.NUMERO AS ARQUEO, CONVERT(char(10), A.FALTAFW, 23) AS FECHA,
                 LEFT(RTRIM(A.HALTAFW), 8) AS HORA, COALESCE(RTRIM(V.CLNOM), RTRIM(A.VENDEDOR)) AS VENDEDOR,
                 D.MONEDADEN AS DIVISA, D.TIPO, D.VALORDEN AS MONTO, D.CANT AS CANTIDAD, D.TOT AS TOTAL, 'local' AS ORIGEN
            FROM [${b}].ZooLogic.ARQCAJA A
            LEFT JOIN [${b}].ZooLogic.VEN V ON RTRIM(V.CLCOD) = RTRIM(A.VENDEDOR)
            LEFT JOIN [${b}].ZooLogic.ARQEFECTDET D ON D.CODIGO = A.CODIGO
           WHERE A.FALTAFW >= @desde`)
        out.push(...r.recordset)
      } catch (e) {
        anotar(`SQL local ${b}: ${e.message}`)
      }
    }
  } finally {
    await pool.close().catch(() => undefined)
  }
  return out
}

async function main() {
  const token = cfg('PUENTE_TOKEN')
  if (!token) throw new Error('Falta PUENTE_TOKEN en puente-sql/.env')
  const todo = process.argv.includes('--todo') || !fs.existsSync(MARCA)
  if (!todo) {
    const ultimo = Number(fs.readFileSync(MARCA, 'utf8')) || 0
    if (Date.now() - ultimo < CADA_MS) return
  }
  const desde = isoLocal(new Date(Date.now() - (todo ? 30 : 1) * 86_400_000))

  const [host, port] = String(cfg('SQL_SERVER') || '').split(':')
  const pool = await sql.connect({
    server: host,
    ...(port ? { port: Number(port) } : {}),
    database: cfg('SQL_DATABASE') || 'master',
    user: cfg('SQL_USER'),
    password: cfg('SQL_PASSWORD'),
    options: { encrypt: cfg('SQL_ENCRYPT') === 'true', trustServerCertificate: cfg('SQL_TRUST_CERT') !== 'false' },
    requestTimeout: 120_000,
  })

  let filas
  try {
    const r = await pool.request().input('desde', sql.Date, desde).query(`
      SELECT TIENDA, SECCION, CAJA, ARQUEO, CONVERT(char(10), FECHA, 23) AS FECHA, LEFT(CONVERT(varchar(8), HORA, 108), 8) AS HORA,
             VENDEDOR, DIVISA, TIPO, MONTO, CANTIDAD, TOTAL
        FROM DWH.dbo.vw_FACT_ARQUEO
       WHERE FECHA >= @desde`)
    filas = r.recordset
  } finally {
    await pool.close().catch(() => undefined)
  }

  // Arqueos de las bases del Replicador en el SQL de esta PC (DESKTOP-OA4GU6I, usuario de Windows): llegan
  // antes que al DWH (p. ej. el de Rivera de las 14:17 no estaba en vw_FACT_ARQUEO). Se lee después de cerrar
  // el pool principal porque msnodesqlv8 y tedious no conviven en la misma copia de mssql.
  const locales = await leerLocales(desde).catch((e) => {
    anotar(`SQL local: ${e.message}`)
    return []
  })

  const arqueos = new Map()
  for (const f of [...filas, ...locales]) {
    const base = String(f.TIENDA || '').replace(/^DRAGONFISH_/i, '').toUpperCase()
    if (!base) continue
    const local = LOCAL_DE_BASE[base] ?? base
    const clave = `${local}|${f.CAJA}|${f.ARQUEO}`
    let a = arqueos.get(clave)
    // El mismo arqueo en las dos fuentes: queda el del SQL local (llega primero y completo)
    if (a && f.ORIGEN === 'local' && a.origen !== 'local') a = null
    if (a && a.origen === 'local' && f.ORIGEN !== 'local') continue
    if (!a) {
      a = { local, caja: Number(f.CAJA), arqueo: Number(f.ARQUEO), fecha: f.FECHA, hora: String(f.HORA || '00:00:00').trim(), vendedor: f.VENDEDOR ?? null, total: 0, billetes: [], origen: f.ORIGEN ?? 'dwh' }
      arqueos.set(clave, a)
    }
    if (f.SECCION === 'DETALLE' && String(f.DIVISA || '').toUpperCase() === 'PESOS') {
      const tot = Number(f.TOTAL) || 0
      a.billetes.push({ tipo: f.TIPO, valor: Number(f.MONTO) || 0, cant: Number(f.CANTIDAD) || 0, tot })
      a.total += tot
    }
  }
  const lista = [...arqueos.values()].filter((a) => Number.isFinite(a.caja) && Number.isFinite(a.arqueo))
  for (const a of lista) {
    a.billetes.sort((x, y) => y.valor - x.valor || String(x.tipo).localeCompare(String(y.tipo)))
    delete a.origen
  }
  if (process.argv.includes('--ver')) {
    for (const a of lista.filter((x) => x.fecha >= isoLocal(new Date())).sort((x, y) => (x.local + x.hora).localeCompare(y.local + y.hora)))
      console.log(a.local, a.caja, a.arqueo, a.fecha, a.hora, a.total, a.vendedor, a.billetes.length)
    return
  }

  const cambiadas = Number(await rpc('arqueos_sync_filas', { p_token: token, p_desde: desde, p_filas: lista })) || 0
  fs.mkdirSync(path.dirname(MARCA), { recursive: true })
  fs.writeFileSync(MARCA, String(Date.now()))
  if (cambiadas || todo) anotar(`Desde ${desde}: ${lista.length} arqueos leídos, ${cambiadas} nuevos o cambiados`)

  // Avisos a los locales que no arquearon (el hub decide quién y cuándo)
  try {
    const r = await fetch(`${HUB_URL}/api/push?tipo=arqueo`, { method: 'POST', signal: AbortSignal.timeout(60_000) })
    const cuerpo = await r.json().catch(() => null)
    if (!r.ok) anotar(`Avisos: HTTP ${r.status} ${cuerpo?.error ?? ''}`)
    else if (cuerpo?.avisos) anotar(`Avisos: ${cuerpo.avisos} (${(cuerpo.locales ?? []).join(', ')}) · ${cuerpo.enviados ?? 0} push`)
  } catch (e) {
    anotar(`Avisos: ${e.message}`)
  }
}

main().catch((e) => {
  anotar(`ERROR ${e.message}`)
  process.exit(1)
})
