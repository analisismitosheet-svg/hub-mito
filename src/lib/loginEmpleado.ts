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

/** Los códigos de barra llegan con espacios o minúsculas según el lector. */
export function normalizaCodigo(codigo: string): string {
  return String(codigo ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
}
