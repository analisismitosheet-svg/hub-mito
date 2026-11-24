// Reglas de las novedades de RR. HH. compartidas entre Carga Novedades y Empleados.

export const MESES_LIQ = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']

/** Texto de liquidación para un mes: "MES (26/mm AL 25/mm)". */
export function textoMes(mes: string): string {
  const idx = MESES_LIQ.indexOf(mes.toUpperCase())
  if (idx < 0) return mes
  // El período arranca el 26 del mes anterior
  const dd = String(idx === 0 ? 12 : idx).padStart(2, '0')
  const hh = String(idx + 1).padStart(2, '0')
  return `${mes.toUpperCase()} (26/${dd} AL 25/${hh})`
}

/** BAJA e INGRESO van al mes calendario de la fecha (así los carga RR. HH.); el resto, del 26 al 25. */
const MOTIVOS_MES_CALENDARIO = new Set(['BAJA', 'INGRESO'])

/** Período de liquidación al que pertenece una fecha ISO (del 26 en adelante es el mes siguiente,
 *  salvo BAJA e INGRESO, que quedan en el mes de la fecha). */
export function periodoDeFecha(iso: string, motivo = ''): { anio: string; mes: string } | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const y = +m[1], mm = +m[2] - 1, d = +m[3]
  const pasa = d >= 26 && !MOTIVOS_MES_CALENDARIO.has(motivo.trim().toUpperCase())
  const idx = (mm + (pasa ? 1 : 0)) % 12
  const anio = y + (pasa && mm === 11 ? 1 : 0)
  return { anio: String(anio), mes: MESES_LIQ[idx] }
}

/** Tipo de novedad según el legajo: nómina -> MITO; planes -> MAS26 / PFOMENTAR / PPP. */
export function tipoDeEmpleado(estado: string | null, plan: string | null): string {
  if (estado === 'PLANES ACTIVOS') {
    const p = (plan ?? '').toUpperCase().replace(/\s+/g, '')
    if (p.includes('MAS26')) return 'MAS26'
    if (p.includes('FOMENTAR')) return 'PFOMENTAR'
    if (p.includes('PPP')) return 'PPP'
    return ''
  }
  return 'MITO'
}
