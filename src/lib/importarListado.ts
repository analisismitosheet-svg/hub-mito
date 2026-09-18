// Lectura del Excel "Listado - MITO": una hoja por categoría de legajo.
// Cada hoja tiene sus propios encabezados, así que hay un mapeo por categoría.

export const ESTADOS_HOJA = ['NOMINA ACTIVA', 'PLANES ACTIVOS', 'BAJAS MITO', 'BAJAS PLANES'] as const

const MAPEO: Record<string, Record<string, string[]>> = {
  'NOMINA ACTIVA': {
    nombre: ['apellido y nombre'],
    legajo: ['n legajo', 'legajo'],
    lugar: ['lugar'],
    area_sector: ['area/sector'],
    horas: ['horas'],
    convenio: ['convenio'],
    categoria: ['categoria'],
    puesto: ['puesto'],
    comision: ['comision'],
    reingreso: ['reingreso'],
    fecha_ingreso: ['fecha de ingreso'],
    antiguedad_2025: ['antiguedad 2025'],
    dias_vacaciones_2025: ['dias de vacac 2025'],
    cuil: ['cuil'],
    dni: ['dni'],
    fecha_nacimiento: ['fecha de nac'],
    sexo: ['sexo'],
    telefono: ['telefonos de contacto'],
    domicilio: ['domicilio'],
    email: ['email'],
    codigo_os: ['codigo os'],
    prepaga: ['prepaga'],
    tipo_contrato: ['tipo de contrato'],
    entrega_remeras: ['entrega de remeras'],
    contacto_emergencia: ['apellido y nombre contacto emergencia'],
    parentesco: ['parentesco'],
    telefono_emergencia: ['n telefonico'],
  },
  'PLANES ACTIVOS': {
    nombre: ['apellido y nombre'],
    legajo: ['n legajo', 'legajo'],
    plan: ['plan'],
    lugar: ['lugar'],
    horas: ['horas'],
    comision: ['comision'],
    fecha_ingreso: ['fecha de ingreso'],
    cuil: ['cuil'],
    dni: ['dni'],
    fecha_nacimiento: ['fecha de nac'],
    sexo: ['sexo'],
    obra_social: ['obra social'],
    fin_plan: ['fin del plan'],
    domicilio: ['domicilio'],
    entrega_remeras: ['entrega de remeras'],
    telefono: ['telefono de contacto'],
    email: ['email'],
    contacto_emergencia: ['apellido y nombre contacto emergencia'],
    parentesco: ['parentesco'],
    telefono_emergencia: ['n telefonico'],
  },
  'BAJAS MITO': {
    legajo: ['vend'],
    nombre: ['apellido y nombre'],
    horas: ['hs'],
    convenio: ['convenio'],
    categoria: ['categoria'],
    cuil: ['cuil'],
    fecha_nacimiento: ['nacim'],
    fecha_ingreso: ['ingreso'],
    fecha_egreso: ['egreso'],
    motivo_baja: ['motivo'],
    telefono: ['telefonos'],
    domicilio: ['domicilio'],
    email: ['mail'],
    contacto_emergencia: ['apellido y nombre contacto emergencia'],
    parentesco: ['parentesco'],
    telefono_emergencia: ['n telefonico'],
  },
  'BAJAS PLANES': {
    nombre: ['nombre'],
    dni: ['dni'],
    plan: ['plan'],
    lugar: ['local'],
    legajo: ['n'],
    fecha_ingreso: ['ingreso'],
    fecha_egreso: ['egreso'],
    motivo_baja: ['motivo'],
    cuil: ['cuil'],
    fecha_nacimiento: ['nacim'],
    telefono: ['telefonos'],
    domicilio: ['domicilio'],
    email: ['mail'],
    contacto_emergencia: ['apellido y nombre contacto emergencia'],
    parentesco: ['parentesco'],
    telefono_emergencia: ['n telefonico'],
  },
}

const CAMPOS_FECHA = new Set(['fecha_ingreso', 'fecha_nacimiento', 'fecha_egreso', 'fin_plan', 'entrega_remeras'])
const CAMPOS_NUMERO = new Set(['horas', 'antiguedad_2025', 'dias_vacaciones_2025'])

/** Normaliza un encabezado: sin acentos, sin símbolos raros, en minúscula. */
function norm(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[°º]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Fecha de Excel (serie o texto) a ISO yyyy-mm-dd. */
export function fechaExcelAISO(v: unknown): string | null {
  if (v == null || v === '') return null
  if (typeof v === 'number' && v > 0) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000))
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  }
  const s = String(v).trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (/^\d+(\.\d+)?$/.test(s)) return fechaExcelAISO(Number(s))
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (m) {
    let y = +m[3]
    if (y < 100) y += y < 40 ? 2000 : 1900
    return `${y}-${String(+m[2]).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`
  }
  return null
}

