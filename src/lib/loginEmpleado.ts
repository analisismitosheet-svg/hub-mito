/**
 * Reglas del ingreso de empleados a piso (legajo + contraseña asignada).
 *
 * Supabase Auth necesita un email para crear la cuenta, así que al dar de alta
 * a un empleado le generamos uno sintético a partir del legajo. La cuenta se
 * crea ya confirmada, así que ese dominio no tiene que existir ni recibir mail.
 *
 * Este archivo NO puede usar `import.meta.env`: lo importa también la función
 * de Vercel `api/admin-empleado.ts`, que corre en Node.
 */

/** Mantener sincronizado: lo usa el front para loguear y la API para dar de alta. */
export const DOMINIO_LOGIN_EMPLEADO = 'empleados.hub-mito.app'

/** Legajo tal cual está en la tabla `empleados` (así se guarda en `usuarios.legajo`). */
export function legajoLimpio(legajo: string): string {
  return String(legajo ?? '').trim()
}

/** Forma canónica del legajo para armar el email (sin puntos, guiones ni espacios). */
export function normalizaLegajo(legajo: string): string {
  return legajoLimpio(legajo).toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Email sintético con el que se crea / se entra.
 * OJO: cambiar el dominio invalida todos los logins de piso existentes.
 */
export function emailDeLegajo(legajo: string): string {
  const base = normalizaLegajo(legajo)
  if (!base) return ''
  return `${base}@${DOMINIO_LOGIN_EMPLEADO}`
}

/** Largo mínimo de la clave que el admin le asigna a un empleado. */
export const MIN_CLAVE_EMPLEADO = 8

/**
 * Valida la clave de un empleado. Los legajos son fáciles de adivinar, así que la
 * clave no puede ser corta, ni contener el legajo, ni ser solo números (DNI, fechas).
 * Devuelve el motivo si no sirve, o null si está bien. La usan el front y la API.
 */
export function problemaClaveEmpleado(clave: string, legajo: string): string | null {
  if (clave.length < MIN_CLAVE_EMPLEADO) return `La contraseña debe tener al menos ${MIN_CLAVE_EMPLEADO} caracteres.`
  if (/^\d+$/.test(clave)) return 'La contraseña no puede ser solo números (DNI, fechas, legajo).'
  const leg = normalizaLegajo(legajo)
  if (leg && clave.toLowerCase().replace(/[^a-z0-9]/g, '').includes(leg)) {
    return 'La contraseña no puede contener el número de legajo.'
  }
  return null
}

/** Clave aleatoria legible (sin 0/O, 1/l/I) con generador criptográfico. */
export function generarClave(largo = 10): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const azar = new Uint32Array(largo)
  crypto.getRandomValues(azar)
  let s = ''
  for (const n of azar) s += chars[n % chars.length]
  // Garantiza al menos una letra y un número
  return /\d/.test(s) && /[a-z]/i.test(s) ? s : generarClave(largo)
}

/** Los códigos de barra llegan con espacios o minúsculas según el lector. */
export function normalizaCodigo(codigo: string): string {
  return String(codigo ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
}
