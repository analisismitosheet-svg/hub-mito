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
 *                   'donde' (una o varias, separadas por coma) debe estar en
 *                   PUENTE_FILTRO_COLS; 'valor' va parametrizado.
 *                   Es lo que usa el tótem F12 para traer solo el artículo escaneado
 *                   y la consulta de artículos del hub (Mayorista).
 *   POST /          body: { vista, top, donde, valor, coincide:'contiene' }
 *                   -> 200 JSON array de filas WHERE [donde] LIKE '%valor%'
 *   POST /          body: { accion: 'servidores' }       -> [{ alias, principal }]
 *   POST /          body: { accion: 'bases', servidor? }          -> ["BASE1", ...]
 *   POST /          body: { accion: 'objetos', base, servidor? }  -> [{ esquema, nombre, tipo }]
 *
 *   VARIOS SQL SERVER: el principal es SQL_* y se puede sumar otro con SQL2_*. Para leer del
 *   segundo, el nombre de la vista lleva su alias adelante: "ALIAS:BASE.esquema.obj".
 *   Sin alias = el principal (así todo lo que ya estaba configurado sigue igual).
 *   POST /          body: { accion: 'replicas' }         -> { replicas: [...], agente }
 *   POST /          body: { accion: 'sync_pedidos_compra' } -> { ok, mensaje }  (botón "Actualizar datos"
 *                   de Pedidos de compra: corre scripts/sync-pedidos-compra.js en el momento)
 *   POST /          body: { accion: 'sync_pedidos_venta' }  -> { ok, mensaje }  (ídem Pedidos de venta:
 *                   scripts/sync-pedidos-venta.js, últimos 7 días)
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
 *   SQL_ALIAS=ZOOLOGIC                 # nombre con que se ve el principal en el hub (opcional)
 *
 *   Segundo SQL Server (opcional):
 *   SQL2_ALIAS=DESKTOP-OA4GU6I         # letras, números y guiones
 *   SQL2_SERVER=localhost              # o host\instancia, host:puerto
 *   SQL2_DATABASE=VISTAS_CONSOLIDADAS
 *   SQL2_WINDOWS_AUTH=true             # entra con el usuario de Windows que corre el puente
 *                                      # (driver ODBC + paquete msnodesqlv8); si no, SQL2_USER/SQL2_PASSWORD
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
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
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

// Columnas sobre las que se acepta el filtro WHERE [col] = valor / LIKE.
// Lista blanca estricta: el nombre de la columna NUNCA sale de acá,
// y el valor siempre va parametrizado.
// Tiene que incluir las columnas por las que busca el hub
// (VITE_SQL_VISTA_ARTICULOS → sql/vw_ARTICULOS_MITO.sql).
const PUENTE_FILTRO_COLS = (
  process.env.PUENTE_FILTRO_COLS || 'ARTCOD,ID_ARTICULO,ARTICULO,NOMBRE_COMPLETO,DESCRIPCION'
)
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

// Tope de filas por consulta. Antes era 10.000 y cortaba vistas más grandes sin avisar
// (vw_STOCK_SKU_MITO tiene ~17.700 SKUs: los que quedaban afuera se veían con stock 0).
const MAX_FILAS = Math.max(1000, Number(process.env.PUENTE_MAX_FILAS) || 50000)

// Cada parte de un nombre (base, esquema, objeto, alias): sin corchetes, puntos ni comillas
const PARTE = /^[A-Za-z0-9_-]{1,128}$/

/** SQL_SERVER acepta: "host", "host\instancia", "host:puerto" o "host,puerto" */
function hostPuerto(servidor) {
  const m = String(servidor).match(/^(.+?)[,:](\d+)$/)
  return m && !String(servidor).includes('\\') ? { host: m[1], port: Number(m[2]) } : { host: servidor }
}

/**
 * Servidores SQL: alias -> { alias, principal, sql, pool, descripcion }.
 * `sql` es el módulo con que se armó el pool (tedious o msnodesqlv8): los tipos de
 * parámetros (sql.NVarChar, sql.Int) se toman del mismo módulo.
 */
const SERVIDORES = new Map()

