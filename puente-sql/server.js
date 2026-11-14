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
 *   POST /          body: { accion: 'items_pedido_venta', codigo } -> [{ linea, articulo, ... }]
 *                   (renglones de un pedido de venta, en vivo de Dragonfish: los viejos ya no se copian)
 *   POST /          body: { accion: 'repo_diaria', fechas?, forzar? } -> { estado: 'calculando' } | { estado: 'listo', filas, resumen, ... }
 *                   (Compras > Repo diaria: sql/repo-diaria.sql + repo-diaria.js; stock MITO real = físico - comprometido)
 *   POST /          body: { accion: 'ventas_articulos', fechas, local?, agrupar?, top? } -> { estado: 'calculando' } | { estado: 'listo', ranking, ... }
 *                     (lee las bases Dragon directo con sql/ventas-articulos.sql; si falla, la foto de la repo diaria)
 *   POST /          body: { accion: 'repo_diaria_dragon', modo: 'revisar'|'cargar'|'estado', fechas, foto, locales?, confirmo? }
 *                   -> { carga: { obs, locales: [{ cliente, unidades, estado, numero }] } }
 *                   (carga la repo como pedidos de venta VTD en DRAGONFISH_MITO por la API, uno por local)
 *   POST /          body: { accion: 'stock_valorizado', forzar? } -> { bases, articulos, costo, calculado }
 *                   (Administradores > Stock valorizado: sql/stock-valorizado.sql contra el
 *                    servidor principal, recorre todas las bases DRAGONFISH_*; cache 10 min)
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
const crypto = require('crypto')

/** Compara el token en tiempo constante (con !== se podía adivinar midiendo tiempos). */
function mismoToken(recibido, esperado) {
  if (typeof recibido !== 'string' || !recibido || !esperado) return false
  const a = crypto.createHash('sha256').update(recibido).digest()
  const b = crypto.createHash('sha256').update(String(esperado)).digest()
  return crypto.timingSafeEqual(a, b)
}

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

/**
 * Renglones de un pedido de venta, igual que los copia scripts/sync-pedidos-venta.js
 * (mismas columnas y la línea numerada en el orden en que vienen). Va por el servidor
 * local (SQL2, usuario de Windows), que es el que ve el linked server de Dragonfish.
 */
const BASE_PEDIDOS_VENTA = process.env.PEDIDOS_VENTA_BASE || 'MITO.DRAGONFISH_MITO.ZooLogic'
async function itemsPedidoVenta(codigo) {
  const cod = String(codigo ?? '').trim()
  if (!/^[A-Za-z0-9]{1,40}$/.test(cod)) throw new Error('Código de pedido inválido')
  const partes = BASE_PEDIDOS_VENTA.split('.')
  if (partes.length < 2 || partes.length > 3 || !partes.every((p) => PARTE.test(p))) {
    throw new Error('PEDIDOS_VENTA_BASE inválida')
  }
  const srv = [...SERVIDORES.values()].find((s) => !s.principal)
  if (!srv) throw new Error('Falta el servidor local (SQL2_*) para leer Dragonfish')
  await asegurarConexion(srv)
  const b = partes.map((p) => `[${p}]`).join('.')
  const r = await srv.pool
    .request()
    .input('c', srv.sql.NVarChar(40), cod)
    .query(
      `SELECT D.FART, D.FTXT, D.CCOLOR, D.FCOLTXT, D.TALLE, D.FCANT, D.FPRECIO, D.FNETO, D.FMTOIVA, D.FBRUTO
         FROM ${b}.[COMPROBANTEVDET] D WHERE D.CODIGO = @c`,
    )
  const txt = (v) => String(v ?? '').trim()
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
  return (r.recordset ?? []).map((f, i) => ({
    linea: i + 1,
    articulo: txt(f.FART).replace(/\s/g, '').toUpperCase() || null,
    descripcion: txt(f.FTXT) || null,
    color: txt(f.CCOLOR) || null,
    color_nombre: txt(f.FCOLTXT) || null,
    talle: txt(f.TALLE) || null,
    cantidad: num(f.FCANT),
    precio: num(f.FPRECIO),
    neto: num(f.FNETO),
    iva: num(f.FMTOIVA),
    bruto: num(f.FBRUTO),
  }))
}

/**
 * Órdenes de compras: colores y talles de un artículo en DRAGONFISH_<base> (COMB + COL).
 * Solo lectura, parametrizado. Bases permitidas: las de PUENTE_BASES_DRAGON (por defecto INDOD).
 */
const BASES_DRAGON = (process.env.PUENTE_BASES_DRAGON || 'INDOD').split(',').map((b) => b.trim().toUpperCase()).filter(Boolean)
async function dragonVariantes(base, articulo) {
  const b = String(base ?? '').trim().toUpperCase()
  const art = String(articulo ?? '').trim().toUpperCase()
  if (!BASES_DRAGON.includes(b)) throw new Error(`Base no habilitada: ${b}`)
  if (!ARTICULO_DRAGON.test(art)) throw new Error('Artículo inválido')
  const srv = SERVIDORES.get(ALIAS_PRINCIPAL.toUpperCase())
  await asegurarConexion(srv)
  const db = `[DRAGONFISH_${b}].[ZooLogic]`
  const r = await srv.pool
    .request()
    .input('a', srv.sql.NVarChar(40), art)
    .query(
      `SELECT DISTINCT RTRIM(C.COCOL) AS color, RTRIM(ISNULL(L.COLDES, '')) AS nombre, RTRIM(C.TALLE) AS talle
         FROM ${db}.[COMB] C LEFT JOIN ${db}.[COL] L ON RTRIM(L.COLCOD) = RTRIM(C.COCOL)
        WHERE C.COART = @a`,
    )
  return armarVariantes(r.recordset ?? [])
}

const ARTICULO_DRAGON = /^[A-Z0-9._/-]{1,40}$/

function armarVariantes(filas) {
  const colores = [...new Map(filas.filter((f) => f.color).map((f) => [f.color, { codigo: f.color, nombre: f.nombre }])).values()]
    .sort((x, y) => x.codigo.localeCompare(y.codigo))
  const orden = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'U']
  const pos = (t) => (/^\d+$/.test(t) ? Number(t) : 1000 + (orden.indexOf(t) < 0 ? 99 : orden.indexOf(t)))
  const talles = [...new Set(filas.map((f) => f.talle).filter(Boolean))].sort((x, y) => pos(x) - pos(y) || x.localeCompare(y))
  return { colores, talles }
}

/**
 * Precio vigente de cada artículo en una lista de Dragon (ZooLogic.PRECIOAR, PDIRECTO): el de FECHAVIG más nueva
 * que ya rige (hay FECHAVIG con años a futuro, ej. 2319, que no cuentan). Va por artículo (CCOLOR/TALLE casi
 * siempre vacíos). Es el precio sin IVA, el mismo que queda en los pedidos de compra. Sin lista -> {}.
 */
const LISTA_DRAGON = /^[A-Z0-9_]{1,20}$/
async function preciosLista(srv, db, listaPrecios, codigos) {
  const l = String(listaPrecios ?? '').trim().toUpperCase()
  if (!LISTA_DRAGON.test(l) || !codigos.length) return {}
  const p = srv.pool.request().input('lista', srv.sql.VarChar(20), l)
  codigos.forEach((c, i) => p.input(`p${i}`, srv.sql.VarChar(40), c))
  const r = await p.query(
    `SELECT articulo, precio FROM (
       SELECT LTRIM(RTRIM(ARTICULO)) AS articulo, PDIRECTO AS precio,
              ROW_NUMBER() OVER (PARTITION BY LTRIM(RTRIM(ARTICULO)) ORDER BY FECHAVIG DESC, HMODIFW DESC) AS n
         FROM ${db}.[PRECIOAR]
        WHERE LTRIM(RTRIM(LISTAPRE)) = @lista AND FECHAVIG <= GETDATE()
          AND LTRIM(RTRIM(ARTICULO)) IN (${codigos.map((_, i) => `@p${i}`).join(',')})
     ) x WHERE n = 1`,
  )
  return Object.fromEntries((r.recordset ?? []).map((f) => [String(f.articulo).toUpperCase(), Number(f.precio) || 0]))
}

