/**
 * Franquicias → Reposición diaria automática. Arma la reposición de cada cliente con su venta
 * de ayer, a la hora y los días que se configuraron en Mayorista → Franquicias, y la deja lista
 * para que el hub mande el link por WhatsApp a todos sus números.
 *
 *   node scripts/reposicion-franquicias-auto.js
 *
 * Lo corre la tarea "MITO - Pedidos franquicias" cada 1 minuto (sync-franquicias-dragon.ps1),
 * después de cargar en Dragon las confirmadas. Casi siempre no hay nada que hacer: una sola
 * consulta a Supabase (franquicias_auto_pendientes) y listo.
 *
 * Mismos números que la pantalla vieja de Reposición diaria (useReposicionFranquicia):
 *   - venta: VISTAS_CONSOLIDADAS.dbo.venta_franquicias de la base del cliente (facturas suman,
 *     notas de crédito restan)
 *   - stock del cliente: vw_STOCK_SUCURSALES_REAL por BD_ORIGEN = sucursal de la base
 *   - stock MITO: vw_STOCK_SKU_MITO · precio y descripción: vw_ARTICULOS_MITO
 *   - sugerido = máx(0, mín(vendido − stock cliente, stock MITO))
 * Todo en el SQL de ESTA PC con el usuario de Windows (sqlcmd -E), solo lectura.
 *
 * Después le avisa al hub (/api/informe?evento=franquicias) para que salga el WhatsApp ya,
 * sin esperar al pg_cron de cada 5 minutos.
 * Log: data/reposicion-franquicias-auto.log (sólo cuando hay algo).
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const RAIZ = path.join(__dirname, '..')
const LOG = path.join(RAIZ, 'data', 'reposicion-franquicias-auto.log')

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
// Instancia local donde vive VISTAS_CONSOLIDADAS (la misma que usa el resto de los syncs)
const SERVIDOR = cfg('FRANQUICIAS_SQL_SERVER') || cfg('PEDIDOS_SQL_SERVER') || 'localhost'
const HUB_URL = (cfg('HUB_URL') || 'https://hub-mito.vercel.app').replace(/\/$/, '')
const VC = 'VISTAS_CONSOLIDADAS.dbo'

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

// Página de códigos 850: bytes 0x80-0xFF (igual que sync-pedidos-venta.js)
const CP850_ALTO =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐' +
  '└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ '
const CP850_COD = Array.from(CP850_ALTO, (c) => c.charCodeAt(0))
function cp850(buf) {
  const out = new Uint16Array(buf.length)
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] < 0x80 ? buf[i] : CP850_COD[buf[i] - 0x80]
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength).toString('utf16le')
}

/** Corre la consulta con sqlcmd (usuario de Windows) y devuelve el JSON de FOR JSON PATH */
function leerJson(consulta) {
  const crudo = execFileSync(
    'sqlcmd',
    ['-S', SERVIDOR, '-E', '-C', '-b', '-f', '65001', '-y', '0', '-Q', `SET NOCOUNT ON; ${consulta}`],
    { maxBuffer: 256 * 1024 * 1024, windowsHide: true },
  )
  // sqlcmd a veces entrega los textos en la página de la consola (CP850) aunque se le pida
  // UTF-8 (la Ñ llega como "�"): si no es UTF-8 válido, se lee como CP850
  let salida
  try {
    salida = new TextDecoder('utf-8', { fatal: true }).decode(crudo)
  } catch {
    salida = cp850(crudo)
  }
  const lineas = salida.split(/\r?\n/)
  const desde = lineas.findIndex((l) => l.trimStart().startsWith('['))
  if (desde === -1) {
    if (lineas.slice(2).join('').trim() === '') return []
    throw new Error(`sqlcmd: ${salida.trim().slice(0, 300)}`)
  }
  return JSON.parse(lineas.slice(desde).join('').trim())
}

/** Literal de texto para T-SQL (los valores salen de Supabase, igual se escapan). */
const lit = (v) => `N'${String(v ?? '').replace(/'/g, "''")}'`
const esFecha = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v))
const txt = (v) => String(v ?? '').trim()
const parte = (v) => txt(v).toUpperCase()
const sku = (a, c, t) => `${parte(a)}|${parte(c)}|${parte(t)}`

