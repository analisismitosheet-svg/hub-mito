/**
 * Órdenes de compras del hub → Dragon: cada OC que alguien de Compras mandó con «Crear OC en Dragon»
 * se carga como pedido de compra en DRAGONFISH_<base> (hoy INDOD) por la API REST, con el mismo
 * número de la OC (scripts/dragon.js → crearPedidoCompra, sólo altas).
 * Lo corre la tarea "MITO - Pedidos franquicias" cada 1 minuto (sync-franquicias-dragon.ps1).
 *
 *   node scripts/sync-oc-dragon.js
 *
 * Si Dragon la rechaza, queda el error en la OC y Compras la reintenta con el botón.
 * Log: data/sync-oc-dragon.log (sólo cuando hay algo).
 */
const fs = require('fs')
const path = require('path')
const { crearPedidoCompra } = require('./dragon')

const RAIZ = path.join(__dirname, '..')
const LOG = path.join(RAIZ, 'data', 'sync-oc-dragon.log')

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

async function main() {
  const token = cfg('PUENTE_TOKEN')
  if (!token) throw new Error('Falta PUENTE_TOKEN en puente-sql/.env')
  const ocs = (await rpc('oc_tomar_para_dragon', { p_token: token })) ?? []
  for (const o of ocs) {
    let codigo = null
    let error = null
    try {
      const items = (o.items ?? []).filter((i) => i.articulo && Number(i.cantidad) > 0)
      if (!items.length) throw new Error('La OC no tiene artículos con cantidad')
      const obs = `OC ${o.numero}${o.observacion ? ` - ${o.observacion}` : ''}${o.por ? ` (hub: ${o.por})` : ''}`
      const r = await crearPedidoCompra({
        base: o.base, numero: o.numero, proveedor: o.proveedor, motivo: o.motivo, condicion: o.condicion,
        lista: o.lista, fecha: o.fecha, fechaEntrega: o.fecha_entrega, obs, items, descuento: o.descuento,
      })
      if (r.ok) codigo = String(r.codigo ?? r.numero)
      else error = r.detalle
    } catch (e) {
      error = e.message
    }
    await rpc('oc_resultado_dragon', { p_token: token, p_numero: o.numero, p_codigo: codigo, p_error: error })
    anotar(codigo ? `OC ${o.numero}: creada en DRAGONFISH_${o.base} (${codigo})` : `OC ${o.numero}: ERROR ${error}`)
  }
}

main().catch((e) => {
  anotar(`ERROR ${e.message}`)
  process.exit(1)
})
