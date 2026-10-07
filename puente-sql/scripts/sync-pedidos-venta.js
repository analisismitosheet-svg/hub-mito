/**
 * Copia los pedidos de venta mayoristas (Dragonfish MITO) a Supabase
 * (tablas public.pedidos_venta + public.pedidos_venta_items) para la pantalla
 * "Pedidos de venta" del hub (área Mayorista).
 *
 *   node scripts/sync-pedidos-venta.js            últimos 7 días (tarea cada 15 minutos, botón "Actualizar datos")
 *   node scripts/sync-pedidos-venta.js --todo     todos desde 2025 y borra los que ya no están (tarea diaria 6:30)
 *
 * Lee los comprobantes "PEDIDO" de [MITO].DRAGONFISH_MITO.ZooLogic.COMPROBANTEV + COMPROBANTEVDET
 * (con el motivo: COMPROBANTEV.MOTIVO y su nombre en ZooLogic.MOTIVO)
 * desde el SQL Server de ESTA PC (servidor vinculado MITO) con el usuario de Windows (sqlcmd -E).
 * Solo lectura. Si algo falla a mitad de camino no se borra nada.
 *
 * Configuración (puente-sql/.env), todo opcional salvo PUENTE_TOKEN:
 *   PEDIDOS_SQL_SERVER     default localhost
 *   PEDIDOS_VENTA_BASE     default MITO.DRAGONFISH_MITO.ZooLogic   (servidor.base.esquema de Dragonfish)
 * Log: data/sync-pedidos-venta.log
 */

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const RAIZ = path.join(__dirname, '..')
const LOG = path.join(RAIZ, 'data', 'sync-pedidos-venta.log')
// Lotes por cantidad de ítems (hay pedidos de cientos de renglones): la llamada entra con la clave anon,
// que tiene un límite de 3 s por consulta en Supabase
const ITEMS_POR_LOTE = 2000
const MAX_PEDIDOS_LOTE = 200
const DIAS_RECIENTES = 7
const COMPLETA = process.argv.includes('--todo')

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
const SERVIDOR = cfg('PEDIDOS_SQL_SERVER') || 'localhost'
const BASE = cfg('PEDIDOS_VENTA_BASE') || 'MITO.DRAGONFISH_MITO.ZooLogic'

function anotar(texto) {
  const linea = `${new Date().toLocaleString('sv-SE')}  ${texto}`
  console.log(linea)
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true })
    fs.appendFileSync(LOG, linea + '\n')
  } catch {
    /* sin log en disco: igual se ve en consola */
  }
}

async function rpc(nombre, params) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  })
  const cuerpo = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`${nombre}: HTTP ${r.status} ${cuerpo?.message ?? ''}`.trim())
  return cuerpo
}

/** "SERVIDOR.BASE.esquema" -> "[SERVIDOR].[BASE].[esquema]" (validado: se arma dentro de la consulta) */
function prefijoSql(nombre) {
  const partes = nombre.split('.')
  if (partes.length < 2 || partes.length > 3 || !partes.every((p) => /^[A-Za-z0-9_-]{1,128}$/.test(p))) {
    throw new Error(`PEDIDOS_VENTA_BASE inválida: ${nombre} (usar SERVIDOR.BASE.esquema o BASE.esquema)`)
  }
  return partes.map((p) => `[${p}]`).join('.')
}

// Página de códigos 850 (consola de Windows en español), bytes 0x80-0xFF. TextDecoder no la trae.
const CP850_ALTO =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐' +
  '└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´\u00AD±‗¾¶§÷¸°¨·¹³²■\u00A0'
const CP850_COD = Array.from(CP850_ALTO, (c) => c.charCodeAt(0))
function cp850(buf) {
  // Una sola pasada a UTF-16 (la salida puede pesar cientos de MB: nada de sumar strings)
  const out = new Uint16Array(buf.length)
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] < 0x80 ? buf[i] : CP850_COD[buf[i] - 0x80]
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength).toString('utf16le')
}

