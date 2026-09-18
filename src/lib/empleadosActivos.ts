/**
 * Filtro para listar solo a la gente que hoy trabaja.
 *
 * La tabla `empleados` guarda también el histórico de bajas (BAJAS MITO y
 * BAJAS PLANES), así que cualquier selector de empleados tiene que excluirlas.
 * Se contemplan los legajos sin estado cargado, que cuentan como nómina activa.
 */
export const FILTRO_EMPLEADOS_ACTIVOS =
  'estado_legajo.in.("NOMINA ACTIVA","PLANES ACTIVOS"),estado_legajo.is.null'
