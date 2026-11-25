/**
 * Franquicias → Dragon: cada propuesta que el cliente confirmó desde el link (/p/:token)
 * se carga como pedido de venta en M1T0O1\ZOOLOGIC · DRAGONFISH_MITO por la API REST
 * (scripts/dragon.js, sólo altas). Lo corre la tarea "MITO - Pedidos franquicias" cada 1 minuto.
 *
 *   node scripts/sync-franquicias-dragon.js
 *
 * - Cliente y lista por franquicia: FRANQUICIAS (abajo). Lista MAYOR = LISTA2 en Dragon.
 * - Observaciones: "01140 (CF Ushuaia - Argentina S.R.L.) - Propuesta P-001" + comentario del cliente.
 * - Lo que sale de Polo 52 va en un pedido aparte con Obs "LLEGA DESDE POLO52 - ..." (25/11/2026,
 *   sql/franquicias_pedido_polo.sql). Si falla solo ese, queda el de MITO y se reintenta el de Polo.
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

const HUB_URL = (cfg('HUB_URL') || 'https://hub-mito.vercel.app').replace(/\/$/, '')

/** Push de transferencia nueva (api/push.ts?tipo=transferencia, con la clave del puente). */
async function avisarTransferencia(token, loteId) {
  try {
    const r = await fetch(`${HUB_URL}/api/push?tipo=transferencia`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Puente-Token': token },
      body: JSON.stringify({ lote_id: loteId }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!r.ok) anotar(`aviso Polo (lote ${loteId}): HTTP ${r.status}`)
  } catch (e) {
    anotar(`aviso Polo (lote ${loteId}): ${e.message}`)
  }
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
    // Lo de MITO y lo de Polo van en pedidos separados (la RPC ya trae el reparto por ítem).
    // Si el de MITO ya estaba cargado (reintento porque falló el de Polo), solo se manda el de Polo.
    let pedido = String(p.dragon_pedido ?? '').trim() || null
    let pedidoPolo = null
    let poloFalta = false
    let error = null
    try {
      if (!cliente) throw new Error(`La franquicia ${p.franquicia} no tiene cliente de Dragon configurado`)
      if (!p.items?.length) throw new Error('La propuesta no tiene artículos pedidos')
      const que = p.tipo === 'calzado' || p.tipo === 'materiales' ? 'Reposición de materiales' : 'Propuesta'
      const obs = `${cliente} (${descripcion}) - ${que} ${p.numero}${p.comentario ? ` - ${p.comentario}` : ''}`
      const fecha = new Date(new Date(p.confirmada_at).getTime() - 3 * 3600_000).toISOString().slice(0, 10)
      const deMito = p.items.map((i) => ({ ...i, cantidad: Number(i.mito ?? i.cantidad) || 0 })).filter((i) => i.cantidad > 0)
      const dePolo = p.items.map((i) => ({ ...i, cantidad: Number(i.polo) || 0 })).filter((i) => i.cantidad > 0)
      if (!pedido && deMito.length) {
        const r = await crearPedido({ cliente, lista: 'LISTA2', obs, items: deMito, fecha })
        if (!r.ok) throw new Error(r.detalle)
        pedido = String(r.numero ?? r.codigo)
      }
      if (dePolo.length) {
        try {
          const r = await crearPedido({ cliente, lista: 'LISTA2', obs: `LLEGA DESDE POLO52 - ${obs}`, items: dePolo, fecha })
          if (r.ok) pedidoPolo = String(r.numero ?? r.codigo)
          else throw new Error(r.detalle)
        } catch (e) {
          // Si todo salía de Polo no hay pedido de MITO: cuenta como error común y se reintenta entero.
          if (!pedido) throw e
          poloFalta = true
          error = e.message
        }
      }
      if (!pedido) pedido = pedidoPolo
    } catch (e) {
      error = e.message
    }
    const res = await rpc('franquicias_resultado_dragon', {
      p_token: token, p_id: p.id, p_pedido: pedido, p_error: error, p_pedido_polo: pedidoPolo, p_polo_falta: poloFalta,
    })
    // Lote POLO52 → MITO recién creado: aviso al celular de Polo 52 (si falla, queda la campana).
    if (res?.lote_polo) await avisarTransferencia(token, res.lote_polo)
    anotar(
      pedido
        ? `${p.numero}: cargada en Dragon · MITO N° ${pedido === pedidoPolo ? '—' : pedido}${pedidoPolo ? ` · Polo N° ${pedidoPolo}` : ''}${poloFalta ? ` · FALTA el de Polo: ${error}` : ''}`
        : `${p.numero}: ERROR ${error}`,
    )
  }
}

main().catch((e) => {
  anotar(`ERROR ${e.message}`)
  process.exit(1)
})
