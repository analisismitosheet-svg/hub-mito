/* Utilidades de la planilla horaria de RR. HH. (Carga horaria y Marcaciones). */

export type Tipo = 'trabajo' | 'franco' | 'vacaciones' | 'licencia'
export interface Carga { legajo: string; fecha: string; local: string | null; horario: string | null; horas: number; tipo: Tipo }
export interface Marcacion { legajo: string; fecha: string; local: string | null; marcas: string | null; horario: string | null; horas: number; incompleta: boolean }
export interface Emp { legajo: string; nombre: string; local: string; horasSem: number | null; plan: boolean; puesto: string }
export interface Apertura { local: string; dias: string; abre: string; cierra: string }

export const pad = (n: number) => String(n).padStart(2, '0')
export const iso = (a: number, m: number, d: number) => `${a}-${pad(m + 1)}-${pad(d)}`
export const sumarDias = (f: string, n: number) => {
  const d = new Date(`${f}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const dow = (f: string) => new Date(`${f}T12:00:00Z`).getUTCDay()
export const lunesDe = (f: string) => sumarDias(f, -((dow(f) + 6) % 7))
export const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`
export const hhmm = (min: number) => `${min < 0 ? '-' : ''}${pad(Math.floor(Math.abs(min) / 60))}:${pad(Math.round(Math.abs(min) % 60))}`
export const aMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))
export const duracion = (ent: string, sal: string) => { let d = aMin(sal) - aMin(ent); if (d <= 0) d += 1440; return d }

/** «10» → 10:00, «9:30» / «9.30» / «930» → 09:30. null = vacío, 'error' = no se entiende */
export function parsearHora(txt: string): string | null | 'error' {
  const t = txt.trim().toLowerCase().replace(/\s*hs?$/, '')
  if (!t) return null
  const m = t.match(/^(\d{1,2})(?:[:.](\d{2}))?$/) ?? t.match(/^(\d{1,2})(\d{2})$/)
  if (!m) return 'error'
  const h = Number(m[1]), mi = Number(m[2] ?? 0)
  return h <= 24 && mi <= 59 ? `${pad(h)}:${pad(mi)}` : 'error'
}

/** Tramos de un horario «10:00-14:00 17:00-21:00» */
export function tramosDe(horario: string | null | undefined): [string, string][] {
  if (!horario) return []
  return [...horario.matchAll(/(\d{2}:\d{2})-(\d{2}:\d{2})/g)].map((m) => [m[1], m[2]] as [string, string])
}

/** Local del legajo: el lugar, o el sector cuando el lugar dice LOCALES */
export function localDe(lugar: string | null, sector: string | null): string {
  const l = (lugar || '').trim().toUpperCase()
  if (l && l !== 'LOCALES') return l
  return (sector || '').trim().toUpperCase() || 'SIN LOCAL'
}

/** Palabras de un nombre, sin tildes ni signos */
export function tokens(s: string): string[] {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(Boolean)
}
