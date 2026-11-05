-- =====================================================================
-- Recepción INDO: el depósito se guarda siempre igual ("Indo", "Mito")
-- (05/11/2026)
--
-- Los Excel nuevos traían "indo" en minúscula y el filtro de Depósito
-- mostraba "indo" e "Indo" como si fueran dos. El trigger lo normaliza en
-- cualquier camino (importar Excel, Nuevo registro, editar la celda) y el
-- UPDATE unifica lo que ya estaba cargado. La clave natural no cambia: ya se
-- arma en mayúsculas (claveRecepcion -> normalizar).
-- =====================================================================
BEGIN;

CREATE OR REPLACE FUNCTION private.recepcion_indo_deposito()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.deposito := initcap(regexp_replace(btrim(coalesce(NEW.deposito, '')), '\s+', ' ', 'g'));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recepcion_indo_deposito ON public.recepcion_indo;
CREATE TRIGGER recepcion_indo_deposito
  BEFORE INSERT OR UPDATE ON public.recepcion_indo
  FOR EACH ROW EXECUTE FUNCTION private.recepcion_indo_deposito();

-- Unificar lo existente. Se corre como admin para que el trigger de bloqueo
-- (recepciones cerradas) no descarte el cambio.
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (SELECT u.id FROM public.usuarios u WHERE u.es_admin OR u.rol = 'administrador' LIMIT 1),
    'role', 'authenticated'
  )::text,
  true
);

UPDATE public.recepcion_indo
   SET deposito = deposito
 WHERE deposito IS DISTINCT FROM initcap(regexp_replace(btrim(coalesce(deposito, '')), '\s+', ' ', 'g'));

COMMIT;