function aNumero(v: unknown): number | null {
  const s = String(v ?? '').trim().replace(',', '.')
  if (!s) return null
  const n = Number(s)
  return isNaN(n) ? null : n
}

/** Busca la columna: primero por nombre exacto, después por "empieza con" y por "contiene". */
function indiceCol(cabecera: string[], candidatos: string[]): number {
  for (const c of candidatos) {
    const i = cabecera.findIndex((h) => h === c)
    if (i >= 0) return i
  }
  for (const c of candidatos) {
    const i = cabecera.findIndex((h) => h.startsWith(c))
    if (i >= 0) return i
  }
  for (const c of candidatos) {
    const i = cabecera.findIndex((h) => h.includes(c))
    if (i >= 0) return i
  }
  return -1
}

/** En estas hojas el encabezado no siempre está en la primera fila. */
function filaEncabezado(filas: unknown[][]): number {
  let mejor = 0
  let mejorPuntaje = -1
  for (let i = 0; i < Math.min(6, filas.length); i++) {
    const celdas = filas[i].map(norm)
    const llenas = celdas.filter((c) => c !== '').length
    const tieneNombre = celdas.some((c) => c === 'nombre' || c.startsWith('apellido y nombre'))
    const puntaje = llenas + (tieneNombre ? 100 : 0)
    if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = i }
  }
  return mejor
}

export interface ResultadoLectura {
  /** filas listas para guardar, agrupadas por categoría */
  porEstado: Record<string, Record<string, unknown>[]>
  avisos: string[]
}

/**
 * Lee el libro y arma las filas de cada categoría.
 * Si el archivo tiene una sola hoja y no coincide con ninguna categoría conocida,
 * se interpreta con el mapeo de `estadoPorDefecto`.
 */
export async function leerListado(file: File, estadoPorDefecto: string): Promise<ResultadoLectura> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', raw: false })
  const porEstado: Record<string, Record<string, unknown>[]> = {}
  const avisos: string[] = []

  for (const hoja of wb.SheetNames) {
    const clave = norm(hoja).toUpperCase()
    const estado = (ESTADOS_HOJA as readonly string[]).find((e) => norm(e).toUpperCase() === clave)
      ?? (wb.SheetNames.length === 1 ? estadoPorDefecto : null)
    if (!estado) { avisos.push(`Hoja "${hoja}": no coincide con ninguna categoría, se ignoró.`); continue }

    const mapa = MAPEO[estado]
    if (!mapa) continue

    const filas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[hoja], { header: 1, defval: '', blankrows: false })
    if (filas.length < 2) { avisos.push(`Hoja "${hoja}": vacía.`); continue }
    const iCab = filaEncabezado(filas)
    const cabecera = (filas[iCab] as unknown[]).map(norm)
    const indices: Record<string, number> = {}
    for (const [campo, candidatos] of Object.entries(mapa)) indices[campo] = indiceCol(cabecera, candidatos)
    if (indices.nombre < 0) { avisos.push(`Hoja "${hoja}": no se encontró la columna de nombre.`); continue }

    const salida: Record<string, unknown>[] = []
    let sinNombre = 0
    for (const fila of filas.slice(iCab + 1)) {
      const crudo = (i: number) => (i >= 0 ? String((fila as unknown[])[i] ?? '').trim() : '')
      const nombre = crudo(indices.nombre)
      if (!nombre) { sinNombre++; continue }
      const reg: Record<string, unknown> = { estado_legajo: estado }
      for (const campo of Object.keys(mapa)) {
        const i = indices[campo]
        if (i < 0) continue
        const v = (fila as unknown[])[i]
        if (CAMPOS_FECHA.has(campo)) reg[campo] = fechaExcelAISO(v)
        else if (CAMPOS_NUMERO.has(campo)) reg[campo] = aNumero(v)
        else reg[campo] = String(v ?? '').trim() || null
      }
      salida.push(reg)
    }
    if (sinNombre) avisos.push(`Hoja "${hoja}": ${sinNombre} fila${sinNombre === 1 ? '' : 's'} sin nombre que se saltearon.`)
    porEstado[estado] = (porEstado[estado] ?? []).concat(salida)
  }

  return { porEstado, avisos }
}

/**
 * Clave para no duplicar una baja al reimportar el mismo archivo.
 * Incluye ingreso y egreso porque una misma persona puede tener varias bajas.
 */
export function claveBaja(r: { cuil?: unknown; nombre?: unknown; fecha_ingreso?: unknown; fecha_egreso?: unknown }): string {
  const id = String(r.cuil ?? '').replace(/\D/g, '') || String(r.nombre ?? '').trim().toUpperCase()
  return `${id}|${String(r.fecha_ingreso ?? '')}|${String(r.fecha_egreso ?? '')}`
}

/** Solo dígitos, para comparar CUIL entre hojas. */
export function soloDigitos(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '')
}