/** Arma los ítems de la reposición de un cliente para su rango de venta. */
function armarItems(c) {
  if (!esFecha(c.desde) || !esFecha(c.hasta)) throw new Error(`Fechas inválidas: ${c.desde} / ${c.hasta}`)

  // Venta neta por SKU: facturas suman, notas de crédito restan, lo demás no cuenta
  const ventas = leerJson(`
    SELECT RTRIM(FART) AS art, RTRIM(CCOLOR) AS color, RTRIM(TALLE) AS talle, MAX(RTRIM(FTXT)) AS txt,
           SUM(CASE WHEN UPPER(DESCFW) LIKE 'NOTADECREDITO%' OR UPPER(DESCFW) LIKE 'TICKETNOTADECREDITO%' THEN -FCANT
                    WHEN UPPER(DESCFW) LIKE 'FACTURA%' OR UPPER(DESCFW) LIKE 'TICKETFACTURA%' THEN FCANT
                    ELSE 0 END) AS vendido
      FROM ${VC}.venta_franquicias
     WHERE BASE_DATOS = ${lit(c.base)}
       AND FFCH >= '${c.desde}' AND FFCH < DATEADD(day, 1, CAST('${c.hasta}' AS date))
     GROUP BY RTRIM(FART), RTRIM(CCOLOR), RTRIM(TALLE)
       FOR JSON PATH`).filter((v) => Number(v.vendido) > 0 && txt(v.art))
  if (!ventas.length) return []

  const arts = [...new Set(ventas.map((v) => parte(v.art)))]
  const enArts = arts.map(lit).join(',')

  const stockCli = new Map()
  if (txt(c.sucursal)) {
    for (const f of leerJson(`
      SELECT ARTICULO AS a, COLOR AS c, TALLE AS t, SUM(CANTIDAD_REAL) AS n
        FROM ${VC}.vw_STOCK_SUCURSALES_REAL
       WHERE BD_ORIGEN = ${lit(c.sucursal)} AND ARTICULO IN (${enArts})
       GROUP BY ARTICULO, COLOR, TALLE FOR JSON PATH`)) {
      stockCli.set(sku(f.a, f.c, f.t), Number(f.n) || 0)
    }
  }

  const stockMito = new Map()
  for (const f of leerJson(`
    SELECT ID_ARTICULO AS a, COLOR_CODIGO AS c, TALLE_CODIGO AS t, SUM(STOCK_MITO) AS n
      FROM ${VC}.vw_STOCK_SKU_MITO WHERE ID_ARTICULO IN (${enArts})
     GROUP BY ID_ARTICULO, COLOR_CODIGO, TALLE_CODIGO FOR JSON PATH`)) {
    stockMito.set(sku(f.a, f.c, f.t), Number(f.n) || 0)
  }

  // Precio por SKU (y el mayor del artículo si el SKU no tiene) + descripción y material
  const precioSku = new Map()
  const infoArt = new Map()
  for (const f of leerJson(`
    SELECT ID_ARTICULO AS a, COLOR_CODIGO AS c, TALLE_CODIGO AS t, MAX(PRECIO) AS p,
           MAX(NOMBRE_COMPLETO) AS d, MAX(MATERIAL) AS m
      FROM ${VC}.vw_ARTICULOS_MITO WHERE ID_ARTICULO IN (${enArts})
     GROUP BY ID_ARTICULO, COLOR_CODIGO, TALLE_CODIGO FOR JSON PATH`)) {
    const p = Number(f.p) || 0
    if (p > 0) precioSku.set(sku(f.a, f.c, f.t), p)
    const a = parte(f.a)
    const i = infoArt.get(a) ?? { precio: 0, descrip: txt(f.d), material: txt(f.m) }
    i.precio = Math.max(i.precio, p)
    infoArt.set(a, i)
  }

  return ventas
    .map((v) => {
      const k = sku(v.art, v.color, v.talle)
      const a = infoArt.get(parte(v.art))
      const vendido = Number(v.vendido) || 0
      const sc = stockCli.get(k) ?? 0
      const sm = stockMito.get(k) ?? 0
      return {
        art: parte(v.art),
        descrip: a?.descrip || txt(v.txt),
        material: a?.material || '',
        color: parte(v.color),
        talle: parte(v.talle),
        vendido,
        stock_cli: sc,
        stock_mito: sm,
        sugerido: Math.max(0, Math.min(vendido - sc, sm)),
        precio: precioSku.get(k) ?? a?.precio ?? null,
      }
    })
    .sort((x, y) => y.sugerido - x.sugerido || y.vendido - x.vendido || x.art.localeCompare(y.art))
}

async function main() {
  // Prueba sin guardar nada:  node scripts/reposicion-franquicias-auto.js --probar DRAGONFISH_CFU "SUCURSAL" 2026-10-26 2026-10-26
  const iProbar = process.argv.indexOf('--probar')
  if (iProbar >= 0) {
    const [base, sucursal, desde, hasta] = process.argv.slice(iProbar + 1)
    const items = armarItems({ base, sucursal, desde, hasta })
    const rep = items.filter((i) => i.sugerido > 0)
    console.log(`${items.length} SKU vendidos · ${rep.length} a reponer · ${rep.reduce((s, i) => s + i.sugerido, 0)} u. · $${rep.reduce((s, i) => s + i.sugerido * (i.precio ?? 0), 0)}`)
    console.table(items.slice(0, 15))
    return
  }
  const token = cfg('PUENTE_TOKEN')
  if (!token) throw new Error('Falta PUENTE_TOKEN en puente-sql/.env')
  const pendientes = (await rpc('franquicias_auto_pendientes', { p_token: token })) ?? []
  let creadas = 0
  for (const c of pendientes) {
    try {
      const items = armarItems(c)
      const r = await rpc('franquicias_auto_crear', { p_token: token, p_cliente: c.cliente_id, p_desde: c.desde, p_hasta: c.hasta, p_items: items })
      if (r?.numero) {
        creadas++
        anotar(`${c.cliente_id} ${c.cliente_nombre}: ${r.numero} (${c.desde} a ${c.hasta}) · ${r.unidades} u. · ${r.envios} WhatsApp`)
      } else if (!r?.repetida) {
        anotar(`${c.cliente_id} ${c.cliente_nombre}: sin nada para reponer (${c.desde} a ${c.hasta}, ${items.length} SKU vendidos)`)
      }
    } catch (e) {
      anotar(`${c.cliente_id}: ERROR ${e.message}`)
      await rpc('franquicias_auto_error', { p_token: token, p_cliente: c.cliente_id, p_error: e.message }).catch(() => undefined)
    }
  }
  // Que salgan ya los WhatsApp (si falla, los toma el pg_cron en 5 minutos)
  if (creadas) {
    await fetch(`${HUB_URL}/api/informe?evento=franquicias`, { signal: AbortSignal.timeout(60_000) }).catch((e) => anotar(`Aviso al hub: ${e.message}`))
  }
}

main().catch((e) => {
  anotar(`ERROR ${e.message}`)
  process.exit(1)
})
