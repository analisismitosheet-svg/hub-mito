-- ¿Puede un legajo del piso (4004) leer los armados? Sólo los contadores,
-- sin tocar nada del esquema private.
--   node scripts/supabase-sql.mjs qwlugajzxrrwckrqlrjp scripts/test-armados-rls.sql --raw
SELECT set_config('request.jwt.claims',
  '{"sub":"33adeafe-1552-4dc5-9527-a9631adce81d","role":"authenticated"}', false);

SET ROLE authenticated;

SELECT
  (SELECT count(*) FROM public.mayorista_armados)       AS armados_visibles,
  (SELECT count(*) FROM public.mayorista_armados_items) AS items_visibles;
