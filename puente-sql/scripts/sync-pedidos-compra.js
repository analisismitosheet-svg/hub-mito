/**
 * Copia los pedidos de compra del SQL Server local a Supabase
 * (tablas public.pedidos_compra + public.pedidos_compra_items) para la pantalla
 * "Pedidos de compra" del hub (áreas Compras y Depósito).
 *
 *   node scripts/sync-pedidos-compra.js     (tarea "MITO - Sync pedidos compra" cada 1 hora, o el botón "Actualizar datos")
 *
 * Lee VISTAS_CONSOLIDADAS.dbo.PEDIDO_COMPRA del SQL Server de ESTA PC con el usuario
 * de Windows (sqlcmd -E): el usuario SQL del puente no tiene acceso a ese servidor.
 * Suma el nombre del proveedor (ZooLogic.PROV). Si algo falla a mitad de camino no se
 * borra nada: queda la copia anterior + lo que se alcanzó a actualizar.
 *
 * Configuración (puente-sql/.env), todo opcional salvo PUENTE_TOKEN:
 *   PEDIDOS_SQL_SERVER   default localhost
 *   PEDIDOS_VISTA        default VISTAS_CONSOLIDADAS.dbo.PEDIDO_COMPRA
 *   PEDIDOS_PROV         default DRAGONFISH_VCPD.ZooLogic.PROV
 * Log: data/sync-pedidos-compra.log
 * Al terminar copia también las cancelaciones (scripts/sync-cancelaciones.js).
 */

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const RAIZ = path.join(__dirname, '..')
const LOG = path.join(RAIZ, 'data', 'sync-pedidos-compra.log')
const LOTE = 100 // pedidos por llamada (cada uno con sus ítems)

