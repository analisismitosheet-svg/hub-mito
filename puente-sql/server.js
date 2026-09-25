/**
 * ============================================================
 * PUENTE SQL — corre en una PC/servidor de TU red, junto al SQL Server
 * ============================================================
 *
 * Expone las vistas del SQL Server como HTTP para el proxy de Vercel,
 * reemplazando al Logic App + On-Premises Data Gateway (sin Azure).
 *
 * Contrato (compatible con api/sql/[view].ts):
 *   POST /          body: { vista: string, top: number }
 *                   header: X-Puente-Token: <PUENTE_TOKEN>
 *                   -> 200 JSON array de filas
 *                   vista = "vw_x" (dbo de SQL_DATABASE), "esquema.obj" o "BASE.esquema.obj"
 *   POST /          body: { vista, top, donde, valor }   (FILTRO opcional)
 *                   -> 200 JSON array de filas WHERE [donde] = valor
 *                   'donde' debe estar en PUENTE_FILTRO_COLS; 'valor' va parametrizado.
 *                   Es lo que usa el tótem F12 para traer solo el artículo escaneado.
 *   POST /          body: { accion: 'bases' }            -> ["BASE1", ...]
 *   POST /          body: { accion: 'objetos', base }    -> [{ esquema, nombre, tipo }]
 *   POST /          body: { accion: 'replicas' }         -> { replicas: [...], agente }
 *                   ^ NO sale del SQL remoto: lee el Replicador SQL de ESTA PC
 *                     (sql/replicas.sql contra la instancia local + config.json
 *                     + historial.csv). Es lo que usa Sistemas > Réplicas.
 *   GET  /health    -> { ok: true } (sin token, para probar el túnel)
 *
 * Solo lectura: siempre hace SELECT TOP (n) * FROM [base].[esquema].[objeto].
 * Solo ve las bases y objetos que el usuario SQL puede leer (sus permisos mandan).
 *
 * CONFIGURACIÓN (archivo .env junto a este archivo o variables de entorno):
 *   PUENTE_TOKEN=un-secreto-largo      # mismo valor que SQL_BRIDGE_TOKEN en Vercel
 *   PUENTE_PORT=3128
 *   SQL_SERVER=TU-SERVIDOR\SQLEXPRESS  # o host:puerto
 *   SQL_DATABASE=TuBase
 *   SQL_USER=usuario_solo_lectura      # login SQL con db_datareader
 *   SQL_PASSWORD=***
 *   SQL_ENCRYPT=false                  # true si tu servidor tiene TLS válido
 *   SQL_TRUST_CERT=true                # para certificados autofirmados internos
 *
 * ARRANQUE:  npm install && npm start   (y dejarlo corriendo, ej. con pm2)
 */

const http = require('http')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFile } = require('child_process')