/** Corre la consulta con sqlcmd (usuario de Windows) y devuelve el JSON de FOR JSON PATH */
function leerJson(consulta) {
  const crudo = execFileSync(
    'sqlcmd',
    ['-S', SERVIDOR, '-E', '-C', '-b', '-f', '65001', '-y', '0', '-Q', `SET NOCOUNT ON; ${consulta}`],
    { maxBuffer: 1024 * 1024 * 1024, windowsHide: true },
  )
  // sqlcmd a veces entrega los textos en la página de la consola (CP850) aunque se le pida UTF-8
  // (la Ñ llegaba como "�"): si no es UTF-8 válido, se lee como CP850
  let salida
  try {
    salida = new TextDecoder('utf-8', { fatal: true }).decode(crudo)
  } catch {
    salida = cp850(crudo)
  }
  // Saltea el encabezado de sqlcmd (nombre de columna + guiones) y pega las líneas del JSON
  const lineas = salida.split(/\r?\n/)
  const desde = lineas.findIndex((l) => l.trimStart().startsWith('['))
  if (desde === -1) {
    if (lineas.slice(2).join('').trim() === '') return []
    throw new Error(`sqlcmd: ${salida.trim().slice(0, 300)}`)
  }
  return JSON.parse(lineas.slice(desde).join('').trim())
}

const txt = (v) => String(v ?? '').trim()
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

