/**
 * MEMORIA DEL PUENTE EN DISCO (por defecto D:\memoria ia, PUENTE_MEMORIA_DIR para cambiarla).
 *
 * Lo que ya se calculó y no cambia (o cambia poco) queda guardado en archivos .json en esta PC,
 * para no volver a pedírselo al SQL y para que sobreviva a un reinicio del puente:
 *   ventas\AAAA-MM-DD.json   venta de un día cerrado por local y SKU (no cambia más)
 *   articulos.json           descripción/grupo/material/proveedor de los artículos ya vistos
 *   foto-dwh.json            última foto del DWH de la repo diaria (con su hora real)
 *   stock-valorizado.json    última corrida del stock valorizado (con su hora real)
 *
 * Nada de esto viaja a Supabase ni a Vercel. Se escribe primero a un .tmp y después se renombra,
 * así un corte a mitad de camino nunca deja un archivo roto. Si falla el disco, el puente sigue
 * igual (la memoria es una ayuda, no un requisito).
 */
const fs = require('fs')
const path = require('path')

const DIR = process.env.PUENTE_MEMORIA_DIR || 'D:\\memoria ia'

// Los Map (artículos de la foto, detalle por base) se guardan como lista de pares
const reemplazo = (_k, v) => (v instanceof Map ? { __map: [...v.entries()] } : v)
const revivir = (_k, v) => (v && typeof v === 'object' && Array.isArray(v.__map) ? new Map(v.__map) : v)

const ruta = (nombre) => {
  if (!/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/.test(nombre)) throw new Error(`Nombre de memoria inválido: ${nombre}`)
  return path.join(DIR, ...nombre.split('/')) + '.json'
}

function guardar(nombre, datos) {
  try {
    const archivo = ruta(nombre)
    fs.mkdirSync(path.dirname(archivo), { recursive: true })
    const tmp = `${archivo}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(datos, reemplazo))
    fs.renameSync(tmp, archivo)
    return true
  } catch (e) {
    console.error(`[puente] memoria: no se pudo guardar ${nombre}:`, e.message)
    return false
  }
}

function leer(nombre) {
  try {
    return JSON.parse(fs.readFileSync(ruta(nombre), 'utf8'), revivir)
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`[puente] memoria: no se pudo leer ${nombre}:`, e.message)
    return null
  }
}

const existe = (nombre) => {
  try {
    return fs.existsSync(ruta(nombre))
  } catch {
    return false
  }
}

module.exports = { DIR, guardar, leer, existe }
