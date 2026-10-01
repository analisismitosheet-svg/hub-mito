// Cliente del Puente SQL local (el mismo contrato que usa el hub vía /api/sql).
// Lee el token de puente-sql/.env, así que no hay que escribirlo a mano.
//
//   node scripts/puente.mjs bases
//   node scripts/puente.mjs servidores
//   node scripts/puente.mjs objetos DRAGONFISH_MITO
//   node scripts/puente.mjs vista ZooLogic.vw_ARTICULOS_MITO 5
//   node scripts/puente.mjs raw '{"vista":"...","top":5,"donde":"ID_ARTICULO","valor":"BG01","coincide":"contiene"}'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cfg = {}
for (const linea of readFileSync(path.join(raiz, 'puente-sql', '.env'), 'utf8').split(/\r?\n/)) {
  const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) cfg[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const url = `http://localhost:${cfg.PUENTE_PORT || 3128}/`

async function puente(body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Puente-Token': cfg.PUENTE_TOKEN || '' },
    body: JSON.stringify(body),
  })
  const texto = await r.text()
  try {
    return JSON.parse(texto)
  } catch {
    return texto
  }
}

/** Imprime compacto: con --json tira el JSON crudo, si no una línea por objeto. */
function mostrar(datos) {
  if (process.argv.includes('--json')) return console.log(JSON.stringify(datos, null, 2))
  if (Array.isArray(datos)) {
    for (const d of datos) {
      if (d && typeof d === 'object') console.log(Object.entries(d).map(([k, v]) => `${k}=${v}`).join('  '))
      else console.log(d)
    }
    return
  }
  console.log(typeof datos === 'string' ? datos : JSON.stringify(datos, null, 2))
}

const [cmd, a, b] = process.argv.slice(2)
switch (cmd) {
  case 'servidores':
    mostrar(await puente({ accion: 'servidores' }))
    break
  case 'bases':
    mostrar(await puente({ accion: 'bases', servidor: a }))
    break
  case 'objetos':
    mostrar(await puente({ accion: 'objetos', base: a, servidor: b }))
    break
  case 'vista':
    mostrar(await puente({ vista: a, top: Number(b) || 5 }))
    break
  case 'raw':
    mostrar(await puente(JSON.parse(a)))
    break
  case 'filtro': {
    // filtro <vista> <valor> [top] [contiene]
    // argv: [2]=filtro [3]=vista [4]=valor [5]=top [6]=contiene
    mostrar(
      await puente({
        vista: a,
        top: Number(process.argv[5]) || 10,
        donde: 'ARTCOD,ID_ARTICULO,ARTICULO,NOMBRE_COMPLETO,DESCRIPCION',
        valor: b,
        coincide: process.argv[6] === 'contiene' ? 'contiene' : 'igual',
      }),
    )
    break
  }
  case 'health': {
    const r = await fetch(new URL('/health', url))
    console.log(r.status, await r.text())
    break
  }
  default:
    console.log('Uso: health | servidores | bases [srv] | objetos <base> [srv] | vista <vista> [top] | raw <json>')
}
