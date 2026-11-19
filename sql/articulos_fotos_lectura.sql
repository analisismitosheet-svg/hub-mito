-- Fotos de artículos: lectura para el hub y el link público de propuesta (/p/:token).
-- Son las fotos públicas de las tiendas (indonesiashop.com.ar y Captain Fin / Zimith en VentasXMayor);
-- las escribe solo puente-sql/scripts/sync-fotos-tiendanube.js con la service role.
-- FotoArticulo las busca acá cuando el código no está en public/fotos-articulos.json.

drop policy if exists articulos_fotos_lectura on public.articulos_fotos;
create policy articulos_fotos_lectura on public.articulos_fotos
  for select to anon, authenticated
  using (true);

grant select on public.articulos_fotos to anon, authenticated;
