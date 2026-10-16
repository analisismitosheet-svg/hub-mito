// Cliente mínimo de la API REST de Dragonfish (M1T0O1\ZOOLOGIC · DRAGONFISH_MITO).
// SOLO ALTAS de pedidos de venta: nunca modifica ni borra. Datos en puente-sql/.env:
//   DRAGON_API_URL, DRAGON_API_IDCLIENTE (MITO), DRAGON_API_TOKEN (JWT ya generado)
const fs = require('fs')
const path = require('path')

for (const l of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const URL_API = (process.env.DRAGON_API_URL || 'http://192.168.0.222:8015/api.Dragonfish').replace(/\/$/, '')
const ID = (process.env.DRAGON_API_IDCLIENTE || '').trim().toUpperCase()
const TOKEN = (process.env.DRAGON_API_TOKEN || '').trim()
const BASE = process.env.DRAGON_BASE || 'MITO'

/**
 * Da de alta un pedido de venta. items: [{ art, color, talle, cantidad }]. El precio no se manda:
 * Dragon pone el del artículo en la lista indicada.
 * Devuelve { ok, status, numero, codigo, detalle }.
 */
/** '2026-10-16' -> '/Date(1792119600000-0300)/' (medianoche de Argentina), el formato de fecha de WCF */
function fechaWcf(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return `/Date(${Date.UTC(y, m - 1, d, 3)}-0300)/`
}

async function crearPedido({ cliente, lista = 'LISTA2', obs = '', items, fecha }) {
  if (!ID || !TOKEN) throw new Error('Faltan DRAGON_API_IDCLIENTE / DRAGON_API_TOKEN en puente-sql/.env')
  const cuerpo = {
    Cliente: cliente,
    ListaDePrecios: lista,
    Fecha: fechaWcf(fecha || new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)),
    Obs: obs.slice(0, 250),
    FacturaDetalle: items.map((i, n) => ({
      NroItem: n + 1,
      Articulo: String(i.art).trim().toUpperCase(),
      Color: String(i.color || '').trim().toUpperCase(),
      Talle: String(i.talle || '').trim().toUpperCase(),
      Cantidad: Number(i.cantidad),
    })),
  }
  const r = await fetch(`${URL_API}/Pedido/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', IdCliente: ID, Authorization: TOKEN, BaseDeDatos: BASE },
    // WCF exige las fechas escapadas: "\/Date(...)\/"
    body: JSON.stringify(cuerpo).replace(/"\/Date\(([^)]*)\)\/"/g, '"\\/Date($1)\\/"'),
  })
  const texto = await r.text()
  let j = null
  try { j = JSON.parse(texto) } catch { /* texto plano */ }
  const info = r.headers.get('InformacionAdicional') || ''
  return {
    ok: r.ok,
    status: r.status,
    numero: j?.Numero ?? null,
    codigo: j?.Codigo ?? null,
    detalle: r.ok ? `Pedido N° ${j?.Numero ?? '?'}` : `${r.status} ${r.statusText} ${info} ${texto.slice(0, 300)}`.trim(),
  }
}

module.exports = { crearPedido }

// Prueba manual: node scripts/dragon.js --prueba
if (require.main === module && process.argv.includes('--prueba')) {
  crearPedido({
    cliente: '01140',
    lista: 'LISTA2', // MAYOR
    obs: '01140 (CF Ushuaia · Argentina S.R.L.) · PRUEBA HUB - no preparar',
    items: [{ art: 'ZH060018', color: '02', talle: 'U', cantidad: 2 }],
  }).then((r) => console.log(JSON.stringify(r, null, 1))).catch((e) => { console.error('ERROR', e.message); process.exit(1) })
}
