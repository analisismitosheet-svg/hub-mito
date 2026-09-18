// Qué columnas se ven en cada categoría de legajo.
// El orden y el recorte salen de las hojas del Excel "Listado - MITO":
// NOMINA ACTIVA y BAJAS MITO comparten la ficha, pero una baja solo muestra
// los campos de la hoja de bajas. Lo mismo entre PLANES ACTIVOS y BAJAS PLANES.

export type TipoCol = 'texto' | 'numero' | 'fecha' | 'derivada'

export interface ColDef {
  label: string
  tipo?: TipoCol
  /** ocupa varias líneas (domicilio, motivo, contacto) */
  wrap?: boolean
  /** muestra el filtro tipo Excel en el encabezado */
  filtrable?: boolean
  /** en el formulario: tipo de control */
  campo?: 'texto' | 'fecha' | 'numero' | 'select' | 'autocomplete'
}

export const COLUMNAS: Record<string, ColDef> = {
  legajo: { label: 'Legajo', filtrable: true },
  nombre: { label: 'Nombre' },
  dni: { label: 'DNI' },
  cuil: { label: 'CUIL' },
  fecha_nacimiento: { label: 'Nacimiento', tipo: 'fecha', campo: 'fecha' },
  sexo: { label: 'Sexo', filtrable: true, campo: 'select' },
  lugar: { label: 'Lugar', filtrable: true, campo: 'autocomplete' },
  area_sector: { label: 'Área / Sector', filtrable: true, campo: 'autocomplete' },
  categoria: { label: 'Categoría', filtrable: true, campo: 'autocomplete' },
  puesto: { label: 'Puesto', filtrable: true, campo: 'autocomplete' },
  horas: { label: 'Horas', tipo: 'numero', campo: 'numero' },
  convenio: { label: 'Convenio', filtrable: true, campo: 'autocomplete' },
  comision: { label: 'Comisión' },
  reingreso: { label: 'Reingreso' },
  fecha_ingreso: { label: 'Ingreso', tipo: 'fecha', campo: 'fecha' },
  fecha_egreso: { label: 'Egreso', tipo: 'fecha', campo: 'fecha' },
  motivo_baja: { label: 'Motivo', wrap: true, filtrable: true },
  antiguedad: { label: 'Antigüedad', tipo: 'derivada' },
  vacaciones: { label: 'Vacaciones', tipo: 'derivada' },
  plan: { label: 'Plan', filtrable: true, campo: 'autocomplete' },
  fin_plan: { label: 'Fin del plan', tipo: 'fecha', campo: 'fecha' },
  obra_social: { label: 'Obra social', filtrable: true, campo: 'autocomplete' },
  entrega_remeras: { label: 'Entrega remeras' },
  prepaga: { label: 'Prepaga', filtrable: true, campo: 'autocomplete' },
  tipo_contrato: { label: 'Contrato', filtrable: true, campo: 'autocomplete' },
  codigo_os: { label: 'Código OS', filtrable: true },
  telefono: { label: 'Teléfono' },
  domicilio: { label: 'Domicilio', wrap: true },
  email: { label: 'Email' },
  contacto_emergencia: { label: 'Contacto emerg.', wrap: true },
  parentesco: { label: 'Parentesco' },
  telefono_emergencia: { label: 'Tel. emerg.' },
}

/** Columnas visibles por categoría, en el mismo orden que la hoja del Excel. */
export const COLUMNAS_POR_ESTADO: Record<string, string[]> = {
  'NOMINA ACTIVA': [
    'legajo', 'nombre', 'lugar', 'area_sector', 'horas', 'convenio', 'categoria', 'puesto',
    'comision', 'reingreso', 'fecha_ingreso', 'antiguedad', 'vacaciones', 'cuil', 'dni',
    'fecha_nacimiento', 'sexo', 'telefono', 'domicilio', 'email', 'codigo_os', 'prepaga',
    'tipo_contrato', 'contacto_emergencia', 'parentesco', 'telefono_emergencia',
  ],
  'PLANES ACTIVOS': [
    'legajo', 'nombre', 'plan', 'lugar', 'horas', 'comision', 'fecha_ingreso', 'cuil', 'dni',
    'fecha_nacimiento', 'sexo', 'obra_social', 'fin_plan', 'domicilio', 'entrega_remeras',
    'telefono', 'email', 'contacto_emergencia', 'parentesco', 'telefono_emergencia',
  ],
  'BAJAS MITO': [
    'legajo', 'nombre', 'horas', 'convenio', 'categoria', 'cuil', 'fecha_nacimiento',
    'fecha_ingreso', 'fecha_egreso', 'motivo_baja', 'telefono', 'domicilio', 'email',
    'contacto_emergencia', 'parentesco', 'telefono_emergencia',
  ],
  'BAJAS PLANES': [
    'legajo', 'nombre', 'dni', 'plan', 'lugar', 'fecha_ingreso', 'fecha_egreso', 'motivo_baja',
    'cuil', 'fecha_nacimiento', 'telefono', 'domicilio', 'email',
    'contacto_emergencia', 'parentesco', 'telefono_emergencia',
  ],
}

/** Campos editables del formulario: los mismos que se ven, sin las derivadas. */
export function camposDeEstado(estado: string): string[] {
  return (COLUMNAS_POR_ESTADO[estado] ?? COLUMNAS_POR_ESTADO['NOMINA ACTIVA'])
    .filter((c) => COLUMNAS[c]?.tipo !== 'derivada')
}

export function columnasDeEstado(estado: string): string[] {
  return COLUMNAS_POR_ESTADO[estado] ?? COLUMNAS_POR_ESTADO['NOMINA ACTIVA']
}