/**
 * mssql guarda el driver en un módulo compartido: cargar 'mssql/msnodesqlv8' en la misma copia
 * cambiaría el driver de las conexiones tedious que ya existen. Se carga en una copia aparte
 * (caché de require limpia para mssql) y después se deja la caché como estaba.
 */
function requireAislado(id) {
  const esMssql = (k) => k.includes(`${path.sep}node_modules${path.sep}mssql${path.sep}`)
  const guardados = {}
  for (const k of Object.keys(require.cache)) if (esMssql(k)) { guardados[k] = require.cache[k]; delete require.cache[k] }
  try {
    return require(id)
  } finally {
    for (const k of Object.keys(require.cache)) if (esMssql(k)) delete require.cache[k]
    Object.assign(require.cache, guardados)
  }
}

function agregarServidor(alias, principal, cfg) {
  const { host, port } = hostPuerto(cfg.server)
  let mod = sql
  let pool
  if (cfg.windowsAuth) {
    try {
      mod = requireAislado('mssql/msnodesqlv8')
    } catch {
      console.error(`[puente] ${alias}: para entrar con usuario de Windows falta el paquete msnodesqlv8 (npm install)`)
      return
    }
    const servidorOdbc = port ? `${host},${port}` : host
    pool = new mod.ConnectionPool({
      connectionString:
        `Driver={${cfg.driver || 'ODBC Driver 18 for SQL Server'}};Server=${servidorOdbc};Database=${cfg.database};` +
        `Trusted_Connection=yes;TrustServerCertificate=yes;`,
    })
  } else {
    pool = new mod.ConnectionPool({
      server: host,
      ...(port ? { port } : {}),
      database: cfg.database,
      user: cfg.user,
      password: cfg.password,
      options: { encrypt: cfg.encrypt === 'true', trustServerCertificate: cfg.trustCert !== 'false' },
    })
  }
  pool.on('error', (err) => console.error(`[puente] Error de pool (${alias}):`, err.message))
  SERVIDORES.set(alias.toUpperCase(), {
    alias,
    principal,
    sql: mod,
    pool,
    descripcion: `${host}${port ? ':' + port : ''} / ${cfg.database}${cfg.windowsAuth ? ' (usuario de Windows)' : ''}`,
  })
}

const ALIAS_PRINCIPAL = PARTE.test(process.env.SQL_ALIAS || '') ? process.env.SQL_ALIAS : 'PRINCIPAL'
agregarServidor(ALIAS_PRINCIPAL, true, {
  server: SQL_SERVER,
  database: SQL_DATABASE,
  user: SQL_USER,
  password: SQL_PASSWORD,
  encrypt: SQL_ENCRYPT,
  trustCert: SQL_TRUST_CERT,
})
if (process.env.SQL2_SERVER) {
  const alias2 = process.env.SQL2_ALIAS || ''
  if (!PARTE.test(alias2) || alias2.toUpperCase() === ALIAS_PRINCIPAL.toUpperCase()) {
    console.error('[puente] SQL2_ALIAS falta o es inválido (letras, números y guiones, distinto del principal): se ignora el segundo servidor')
  } else {
    agregarServidor(alias2, false, {
      server: process.env.SQL2_SERVER,
      database: process.env.SQL2_DATABASE || 'master',
      user: process.env.SQL2_USER,
      password: process.env.SQL2_PASSWORD,
      encrypt: process.env.SQL2_ENCRYPT || 'false',
      trustCert: process.env.SQL2_TRUST_CERT || 'true',
      windowsAuth: process.env.SQL2_WINDOWS_AUTH === 'true',
      driver: process.env.SQL2_ODBC_DRIVER,
    })
  }
}

/** Servidor por alias (sin alias = el principal). null si no existe. */
function servidorDe(alias) {
  if (!alias) return SERVIDORES.get(ALIAS_PRINCIPAL.toUpperCase())
  return PARTE.test(alias) ? SERVIDORES.get(String(alias).toUpperCase()) ?? null : null
}

/** La base existe, está en línea y el usuario SQL tiene acceso. */
async function baseAccesible(srv, base) {
  const { pool, sql } = srv
  const r = await pool
    .request()
    .input('base', sql.NVarChar, base)
    .query(`SELECT 1 AS ok FROM sys.databases WHERE name = @base AND state = 0 AND HAS_DBACCESS(name) = 1`)
  return Boolean(r.recordset?.length)
}

