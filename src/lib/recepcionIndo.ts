/* ------------------------------------------------------------------ */
/*  Recepción INDO (Depósito)                                          */
/*                                                                      */
/*  Lee el Excel "Recepción de Mercadería" (el que arma el depósito)   */
/*  y lo deja listo para guardar en public.recepcion_indo.            */
/*                                                                      */
/*  El Excel es medio sucio a propósito: las columnas traen links de    */
/*  Google Drive, fechas como texto ("22/09/0226"), "----", "SIN       */
/*  REMITO" y el queIpso... Por eso todo se resuelve por encabezado     */
/*  (con alias) y cada valor se castea con tolerancia.                 */
/* ------------------------------------------------------------------ */

/** Una fila del Excel ya limpia, lista para el upsert. */
export interface RecepcionIndo {
  /** clave natural (ver `claveRecepcion`): no cambia al reimportar el mismo Excel */
  clave: string
  nGuia: string
  transporte: string
  bultos: number
  deposito: string
  proveedor: string
  nRemito: string
  fechaRemito: string | null
  mes: number | null
  /** puede venir "15183/15347/15329" (una fila por guía con varias OC) */
  nOc: string
  ocCargadaDragon: boolean
  nFactura: string
  fechaFactura: string | null
  /** la columna "Factura" del Excel es un link de Drive al comprobante */
  facturaLink: string | null
  fechaIngreso: string | null
  fechaControlada: string | null
  estado: string
  iva: number | null
  detalle: string
}

/** Columnas del Excel que nos interesan y en qué índice caen. */
export type Indices = {
  nGuia: number
  transporte: number
  bultos: number
  deposito: number
  proveedor: number
  nRemito: number
  fechaRemito: number
  mes: number
  nOc: number
  ocCargadaDragon: number
  nFactura: number
  fechaFactura: number
  facturaLink: number
  fechaIngreso: number
  fechaControlada: number
  estado: number
  iva: number
  detalle: number
}