/** Buscador de artículos en vivo sobre ZooLogic.ART de la base elegida: cada palabra tiene que estar en el código o la descripción.
    Con listaPrecios trae también el precio vigente de esa lista. */
async function dragonBuscarArticulos(base, texto, listaPrecios) {
  const b = String(base ?? '').trim().toUpperCase()
  if (!BASES_DRAGON.includes(b)) throw new Error(`Base no habilitada: ${b}`)
  const palabras = String(texto ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 4)
  if (!palabras.length) return []
  const srv = SERVIDORES.get(ALIAS_PRINCIPAL.toUpperCase())
  await asegurarConexion(srv)
  const like = (w) => `%${w.replace(/[\\%_[]/g, '\\$&')}%`
  const pedido = srv.pool.request()
  palabras.forEach((w, i) => pedido.input(`w${i}`, srv.sql.VarChar(80), like(w)))
  pedido.input('inicio', srv.sql.VarChar(80), `${palabras[0].replace(/[\\%_[]/g, '\\$&')}%`)
  const r = await pedido.query(
    `SELECT TOP 30 LTRIM(RTRIM(ARTCOD)) AS articulo, RTRIM(ISNULL(ARTDES, '')) AS descripcion, RTRIM(ISNULL(ARTFAB, '')) AS proveedor
       FROM [DRAGONFISH_${b}].[ZooLogic].[ART]
      WHERE ${palabras.map((_, i) => `(ARTCOD LIKE @w${i} ESCAPE '\\' OR ARTDES LIKE @w${i} ESCAPE '\\')`).join(' AND ')}
      ORDER BY CASE WHEN LTRIM(ARTCOD) LIKE @inicio ESCAPE '\\' THEN 0 ELSE 1 END, ARTCOD DESC`,
  )
  const arts = r.recordset ?? []
  const precios = await preciosLista(srv, `[DRAGONFISH_${b}].[ZooLogic]`, listaPrecios, arts.map((a) => a.articulo.toUpperCase()))
  return arts.map((a) => ({ ...a, precio: precios[a.articulo.toUpperCase()] ?? null }))
}

/** Descripción, colores y talles de varios artículos juntos (importar el txt de la OC). Solo vuelven los que existen en la base. */
async function dragonDatosArticulos(base, codigos, listaPrecios) {
  const b = String(base ?? '').trim().toUpperCase()
  if (!BASES_DRAGON.includes(b)) throw new Error(`Base no habilitada: ${b}`)
  const lista = [...new Set((Array.isArray(codigos) ? codigos : []).map((c) => String(c).trim().toUpperCase()))]
  if (!lista.length) return []
  if (lista.length > 100) throw new Error('Máximo 100 artículos por pedido')
  if (lista.some((c) => !ARTICULO_DRAGON.test(c))) throw new Error('Artículo inválido')
  const srv = SERVIDORES.get(ALIAS_PRINCIPAL.toUpperCase())
  await asegurarConexion(srv)
  const db = `[DRAGONFISH_${b}].[ZooLogic]`
  const cargar = (p) => { lista.forEach((c, i) => p.input(`a${i}`, srv.sql.VarChar(40), c)); return p }
  const params = lista.map((_, i) => `@a${i}`).join(',')
  const arts = await cargar(srv.pool.request()).query(
    `SELECT LTRIM(RTRIM(ARTCOD)) AS articulo, RTRIM(ISNULL(ARTDES, '')) AS descripcion, RTRIM(ISNULL(ARTFAB, '')) AS proveedor
       FROM ${db}.[ART] WHERE ARTCOD IN (${params})`,
  )
  const combs = await cargar(srv.pool.request()).query(
    `SELECT DISTINCT RTRIM(C.COART) AS articulo, RTRIM(C.COCOL) AS color, RTRIM(ISNULL(L.COLDES, '')) AS nombre, RTRIM(C.TALLE) AS talle
       FROM ${db}.[COMB] C LEFT JOIN ${db}.[COL] L ON RTRIM(L.COLCOD) = RTRIM(C.COCOL)
      WHERE C.COART IN (${params})`,
  )
  const precios = await preciosLista(srv, db, listaPrecios, lista)
  return (arts.recordset ?? []).map((a) => ({
    ...a,
    precio: precios[a.articulo.toUpperCase()] ?? null,
    ...armarVariantes((combs.recordset ?? []).filter((f) => f.articulo.toUpperCase() === a.articulo.toUpperCase())),
  }))
}

/** Servidor por alias (sin alias = el principal). null si no existe. */
function servidorDe(alias) {
  if (!alias) return SERVIDORES.get(ALIAS_PRINCIPAL.toUpperCase())
  return PARTE.test(alias) ? SERVIDORES.get(String(alias).toUpperCase()) ?? null : null
}

/**
 * Reconecta el pool si quedó cerrado (el SQL se reinició, se cortó la red, etc.).
 * Sin esto, una vez caída la conexión todas las consultas respondían
 * "Connection is closed." hasta reiniciar el puente a mano.
 */
