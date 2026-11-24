-- Marca de renuncia en el listado de Empleados (pedido de RR. HH., 24/11/2026).
-- Mientras está en true el nombre se pinta para diferenciarlo, hasta que se le da la baja
-- (el botón "Dar de baja" la vuelve a false). Aplicado el 24/11/2026.

ALTER TABLE public.empleados ADD COLUMN IF NOT EXISTS renuncia boolean NOT NULL DEFAULT false;
