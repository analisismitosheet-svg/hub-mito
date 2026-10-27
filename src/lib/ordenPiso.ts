/* ------------------------------------------------------------------ */
/*  Orden con el que el piso recorre un repo o un armado:              */
/*  ubicación del depósito → código → color → talle.                    */
/*  Así el que arma no vuelve dos veces al mismo estante y, dentro del */
/*  mismo artículo, los talles salen de menor a mayor.                 */
/* ------------------------------------------------------------------ */

/** Plantas sugeridas del depósito, en el orden en que se recorren. */
export const PLANTAS: { codigo: string; nombre: string }[] = [
  { codigo: 'PB', nombre: 'Planta baja' },
  { codigo: 'EP', nombre: 'Entrepiso' },
  { codigo: 'P1', nombre: 'Primer piso' },
  { codigo: 'P2', nombre: 'Segundo piso' },
]

/** Orden de plantas: las sugeridas en su orden, después el resto alfabético */
export function ordenPlanta(planta: string): number {
  const i = PLANTAS.findIndex((p) => p.codigo === planta)
  return i === -1 ? PLANTAS.length : i
}

function partesUbicacion(u: string): [number, string, string, number] | null {
  const m = /^([A-Z0-9]+)-([A-Z])(\d+)$/.exec(u.trim().toUpperCase())
  return m ? [ordenPlanta(m[1]), m[1], m[2], Number(m[3])] : null
}

/** Compara ubicaciones en el orden del depósito (PB-A1 < PB-A2 < PB-A10 < PB-B1 < EP-A1) */
export function compararUbicaciones(a: string, b: string): number {
  const pa = partesUbicacion(a)
  const pb = partesUbicacion(b)
  if (!pa || !pb) return pa ? -1 : pb ? 1 : a.localeCompare(b)
  return pa[0] - pb[0] || pa[1].localeCompare(pb[1]) || pa[2].localeCompare(pb[2]) || pa[3] - pb[3]
}

/** Talles de letra, de menor a mayor. 2XL = XXL, 3XL = XXXL, 4XL = XXXXL. */
const TALLES_LETRA = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'XXXXL', 'XXXXXL']

/** "3XL" -> "XXXL"; deja igual lo que ya viene como sigla o número. */
function siglaTalle(talle: string | null | undefined): string {
  return String(talle ?? '').trim().toUpperCase().replace(/^(\d)XL$/, (_, n: string) => `${'X'.repeat(Number(n))}L`)
}

/**
 * [grupo, valor] para ordenar: primero los talles de letra por tamaño,
 * después los numéricos (28, 30, 32…) y al final el resto (U, SM…).
 */
function rangoTalle(talle: string | null | undefined): [number, number] {
  const s = siglaTalle(talle)
  const i = TALLES_LETRA.indexOf(s)
  if (i >= 0) return [0, i]
  const n = Number(s.replace(',', '.'))
  if (s !== '' && Number.isFinite(n)) return [1, n]
  return [2, 0]
}

/** XS, S, M, L, XL, XXL, 3XL, 4XL… después los números y al final el resto. */
export function compararTalles(a: string | null | undefined, b: string | null | undefined): number {
  const [ga, va] = rangoTalle(a)
  const [gb, vb] = rangoTalle(b)
  return ga - gb || va - vb || String(a ?? '').localeCompare(String(b ?? ''), 'es', { numeric: true })
}

const txt = (v: unknown) => String(v ?? '').trim().toUpperCase()

/** Una línea de repo o de armado, mirada sólo por lo que hace falta para ordenarla. */
export interface LineaPiso {
  /** código del artículo (en repos es `codigo`, en armados `articulo`) */
  codigo: string | null | undefined
  color: string | null | undefined
  talle: string | null | undefined
}

/**
 * Compara dos líneas por ubicación → código → color → talle.
 * `ubicA` / `ubicB` son la primera ubicación mapeada de cada artículo (o undefined
 * si todavía no se mapeó: esos van al final).
 */
export function compararLineasPiso(
  a: LineaPiso,
  b: LineaPiso,
  ubicA: string | undefined,
  ubicB: string | undefined,
): number {
  const porUbicacion = ubicA && ubicB ? compararUbicaciones(ubicA, ubicB) : ubicA ? -1 : ubicB ? 1 : 0
  return (
    porUbicacion ||
    txt(a.codigo).localeCompare(txt(b.codigo), 'es', { numeric: true }) ||
    txt(a.color).localeCompare(txt(b.color), 'es', { numeric: true }) ||
    compararTalles(a.talle, b.talle)
  )
}
