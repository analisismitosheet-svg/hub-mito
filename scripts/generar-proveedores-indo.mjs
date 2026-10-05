/**
 * Genera sql/recepcion_indo_proveedores.sql con el catálogo de proveedores de
 * DRAGONFISH_INDOD.dbo.PROVEEDORES_INDO, para que el desplegable de "Proveedor" de
 * Recepción INDO tenga la lista canónica aunque el Puente SQL esté caído.
 *
 *   node scripts/generar-proveedores-indo.mjs
 *   node scripts/generar-proveedores-indo.mjs otro.json      (usa un JSON ya existente)
 *
 * IMPORTANTE: no volcar el JSON con `> archivo.json` desde PowerShell. Ese redirect
 * decodifica la salida de node con la codificación de la consola y la vuelve a
 * codificar, y los acentos quedan como "RI├æONERAS" en vez de "RIÑONERAS". Cuatro de los
 * 1518 nombres entran corruptos por ahí. Por eso el script consulta la vista él mismo.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VISTA = 'DRAGONFISH_INDOD.dbo.PROVEEDORES_INDO'
const CONSULTA = `SELECT LTRIM(RTRIM(Codigo)) AS codigo, LTRIM(RTRIM(Nombre)) AS nombre FROM ${VISTA}`

const salida = process.argv[2]?.endsWith('.sql') ? process.argv[2] : 'sql/recepcion_indo_proveedores.sql'
const entrada = process.argv[2] && !process.argv[2].endsWith('.sql') ? process.argv[2] : process.argv[3]

function desdeJson(ruta) {
  // El redirect de PowerShell guarda en UTF-16: se aceptan las dos codificaciones.
  const crudo = readFileSync(ruta)
  const texto = crudo[0] === 0xff && crudo[1] === 0xfe ? crudo.toString('utf16le') : crudo.toString('utf8')
  const plano = JSON.parse(texto.replace(/^﻿/, ''))
  return Array.isArray(plano) && Array.isArray(plano[0]) ? plano.flat() : plano
}

function desdeSqlServer() {
  const r = spawnSync(process.execPath, [`${RAIZ}/scripts/sql.mjs`, '--json', CONSULTA], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (r.status !== 0) {
    console.error('Falló la consulta al SQL Server:', (r.stderr || r.stdout).slice(0, 600))
    process.exit(1)
  }
  const plano = JSON.parse(r.stdout)
  return Array.isArray(plano) && Array.isArray(plano[0]) ? plano.flat() : plano
}

const origen = entrada && existsSync(entrada) ? `JSON ${entrada}` : `vista ${VISTA}`
const filas = entrada && existsSync(entrada) ? desdeJson(entrada) : desdeSqlServer()

const proveedores = filas
  .map((r) => ({ codigo: String(r.codigo ?? r.cod ?? '').trim(), nombre: String(r.nombre ?? '').trim() }))
  .filter((r) => r.codigo && r.nombre)
  .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

// Charset explícito: la tabla es UTF8 y el nombre tiene que llegar entero, no reinterpretado.
const q = (s) => s.replace(/'/g, "''")

const sql = `-- =====================================================
-- RECEPCION INDO (Deposito): catálogo de proveedores
--
-- Generado con:
--   node scripts/generar-proveedores-indo.mjs
--
-- Son los proveedores del depósito (INDOD). El desplegable de la columna "Proveedor"
-- de Recepción INDO sale de acá: con esta lista el módulo anda aunque el Puente SQL
-- esté caído. Se puede refrescar desde la pantalla ("Actualizar del SQL Server"), y esa
-- vía sí necesita la vista habilitada en Configuraciones > Conexión SQL.
--
-- Origen de esta corrida: ${origen}
--
-- ${proveedores.length} proveedores. Correr después de sql/recepcion_indo.sql. Idempotente.
-- =====================================================

BEGIN;

INSERT INTO public.recepcion_indo_proveedores (codigo, nombre) VALUES
${proveedores.map((r) => `  ('${q(r.codigo)}', '${q(r.nombre)}')`).join(',\n')}
ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre;

COMMIT;
`

const destino = resolve(process.cwd(), salida)
writeFileSync(destino, sql, 'utf8')

const conAcento = proveedores.filter((p) => /[^\x00-\x7F]/.test(p.nombre))
console.log(`${proveedores.length} proveedores -> ${salida} (${Buffer.byteLength(sql, 'utf8')} bytes)`)
console.log(`  origen: ${origen}`)
console.log(`  nombres con caracteres no ASCII: ${conAcento.length}`)
for (const p of conAcento) console.log(`    ${p.codigo}  ${p.nombre}`)
const reemplazo = proveedores.filter((p) => p.nombre.includes('\uFFFD'))
console.log(reemplazo.length
  ? `  ATENCION: ${reemplazo.length} nombre(s) con U+FFFD, revisar la fuente`
  : '  sin caracteres de reemplazo (U+FFFD)')
