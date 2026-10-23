/**
 * Franquicias → Dragon: cada propuesta que el cliente confirmó desde el link (/p/:token)
 * se carga como pedido de venta en M1T0O1\ZOOLOGIC · DRAGONFISH_MITO por la API REST
 * (scripts/dragon.js, sólo altas). Lo corre la tarea "MITO - Pedidos franquicias" cada 1 minuto.
 *
 *   node scripts/sync-franquicias-dragon.js
 *
 * - Cliente y lista por franquicia: FRANQUICIAS (abajo). Lista MAYOR = LISTA2 en Dragon.
 * - Observaciones: "01140 (CF Ushuaia - Argentina S.R.L.) - Propuesta P-001" + comentario del cliente.
 * - Precio: no se manda; Dragon pone el del artículo en la lista.
 * - Si Dragon rechaza, queda el error en el hub y se reintenta (hasta 5 veces). Si el proceso se corta
 *   a mitad de camino queda "enviando" y no se reintenta solo (ver sql/franquicias_dragon.sql).
 * Log: data/sync-franquicias-dragon.log (sólo cuando hay algo).
 */
const fs = require('fs')
const path = require('path')
const { crearPedido } = require('./dragon')

const RAIZ = path.join(__dirname, '..')
const LOG = path.join(RAIZ, 'data', 'sync-franquicias-dragon.log')

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

/** Franquicia del hub → cliente y lista de precios en DRAGONFISH_MITO */
const FRANQUICIAS = {
  CFU: { cliente: '01140', descripcion: 'CF Ushuaia - Argentina S.R.L.', lista: 'LISTA2' },
}

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
  const propuestas = (await rpc('franquicias_tomar_para_dragon', { p_token: token })) ?? []
  for (const p of propuestas) {
    const f = FRANQUICIAS[String(p.franquicia).toUpperCase()]
    // El cliente destino lo elige el hub (cualquier cliente de la base); si la
    // propuesta es vieja y no lo trae, se usa el de la franquicia.
    const cliente = String(p.cliente_id ?? '').trim() || f?.cliente
    const descripcion = String(p.cliente_nombre ?? '').trim() || f?.descripcion || ''
    let pedido = null
    let error = null
    try {
      if (!cliente) throw new Error(`La franquicia ${p.franquicia} no tiene cliente de Dragon configurado`)
      if (!p.items?.length) throw new Error('La propuesta no tiene artículos pedidos')
      const que = p.tipo === 'calzado' || p.tipo === 'materiales' ? 'Reposición de materiales' : 'Propuesta'
      const obs = `${cliente} (${descripcion}) - ${que} ${p.numero}${p.comentario ? ` - ${p.comentario}` : ''}`
      const fecha = new Date(new Date(p.confirmada_at).getTime() - 3 * 3600_000).toISOString().slice(0, 10)
      const r = await crearPedido({ cliente, lista: 'LISTA2', obs, items: p.items, fecha })
      if (r.ok) pedido = String(r.numero ?? r.codigo)
      else error = r.detalle
    } catch (e) {
      error = e.message
    }
    await rpc('franquicias_resultado_dragon', { p_token: token, p_id: p.id, p_pedido: pedido, p_error: error })
    anotar(pedido ? `${p.numero}: cargada en Dragon como pedido N° ${pedido}` : `${p.numero}: ERROR ${error}`)
  }
}

main().catch((e) => {
  anotar(`ERROR ${e.message}`)
  process.exit(1)
})