async function main() {
  if (!cfg('PUENTE_TOKEN')) throw new Error('Falta PUENTE_TOKEN en puente-sql/.env')
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Falta SUPABASE_URL / SUPABASE_ANON_KEY')

  const t0 = Date.now()
  const b = prefijoSql(BASE)
  // Fecha fija en el texto (no hay datos del usuario en la consulta)
  const desde = COMPLETA ? '20250101' : new Date(Date.now() - DIAS_RECIENTES * 86400000).toISOString().slice(0, 10).replace(/-/g, '')
  const filas = leerJson(
    `SELECT C.CODIGO, C.MOTIVO, C.FNUMCOMP, C.DESCFW, CONVERT(varchar(10), C.FFCH, 23) AS FFCH,
            CONVERT(varchar(10), C.FALTAFW, 23) AS FALTAFW, C.HALTAFW, C.FPERSON, C.FCLIENTE, C.FVEN,
            CAST(C.FOBS AS varchar(max)) AS FOBS, C.FSUBTOT, C.FIMPUESTO, C.FTOTAL, C.ANULADO, C.UALTAFW,
            D.FART, D.FTXT, D.CCOLOR, D.FCOLTXT, D.TALLE, D.FCANT, D.FPRECIO, D.FNETO, D.FMTOIVA, D.FBRUTO
     FROM ${b}.[COMPROBANTEV] C
     JOIN ${b}.[COMPROBANTEVDET] D ON D.CODIGO = C.CODIGO
     WHERE C.DESCFW LIKE 'PEDIDO %' AND C.FFCH >= '${desde}'
     ORDER BY C.CODIGO
     FOR JSON PATH, INCLUDE_NULL_VALUES`,
  )

  // Nombre de cada motivo (REP = REPOSICION LOCALES, VTD = venta diaria, …); la tabla viene
  // repetida por sucursal. Si falla, los pedidos se copian igual con el código solo.
  const nombreMotivo = new Map()
  try {
    for (const m of leerJson(
      `SELECT LTRIM(RTRIM(MOTCOD)) AS MOTCOD, MAX(LTRIM(RTRIM(MOTDES))) AS MOTDES
         FROM ${b}.[MOTIVO] GROUP BY LTRIM(RTRIM(MOTCOD)) FOR JSON PATH`,
    )) {
      if (txt(m.MOTCOD)) nombreMotivo.set(txt(m.MOTCOD).toUpperCase(), txt(m.MOTDES))
    }
  } catch (err) {
    anotar(`Aviso: no se pudieron leer los nombres de los motivos (${err instanceof Error ? err.message : err})`)
  }

  // Agrupa por pedido (la consulta trae una fila por artículo)
  const pedidos = new Map()
  for (const f of filas) {
    const codigo = txt(f.CODIGO)
    if (!codigo) continue
    let p = pedidos.get(codigo)
    if (!p) {
      const hora = txt(f.HALTAFW)
      const motivo = txt(f.MOTIVO).toUpperCase()
      p = {
        codigo,
        motivo,
        motivo_nombre: motivo ? nombreMotivo.get(motivo) || motivo : '',
        numero: num(f.FNUMCOMP),
        descripcion: txt(f.DESCFW),
        fecha: txt(f.FFCH) || null,
        // Fecha/hora de alta en hora de Argentina
        fecha_alta: f.FALTAFW ? `${txt(f.FALTAFW)}T${/^\d{1,2}:\d{2}(:\d{2})?$/.test(hora) ? hora : '00:00:00'}-03:00` : null,
        cliente: txt(f.FPERSON),
        cliente_nombre: txt(f.FCLIENTE),
        vendedor: txt(f.FVEN),
        observacion: txt(f.FOBS),
        subtotal: num(f.FSUBTOT),
        impuestos: num(f.FIMPUESTO),
        total: num(f.FTOTAL),
        anulado: Boolean(f.ANULADO),
        usuario: txt(f.UALTAFW),
        base: 'DRAGONFISH_MITO',
        items: [],
      }
      pedidos.set(codigo, p)
    }
    p.items.push({
      linea: p.items.length + 1,
      articulo: txt(f.FART),
      descripcion: txt(f.FTXT),
      color: txt(f.CCOLOR),
      color_nombre: txt(f.FCOLTXT),
      talle: txt(f.TALLE),
      cantidad: num(f.FCANT),
      precio: num(f.FPRECIO),
      neto: num(f.FNETO),
      iva: num(f.FMTOIVA),
      bruto: num(f.FBRUTO),
    })
  }
  const lista = [...pedidos.values()]
  const alcance = COMPLETA ? 'copia completa' : `últimos ${DIAS_RECIENTES} días`
  anotar(`Leídas ${filas.length} filas de ${BASE} (${lista.length} pedidos, ${alcance}) en ${Date.now() - t0} ms`)
  if (lista.length === 0) {
    if (COMPLETA) throw new Error('Dragonfish no devolvió pedidos: no se toca la copia actual')
    anotar('OK: no hay pedidos nuevos en el período')
    return
  }

  const token = cfg('PUENTE_TOKEN')
  const gen = Date.now()
  const lotes = []
  let actual = []
  let items = 0
  for (const p of lista) {
    if (actual.length && (items + p.items.length > ITEMS_POR_LOTE || actual.length >= MAX_PEDIDOS_LOTE)) {
      lotes.push(actual)
      actual = []
      items = 0
    }
    actual.push(p)
    items += p.items.length
  }
  if (actual.length) lotes.push(actual)

  for (const lote of lotes) {
    for (let intento = 1; ; intento++) {
      try {
        await rpc('pedidos_venta_sync_lote', { p_token: token, p_gen: gen, p_pedidos: lote })
        break
      } catch (err) {
        if (intento >= 3 || /Clave de sincronizaci/.test(String(err))) throw err
        await new Promise((r) => setTimeout(r, 5000 * intento))
      }
    }
  }
  const borrados = await rpc('pedidos_venta_sync_fin', {
    p_token: token,
    p_gen: gen,
    p_total: lista.length,
    p_origen: `${SERVIDOR} ${BASE}`,
    p_completa: COMPLETA,
  })
  anotar(`OK: ${lista.length} pedidos (${filas.length} ítems, ${alcance}) en Supabase, ${borrados} viejos borrados (${Math.round((Date.now() - t0) / 1000)} s)`)
}

main().catch((err) => {
  anotar(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
})