/* ---- mini lector de .env (sin dependencias) ---- */
try {
  const envPath = path.join(__dirname, '.env')
  for (const linea of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {
  /* .env opcional */
}

const {
  PUENTE_TOKEN,
  PUENTE_PORT = '3128',
  SQL_SERVER,
  SQL_DATABASE,
  SQL_USER,
  SQL_PASSWORD,
  SQL_ENCRYPT = 'false',
  SQL_TRUST_CERT = 'true',
} = process.env

// Columnas sobre las que se acepta el filtro WHERE [col] = valor.
// Lista blanca estricta: el nombre de la columna NUNCA sale de acá,
// y el valor siempre va parametrizado.
const PUENTE_FILTRO_COLS = (process.env.PUENTE_FILTRO_COLS || 'ARTCOD')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

if (!PUENTE_TOKEN || !SQL_SERVER || !SQL_DATABASE || !SQL_USER || !SQL_PASSWORD) {
  console.error('[puente] Faltan variables: PUENTE_TOKEN, SQL_SERVER, SQL_DATABASE, SQL_USER, SQL_PASSWORD')
  process.exit(1)
}

let sql
try {
  sql = require('mssql')
} catch {
  console.error('[puente] Falta el paquete mssql. Corré:  npm install')
  process.exit(1)
}

// SQL_SERVER acepta: "host", "host\instancia", "host:puerto" o "host,puerto"
let serverHost = SQL_SERVER
let serverPort
const mPuerto = String(SQL_SERVER).match(/^(.+?)[,:](\d+)$/)
if (mPuerto && !String(SQL_SERVER).includes('\\')) {
  serverHost = mPuerto[1]
  serverPort = Number(mPuerto[2])
}

const pool = new sql.ConnectionPool({
  server: serverHost,
  ...(serverPort ? { port: serverPort } : {}),
  database: SQL_DATABASE,
  user: SQL_USER,
  password: SQL_PASSWORD,
  options: {
    encrypt: SQL_ENCRYPT === 'true',
    trustServerCertificate: SQL_TRUST_CERT === 'true',
  },
})
pool.on('error', (err) => console.error('[puente] Error de pool:', err.message))

// Cada parte de un nombre (base, esquema, objeto): sin corchetes, puntos ni comillas
const PARTE = /^[A-Za-z0-9_-]{1,128}$/

/** La base existe, está en línea y el usuario SQL tiene acceso. */
async function baseAccesible(base) {
  const r = await pool
    .request()
    .input('base', sql.NVarChar, base)
    .query(`SELECT 1 AS ok FROM sys.databases WHERE name = @base AND state = 0 AND HAS_DBACCESS(name) = 1`)
  return Boolean(r.recordset?.length)
}

function enviar(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(payload)
}

async function leerCuerpo(req) {
  let data = ''
  for await (const chunk of req) data += chunk
  if (data.length > 4096) throw new Error('Body demasiado grande')
  return data ? JSON.parse(data) : {}
}

/* =========================================================================
 * REPLICADOR SQL LOCAL — acción 'replicas' (Sistemas > Réplicas)
 * -------------------------------------------------------------------------
 * El estado de las réplicas NO sale del SQL remoto: sale de ESTA PC (la
 * central del Replicador SQL, p. ej. DESKTOP-OA4GU6I). Por cada sucursal
 * copiada hay una base local con dbo._sync_estado (fecha de la última
 * actualización por tabla) y, en la carpeta del Replicador, el config.json
 * (nombre de cada sucursal) y el historial.csv (última corrida + errores).
 *
 * Todo es lectura local y fija: el script no recibe parámetros y las bases
 * las resuelve sys.databases dentro del propio SQL.
 * ========================================================================= */

const REPLICADOR_DIR = process.env.REPLICADOR_DIR || 'C:\\ReplicadorSQL'
const REPLICADOR_SQLSERVER = process.env.REPLICADOR_SQLSERVER || 'localhost'
const SCRIPT_REPLICAS = path.join(__dirname, 'sql', 'replicas.sql')
const LATIDO_VIVO_MS = 300_000

const SQLCMD = (() => {
  const candidatos = [
    process.env.SQLCMD_PATH,
    'C:\\Program Files\\Microsoft SQL Server\\Client SDK\\ODBC\\180\\Tools\\Binn\\SQLCMD.EXE',
    'C:\\Program Files\\Microsoft SQL Server\\Client SDK\\ODBC\\170\\Tools\\Binn\\SQLCMD.EXE',
    'sqlcmd',
  ].filter(Boolean)
  return candidatos.find((c) => c === 'sqlcmd' || fs.existsSync(c)) || null
})()

/** Una línea CSV simple, respetando campos entre comillas. */
function csvFila(linea) {
  const out = []
  let campo = ''
  let entreComillas = false
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i]
    if (entreComillas) {
      if (ch === '"' && linea[i + 1] === '"') {
        campo += '"'
        i++
      } else if (ch === '"') entreComillas = false
      else campo += ch
    } else if (ch === '"') entreComillas = true
    else if (ch === ',') {
      out.push(campo)
      campo = ''
    } else campo += ch
  }
  out.push(campo)
  return out
}

/** Cada base copiada -> { sucursal, origen }, según el config.json del Replicador. */
function configReplicador() {
  const porBase = {}
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(REPLICADOR_DIR, 'config.json'), 'utf8'))
    for (const s of Array.isArray(cfg?.sources) ? cfg.sources : []) {
      const base = String(s?.target_database || s?.database || '').trim()
      if (base) porBase[base] = { sucursal: String(s?.name || '').trim(), origen: String(s?.server || '').trim() }
    }
  } catch {
    /* sin config: se muestra igual, sin nombre de sucursal */
  }
  return porBase
}

/** Última fila del historial.csv por sucursal: { fin, estado, ultimo_error }. */
function historialReplicador() {
  const porSucursal = {}
  try {
    const lineas = fs.readFileSync(path.join(REPLICADOR_DIR, 'historial.csv'), 'utf8').split(/\r?\n/)
    if (lineas.length < 2) return porSucursal
    const cols = csvFila(lineas[0]).map((c) => c.trim())
    const ix = (n) => cols.indexOf(n)
    const iFin = ix('fin')
    const iEst = ix('estado')
    const iErr = ix('ultimo_error')
    const iCant = ix('errores')
    for (let i = 1; i < lineas.length; i++) {
      if (!lineas[i]) continue
      const v = csvFila(lineas[i])
      const sucursal = (v[ix('sucursal')] ?? '').trim()
      if (sucursal) {
        porSucursal[sucursal] = {
          corrida_fin: (v[iFin] ?? '').trim(),
          estado: (v[iEst] ?? '').trim(),
          errores: (v[iCant] ?? '').trim(),
          ultimo_error: (v[iErr] ?? '').trim(),
        }
      }
    }
  } catch {
    /* sin historial */
  }
  return porSucursal
}

