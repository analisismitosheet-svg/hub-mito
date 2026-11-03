// Horas hábiles entre dos timestamps: solo lunes a viernes, de 09:00 a 17:00
// (el depósito cierra a las 17). Devuelve horas decimales.
const INICIO_HABIL_H = 9
const FIN_HABIL_H = 17

export function horasHabilesEntre(desdeIso: string, hastaIso: string): number {
  const desde = new Date(desdeIso)
  const hasta = new Date(hastaIso)
  if (!Number.isFinite(desde.getTime()) || !Number.isFinite(hasta.getTime()) || hasta.getTime() <= desde.getTime()) return 0
  let total = 0
  const cursor = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate(), INICIO_HABIL_H, 0, 0, 0)
  while (cursor.getTime() < hasta.getTime()) {
    const dow = cursor.getDay() // 0 = domingo, 6 = sábado
    if (dow !== 0 && dow !== 6) {
      const finDia = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), FIN_HABIL_H, 0, 0, 0)
      const a = Math.max(desde.getTime(), cursor.getTime())
      const b = Math.min(hasta.getTime(), finDia.getTime())
      if (b > a) total += b - a
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return total / 3600000
}
