-- empleados_basico: suma la columna plan (MAS 26 / FOMENTAR / PPP) al final.
-- La usa Carga Novedades para poner el tipo solo al elegir el empleado
-- (nómina -> MITO, planes -> MAS26 / PFOMENTAR / PPP). No es un dato sensible.
-- Mismo filtro y opciones que la vista original (sql/empleados_piso_seguridad_1.sql).
-- Aplicado el 24/11/2026.

CREATE OR REPLACE VIEW public.empleados_basico WITH (security_barrier = true) AS
  SELECT id, legajo, nombre, activo, estado_legajo, lugar, plan
  FROM public.empleados e
  WHERE (SELECT public.empleados_basico_ve_todos()) OR id = (SELECT public.mi_empleado_id());
