-- Quién cargó cada lote de Transferencias (27/11/2026).
-- transfer_lotes.subido_por apunta a usuarios, pero la tabla usuarios solo la lee
-- el admin (cada uno ve su fila). Esta función devuelve solo el nombre de quien
-- subió los lotes pedidos, para mostrarlo en cada lote de /transferencias.
-- subido_por vacío = lo cargó el programador del Puente (Cascada automática).
CREATE OR REPLACE FUNCTION public.transfer_lotes_autores(p_ids uuid[])
RETURNS TABLE(id uuid, autor text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, coalesce(nullif(btrim(u.nombre), ''), u.email)
    FROM public.transfer_lotes l
    LEFT JOIN public.usuarios u ON u.id = l.subido_por
   WHERE auth.uid() IS NOT NULL
     AND l.id = ANY (p_ids)
$$;

REVOKE ALL ON FUNCTION public.transfer_lotes_autores(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.transfer_lotes_autores(uuid[]) TO authenticated;
