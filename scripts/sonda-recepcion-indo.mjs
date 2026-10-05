// Sonda: ¿está aplicada la parte de base de datos de Recepción INDO?
//
// No necesita el SQL Editor ni credenciales de servicio: usa la clave publishable del
// .env y solo PREGUNTA a PostgREST qué objetos existen. PostgREST resuelve cada función
// en su schema cache ANTES de mirar permisos, así que el mensaje dice qué falta:
//
//   "Could not find the function ..."  -> la función NO existe (falta correr el .sql)
//   "permission denied for function"   -> la función existe, la clave no tiene permiso
//
// node scripts/sonda-recepcion-indo.mjs
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const val = (k) => env.match(new RegExp(`^${k}\\s*=\\s*(.+)$`, 'm'))?.[1]?.trim() ?? ''
const url = val('VITE_SUPABASE_URL')
const key = val('VITE_SUPABASE_ANON_KEY')
if (!url || !key) {
  console.error('Falta VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en .env')
  process.exit(1)
}
const sb = createClient(url, key, { auth: { persistSession: false } })

const titulo = (t) => `\n=== ${t} ${'='.repeat(Math.max(3, 56 - t.length))}`

async function rpc(nombre, args) {
  const { error } = args ? await sb.rpc(nombre, args) : await sb.rpc(nombre)
  const msg = error?.message ?? '(sin error)'
  const veredicto = !error ? 'OK (respondió)'
    : /could not find the function/i.test(msg) ? 'NO EXISTE'
    : /permission denied|row-level security|not authorized/i.test(msg) ? 'EXISTE (sin permiso para esta clave)'
    : 'OTRO ERROR'
  console.log(`  ${veredicto.padEnd(42)} ${nombre}`)
  if (error) console.log(`  ${''.padEnd(42)} ${msg.slice(0, 200)}`)
}

async function tabla(t) {
  const { data, error } = await sb.from(t).select('*').limit(1)
  const veredicto = !error ? `OK (${data?.length ?? 0} fila(s) legible(s))`
    : /could not find|does not exist/i.test(error.message) ? 'NO EXISTE'
    : /row-level security|permission denied/i.test(error.message) ? 'EXISTE (RLS oculta todo a esta clave)'
    : 'OTRO ERROR'
  console.log(`  ${veredicto.padEnd(42)} ${t}`)
  if (error) console.log(`  ${''.padEnd(42)} ${error.message.slice(0, 200)}`)
}

console.log(`Proyecto: ${url}`)
console.log('(la clave publishable no puede crear nada: esto solo informa)')

// Control: si esto tampoco responde, el problema es la conexión o el proyecto, no el SQL.
console.log(titulo('CONTROL (debe existir de antes)'))
await rpc('mis_permisos')
await tabla('picking_compra')

console.log(titulo('Funciones de Recepción INDO'))
for (const n of ['recepcion_indo_opciones', 'recepcion_indo_filas', 'recepcion_indo_resumen', 'recepcion_indo_proveedores']) {
  await rpc(n)
}
await rpc('recepcion_indo_importar', { p_filas: [] })

console.log(titulo('Tablas de Recepción INDO'))
await tabla('recepcion_indo')
await tabla('recepcion_indo_proveedores')

console.log(`
Cómo seguir:
  · "NO EXISTE" en las funciones -> correr sql/recepcion_indo.sql en el SQL Editor de ESTE
    proyecto. Ya no va con BEGIN/COMMIT, asi que el editor muestra la sentencia que falla.
  · Todo "EXISTE" pero el navegador dice que no -> la caché de PostgREST quedó vieja:
    correr  NOTIFY pgrst, 'reload schema';
  · El CONTROL falla -> estás mirando otro proyecto o la URL del .env no es la del deploy.`)
