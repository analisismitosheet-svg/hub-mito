/**
 * Zonas de los locales (locales.zona, sql/locales_zona.sql). Las edita el admin en
 * Configuración → Locales y las usan los filtros de Requerimientos.
 */
export const ZONAS = ['CENTRO', 'NORTE', 'SUR', 'ESTE', 'OESTE', 'INTERIOR'] as const

/** «NORTE» → «Norte» */
export const nombreZona = (z: string) => z.charAt(0) + z.slice(1).toLowerCase()
