/**
 * Arqueos de caja de los locales → Supabase (arqueos_locales), para Tesorería → Arqueos de locales
 * y el aviso a los locales que no arquearon a las 10, 14, 19 y 22 (sql/arqueos_locales.sql).
 *
 *   node scripts/sync-arqueos.js          (hoy y ayer)
 *   node scripts/sync-arqueos.js --todo   (últimos 30 días)
 *
 * Lee DWH.dbo.vw_FACT_ARQUEO del servidor principal (SQL_SERVER del .env), SOLO LECTURA.
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

  const arqueos = new Map()
  for (const f of filas) {
    const base = String(f.TIENDA || '').replace(/^DRAGONFISH_/i, '').toUpperCase()
    if (!base) continue
    const local = LOCAL_DE_BASE[base] ?? base
    const clave = `${local}|${f.CAJA}|${f.ARQUEO}`
    let a = arqueos.get(clave)
    if (!a) {
      a = { local, caja: Number(f.CAJA), arqueo: Number(f.ARQUEO), fecha: f.FECHA, hora: String(f.HORA || '00:00:00').trim(), vendedor: f.VENDEDOR ?? null, total: 0, billetes: [] }
      arqueos.set(clave, a)
    }
    if (f.SECCION === 'DETALLE' && String(f.DIVISA || '').toUpperCase() === 'PESOS') {
      const tot = Number(f.TOTAL) || 0
      a.billetes.push({ tipo: f.TIPO, valor: Number(f.MONTO) || 0, cant: Number(f.CANTIDAD) || 0, tot })
      a.total += tot
    }
  }
  const lista = [...arqueos.values()].filter((a) => Number.isFinite(a.caja) && Number.isFinite(a.arqueo))
  for (const a of lista) a.billetes.sort((x, y) => y.valor - x.valor)

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
