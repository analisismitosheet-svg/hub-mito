/**
 * Colores de íconos sin repetir dentro de una misma pantalla (área o carpeta).
 *
 * Cada app conserva su color propio mientras nadie antes en la lista use un
 * tono parecido; si ya está usado, toma el siguiente tono libre de PALETA.
 * "Parecido" = matices a menos de DISTANCIA_MINIMA grados, así #d97706, #ea580c
 * y #f97316 cuentan como el mismo naranja. Los grises van aparte.
 */

/** Tonos bien distintos entre sí, en el orden en que se reparten */
const PALETA = [
  '#0ea5e9', // celeste
  '#22c55e', // verde
  '#a855f7', // violeta
  '#ec4899', // rosa
  '#eab308', // amarillo
  '#14b8a6', // turquesa
  '#ef4444', // rojo
  '#6366f1', // índigo
  '#84cc16', // lima
  '#f97316', // naranja
  '#d946ef', // fucsia
  '#3b82f6', // azul
  '#f43f5e', // frambuesa
  '#10b981', // esmeralda
  '#8b5cf6', // lavanda
  '#64748b', // gris
]

/** Dos tonos con matices a menos de esta distancia (grados) cuentan como "el mismo" */
const DISTANCIA_MINIMA = 22

/** Matiz en grados (0-359), o null para grises */
function matiz(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d < 0.15) return null // casi gris
  let h: number
  if (max === r) h = (g - b) / d
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return (((h * 60) % 360) + 360) % 360
}

/** Distancia entre dos matices sobre el círculo (0-180) */
function distancia(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** HSL (s 72%, l 50%) -> #rrggbb */
function deMatiz(h: number): string {
  const s = 0.72
  const l = 0.5
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0')
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`
}

/**
 * Devuelve un color por cada entrada, en el mismo orden, sin tonos parecidos:
 * conserva el propio si está libre; si no, el primero libre de la PALETA; y si
 * la paleta se agotó, genera el matiz más alejado de los ya usados.
 */
export function coloresUnicos(colores: string[]): string[] {
  const matices: number[] = []
  let grisUsado = false
  const libre = (hex: string) => {
    const h = matiz(hex)
    if (h === null) return !grisUsado
    return matices.every((u) => distancia(u, h) >= DISTANCIA_MINIMA)
  }
  const usar = (hex: string) => {
    const h = matiz(hex)
    if (h === null) grisUsado = true
    else matices.push(h)
    return hex
  }
  return colores.map((c) => {
    if (libre(c)) return usar(c)
    const dePaleta = PALETA.find(libre)
    if (dePaleta) return usar(dePaleta)
    // paleta agotada: el matiz más lejano a todos los usados
    let mejor = 0
    let mejorDist = -1
    for (let h = 0; h < 360; h += 3) {
      const dmin = Math.min(...matices.map((u) => distancia(u, h)))
      if (dmin > mejorDist) { mejorDist = dmin; mejor = h }
    }
    return usar(deMatiz(mejor))
  })
}