/**
 * ¿Sigue vivo el agente? Dos señales locales, y se toma la más reciente:
 *   - agent_heartbeat.txt: lo escribe al pasar por el bucle principal;
 *   - sync.log: avanza en cada ciclo (el heartbeat puede quedar viejo si una
 *     copia inicial tarda varios minutos, y no hay que marcarlo como caído).
 */
function latidoAgente() {
  const candidatos = []
  try {
    const crudo = fs.readFileSync(path.join(REPLICADOR_DIR, 'agent_heartbeat.txt'), 'utf8').trim()
    const ms = Math.round(Number(crudo) * 1000)
    if (Number.isFinite(ms) && ms > 0) candidatos.push(ms)
  } catch {
    /* sin heartbeat */
  }
  try {
    const ms = fs.statSync(path.join(REPLICADOR_DIR, 'sync.log')).mtimeMs
    if (ms > 0) candidatos.push(ms)
  } catch {
    /* sin log */
  }
  if (candidatos.length === 0) return { vivo: false, ultimo_latido: null }
  const ms = Math.max(...candidatos)
  return { vivo: Date.now() - ms < LATIDO_VIVO_MS, ultimo_latido: new Date(ms).toISOString() }
}

/** Ejecuta sql/replicas.sql contra la instancia local (Windows auth). */
function sqlcmdReplicas() {
  if (!SQLCMD) throw new Error('No se encontró sqlcmd (instalar "Command Line Utilities" o setear SQLCMD_PATH)')
  if (!fs.existsSync(SCRIPT_REPLICAS)) throw new Error('Falta sql/replicas.sql junto a server.js')
  return new Promise((resolve, reject) => {
    execFile(
      SQLCMD,
      ['-S', REPLICADOR_SQLSERVER, '-E', '-C', '-d', 'master', '-h', '-1', '-W', '-b', '-i', SCRIPT_REPLICAS],
      { timeout: 20_000, windowsHide: true, maxBuffer: 1024 * 1024, encoding: 'utf8' },
      (err, stdout) => {
        if (err) {
          const primera = String(err.message || err).split(/\r?\n/)[0]
          return reject(new Error(`sqlcmd: ${primera.slice(0, 250)}`))
        }
        resolve(String(stdout || ''))
      },
    )
  })
}

let cacheReplicas = { en: 0, datos: null }

/** { replicas: [...], agente: {...} } — cacheado 10 s para no repetir sqlcmd. */
async function estadoReplicas() {
  const ahora = Date.now()
  if (cacheReplicas.datos && ahora - cacheReplicas.en < 10_000) return cacheReplicas.datos

  const salida = await sqlcmdReplicas()
  const config = configReplicador()
  const historial = historialReplicador()

  const replicas = []
  for (const linea of salida.split(/\r?\n/)) {
    if (!linea.trim()) continue
    const [base = '', fecha = '', tablas = ''] = linea.split('|')
    if (!/^[A-Za-z0-9_-]+$/.test(base)) continue
    const cfg = config[base] || { sucursal: '', origen: '' }
    const hist = historial[cfg.sucursal] || {}
    const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(fecha) ? fecha.replace(' ', 'T') : null
    replicas.push({
      base,
      sucursal: cfg.sucursal,
      origen: cfg.origen,
      actualizacion: iso,
      tablas: Number(tablas) || 0,
      corrida_fin: hist.corrida_fin || '',
      estado: hist.estado || '',
      errores: hist.errores || '',
      ultimo_error: hist.ultimo_error || '',
    })
  }

  const datos = { servidor: os.hostname(), replicas, agente: latidoAgente() }
  cacheReplicas = { en: ahora, datos }
  return datos
}