async function asegurarConexion(srv) {
  const p = srv.pool
  if (p.connected || p.connecting) return
  await p.connect()
  console.log(`[puente] Reconectado a SQL Server ${srv.alias}: ${srv.descripcion}`)
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

/* =========================================================================
 * Stock valorizado a costo (Administradores > Stock valorizado)
 *
 * Corre sql/stock-valorizado.sql contra el SQL Server PRINCIPAL (ahí viven
 * todas las bases DRAGONFISH_* del grupo). Tarda entre 8 y 20 s porque recorre
 * base por base, así que se cachea 10 minutos: el stock de un depósito no
 * cambia de un minuto al otro y la pantalla tiene botón "Actualizar"
 * (forzar: true, que sí espera el recálculo).
 *
 * Vencido el cache se entrega igual la foto anterior y el recálculo arranca por
 * detrás: así espera el primero que entra y nadie más.
 * ========================================================================= */

const SCRIPT_STOCK_VALORIZADO = path.join(__dirname, 'sql', 'stock-valorizado.sql')
const STOCK_VALORIZADO_CACHE_MS = Math.max(10_000, Number(process.env.STOCK_VALORIZADO_CACHE_MS) || 600_000)

/**
 * Esta consulta no puede ir por el pool común: los pools se arman con el
 * requestTimeout que trae mssql de fábrica (15 s) y recorrer ~30 bases tarda
 * entre 8 y 20 s según cómo esté el servidor, así que caía con
 * "Timeout: Request failed to complete in 15000ms". Subirle el timeout al pool
 * principal dejaría a cualquier vista pesada colgada 3 minutos; en cambio, acá
 * se abre una conexión propia, se usa y se cierra.
 */
const STOCK_VALORIZADO_TIMEOUT_MS = Math.max(30_000, Number(process.env.STOCK_VALORIZADO_TIMEOUT_MS) || 180_000)

async function conexionLarga() {
  const { host, port } = hostPuerto(SQL_SERVER)
  const pool = new sql.ConnectionPool({
    server: host,
    ...(port ? { port } : {}),
    database: SQL_DATABASE,
    user: SQL_USER,
    password: SQL_PASSWORD,
    options: { encrypt: SQL_ENCRYPT === 'true', trustServerCertificate: SQL_TRUST_CERT !== 'false' },
    requestTimeout: STOCK_VALORIZADO_TIMEOUT_MS,
    pool: { max: 1, min: 0, idleTimeoutMillis: 1000 },
  })
  pool.on('error', (err) => console.error('[puente] Error de pool (stock valorizado):', err.message))
  return pool.connect()
}

/**
 * `datos` es lo que viaja al hub; `porBase` es el artículo por artículo dentro
 * de cada base, que se calcula en la misma corrida pero NO se manda: son 50.000
 * filas (5,6 MB) y la respuesta se iba a 8,4 MB, muy arriba del tope de ~4,5 MB
 * de Vercel. Queda acá y la pantalla pide la base que abre
 * (`accion: 'stock_valorizado_base'`), que sale del cache sin tocar el SQL.
 */
let cacheStockValorizado = { en: 0, datos: null, porBase: null }
{
  // La última corrida guardada en D:\memoria ia (con su hora real: si venció, se recalcula igual)
  const g = require('./memoria-ia').leer('stock-valorizado')
  if (g?.datos && g.porBase instanceof Map && Number(g.en) > 0) cacheStockValorizado = g
}
let stockValorizadoEnCurso = null

async function stockValorizado(forzar) {
  const ahora = Date.now()
  const hay = cacheStockValorizado.datos
  const fresco = hay && ahora - cacheStockValorizado.en < STOCK_VALORIZADO_CACHE_MS
  if (!forzar && fresco) return { ...hay, cacheado: true }

  // Dos pedidos a la vez comparten la misma corrida (la consulta es pesada)
  if (stockValorizadoEnCurso) {
    // Con una foto vieja a mano, se la devuelve ya en vez de hacer esperar 20 s
    return !forzar && hay ? { ...hay, cacheado: true } : stockValorizadoEnCurso
  }

  stockValorizadoEnCurso = (async () => {
    if (!fs.existsSync(SCRIPT_STOCK_VALORIZADO)) throw new Error('Falta sql/stock-valorizado.sql junto a server.js')

    const t0 = Date.now()
    const pool = await conexionLarga()
    let r
    try {
      r = await pool.request().query(fs.readFileSync(SCRIPT_STOCK_VALORIZADO, 'utf8'))
    } finally {
      await pool.close().catch(() => {})
    }
    const [
      bases = [],
      articulos = [],
      costo = [],
      sinCosto = [],
      sinCostoDetalle = [],
      cruce = [],
      nombresClas = [],
      artPorBase = [],
    ] = r.recordsets ?? []

    const datos = {
      servidor: ALIAS_PRINCIPAL,
      bases: bases.map((f) => ({
        base: String(f.base ?? ''),
        unidades: Number(f.unidades) || 0,
        valorizado: Number(f.valorizado) || 0,
        unidades_sin_costo: Number(f.unidades_sin_costo) || 0,
        skus: Number(f.skus) || 0,
        // Mercadería en tránsito (ya va sumada en unidades/valorizado)
        transito: Number(f.transito) || 0,
        transito_val: Number(f.transito_val) || 0,
      })),
      articulos: articulos.map((f) => ({
        articulo: String(f.articulo ?? '').trim(),
        descripcion: String(f.descripcion ?? '').trim(),
        unidades: Number(f.unidades) || 0,
        valorizado: Number(f.valorizado) || 0,
        costo: f.costo == null ? null : Number(f.costo),
        transito: Number(f.transito) || 0,
        proveedor: String(f.proveedor ?? '').trim(),
        material: String(f.material ?? '').trim(),
      })),
      costo: {
        lista: 'LISTA0',
        lista_nombre: 'Compra',
        // Base de donde sale la lista de costos (ver sql/stock-valorizado.sql)
        base: 'INDO',
        articulos_con_costo: Number(costo[0]?.articulos_con_costo) || 0,
      },
      // Todos los que tienen stock y no tienen costo cargado (valen $0)
      sin_costo: sinCosto.map((f) => ({
        articulo: String(f.articulo ?? '').trim(),
        descripcion: String(f.descripcion ?? '').trim(),
        unidades: Number(f.unidades) || 0,
        unidades_val: Number(f.unidades_val) || 0,
        sucursales: Number(f.sucursales) || 0,
        bases: String(f.bases ?? '').trim(),
        proveedor: String(f.proveedor ?? '').trim(),
        material: String(f.material ?? '').trim(),
      })),
      // Esos mismos, abiertos por sucursal: una fila por artículo y base
      sin_costo_detalle: sinCostoDetalle.map((f) => ({
        articulo: String(f.articulo ?? '').trim(),
        base: String(f.base ?? ''),
        unidades: Number(f.unidades) || 0,
        valoriza: Number(f.valoriza) === 1,
      })),
      // Sucursal x proveedor x material: con esto la pantalla rearma las tarjetas
      // y la tabla por sucursal cuando se filtra, sin volver a pedirle nada al SQL
      cruce: cruce.map((f) => ({
        base: String(f.base ?? ''),
        proveedor: String(f.proveedor ?? '').trim(),
        material: String(f.material ?? '').trim(),
        unidades: Number(f.unidades) || 0,
        valorizado: Number(f.valorizado) || 0,
        unidades_sin_costo: Number(f.unidades_sin_costo) || 0,
        skus: Number(f.skus) || 0,
        transito: Number(f.transito) || 0,
        transito_val: Number(f.transito_val) || 0,
      })),
      // Nombres de esos códigos: { tipo: 'prov' | 'mat', codigo, nombre }
      clasificaciones: nombresClas.map((f) => ({
        tipo: String(f.tipo ?? ''),
        codigo: String(f.codigo ?? '').trim(),
        nombre: String(f.nombre ?? '').trim(),
      })),
      calculado: new Date().toISOString(),
      segundos: Math.round((Date.now() - t0) / 100) / 10,
    }
    /* El detalle por base se agrupa una vez acá y queda a mano para
       `stock_valorizado_base`: así abrir una sucursal es instantáneo y sale
       siempre de la misma corrida que la fila que se está abriendo (los
       números no pueden discrepar). */
    const porBase = new Map()
    for (const f of artPorBase) {
      const base = String(f.base ?? '')
      const fila = {
        articulo: String(f.articulo ?? '').trim(),
        unidades: Number(f.unidades) || 0,
        valorizado: Number(f.valorizado) || 0,
        costo: f.costo == null ? null : Number(f.costo),
        transito: Number(f.transito) || 0,
      }
      const lista = porBase.get(base)
      if (lista) lista.push(fila)
      else porBase.set(base, [fila])
    }

    cacheStockValorizado = { en: Date.now(), datos, porBase }
    // Copia en D:\memoria ia: después de un reinicio se muestra esta al toque (y se recalcula si venció)
    require('./memoria-ia').guardar('stock-valorizado', cacheStockValorizado)
    return { ...datos, cacheado: false }
  })().finally(() => {
    stockValorizadoEnCurso = null
  })

  // Cache vencido: se devuelve la foto anterior al toque y el recálculo sigue
  // por detrás (así solo espera el primero del día, no uno cada diez minutos).
  if (!forzar && hay) {
    stockValorizadoEnCurso.catch((e) => console.error('[puente] stock valorizado:', e.message))
    return { ...hay, cacheado: true }
  }

  return stockValorizadoEnCurso
}

/**
 * Los artículos de UNA base, para el desplegable de la tabla por sucursal.
 * Sale del cache de la corrida completa: no vuelve a tocar el SQL y es la misma
 * foto que la fila que se está abriendo. Si todavía no hay cache (el puente
 * recién arrancó), calcula primero.
 */
async function stockValorizadoDeBase(base) {
  const pedida = String(base ?? '').trim()
  if (!pedida) throw new Error('Falta la base')
  if (!cacheStockValorizado.porBase) await stockValorizado(false)
  const porBase = cacheStockValorizado.porBase
  return {
    base: pedida,
    articulos: porBase?.get(pedida) ?? [],
    calculado: cacheStockValorizado.datos?.calculado ?? null,
  }
}


/* ---- Repo diaria (Compras > Repo diaria del hub) ----------------------------------
 * Reemplaza a TRANSFER.pbix + repo_diaria.py: lee el DWH en vivo (sql/repo-diaria.sql)
 * y reparte el stock REAL de MITO (físico - comprometido) con repo-diaria.js.
 * La lectura tarda ~45 s (la vista de ventas no filtra por fecha), más de lo que
 * aguanta una función de Vercel: se lanza por detrás y el hub vuelve a preguntar
 * hasta que está ("estado: calculando" -> "listo"). La foto se reusa 5 minutos
 * para cambiar de día sin volver al SQL; "Actualizar" (forzar) saca una nueva.
 */
const repoDiaria = require('./repo-diaria')
const cascadaLocales = require('./cascada')
const programador = require('./programador')
const SCRIPT_REPO_DIARIA = path.join(__dirname, 'sql', 'repo-diaria.sql')
const REPO_DIARIA_CACHE_MS = 5 * 60_000
const REPO_DIARIA_DIAS = 12
let fotoRepo = { en: 0, foto: null, segundos: null, error: null }
{
  // La última foto del DWH guardada en D:\memoria ia, con su hora real: las reglas de siempre
  // (5 minutos para la repo, "sacada hoy" para el chat) deciden si sirve o hay que sacar otra.
  const g = require('./memoria-ia').leer('foto-dwh')
  if (g?.foto?.arts instanceof Map && Number(g.en) > 0) fotoRepo = { en: g.en, foto: g.foto, segundos: g.segundos ?? null, error: null }
}
let fotoRepoEnCurso = null
let fotoRepoInicio = 0
/** Días que ya tienen pedidos «REPO DIARIA (…)» en Dragon (últimas 2 semanas). */
let diasEnDragon = { en: 0, dias: new Set(), enCurso: null }

/** Relee de Dragon qué días ya tienen repo cargada (no frena nada si falla). */
function refrescarDiasEnDragon() {
  if (diasEnDragon.enCurso) return diasEnDragon.enCurso
  diasEnDragon.enCurso = obsRepoEnDragon()
    .then((obs) => {
      const dias = new Set()
      for (const o of obs) programador.diasDeObs(o).forEach((d) => dias.add(d))
      diasEnDragon = { en: Date.now(), dias, enCurso: null }
    })
    .catch((e) => {
      console.error('[puente] días con repo en Dragon:', e.message)
      diasEnDragon = { ...diasEnDragon, en: Date.now(), enCurso: null } // reintenta en 5 min
    })
  return diasEnDragon.enCurso
}

/**
 * Días que la pantalla elige sola: los días con venta DESPUÉS del último que ya tiene repo en
 * Dragon (si un lunes no se trabajó, el martes trae viernes, sábado, domingo y lunes).
 * Vacío = el último día con venta (lo decide calcularRepo).
 */
function diasPendientesRepo(foto, hoy) {
  const ultimo = [...diasEnDragon.dias].sort().pop()
  if (!ultimo) return []
  return foto.dias.filter((d) => d.unidades > 0 && d.dia < hoy && d.dia > ultimo).map((d) => d.dia).sort().slice(-7)
}

/** 'YYYY-MM-DD' en la hora de esta PC (Argentina), corrido `menos` días. */
function diaLocal(menos = 0) {
  const d = new Date()
  d.setDate(d.getDate() - menos)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function lanzarFotoRepo() {
  if (fotoRepoEnCurso) return
  fotoRepoInicio = Date.now()
  fotoRepoEnCurso = (async () => {
    if (!fs.existsSync(SCRIPT_REPO_DIARIA)) throw new Error('Falta sql/repo-diaria.sql junto a server.js')
    const enDragon = refrescarDiasEnDragon()
    const t0 = Date.now()
    const pool = await conexionLarga()
    let r
    try {
      r = await pool
        .request()
        .input('desde', sql.VarChar(10), diaLocal(REPO_DIARIA_DIAS))
        .query(fs.readFileSync(SCRIPT_REPO_DIARIA, 'utf8'))
    } finally {
      await pool.close().catch(() => {})
    }
    fotoRepo = {
      en: Date.now(),
      foto: repoDiaria.prepararFoto(r.recordsets),
      segundos: Math.round((Date.now() - t0) / 100) / 10,
      error: null,
    }
    require('./memoria-ia').guardar('foto-dwh', { en: fotoRepo.en, segundos: fotoRepo.segundos, foto: fotoRepo.foto })
    await enDragon
  })()
    .catch((e) => {
      console.error('[puente] repo diaria:', e.message)
      fotoRepo = { ...fotoRepo, error: e.message }
    })
    .finally(() => {
      fotoRepoEnCurso = null
    })
}

/** body: { fechas?: ['YYYY-MM-DD'], forzar?: bool } */
function accionRepoDiaria(body) {
  const calculando = () => ({ estado: 'calculando', desde: new Date(fotoRepoInicio).toISOString() })
  if (fotoRepoEnCurso) return calculando()

  if (fotoRepo.error) {
    const error = fotoRepo.error
    fotoRepo = { ...fotoRepo, error: null }
    throw new Error(error)
  }

  const fresca = fotoRepo.foto && Date.now() - fotoRepo.en < REPO_DIARIA_CACHE_MS
  // forzar = foto nueva, salvo que la última tenga menos de 20 s (doble clic / la que se acaba de pedir)
  const recienSacada = fotoRepo.foto && Date.now() - fotoRepo.en < 20_000
  if (!fresca || (body?.forzar === true && !recienSacada)) {
    lanzarFotoRepo()
    return calculando()
  }

  // Lo que Dragon ya tiene cargado puede cambiar sin foto nueva (carga a mano o automática)
  if (Date.now() - diasEnDragon.en > REPO_DIARIA_CACHE_MS) {
    refrescarDiasEnDragon()
    if (!diasEnDragon.en && !body?.fechas?.length) return calculando() // primera vez: esperar a saberlo
  }
  let fechas = Array.isArray(body?.fechas) ? body.fechas.filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(String(f))) : []
  if (!fechas.length) fechas = diasPendientesRepo(fotoRepo.foto, diaLocal())
  const repo = repoDiaria.calcularRepo(fotoRepo.foto, { fechas, hoy: diaLocal() })
  // Cascada entre locales con lo que MITO no cubrió (misma foto, mismos días, parámetros guardados)
  let cascada = null
  try {
    cascada = cascadaLocales.calcularCascada(fotoRepo.foto, repo, body?.params)
  } catch (e) {
    cascada = { error: e.message }
  }
  return {
    estado: 'listo',
    foto: new Date(fotoRepo.en).toISOString(),
    segundos: fotoRepo.segundos,
    ...repo,
    dias_en_dragon: repo.dias_disponibles.map((d) => d.dia).filter((d) => diasEnDragon.dias.has(d)),
    cascada,
  }
}

/** ¿La foto en memoria se sacó hoy (fecha de esta PC)? */
function fotoDeHoy() {
  if (!fotoRepo.foto || !fotoRepo.en) return false
  const d = new Date(fotoRepo.en)
  const dia = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return dia === diaLocal()
}

/**
 * Foto del DWH lista a la mañana para el Chat IA: a partir de las 7:30, si todavía no hay
 * una foto de hoy, se saca una (una sola lectura del DWH por día; si la repo automática
 * ya sacó la suya, no hace nada). PUENTE_FOTO_MANANA=0 lo apaga.
 */
function iniciarFotoManana() {
  if (process.env.PUENTE_FOTO_MANANA === '0') return
  setInterval(() => {
    const ahora = new Date()
    const minutos = ahora.getHours() * 60 + ahora.getMinutes()
    if (minutos < 7 * 60 + 30 || minutos > 21 * 60) return
    if (fotoRepoEnCurso || fotoDeHoy()) return
    console.log('[puente] foto del DWH de la mañana (Chat IA)')
    lanzarFotoRepo()
  }, 5 * 60_000).unref?.()
}

/* ---- Ventas por artículo DIRECTO de las bases (Chat IA) -----------------------------------
 * sql/ventas-articulos.sql lee COMPROBANTEV/DET de cada base solo en las fechas pedidas, en los dos
 * servidores a la vez: las réplicas del Replicador SQL en esta PC (SQL2, usuario de Windows) y el
 * resto de las bases en el principal. Tarda 1-2 s por día y no depende de que los locales respondan
 * (la vista del DWH tarda ~1 minuto). Las listas son las mismas bases que arma vw_FACT_VENTAS_STOCK;
 * se pueden cambiar con PUENTE_VENTAS_BASES_PRINCIPAL / PUENTE_VENTAS_BASES_LOCAL (separadas por coma).
 * Si algo falla, se vuelve a la foto del DWH de siempre.
 */
const SCRIPT_VENTAS_ARTICULOS = path.join(__dirname, 'sql', 'ventas-articulos.sql')
const listaBases = (env, porDefecto) =>
  (process.env[env] || porDefecto)
    .split(',')
    .map((b) => b.trim().toUpperCase())
    .filter((b) => PARTE.test(b))
const VENTAS_BASES_PRINCIPAL = listaBases(
  'PUENTE_VENTAS_BASES_PRINCIPAL',
  'DRAGONFISH_9DEJULIO,DRAGONFISH_BUSTOD,DRAGONFISH_CENTRALD,DRAGONFISH_CFD,DRAGONFISH_CFPO,DRAGONFISH_CFR4,' +
    'DRAGONFISH_CFR9,DRAGONFISH_CFRA,DRAGONFISH_DINOD,DRAGONFISH_GRALPAZ,DRAGONFISH_INDO,DRAGONFISH_INDOD,' +
    'DRAGONFISH_LIBERD,DRAGONFISH_NOMED,DRAGONFISH_NVOCED,DRAGONFISH_OUTLETD,DRAGONFISH_TX-POLO,' +
    'DRAGONFISH_WALMARTD,DRAGONFISH_POLO52,DRAGONFISH_MITO',
)
const VENTAS_BASES_LOCAL = listaBases(
  'PUENTE_VENTAS_BASES_LOCAL',
  'DRAGONFISH_9DEJUL2,DRAGONFISH_ESPINOD,DRAGONFISH_FABRICA,DRAGONFISH_MUNOZ,DRAGONFISH_NVOCED2,' +
    'DRAGONFISH_RIVERAD,DRAGONFISH_RUTA9D2,DRAGONFISH_VCPD',
)
const memoria = require('./memoria-ia')
const VENTAS_DIRECTO_TIMEOUT_MS = 18_000 // el hub espera 25 s al puente
// Días cerrados que se guardan solos en D:\memoria ia\ventas (y se completan por detrás)
const VENTAS_MEMORIA_DIAS = Math.max(0, Number(process.env.PUENTE_MEMORIA_VENTAS_DIAS ?? 90) || 0)
const VENTAS_HOY_MS = 60_000 // el día abierto se vuelve a leer después de 1 minuto

/**
 * dia -> { dia, en, unidades, filas: [[Tienda, art, color, talle, cant], ...], bases_con_error, fijo }
 * fijo = día cerrado y completo: no cambia más y está guardado en disco.
 */
const ventasDia = new Map()

const conTope = (promesa, ms, que) =>
  Promise.race([promesa, new Promise((_, no) => setTimeout(() => no(new Error(`${que}: más de ${ms / 1000} s`)), ms).unref?.())])

/**
 * Un día está cerrado cuando pasaron 2 horas desde su medianoche siguiente: para entonces
 * el Replicador ya copió lo último de los locales. Recién ahí se guarda para siempre.
 */
const diaCerrado = (dia) => Date.now() >= new Date(`${dia}T00:00:00`).getTime() + 26 * 3_600_000

function sumarDia(dia, n) {
  const d = new Date(`${dia}T12:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function ventasDeServidor(srv, bases, desde, hasta) {
  await asegurarConexion(srv)
  const r = await srv.pool
    .request()
    .input('desde', srv.sql.VarChar(10), desde)
    .input('hasta', srv.sql.VarChar(10), hasta)
    .input('bases', srv.sql.NVarChar(4000), bases.join(','))
    .query(fs.readFileSync(SCRIPT_VENTAS_ARTICULOS, 'utf8'))
  const [dias = [], ventas = [], estado = []] = r.recordsets ?? []
  return { dias, ventas, estado }
}

/** Lee del SQL los días desde..hasta (los dos servidores a la vez) y los deja en memoria (y en disco si cerraron). */
async function leerVentasDelSql(desde, hasta) {
  const principal = SERVIDORES.get(ALIAS_PRINCIPAL.toUpperCase())
  const local = [...SERVIDORES.values()].find((s) => !s.principal)
  if (!local) throw new Error('Falta el servidor local (SQL2_*) con las réplicas')
  if (!fs.existsSync(SCRIPT_VENTAS_ARTICULOS)) throw new Error('Falta sql/ventas-articulos.sql junto a server.js')
  const partes = await conTope(
    Promise.all([
      ventasDeServidor(principal, VENTAS_BASES_PRINCIPAL, desde, hasta),
      ventasDeServidor(local, VENTAS_BASES_LOCAL, desde, hasta),
    ]),
    VENTAS_DIRECTO_TIMEOUT_MS,
    'ventas directo',
  )
  const fallidas = partes.flatMap((p) => p.estado.filter((e) => !e.ok).map((e) => `${e.base}: ${e.error}`))
  // Si no se pudo leer ninguna base de un servidor, mejor la foto del DWH que un ranking a medias
  if (partes.some((p, i) => !p.estado.some((e) => e.ok) && (i === 0 ? VENTAS_BASES_PRINCIPAL : VENTAS_BASES_LOCAL).length)) {
    throw new Error(`no se leyó ninguna base: ${fallidas.slice(0, 3).join('; ')}`)
  }
  const en = Date.now()
  const nuevos = new Map()
  for (let d = desde; d <= hasta; d = sumarDia(d, 1)) {
    nuevos.set(d, { dia: d, en, unidades: 0, filas: [], bases_con_error: fallidas, fijo: false })
  }
  const t = (v) => String(v ?? '').trim()
  for (const f of partes.flatMap((p) => p.dias)) {
    const r = nuevos.get(t(f.dia))
    if (r) r.unidades += Number(f.unidades) || 0
  }
  for (const f of partes.flatMap((p) => p.ventas)) {
    const r = nuevos.get(t(f.dia))
    if (r) r.filas.push([t(f.Tienda), t(f.ID_ART), t(f.ID_COLOR), t(f.ID_TALLE), Number(f.cant) || 0])
  }
  for (const r of nuevos.values()) {
    // Solo se guarda para siempre un día cerrado y leído entero (sin bases con error)
    if (diaCerrado(r.dia) && !fallidas.length) {
      r.fijo = memoria.guardar(`ventas/${r.dia}`, { ...r, fijo: true, guardado: new Date(en).toISOString() })
    }
    ventasDia.set(r.dia, r)
  }
  return nuevos
}

/** Los días pedidos: de la memoria (RAM o disco) los que se puedan, del SQL el resto. */
async function ventasDeDias(dias) {
  const listos = new Map()
  const faltan = []
  for (const dia of dias) {
    let r = ventasDia.get(dia)
    if (!r?.fijo && diaCerrado(dia)) {
      const disco = memoria.leer(`ventas/${dia}`)
      if (disco?.dia === dia) {
        r = { ...disco, fijo: true }
        ventasDia.set(dia, r)
      }
    }
    if (r && (r.fijo || Date.now() - r.en < VENTAS_HOY_MS)) listos.set(dia, r)
    else faltan.push(dia)
  }
  if (faltan.length) {
    const nuevos = await leerVentasDelSql(faltan[0], faltan[faltan.length - 1])
    for (const dia of faltan) listos.set(dia, nuevos.get(dia))
  }
  return dias.map((d) => listos.get(d)).filter(Boolean)
}

/**
 * Completa por detrás la memoria de ventas: los últimos VENTAS_MEMORIA_DIAS días cerrados que
 * no estén en disco, de a uno (1-2 s cada uno, para no cargar el SQL). Al arrancar y cada 6 horas.
 */
let completandoVentas = false
async function completarMemoriaVentas() {
  if (completandoVentas || !VENTAS_MEMORIA_DIAS) return
  completandoVentas = true
  let hechos = 0
  try {
    for (let i = 1; i <= VENTAS_MEMORIA_DIAS; i++) {
      const dia = diaLocal(i)
      if (!diaCerrado(dia) || memoria.existe(`ventas/${dia}`)) continue
      await leerVentasDelSql(dia, dia)
      hechos++
      await new Promise((ok) => setTimeout(ok, 500))
    }
    if (hechos) console.log(`[puente] memoria: ${hechos} días de venta guardados en ${memoria.DIR}`)
  } catch (e) {
    console.error('[puente] memoria: no se pudo completar la venta guardada:', e.message)
  } finally {
    completandoVentas = false
  }
}
function iniciarMemoriaVentas() {
  if (!VENTAS_MEMORIA_DIAS) return
  setTimeout(completarMemoriaVentas, 60_000).unref?.()
  setInterval(completarMemoriaVentas, 6 * 3_600_000).unref?.()
}

/**
 * Descripción, grupo, material y proveedor de los artículos (maestro de INDOD, como vw_DIM_ARTICULO).
 * Lo ya buscado queda en D:\memoria ia\articulos.json y se reusa 7 días.
 */
const ARTICULOS_MEMORIA_MS = 7 * 86_400_000
const artsMemoria = new Map(Object.entries(memoria.leer('articulos') ?? {}))
async function maestroArticulos(codigos) {
  const arts = new Map()
  const pedidos = [...new Set(codigos)].filter((c) => /^[A-Za-z0-9._/ -]{1,40}$/.test(c)).slice(0, 200)
  const lista = []
  for (const c of pedidos) {
    const m = artsMemoria.get(c)
    if (m && Date.now() - (m.en || 0) < ARTICULOS_MEMORIA_MS) arts.set(c, m)
    else lista.push(c)
  }
  if (!lista.length) return arts
  const srv = SERVIDORES.get(ALIAS_PRINCIPAL.toUpperCase())
  await asegurarConexion(srv)
  const p = srv.pool.request()
  lista.forEach((c, i) => p.input(`a${i}`, srv.sql.VarChar(40), c))
  const r = await p.query(`
    SELECT LTRIM(RTRIM(a.ARTCOD)) AS ID_ART, LTRIM(RTRIM(a.ARTDES)) AS ARTICULO, LTRIM(RTRIM(a.ARTDESADIC)) AS ARTICULO_ADICIONAL,
           LTRIM(RTRIM(pr.DESCFW)) AS PROVEEDOR, UPPER(LTRIM(RTRIM(a.GRUPO))) AS ID_GRUPO, LTRIM(RTRIM(g.DESCRIP)) AS GRUPO,
           LTRIM(RTRIM(a.MAT)) AS ID_MATERIAL, LTRIM(RTRIM(m.MATDES)) AS MATERIAL
      FROM DRAGONFISH_INDOD.ZooLogic.ART a
      OUTER APPLY (SELECT TOP 1 DESCFW FROM DRAGONFISH_INDOD.ZooLogic.PROV t WHERE t.CLCOD = a.ARTFAB) pr
      OUTER APPLY (SELECT TOP 1 DESCRIP FROM DRAGONFISH_INDOD.ZooLogic.GRUPO t WHERE RTRIM(t.COD) = RTRIM(a.GRUPO)) g
      OUTER APPLY (SELECT TOP 1 MATDES FROM DRAGONFISH_INDOD.ZooLogic.MAT t WHERE t.MATCOD = a.MAT) m
     WHERE LTRIM(RTRIM(a.ARTCOD)) IN (${lista.map((_, i) => `@a${i}`).join(',')})`)
  const t = (v) => String(v ?? '').trim()
  const en = Date.now()
  for (const f of r.recordset ?? []) {
    const a = {
      ARTICULO: t(f.ARTICULO), ARTICULO_ADICIONAL: t(f.ARTICULO_ADICIONAL), PROVEEDOR: t(f.PROVEEDOR),
      ID_GRUPO: t(f.ID_GRUPO), GRUPO: t(f.GRUPO), ID_MATERIAL: t(f.ID_MATERIAL), MATERIAL: t(f.MATERIAL), en,
    }
    arts.set(t(f.ID_ART), a)
    artsMemoria.set(t(f.ID_ART), a)
  }
  memoria.guardar('articulos', Object.fromEntries(artsMemoria))
  return arts
}

/** Ranking leyendo las bases directo (o la memoria); null si no se pudo (y entonces va la foto del DWH). */
async function ventasArticulosDirecto(body) {
  const fechas = [...new Set((Array.isArray(body?.fechas) ? body.fechas : []).map((f) => String(f).trim()).filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f)))].sort()
  if (!fechas.length || fechas.length > 31) return null
  try {
    const t0 = Date.now()
    const recs = await ventasDeDias(fechas)
    const foto = repoDiaria.prepararFoto([
      recs.map((r) => ({ dia: r.dia, unidades: r.unidades })),
      recs.flatMap((r) =>
        r.filas.map(([Tienda, ID_ART, ID_COLOR, ID_TALLE, cant]) => ({ dia: r.dia, Tienda, ID_ART, ID_COLOR, ID_TALLE, cant })),
      ),
    ])
    const opts = { fechas, local: body?.local, agrupar: body?.agrupar, top: body?.top }
    const borrador = repoDiaria.rankingVentas(foto, opts)
    const arts = await maestroArticulos(borrador.ranking.map((r) => r.articulo)).catch(() => new Map())
    const fallidas = [...new Set(recs.flatMap((r) => r.bases_con_error ?? []))]
    return {
      estado: 'listo',
      fuente: 'bases Dragon (réplicas de esta PC + servidor principal)',
      foto: new Date(Math.min(...recs.map((r) => r.en))).toISOString(),
      segundos: Math.round((Date.now() - t0) / 100) / 10,
      dias_de_memoria: recs.filter((r) => r.fijo).map((r) => r.dia),
      ...(fallidas.length ? { bases_con_error: fallidas } : {}),
      ...repoDiaria.rankingVentas({ ...foto, arts }, opts),
    }
  } catch (e) {
    console.error('[puente] ventas directo (se usa la foto del DWH):', e.message)
    return null
  }
}

/**
 * body: { fechas, local?, agrupar?, top? } -> ranking de ventas por artículo (Chat IA del hub).
 * Primero lee las bases directo (segundos); si falla, usa la foto de la repo diaria.
 */
async function accionVentasArticulos(body) {
  return (await ventasArticulosDirecto(body)) ?? accionVentasArticulosFoto(body)
}

/**
 * Respaldo: la foto de la repo diaria (vw_FACT_VENTAS_STOCK). La venta de días cerrados no cambia,
 * así que sirve una foto sacada hoy. Si no hay, la saca por detrás y contesta "calculando"
 * (el hub vuelve a preguntar).
 */
function accionVentasArticulosFoto(body) {
  const calculando = () => ({ estado: 'calculando', desde: new Date(fotoRepoInicio).toISOString() })
  if (fotoRepoEnCurso) return calculando()
  if (fotoRepo.error) {
    const error = fotoRepo.error
    fotoRepo = { ...fotoRepo, error: null }
    throw new Error(error)
  }
  // La venta de días cerrados no cambia: para días pasados sirve cualquier foto sacada HOY
  // (la de las 7:30 o la de la repo automática). Si piden hoy, que tenga menos de 5 minutos.
  const hoy = diaLocal()
  const pideHoy = Array.isArray(body?.fechas) && body.fechas.includes(hoy)
  const sirve = fotoRepo.foto && (pideHoy ? Date.now() - fotoRepo.en < REPO_DIARIA_CACHE_MS : fotoDeHoy())
  if (!sirve) {
    lanzarFotoRepo()
    return calculando()
  }
  return {
    estado: 'listo',
    foto: new Date(fotoRepo.en).toISOString(),
    ...repoDiaria.rankingVentas(fotoRepo.foto, {
      fechas: Array.isArray(body?.fechas) ? body.fechas : [],
      local: body?.local,
      agrupar: body?.agrupar,
      top: body?.top,
    }),
  }
}

/**
 * body: { fechas, foto, params } -> { cascada }
 * Recalcula SOLO la cascada con otros parámetros sobre la foto que el usuario está viendo
 * (aunque tenga más de 5 minutos: es un recálculo en memoria, no vuelve al SQL).
 */
function accionRepoCascada(body) {
  if (!fotoRepo.foto) throw new Error('No hay repo calculada: tocá Actualizar.')
  if (body?.foto && String(body.foto) !== new Date(fotoRepo.en).toISOString()) {
    throw new Error('La repo se volvió a calcular: tocá Actualizar.')
  }
  const fechas = Array.isArray(body?.fechas) ? body.fechas.filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(String(f))) : []
  const repo = repoDiaria.calcularRepo(fotoRepo.foto, { fechas, hoy: diaLocal() })
  return { foto: new Date(fotoRepo.en).toISOString(), cascada: cascadaLocales.calcularCascada(fotoRepo.foto, repo, body?.params) }
}

/** Foto nueva del DWH y esperar a que esté (la usa el programador). */
async function fotoRepoNueva() {
  if (!fotoRepoEnCurso) lanzarFotoRepo()
  await fotoRepoEnCurso
  if (fotoRepo.error) {
    const e = fotoRepo.error
    fotoRepo = { ...fotoRepo, error: null }
    throw new Error(e)
  }
  return fotoRepo
}

/* ---- Repo diaria → Dragon: un pedido de venta (motivo VTD) por local ----------------
 * Lo mismo que se hacía importando la hoja IMPORTAR DRAGON: cliente = CLIENTE REPO,
 * motivo VTD, observación "REPO DIARIA (<días>)", lista la del último pedido VTD del
 * local (LISTA1; LISTA2 en CFR4 / R9D / VCPD). El precio lo pone Dragon.
 * Cuidados:
 *  - Se carga EXACTAMENTE la repo que el usuario vio (body.foto = hora de la foto);
 *    si la foto cambió desde entonces, no carga y pide revisar de nuevo.
 *  - Antes de cargar se mira en DRAGONFISH_MITO qué locales ya tienen un pedido VTD con
 *    la misma observación: esos no se vuelven a cargar (sirve también para reintentar).
 *  - Una carga a la vez, por detrás; el hub pregunta el avance (modo 'estado').
 *  - PUENTE_DRAGON_EN_SECO=1 en .env: arma todo pero NO llama a la API de Dragon.
 */
const dragon = require('./scripts/dragon')
const LISTA_REPO = { CFR4: 'LISTA2', R9D: 'LISTA2', VCPD: 'LISTA2' }
const enSecoDragon = () => /^(1|true|si|sí)$/i.test(String(process.env.PUENTE_DRAGON_EN_SECO ?? ''))
let cargaDragon = null

/** Pedidos VTD ya cargados con esta observación + la última lista usada por local. */
async function pedidosVtdEnDragon(obs) {
  const pool = await conexionLarga()
  try {
    const r = await pool
      .request()
      .input('obs', sql.VarChar(250), obs)
      .query(`
        SELECT RTRIM(FPERSON) AS cliente, MAX(FNUMCOMP) AS numero
          FROM DRAGONFISH_MITO.ZooLogic.COMPROBANTEV
         WHERE FACTTIPO = 23 AND RTRIM(MOTIVO) = 'VTD' AND FFCH >= DATEADD(day, -30, GETDATE())
           AND RTRIM(CAST(FOBS AS varchar(250))) = @obs
         GROUP BY RTRIM(FPERSON);
        SELECT cliente, lista FROM (
          SELECT RTRIM(FPERSON) AS cliente, RTRIM(CODLISTA) AS lista,
                 ROW_NUMBER() OVER (PARTITION BY RTRIM(FPERSON) ORDER BY FFCH DESC, FNUMCOMP DESC) AS n
            FROM DRAGONFISH_MITO.ZooLogic.COMPROBANTEV
           WHERE FACTTIPO = 23 AND RTRIM(MOTIVO) = 'VTD' AND FFCH >= DATEADD(day, -60, GETDATE())) x
         WHERE n = 1;`)
    return {
      existentes: new Map(r.recordsets[0].map((f) => [String(f.cliente).toUpperCase(), f.numero])),
      listas: new Map(r.recordsets[1].map((f) => [String(f.cliente).toUpperCase(), f.lista])),
    }
  } finally {
    await pool.close().catch(() => {})
  }
}

/** Qué locales ya tienen el pedido con esa observación (no se repiten) y con qué lista cargar. */
async function marcarExistentes(plan) {
  const { existentes, listas } = await pedidosVtdEnDragon(plan.obs)
  for (const l of plan.locales) {
    l.lista = listas.get(l.cliente) || LISTA_REPO[l.cliente] || 'LISTA1'
    l.numero = existentes.get(l.cliente) ?? null
    l.estado = l.numero ? 'ya_estaba' : 'pendiente'
    l.error = null
  }
  return plan
}

/** Observaciones "REPO DIARIA (…)" de los pedidos VTD de las últimas 2 semanas (qué días ya se cargaron). */
async function obsRepoEnDragon() {
  const pool = await conexionLarga()
  try {
    const r = await pool.request().query(`
      SELECT DISTINCT RTRIM(CAST(FOBS AS varchar(250))) AS obs
        FROM DRAGONFISH_MITO.ZooLogic.COMPROBANTEV
       WHERE FACTTIPO = 23 AND RTRIM(MOTIVO) = 'VTD' AND FFCH >= DATEADD(day, -14, GETDATE())
         AND CAST(FOBS AS varchar(250)) LIKE 'REPO DIARIA (%'`)
    return r.recordset.map((f) => String(f.obs))
  } finally {
    await pool.close().catch(() => {})
  }
}

/** Los pedidos a cargar (uno por local) con la foto que el usuario está viendo. */
function planCargaDragon(body) {
  if (!fotoRepo.foto) throw new Error('No hay repo calculada: tocá Actualizar.')
  if (String(body?.foto ?? '') !== new Date(fotoRepo.en).toISOString()) {
    throw new Error('La repo se volvió a calcular desde que la abriste: tocá Actualizar, revisala y cargá de nuevo.')
  }
  return armarPlanDragon(body)
}

/** Pedidos por local de la repo de esos días, con la foto en memoria. */
function armarPlanDragon(body) {
  const fechas = Array.isArray(body?.fechas) ? body.fechas.filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(String(f))) : []
  const repo = repoDiaria.calcularRepo(fotoRepo.foto, { fechas, hoy: diaLocal() })
  const pedir = Array.isArray(body?.locales) && body.locales.length ? new Set(body.locales.map((s) => String(s).toUpperCase())) : null
  const porLocal = new Map()
  for (const f of repo.filas) {
    if (pedir && !pedir.has(f.cliente)) continue
    if (!porLocal.has(f.cliente)) porLocal.set(f.cliente, [])
    porLocal.get(f.cliente).push({ art: f.articulo, color: f.color, talle: f.talle, cantidad: f.a_reponer })
  }
  const locales = repoDiaria.RECEPTORES_ORDEN.filter((c) => porLocal.has(c)).map((c) => {
    const items = porLocal.get(c)
    return { cliente: c, renglones: items.length, unidades: items.reduce((a, i) => a + i.cantidad, 0), items }
  })
  return { obs: `REPO DIARIA (${repo.fecha_str})`, fecha_str: repo.fecha_str, dias: repo.dias, locales }
}

const vistaCarga = (c) =>
  c && {
    obs: c.obs,
    fecha_str: c.fecha_str,
    en_curso: !!c.enCurso,
    en_seco: !!c.enSeco,
    inicio: c.inicio ? new Date(c.inicio).toISOString() : null,
    fin: c.fin ? new Date(c.fin).toISOString() : null,
    locales: c.locales.map(({ items, ...l }) => l),
  }

/** body: { modo: 'revisar' | 'cargar' | 'estado', fechas, foto, locales?, confirmo? } */
async function accionRepoDragon(body) {
  const modo = String(body?.modo ?? '')
  if (modo === 'estado') return { carga: vistaCarga(cargaDragon) }
  if (modo !== 'revisar' && modo !== 'cargar') throw new Error('Modo inválido')
  if (modo === 'cargar' && cargaDragon?.enCurso) throw new Error('Ya hay una carga a Dragon en curso: esperá a que termine.')

  const plan = planCargaDragon(body)
  if (!plan.locales.length) throw new Error('No hay nada para cargar.')
  await marcarExistentes(plan)
  if (modo === 'revisar') return { carga: vistaCarga({ ...plan, enSeco: enSecoDragon() }) }

  // El hub repite la observación que mostró en la confirmación: si no coincide, no se carga nada
  if (String(body?.confirmo ?? '') !== plan.obs) throw new Error('La confirmación no coincide con la repo: revisala de nuevo.')
  ejecutarCargaDragon(plan)
  return { carga: vistaCarga(cargaDragon) }
}

/** Carga los locales 'pendiente' del plan en Dragon, uno por uno. Devuelve la promesa del final. */
function ejecutarCargaDragon(plan) {
  const carga = { ...plan, enCurso: true, enSeco: enSecoDragon(), inicio: Date.now(), fin: null }
  cargaDragon = carga
  return (async () => {
    for (const l of carga.locales) {
      if (l.estado !== 'pendiente') continue
      l.estado = 'cargando'
      try {
        const r = await dragon.crearPedido({
          cliente: l.cliente, lista: l.lista, motivo: 'VTD', obs: carga.obs, items: l.items, soloArmar: carga.enSeco,
        })
        if (r.ok) {
          l.estado = carga.enSeco ? 'en_seco' : 'cargado'
          l.numero = r.numero ?? r.codigo ?? null
        } else {
          l.estado = 'error'
          l.error = r.detalle
        }
      } catch (e) {
        l.estado = 'error'
        l.error = e.message
      }
      console.log(`[puente] repo → Dragon ${l.cliente}: ${l.estado}${l.numero ? ` N° ${l.numero}` : ''}${l.error ? ` ${l.error}` : ''}`)
    }
  })().finally(() => {
    carga.enCurso = false
    carga.fin = Date.now()
    diasEnDragon.en = 0 // la próxima consulta relee qué días quedaron cargados
  }).then(() => carga)
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

    if (!mismoToken(req.headers['x-puente-token'], PUENTE_TOKEN)) {
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

    // Detalle de un pedido de venta leído en vivo de Dragonfish (Mayorista > Pedidos de venta).
    // En Supabase solo quedan los renglones de los últimos 120 días (sql/pedidos_venta_items_ventana.sql);
    // los pedidos más viejos se abren desde acá. Lee por el servidor local (linked server MITO).
    if (body?.accion === 'items_pedido_venta') {
      return enviar(res, 200, await itemsPedidoVenta(body?.codigo))
    }

    // Órdenes de compras: colores y talles de un artículo en Dragon (COMB/COL de DRAGONFISH_<base>)
    if (body?.accion === 'dragon_variantes') {
      return enviar(res, 200, await dragonVariantes(body?.base, body?.articulo))
    }
    if (body?.accion === 'dragon_articulos') {
      return enviar(res, 200, body?.codigos ? await dragonDatosArticulos(body?.base, body.codigos, body?.lista) : await dragonBuscarArticulos(body?.base, body?.texto, body?.lista))
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
      await asegurarConexion(srvCat)
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

    // Stock valorizado a costo por sucursal (Administradores > Stock valorizado)
    if (body?.accion === 'stock_valorizado') {
      return enviar(res, 200, await stockValorizado(body?.forzar === true))
    }

    // Los artículos de una sola base (el desplegable de la tabla por sucursal)
    if (body?.accion === 'stock_valorizado_base') {
      return enviar(res, 200, await stockValorizadoDeBase(body?.base))
    }

    // Repo diaria: reposición de MITO a los locales con la venta del día anterior
    if (body?.accion === 'repo_diaria') {
      try {
        return enviar(res, 200, accionRepoDiaria(body))
      } catch (e) {
        return enviar(res, 400, { error: e.message })
      }
    }

    // Ranking de ventas por artículo: bases directo, con la foto de la repo diaria de respaldo (Chat IA)
    if (body?.accion === 'ventas_articulos') {
      try {
        return enviar(res, 200, await accionVentasArticulos(body))
      } catch (e) {
        return enviar(res, 400, { error: e.message })
      }
    }

    // Repo diaria: recalcular la cascada con otros parámetros (misma foto)
    if (body?.accion === 'repo_diaria_cascada') {
      try {
        return enviar(res, 200, accionRepoCascada(body))
      } catch (e) {
        return enviar(res, 400, { error: e.message })
      }
    }

    // Programación de repo y cascada: estado del programador de esta PC
    if (body?.accion === 'repo_auto_estado') {
      return enviar(res, 200, programador.estado())
    }

    // Repo diaria → pedidos de venta VTD en Dragon (uno por local)
    if (body?.accion === 'repo_diaria_dragon') {
      try {
        return enviar(res, 200, await accionRepoDragon(body))
      } catch (e) {
        return enviar(res, 400, { error: e.message })
      }
    }

    vista = String(body?.vista ?? '')
    const pedido = Number(body?.top)
    const top = Math.min(Number.isFinite(pedido) && pedido > 0 ? Math.floor(pedido) : 1000, MAX_FILAS)

    // "ALIAS:nombre" = de otro servidor; sin alias, el principal
    const mAlias = vista.match(/^([A-Za-z0-9_-]{1,128}):(.*)$/)
    const srv = servidorDe(mAlias ? mAlias[1] : '')
    if (!srv) return enviar(res, 400, { error: `No existe el servidor ${mAlias?.[1]}` })
    await asegurarConexion(srv)
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
  // Repo diaria y cascada programadas (Compras > Repo diaria > Automático). PUENTE_PROGRAMADOR=0 lo apaga.
  iniciarFotoManana()
  // Venta de los días cerrados guardada en D:\memoria ia (se completa por detrás)
  iniciarMemoriaVentas()
  programador.iniciar({
    fotoNueva: fotoRepoNueva,
    foto: () => fotoRepo.foto,
    hoy: diaLocal,
    calcularRepo: repoDiaria.calcularRepo,
    calcularCascada: cascadaLocales.calcularCascada,
    armarPlanDragon,
    marcarExistentes,
    cargarDragon: ejecutarCargaDragon,
    cargaEnCurso: () => !!cargaDragon?.enCurso,
    obsRepoEnDragon,
    correrSync,
  })
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