/**
 * Columnas reales de un objeto, en minúsculas y cacheadas 10 minutos.
 *
 * Sirve para que el filtro no se rompa cuando se piden columnas que la vista
 * no tiene: cada vista expone las suyas (por ejemplo, la de artículos usa
 * ID_ARTICULO y no ARTCOD), y el cliente manda la lista completa.
 */
const cacheColumnas = new Map()
const COLUMNAS_TTL_MS = 600_000

async function columnasDe(srv, base, esquema, objeto) {
  const clave = `${srv.alias}|${base || ''}|${esquema}|${objeto}`.toUpperCase()
  const guardado = cacheColumnas.get(clave)
  if (guardado && Date.now() - guardado.en < COLUMNAS_TTL_MS) return guardado.cols
  const { pool, sql } = srv
  const r = await pool.request()
    .input('base', sql.NVarChar, base || '')
    .input('esquema', sql.NVarChar, esquema)
    .input('objeto', sql.NVarChar, objeto)
    .query(
      `SELECT LOWER(COLUMN_NAME) AS col
         FROM ${base ? `[${base}].` : ''}INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = @esquema AND TABLE_NAME = @objeto AND (TABLE_CATALOG = @base OR @base = '')`,
    )
  const cols = new Set((r.recordset ?? []).map((x) => x.col))
  cacheColumnas.set(clave, { en: Date.now(), cols })
  return cols
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


/* ---- Pedidos de compra / venta: copia forzada desde el hub (una a la vez por script) ---- */
const syncEnCurso = new Map()
function correrSync(script) {
  if (syncEnCurso.has(script)) return syncEnCurso.get(script)
  const promesa = new Promise((resolve) => {
    execFile(
      process.execPath,
      [path.join(__dirname, 'scripts', script)],
      { cwd: __dirname, timeout: 120000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        // La última línea del log dice "OK: …" o "ERROR: …"
        const ultima = String(stdout ?? '').trim().split(/\r?\n/).pop() ?? ''
        const mensaje = ultima.replace(/^\S+\s+\S+\s+/, '')
        if (err || /ERROR:/.test(ultima)) resolve({ ok: false, error: mensaje || 'La copia falló' })
        else resolve({ ok: true, mensaje })
      },
    )
  }).finally(() => {
    syncEnCurso.delete(script)
  })
  syncEnCurso.set(script, promesa)
  return promesa
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

    // Pedidos de compra: copia forzada (botón "Actualizar datos" del hub)
    if (body?.accion === 'sync_pedidos_compra') {
      return enviar(res, 200, await correrSync('sync-pedidos-compra.js'))
    }
    if (body?.accion === 'sync_pedidos_venta') {
      return enviar(res, 200, await correrSync('sync-pedidos-venta.js'))
    }

    // Servidores configurados (para elegir en el explorador del hub)
    if (body?.accion === 'servidores') {
      return enviar(res, 200, [...SERVIDORES.values()].map((s) => ({ alias: s.alias, principal: s.principal })))
    }

    // Catálogo: bases a las que el usuario SQL tiene acceso
    let srvCat = null
    if (body?.accion === 'bases' || body?.accion === 'objetos') {
      srvCat = servidorDe(body?.servidor)
      if (!srvCat) return enviar(res, 400, { error: `No existe el servidor ${body?.servidor}` })
    }
    if (body?.accion === 'bases') {
      const r = await srvCat.pool.request().query(
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
      if (!PARTE.test(base) || !(await baseAccesible(srvCat, base))) return enviar(res, 400, { error: 'Base no disponible' })
      const r = await srvCat.pool.request().query(
        `SELECT TABLE_SCHEMA AS esquema, TABLE_NAME AS nombre,
                CASE TABLE_TYPE WHEN 'VIEW' THEN 'vista' ELSE 'tabla' END AS tipo
           FROM [${base}].INFORMATION_SCHEMA.TABLES
          ORDER BY TABLE_TYPE DESC, TABLE_SCHEMA, TABLE_NAME`,
      )
      // Solo lo que se puede pedir después: nombres con espacios u otros caracteres no pasan el filtro de PARTE
      return enviar(res, 200, (r.recordset ?? []).filter((o) => PARTE.test(o.esquema) && PARTE.test(o.nombre)))
    }

    // Estado de las réplicas (Sistemas > Réplicas): Replicador SQL local
    if (body?.accion === 'replicas') {
      return enviar(res, 200, await estadoReplicas())
    }

    vista = String(body?.vista ?? '')
    const pedido = Number(body?.top)
    const top = Math.min(Number.isFinite(pedido) && pedido > 0 ? Math.floor(pedido) : 1000, MAX_FILAS)

    // "ALIAS:nombre" = de otro servidor; sin alias, el principal
    const mAlias = vista.match(/^([A-Za-z0-9_-]{1,128}):(.*)$/)
    const srv = servidorDe(mAlias ? mAlias[1] : '')
    if (!srv) return enviar(res, 400, { error: `No existe el servidor ${mAlias?.[1]}` })
    const { pool, sql } = srv
    const nombre = mAlias ? mAlias[2] : vista

    // Nombre: "vista" (dbo de la base del .env), "esquema.objeto" o "base.esquema.objeto".
    // Sanitizado estricto de cada parte (solo SELECT, nunca otra cosa)
    const partes = nombre.split('.')
    if (partes.length > 3 || !partes.every((p) => PARTE.test(p))) {
      return enviar(res, 400, { error: 'Nombre de vista inválido' })
    }
    const [objeto, esquema = 'dbo', base = null] = [...partes].reverse()

    if (base) {
      if (!(await baseAccesible(srv, base))) return enviar(res, 400, { error: `No hay acceso a la base ${base}` })
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

    // Filtro opcional: WHERE ([col1] = @v OR [col2] = @v). Los nombres de columna
    // salen de la lista blanca (PUENTE_FILTRO_COLS) y el valor SIEMPRE va
    // parametrizado. Con coincide:'contiene' se busca con LIKE '%valor%'.
    //   body: { donde: 'ARTCOD' | ['ARTCOD','ARTICULO'], valor, coincide }
    const pedidoCols = Array.isArray(body?.donde)
      ? body.donde
      : String(body?.donde ?? '').split(',')
    const valor = String(body?.valor ?? '').trim()
    if (pedidoCols.some((c) => String(c ?? '').trim()) || valor) {
      const cols = [...new Set(
        pedidoCols
          .map((c) => String(c ?? '').trim())
          .map((c) => PUENTE_FILTRO_COLS.find((w) => w.toLowerCase() === c.toLowerCase()))
          .filter(Boolean),
      )]
      if (cols.length === 0 || !valor) {
        return enviar(res, 400, {
          error: `Filtro inválido. 'donde' debe ser una de: ${PUENTE_FILTRO_COLS.join(', ')} y 'valor' no puede quedar vacío.`,
        })
      }
      // De las columnas pedidas se usan solo las que la vista tiene: cada vista
      // nombra las suyas y el cliente manda la lista completa.
      const existentes = await columnasDe(srv, base, esquema, objeto)
      const colsUtiles = cols.filter((c) => existentes.has(c.toLowerCase()))
      if (colsUtiles.length === 0) {
        return enviar(res, 400, {
          error: `La vista ${vista} no tiene ninguna de las columnas pedidas (${cols.join(', ')}).`,
        })
      }
      const contiene = String(body?.coincide ?? '').trim().toLowerCase() === 'contiene'
      // Los comodines del usuario van escapados: solo matchea el texto buscado
      const v = contiene ? `%${valor.replace(/[\\%_[\]]/g, (m) => `\\${m}`)}%` : valor
      const op = contiene ? 'LIKE' : '='
      const where = colsUtiles.map((c) => `[${c}] ${op} @v`).join(' OR ')
      const r = await pool
        .request()
        .input('top', sql.Int, top)
        .input('v', sql.NVarChar(250), v)
        .query(`SELECT TOP (@top) * FROM ${desde} WHERE ${where}`)
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
for (const s of SERVIDORES.values()) {
  s.pool
    .connect()
    .then(() => console.log(`[puente] Conectado a SQL Server ${s.alias}: ${s.descripcion}`))
    .catch((err) => console.error(`[puente] No se pudo conectar a SQL Server ${s.alias}: ${err.message}`))
}
