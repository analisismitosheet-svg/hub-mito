/**
 * Filtro de período por semanas (lunes a domingo, hora Argentina), el mismo de
 * Repos Mayorista: por defecto la semana vigente, así cada pantalla trae solo
 * lo reciente y carga rápido.
 */

export type Periodo = 'semana' | 'anterior' | 'cuatro' | 'todas'

export const PERIODOS: { id: Periodo; label: string }[] = [
  { id: 'semana', label: 'Esta semana' },
  { id: 'anterior', label: 'Semana pasada' },
  { id: 'cuatro', label: 'Últimas 4 semanas' },
  { id: 'todas', label: 'Todas' },
]

/** Lunes 00:00 (Argentina, UTC-3) de la semana actual menos `semanasAtras`, en ISO. */
export function lunesAR(semanasAtras = 0): string {
  const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }) // AAAA-MM-DD
  const d = new Date(`${hoy}T12:00:00Z`)
  const desdeLunes = (d.getUTCDay() + 6) % 7 // lunes = 0
  d.setUTCDate(d.getUTCDate() - desdeLunes - semanasAtras * 7)
  return `${d.toISOString().slice(0, 10)}T00:00:00-03:00`
}

/** Rango [desde, hasta) del período; null = sin límite. */
export function rangoDe(p: Periodo): { desde: string | null; hasta: string | null } {
  if (p === 'semana') return { desde: lunesAR(0), hasta: null }
  if (p === 'anterior') return { desde: lunesAR(1), hasta: lunesAR(0) }
  if (p === 'cuatro') return { desde: lunesAR(3), hasta: null }
  return { desde: null, hasta: null }
}

/** Período guardado en este navegador (por pantalla); 'semana' si no hay. */
export function periodoGuardado(clave: string): Periodo {
  try {
    const g = localStorage.getItem(clave) as Periodo | null
    return g && PERIODOS.some((p) => p.id === g) ? g : 'semana'
  } catch {
    return 'semana'
  }
}

export function guardarPeriodo(clave: string, p: Periodo): void {
  try { localStorage.setItem(clave, p) } catch { /* sin almacenamiento: no pasa nada */ }
}

/** "esta semana" / "la semana pasada" / "en las últimas 4 semanas" (para mensajes vacíos). */
export function textoPeriodo(p: Periodo): string {
  return p === 'semana' ? 'esta semana' : p === 'anterior' ? 'la semana pasada' : p === 'cuatro' ? 'en las últimas 4 semanas' : ''
}