function leerEnv(archivo) {
  const out = {}
  try {
    for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
      const m = linea.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
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
const VISTA = cfg('PEDIDOS_VISTA') || 'VISTAS_CONSOLIDADAS.dbo.PEDIDO_COMPRA'
const PROV = cfg('PEDIDOS_PROV') || 'DRAGONFISH_VCPD.ZooLogic.PROV'

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

/** "BASE.esquema.objeto" -> "[BASE].[esquema].[objeto]" (validado: se arma dentro de la consulta) */
function objetoSql(nombre, variable) {
  const partes = nombre.split('.')
  if (partes.length !== 3 || !partes.every((p) => /^[A-Za-z0-9_-]{1,128}$/.test(p))) {
    throw new Error(`${variable} inválida: ${nombre} (usar BASE.esquema.objeto)`)
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
    { maxBuffer: 512 * 1024 * 1024, windowsHide: true },
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

/** Proveedor MITO / Mito SRL: se excluye de la copia (y por eso se borra del hub en la siguiente corrida) */
function esProveedorMito(codigo, nombre) {
  const solo = (v) => txt(v).toUpperCase().replace(/[^A-Z]/g, '')
  return solo(codigo) === 'MITO' || solo(nombre) === 'MITOSRL'
}
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

async function main() {
  if (!cfg('PUENTE_TOKEN')) throw new Error('Falta PUENTE_TOKEN en puente-sql/.env')
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Falta SUPABASE_URL / SUPABASE_ANON_KEY')

  const t0 = Date.now()
  const filas = leerJson(
    `SELECT p.CODIGO, p.FNUMCOMP, p.DESCFW, CONVERT(varchar(10), p.FFCH, 23) AS FFCH,
            CONVERT(varchar(10), p.FALTAFW, 23) AS FALTAFW, p.HALTAFW, p.FPERSON, pr.CLNOM, p.CODLISTA,
            p.FOBS, p.FTOTAL, p.ANULADO, p.UALTAFW, p.BD,
            p.FART, p.FCOLO, p.FTALL, p.FCANT, p.FPRECIO, p.FMONTO, p.FMTOIVA, p.FBRUTO
     FROM ${objetoSql(VISTA, 'PEDIDOS_VISTA')} p
     LEFT JOIN ${objetoSql(PROV, 'PEDIDOS_PROV')} pr
       ON pr.CLCOD COLLATE DATABASE_DEFAULT = p.FPERSON COLLATE DATABASE_DEFAULT
     FOR JSON PATH, INCLUDE_NULL_VALUES`,
  )

  // Listado completo de OC (encabezados, SIN excluir nada) para el selector de N° OC de Recepción INDO
  const ocs = new Map()
  for (const f of filas) {
    const codigo = txt(f.CODIGO)
    if (!codigo || ocs.has(codigo)) continue
    ocs.set(codigo, {
      codigo,
      numero: num(f.FNUMCOMP),
      fecha: txt(f.FFCH) || null,
      proveedor: txt(f.FPERSON),
      proveedor_nombre: txt(f.CLNOM),
      anulado: Boolean(f.ANULADO),
    })
  }

  // Agrupa por pedido (la vista trae una fila por artículo)
  const pedidos = new Map()
  for (const f of filas) {
    const codigo = txt(f.CODIGO)
    if (!codigo) continue
    // Los pedidos al proveedor MITO (Mito SRL, movimientos internos) no van al hub
    if (esProveedorMito(f.FPERSON, f.CLNOM)) continue
    let p = pedidos.get(codigo)
    if (!p) {
      const hora = txt(f.HALTAFW)
      p = {
        codigo,
        numero: num(f.FNUMCOMP),
        descripcion: txt(f.DESCFW),
        fecha: txt(f.FFCH) || null,
        // Fecha/hora de alta en hora de Argentina
        fecha_alta: f.FALTAFW ? `${txt(f.FALTAFW)}T${/^\d{1,2}:\d{2}(:\d{2})?$/.test(hora) ? hora : '00:00:00'}-03:00` : null,
        proveedor: txt(f.FPERSON),
        proveedor_nombre: txt(f.CLNOM),
        lista: txt(f.CODLISTA),
        observacion: txt(f.FOBS),
        total: num(f.FTOTAL),
        anulado: Boolean(f.ANULADO),
        usuario: txt(f.UALTAFW),
        base: txt(f.BD),
        items: [],
      }
      pedidos.set(codigo, p)
    }
    p.items.push({
      linea: p.items.length + 1,
      articulo: txt(f.FART),
      color: txt(f.FCOLO),
      talle: txt(f.FTALL),
      cantidad: num(f.FCANT),
      precio: num(f.FPRECIO),
      neto: num(f.FMONTO),
      iva: num(f.FMTOIVA),
      bruto: num(f.FBRUTO),
    })
  }
  const lista = [...pedidos.values()]
  anotar(`Leídas ${filas.length} filas de ${VISTA} (${lista.length} pedidos) en ${Date.now() - t0} ms`)
  if (lista.length === 0) throw new Error('La vista no devolvió pedidos: no se toca la copia actual')

  const token = cfg('PUENTE_TOKEN')
  const gen = Date.now()
  for (let i = 0; i < lista.length; i += LOTE) {
    await rpc('pedidos_compra_sync_lote', { p_token: token, p_gen: gen, p_pedidos: lista.slice(i, i + LOTE) })
  }
  const borrados = await rpc('pedidos_compra_sync_fin', {
    p_token: token,
    p_gen: gen,
    p_total: lista.length,
    p_origen: `${SERVIDOR} ${VISTA}`,
  })
  anotar(`OK: ${lista.length} pedidos (${filas.length} ítems) en Supabase, ${borrados} viejos borrados (${Math.round((Date.now() - t0) / 1000)} s)`)

  // Listado completo de OC (Recepción INDO): si falla, la copia de pedidos ya quedó hecha
  try {
    const n = await rpc('pedidos_compra_oc_sync', { p_token: token, p_ocs: [...ocs.values()] })
    anotar(`Listado de OC para Recepción INDO: ${n} OC (todas las de la vista)`)
  } catch (err) {
    anotar(`Listado de OC: ERROR ${err instanceof Error ? err.message : String(err)}`)
  }

  // Después, las cancelaciones (DWH.dbo.vw_FACT_CANCELADOS): si fallan, los pedidos ya quedaron copiados
  try {
    await require('./sync-cancelaciones').sincronizarCancelaciones()
  } catch (err) {
    anotar(`Cancelaciones: ERROR ${err instanceof Error ? err.message : String(err)}`)
  }
}

main().catch((err) => {
  anotar(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
})