const server = http.createServer(async (req, res) => {
  // Socket roto / cliente desconectado: no debe tumbar el proceso
  res.on('error', () => {})
  // Afuera del try para que el catch pueda nombrarla en el mensaje de error
  let vista = ''
  try {
    // Salud: sin token, útil para verificar el túnel
    if (req.method === 'GET' && req.url.startsWith('/health')) {
      return enviar(res, 200, { ok: true })
    }

    if (req.method !== 'POST') return enviar(res, 405, { error: 'Método no permitido' })

    if ((req.headers['x-puente-token'] ?? '') !== PUENTE_TOKEN) {
      return enviar(res, 401, { error: 'Token inválido' })
    }

    const body = await leerCuerpo(req)

    // Catálogo: bases a las que el usuario SQL tiene acceso
    if (body?.accion === 'bases') {
      const r = await pool.request().query(
        `SELECT name FROM sys.databases
          WHERE database_id > 4 AND state = 0 AND HAS_DBACCESS(name) = 1
            AND name NOT LIKE '%[_]Publication[_]%'  -- bases internas de replicación
          ORDER BY name`,
      )
      return enviar(res, 200, (r.recordset ?? []).map((f) => f.name))
    }

    // Catálogo: tablas y vistas de una base (solo las que el usuario puede leer)
    if (body?.accion === 'objetos') {
      const base = String(body?.base ?? '')
      if (!PARTE.test(base) || !(await baseAccesible(base))) return enviar(res, 400, { error: 'Base no disponible' })
      const r = await pool.request().query(
        `SELECT TABLE_SCHEMA AS esquema, TABLE_NAME AS nombre,
                CASE TABLE_TYPE WHEN 'VIEW' THEN 'vista' ELSE 'tabla' END AS tipo
           FROM [${base}].INFORMATION_SCHEMA.TABLES
          ORDER BY TABLE_TYPE DESC, TABLE_SCHEMA, TABLE_NAME`,
      )
      return enviar(res, 200, r.recordset ?? [])
    }

    // Estado de las réplicas (Sistemas > Réplicas): Replicador SQL local
    if (body?.accion === 'replicas') {
      return enviar(res, 200, await estadoReplicas())
    }

    vista = String(body?.vista ?? '')
    const pedido = Number(body?.top)
    const top = Math.min(Number.isFinite(pedido) && pedido > 0 ? Math.floor(pedido) : 1000, 10000)

    // Nombre: "vista" (dbo de la base del .env), "esquema.objeto" o "base.esquema.objeto".
    // Sanitizado estricto de cada parte (solo SELECT, nunca otra cosa)
    const partes = vista.split('.')
    if (partes.length > 3 || !partes.every((p) => PARTE.test(p))) {
      return enviar(res, 400, { error: 'Nombre de vista inválido' })
    }
    const [objeto, esquema = 'dbo', base = null] = [...partes].reverse()

    if (base) {
      if (!(await baseAccesible(base))) return enviar(res, 400, { error: `No hay acceso a la base ${base}` })
      const existe = await pool
        .request()
        .input('esquema', sql.NVarChar, esquema)
        .input('objeto', sql.NVarChar, objeto)
        .query(
          `SELECT 1 AS ok FROM [${base}].INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = @esquema AND TABLE_NAME = @objeto`,
        )
      if (!existe.recordset?.length) return enviar(res, 404, { error: `No existe ${vista}` })
    }

    const desde = base ? `[${base}].[${esquema}].[${objeto}]` : `[${esquema}].[${objeto}]`

    // Filtro opcional: WHERE [col] = @v. La columna sale de la lista blanca
    // (PUENTE_FILTRO_COLS) y el valor SIEMPRE va parametrizado.
    const donde = String(body?.donde ?? '').trim()
    const valor = String(body?.valor ?? '').trim()
    if (donde || valor) {
      const col = PUENTE_FILTRO_COLS.find((c) => c.toLowerCase() === donde.toLowerCase())
      if (!col || !valor) {
        return enviar(res, 400, {
          error: `Filtro inválido. 'donde' debe ser una de: ${PUENTE_FILTRO_COLS.join(', ')} y 'valor' no puede quedar vacío.`,
        })
      }
      const r = await pool
        .request()
        .input('top', sql.Int, top)
        .input('v', sql.NVarChar(100), valor)
        .query(`SELECT TOP (@top) * FROM ${desde} WHERE [${col}] = @v`)
      return enviar(res, 200, r.recordset ?? [])
    }

    const result = await pool.request().input('top', sql.Int, top).query(`SELECT TOP (@top) * FROM ${desde}`)
    return enviar(res, 200, result.recordset ?? [])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[puente]', msg)
    if (/invalid object name/i.test(msg)) {
      return enviar(res, 404, { error: `No existe la vista solicitada (${vista}). Revisá el nombre en la base.` })
    }
    return enviar(res, 500, { error: msg.slice(0, 300) })
  }
})

server.listen(Number(PUENTE_PORT), () => {
  console.log(`[puente] Escuchando en http://localhost:${PUENTE_PORT}`)
})

// Errores de HTTP a nivel de socket (peticiones rotas a mitad de camino)
server.on('clientError', (_err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
})

// Un error aislado jamás debe tumbar el puente: se loguea y la consulta siguiente sigue.
process.on('uncaughtException', (err) => {
  console.error('[puente] Excepción no capturada (continuando):', err?.message ?? err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[puente] Rechazo no manejado (continuando):', reason instanceof Error ? reason.message : reason)
})

// Conexión explícita al arrancar (mssql v10 ya no se autoconecta en el primer request)
pool.connect()
  .then(() => console.log(`[puente] Conectado a SQL Server: ${serverHost}:${serverPort ?? 1433} / ${SQL_DATABASE}`))
  .catch((err) => console.error(`[puente] No se pudo conectar a SQL Server: ${err.message}`))