/** "N° OC" -> "N OC", "Fecha de factura " -> "FECHA DE FACTURA" */
export function normalizar(v: unknown): string {
  return aTexto(v)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[°º]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

export function aTexto(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? 'true' : ''
  return String(v).trim()
}

export function aNumero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const t = aTexto(v)
  if (!t) return null
  const n = Number(t.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export function aBooleano(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  const t = normalizar(v)
  return t === 'TRUE' || t === 'SI' || t === 'S' || t === '1' || t === 'X'
}

/** Días desde 1970-01-01 (serial 25569 de Excel) hasta el 1900 del Excel. */
const EXCEL_EPOCH = 25569

/**
 * Fecha del Excel -> "YYYY-MM-DD". Acepta el número serial (así viene con raw: true),
 * un Date, o texto "dd/mm/aaaa" / "dd-mm-aa". Devuelve null si no hay fecha
 * ("----", "SIN REMITO", un link de Drive, vacío...).
 *
 * El año de 4+ dígitos se interpreta como "los dos últimos": "0226" -> 2026.
 */
export function aFecha(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // Excel no tiene zona horaria: se leen las partes locales, no toISOString()
    // (con UTC negativo un toISOString() corría la fecha un día).
    return `${String(v.getFullYear()).padStart(4, '0')}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v <= 0 || v > 2958465) return null // fuera de rango de Excel
    const d = new Date((v - EXCEL_EPOCH) * 86400000)
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  }
  const t = aTexto(v)
  if (!t) return null
  if (/^\d{1,6}(\.\d+)?$/.test(t)) return aFecha(Number(t))
  const m = /(\d{1,2})[/-](\d{1,2})[/-](\d{2,6})/.exec(t)
  if (!m) return null
  const dia = Number(m[1])
  const mes = Number(m[2])
  const crudo = m[3]
  let an = Number(crudo)
  if (crudo.length > 2) an = 2000 + (an % 100) // "0226" -> 2026
  else if (an < 100) an += an <= 49 ? 2000 : 1900
  if (!an || an < 1900 || an > 2100 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null
  return `${String(an).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/** Link de la columna "Factura" (o de cualquier celda): solo si parece una URL. */
function aLink(v: unknown): string | null {
  const t = aTexto(v)
  return /^https?:\/\//i.test(t) ? t : null
}

/**
 * Cómo ubicar cada columna. Todo anclado (^...$) porque si no "N° de factura" y
 * "Fecha de factura" se pisan entre sí. El orden importa: primero el patrón exacto.
 */
const REGLAS: [keyof Indices, RegExp[]][] = [
  ['nGuia', [/^N (DE )?GUIA$/, /GUIA/]],
  ['transporte', [/^TRANSPORTE( O|ISTA)?$/, /TRANSPORT/]],
  ['bultos', [/^BULTOS?$/, /BULT/]],
  ['deposito', [/^DEPOSITO$/, /DEPOSITO/]],
  ['proveedor', [/^PROVEEDOR/, /PROVEEDOR/]],
  ['nRemito', [/^N (DE )?REMITO$/, /REMITO/]],
  ['fechaRemito', [/^FECHA (DEL |DE )?REMITO$/, /REMITO/]],
  ['mes', [/^MES$/, /MES/]],
  ['nOc', [/^N ?(DE )?OCS?$/, /OCS?$/]],
  ['ocCargadaDragon', [/^OC CARGADA/, /CARGAD/, /DRAGON/]],
  ['nFactura', [/^N (DE )?FACTURA( N)?$/, /^FACTURA N/]],
  ['fechaFactura', [/^FECHA (DE |DEL )?FACTURA$/, /FACTURA/]],
  ['facturaLink', [/^FACTURA( N)?$/, /FACTURA/]],
  ['fechaIngreso', [/^FECHA (DE )?INGRESO$/, /INGRESO/]],
  ['fechaControlada', [/^FECHA (DE )?CONTROL(AD)?/, /CONTROLAD/]],
  // en este Excel el estado no tiene nombre ("Columna 17")
  ['estado', [/^COLUMNA \d+$/, /ESTADO/, /SITUACION/]],
  ['iva', [/^IVA( \$|\$)?$/, /IVA/, /IMPORTE/]],
  ['detalle', [/^DETALLE$/, /DETALLE/, /OBSERV/]],
]

/** Índice de cada columna en el encabezado dado. Faltan (-1) los que no aparecen. */
export function resolverIndices(cabecera: unknown[]): Partial<Indices> {
  const cab = cabecera.map(normalizar)
  const usado = new Set<number>()
  const out: Partial<Indices> = {}
  for (const [campo, patrones] of REGLAS) {
    for (const re of patrones) {
      const i = cab.findIndex((h, k) => h !== '' && !usado.has(k) && re.test(h))
      if (i >= 0) {
        out[campo] = i
        usado.add(i)
        break
      }
    }
  }
  return out
}

/** Cuántas columnas reconnocidas tiene este encabezado (para elegir la fila de títulos). */
function columnasReconocidas(fila: unknown[]): number {
  const idx = resolverIndices(fila)
  return Object.keys(idx).length
}

/** Fila de encabezados: la primera que reconoce columnas conocidas. */
export function filaEncabezado(filas: unknown[][]): number {
  let mejor = -1
  let mejorN = 5
  for (let i = 0; i < Math.min(filas.length, 15); i++) {
    const f = filas[i]
    if (!Array.isArray(f) || !f.some((c) => aTexto(c) !== '')) continue
    const n = columnasReconocidas(f)
    if (n > mejorN) {
      mejorN = n
      mejor = i
    }
  }
  return mejorN >= 6 ? mejor : -1
}

/**
 * Clave natural de la fila. No incluye el estado, el IVA, el detalle ni las fechas de
 * control: reimportar el mismo Excel actualiza la fila en vez de duplicarla.
 * Verificada contra el archivo real: 1.605 filas -> 1.605 claves.
 */
export function claveRecepcion(f: Omit<RecepcionIndo, 'clave'>): string {
  return [f.nGuia, f.deposito, f.proveedor, f.nRemito, f.fechaRemito ?? '', f.fechaIngreso ?? '', f.nFactura]
    .map(normalizar)
    .join('|')
}

/** Resultado de la lectura, para poder avisarle al usuario qué se saltó. */
export interface LecturaRecepcion {
  filas: RecepcionIndo[]
  /** fila de títulos dentro de la hoja (0 = primera) */
  filaEncabezado: number
  /** columnas del Excel que no se pudieron ubicar */
  faltantes: string[]
  /** filas con formato pero sin un solo dato (el archivo trae ~6.400 así) */
  descartadas: number
  /** filas repetidas con la misma clave natural: se conserva la primera */
  duplicadas: number
  /** celdas que no son una fecha (para avisar, no para frenar) */
  fechasCero: number
}

/**
 * Lee la hoja del Excel. `filas` sale de `sheet_to_json(ws, { header: 1, raw: true })`:
 * con raw:true las fechas llegan como serial y el casteo es determinístico.
 */
export function leerRecepcionIndo(filas: unknown[][]): LecturaRecepcion {
  const iCab = filaEncabezado(filas)
  if (iCab < 0) throw new Error('No se encontró la fila de encabezados del Excel de Recepción de Mercadería.')
  const idx = resolverIndices(filas[iCab])
  const pedir = (campo: keyof Indices, fila: unknown[]): unknown =>
    idx[campo] !== undefined ? fila[idx[campo] as number] : null

  const faltantes = (Object.keys(idx) as (keyof Indices)[]).length < REGLAS.length
    ? REGLAS.filter(([c]) => idx[c] === undefined).map(([c]) => c)
    : []

  const out: RecepcionIndo[] = []
  const vistas = new Set<string>()
  let descartadas = 0
  let duplicadas = 0
  let fechasCero = 0

  for (let i = iCab + 1; i < filas.length; i++) {
    const f = filas[i]
    if (!Array.isArray(f) || !f.some((c) => aTexto(c) !== '')) continue

    const fechaRemito = aFecha(pedir('fechaRemito', f))
    const fechaFactura = aFecha(pedir('fechaFactura', f))
    const fechaIngreso = aFecha(pedir('fechaIngreso', f))
    const fechaControlada = aFecha(pedir('fechaControlada', f))
    for (const [celda, valor] of [
      [pedir('fechaRemito', f), fechaRemito],
      [pedir('fechaFactura', f), fechaFactura],
      [pedir('fechaIngreso', f), fechaIngreso],
      [pedir('fechaControlada', f), fechaControlada],
    ] as [unknown, string | null][]) {
      if (aTexto(celda) !== '' && valor === null) fechasCero++
    }

    const base: Omit<RecepcionIndo, 'clave'> = {
      nGuia: aTexto(pedir('nGuia', f)),
      transporte: aTexto(pedir('transporte', f)),
      bultos: aNumero(pedir('bultos', f)) ?? 0,
      deposito: aTexto(pedir('deposito', f)),
      proveedor: aTexto(pedir('proveedor', f)),
      nRemito: aTexto(pedir('nRemito', f)),
      fechaRemito,
      mes: aNumero(pedir('mes', f)),
      nOc: aTexto(pedir('nOc', f)),
      ocCargadaDragon: aBooleano(pedir('ocCargadaDragon', f)),
      nFactura: aTexto(pedir('nFactura', f)),
      fechaFactura,
      facturaLink: aLink(pedir('facturaLink', f)),
      fechaIngreso,
      fechaControlada,
      estado: aTexto(pedir('estado', f)),
      iva: aNumero(pedir('iva', f)),
      detalle: aTexto(pedir('detalle', f)),
    }

    // Fila con formato pero sin nada (el archivo trae ~6.400 así): se saltea.
    // También las que solo tienen depósito/proveedor y ningún comprobante.
    const tieneAlgo =
      base.nGuia !== '' || base.nRemito !== '' || base.nFactura !== '' || base.detalle !== '' ||
      base.bultos > 0 || base.fechaIngreso !== null || base.nOc !== ''
    if (!tieneAlgo) {
      descartadas++
      continue
    }

    const clave = claveRecepcion(base)
    if (vistas.has(clave)) {
      duplicadas++
      continue
    }
    vistas.add(clave)
    out.push({ ...base, clave })
  }

  return { filas: out, filaEncabezado: iCab, faltantes, descartadas, duplicadas, fechasCero }
}
