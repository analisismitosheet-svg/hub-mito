/**
 * Genera sql/recepcion_indo_proveedores.sql con el catálogo de proveedores de
 * DRAGONFISH_INDOD.dbo.PROVEEDORES_INDO, para que el desplegable de "Proveedor" de
 * Recepción INDO tenga la lista canónica aunque el Puente SQL esté caído.
 *
 *   node scripts/sql.mjs --json "SELECT Codigo, LTRIM(RTRIM(Codigo)) AS cod, LTRIM(RTRIM(Nombre)) AS nombre FROM DRAGONFISH_INDOD.dbo.PROVEEDORES_INDO" > prov_indo.json
 *   node scripts/generar-proveedores-indo.mjs prov_indo.json
 */
import { readFileSync, writeFileSync } from 'node:fs'

const entrada = process.argv[2] ?? 'prov_indo.json'
const salida = process.argv[3] ?? 'sql/recepcion_indo_proveedores.sql'

// El redirect de PowerShell guarda en UTF-16: se aceptan las dos codificaciones.
const crudo = readFileSync(entrada)
const texto = crudo[0] === 0xff && crudo[1] === 0xfe ? crudo.toString('utf16le') : crudo.toString('utf8')
const filas = JSON.parse(texto.replace(/^\uFEFF/, ''))[0]

const proveedores = filas
  .map((r) => ({ codigo: String(r.cod ?? '').trim(), nombre: String(r.nombre ?? '').trim() }))
  .filter((r) => r.codigo && r.nombre)
  .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

const q = (s) => s.replace(/'/g, "''")

const sql = `-- =====================================================
-- RECEPCION INDO (Deposito): catálogo de proveedores
--
-- Generado con:
--   node scripts/sql.mjs --json "SELECT Codigo, LTRIM(RTRIM(Codigo)) AS cod, LTRIM(RTRIM(Nombre)) AS nombre FROM DRAGONFISH_INDOD.dbo.PROVEEDORES_INDO" > prov_indo.json
--   node scripts/generar-proveedores-indo.mjs prov_indo.json
--
-- Son los proveedores del depósito (INDOD). El desplegable de la columna "Proveedor"
-- de Recepción INDO sale de acá: con esta lista el módulo anda aunque el Puente SQL
-- esté caído. Se puede refrescar desde la pantalla ("Actualizar del SQL Server"), y esa
-- vía sí necesita la vista habilitada en Configuraciones > Conexión SQL.
--
-- ${proveedores.length} proveedores. Correr después de sql/recepcion_indo.sql. Idempotente.
-- =====================================================

BEGIN;

INSERT INTO public.recepcion_indo_proveedores (codigo, nombre) VALUES
${proveedores.map((r) => `  ('${q(r.codigo)}', '${q(r.nombre)}')`).join(',\n')}
ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre;

COMMIT;
`

writeFileSync(salida, sql, 'utf8')
console.log(`${proveedores.length} proveedores -> ${salida} (${sql.length} bytes)`)
