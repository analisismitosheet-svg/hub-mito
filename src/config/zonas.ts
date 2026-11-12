/**
 * Zonas de los locales (locales.zona, sql/locales_zona.sql). Las edita el admin en
 * Configuración → Locales y las usan los filtros de Requerimientos.
 */
export const ZONAS = ['CENTRO', 'NORTE', 'SUR', 'OESTE', 'CARLOS PAZ', 'RIO CUARTO'] as const

/** «NORTE» → «Norte» · «CARLOS PAZ» → «Carlos Paz» */
export const nombreZona = (z: string) => z.toLowerCase().replace(/(^|\s)(\S)/g, (_, a: string, b: string) => a + b.toUpperCase())
